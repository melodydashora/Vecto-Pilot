#!/usr/bin/env python3
"""Keep Codex state recoverable without relocating a live home."""
from __future__ import annotations
import argparse, hashlib, json, os, shutil, sqlite3, subprocess, sys, tempfile
from pathlib import Path
from contextlib import closing, contextmanager

SKIP = {"tmp", ".tmp", "app-server-control", "app-server-daemon", "thread-writer-locks"}

class Persistence:
    def __init__(self, repo_root: Path, user_home: Path | None = None, source_home: Path | None = None):
        self.repo_root = Path(repo_root).resolve()
        self.user_home = Path(user_home or Path.home()).resolve()
        self.legacy_home = self.user_home / ".codex"
        self.persistent_home = self.repo_root / ".config" / "codex-home"
        self.storage = self.repo_root / ".config" / "codex-persistence"
        self.source_home = Path(source_home).resolve() if source_home else None

    def status(self):
        return {"legacy_home": str(self.legacy_home), "legacy_exists": self.legacy_home.exists() or self.legacy_home.is_symlink(),
                "persistent_home": str(self.persistent_home), "current": str(self.storage / "current") if (self.storage / "current").is_symlink() else None}

    @contextmanager
    def lock(self):
        import fcntl
        self.storage.mkdir(parents=True, mode=0o700, exist_ok=True); os.chmod(self.storage, 0o700)
        with open(self.storage / ".lock", "a+") as f:
            fcntl.flock(f, fcntl.LOCK_EX); yield

    def _source(self):
        src = self.source_home or self.legacy_home
        if self.source_home and src not in (self.legacy_home, self.persistent_home):
            raise RuntimeError("source_home must be the managed Codex home")
        if not src.exists() or not src.is_dir(): raise RuntimeError("Codex home is unavailable")
        if src.is_symlink() and src.resolve() not in (self.persistent_home.resolve(),):
            raise RuntimeError("foreign Codex home symlink refused")
        return src.resolve()

    def _copy(self, src: Path, dst: Path):
        managed_links = []
        for p in src.rglob("*"):
            rel = p.relative_to(src)
            if any(part in SKIP for part in rel.parts) or p.name.endswith(("-wal", "-shm")) or p.is_socket(): continue
            out = dst / rel
            if p.is_symlink():
                if rel != Path("packages/standalone/current"): continue
                releases = src / "packages/standalone/releases"
                try:
                    resolved_releases = releases.resolve(strict=True)
                    resolved_target = p.resolve(strict=True)
                    valid = (not releases.is_symlink()
                             and resolved_target.is_relative_to(resolved_releases)
                             and resolved_target.is_dir())
                except OSError:
                    valid = False
                if not valid: raise RuntimeError("invalid managed Codex release symlink")
                # Installer links may be absolute; checkpoints must remain relocatable.
                target = Path("releases") / resolved_target.relative_to(resolved_releases)
                managed_links.append((out, target))
                continue
            if p.is_dir(): out.mkdir(parents=True, exist_ok=True); os.chmod(out, 0o700); continue
            out.parent.mkdir(parents=True, exist_ok=True)
            if p.name.endswith(".sqlite") or ".sqlite" in p.name:
                try:
                    with closing(sqlite3.connect(p.as_uri() + "?mode=ro", uri=True, timeout=2)) as source, closing(sqlite3.connect(out)) as dest:
                        source.backup(dest)
                    continue
                except sqlite3.Error as exc:
                    raise RuntimeError(f"SQLite checkpoint failed for {rel}") from exc
            shutil.copy2(p, out, follow_symlinks=False)
            if p.stat().st_mode & 0o111: out.chmod(0o700)
        for out, target in managed_links:
            if out.exists() or out.is_symlink(): raise RuntimeError("managed Codex link destination already exists")
            copied_target = (out.parent / target).resolve(strict=True)
            if not copied_target.is_relative_to((dst / "packages/standalone/releases").resolve(strict=True)) or not copied_target.is_dir():
                raise RuntimeError("managed Codex release was not copied")
            out.parent.mkdir(parents=True, exist_ok=True)
            out.symlink_to(target)

    def checkpoint(self):
        ignore = self.repo_root / ".gitignore"
        rules = ignore.read_text(encoding="utf-8").splitlines() if ignore.exists() else []
        if not any(line.strip() in (".config/", ".config", "/.config/", "/.config") for line in rules if line.strip() and not line.lstrip().startswith("#")):
            raise RuntimeError("private .config destination is not ignored")
        src = self._source()
        with self.lock():
            self.storage.mkdir(parents=True, exist_ok=True)
            stage = Path(tempfile.mkdtemp(prefix="snapshot-", dir=self.storage)); home = stage / "home"; home.mkdir(mode=0o700)
            self._copy(src, home)
            manifest = {"source": str(src), "files": [str(p.relative_to(home)) for p in home.rglob("*") if p.is_file()]}
            (stage / "manifest.json").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8"); os.chmod(stage / "manifest.json", 0o600)
            final = self.storage / ("snapshot-" + str(os.stat(stage).st_ino)); os.replace(stage, final)
            current = self.storage / "current.tmp"; current.unlink(missing_ok=True); current.symlink_to(final.name); os.replace(current, self.storage / "current")
            return {"snapshot": str(final), "files": len(manifest["files"]), "sqlite_databases": [x for x in manifest["files"] if ".sqlite" in x]}

    def _binary(self, home):
        candidates = [home / "packages/standalone/current/bin/codex", self.legacy_home / "packages/standalone/current/bin/codex"]
        for b in candidates:
            if b.is_file() and os.access(b, os.X_OK):
                try:
                    v = subprocess.run([str(b), "--version"], text=True, capture_output=True, timeout=5).stdout.strip()
                    if v.startswith("codex-cli "): return b
                except Exception: pass
        raise RuntimeError("managed Codex binary unavailable")

    def prepare(self):
        if self.legacy_home.exists() and not self.legacy_home.is_symlink():
            self.checkpoint(); home = self.legacy_home.resolve(); mode = "live"
        else:
            if self.legacy_home.is_symlink() and self.legacy_home.resolve() not in (self.persistent_home.resolve(),): raise RuntimeError("foreign Codex home symlink refused")
            with self.lock():
                cur = self.storage / "current"
                if not cur.exists(): raise RuntimeError("no Codex checkpoint available")
                if not self.persistent_home.exists(): shutil.copytree(cur / "home", self.persistent_home, symlinks=True)
                if not self.legacy_home.exists(): self.legacy_home.parent.mkdir(parents=True, exist_ok=True); self.legacy_home.symlink_to(self.persistent_home)
                home = self.persistent_home; mode = "persistent"
        binary = self._binary(home)
        launcher = self.user_home / ".local/bin/codex"; launcher.parent.mkdir(parents=True, exist_ok=True)
        if not launcher.exists() and not launcher.is_symlink(): launcher.symlink_to(binary)
        elif launcher.is_symlink() and not launcher.exists(): launcher.unlink(); launcher.symlink_to(binary)
        return {"home": str(home), "binary": str(binary), "mode": mode}

    def run(self, args):
        p = self.prepare(); env = os.environ.copy(); env["CODEX_HOME"] = p["home"]; os.execve(p["binary"], [p["binary"], *args], env)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("command", choices=["status","checkpoint","prepare","exec"]); ap.add_argument("args", nargs=argparse.REMAINDER)
    ns=ap.parse_args(); p=Persistence(Path(__file__).resolve().parents[1]);
    if ns.command=="status": out=p.status()
    elif ns.command=="checkpoint": out=p.checkpoint()
    elif ns.command=="prepare": out=p.prepare()
    else: p.run(ns.args[1:] if ns.args[:1]==["--"] else ns.args); return
    print(json.dumps(out, sort_keys=True))
if __name__ == "__main__": main()
