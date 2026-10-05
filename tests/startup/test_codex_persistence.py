"""Offline persistence checks using disposable homes and synthetic credentials.

Run with: python3 -m unittest discover -s tests/startup -p 'test_*.py' -v
No test reads the operator's Codex home or starts an agent session.
"""

from contextlib import closing
import importlib.util
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import unittest


HELPER = Path(__file__).resolve().parents[2] / "scripts" / "ensure-codex.py"
SPEC = importlib.util.spec_from_file_location("codex_persistence_under_test", HELPER)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
_write_bytecode = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    SPEC.loader.exec_module(MODULE)
finally:
    sys.dont_write_bytecode = _write_bytecode
Persistence = MODULE.Persistence


class CodexPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="codex-persistence-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "workspace"
        self.repo.mkdir()
        subprocess.run(
            ["git", "init", "--quiet", str(self.repo)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        (self.repo / ".gitignore").write_text(".config/\n", encoding="utf-8")
        self.user_home = self.root / "user"
        self.user_home.mkdir()
        self.home = self.user_home / ".codex"
        self.home.mkdir(mode=0o700)
        self.auth_bytes = b'{"synthetic_test_credential":"fixture-only"}\n'
        (self.home / "auth.json").write_bytes(self.auth_bytes)
        (self.home / "auth.json").chmod(0o600)
        (self.home / "config.toml").write_text(
            'model = "fixture-model"\n', encoding="utf-8"
        )
        self.binary = self.home / "packages/standalone/current/bin/codex"
        self.binary.parent.mkdir(parents=True)
        self.binary.write_text(
            "#!/bin/sh\nprintf '%s\\n' 'codex-cli 0.154.0'\n", encoding="utf-8"
        )
        self.binary.chmod(0o755)
        self.launcher = self.user_home / ".local/bin/codex"

    def persistence(self, source_home=None):
        return Persistence(self.repo, self.user_home, source_home=source_home)

    def tree_metadata(self):
        return {
            str(path.relative_to(self.root)): (
                path.lstat().st_mode,
                path.lstat().st_size,
                path.lstat().st_mtime_ns,
                path.lstat().st_ino,
                os.readlink(path) if path.is_symlink() else None,
            )
            for path in self.root.rglob("*")
        }

    def snapshot_file(self, checkpoint, name):
        snapshot = Path(checkpoint["snapshot"])
        self.assertTrue(snapshot.is_dir())
        matches = list(snapshot.rglob(name))
        self.assertEqual(len(matches), 1, matches)
        return matches[0]

    def test_status_does_not_create_or_modify_files(self):
        before = self.tree_metadata()
        self.assertIsInstance(self.persistence().status(), dict)
        self.assertEqual(before, self.tree_metadata())

    def test_prepare_keeps_live_home_and_auth_inodes(self):
        home_identity = (self.home.stat().st_dev, self.home.stat().st_ino)
        auth_inode = (self.home / "auth.json").stat().st_ino
        result = self.persistence().prepare()
        self.assertEqual(result["mode"], "live")
        self.assertEqual(Path(result["home"]).resolve(), self.home.resolve())
        self.assertFalse(self.home.is_symlink())
        self.assertEqual(home_identity, (self.home.stat().st_dev, self.home.stat().st_ino))
        self.assertEqual(auth_inode, (self.home / "auth.json").stat().st_ino)
        self.assertEqual((self.home / "auth.json").read_bytes(), self.auth_bytes)
        self.assertTrue(Path(result["binary"]).is_file())

    def test_checkpoint_captures_auth_config_and_nested_regular_files(self):
        session = self.home / "sessions/fixture/session.jsonl"
        session.parent.mkdir(parents=True)
        session.write_text('{"synthetic_session":"fixture-only"}\n', encoding="utf-8")
        checkpoint = self.persistence().checkpoint()
        self.assertEqual(self.snapshot_file(checkpoint, "auth.json").read_bytes(), self.auth_bytes)
        self.assertEqual(
            self.snapshot_file(checkpoint, "config.toml").read_bytes(),
            (self.home / "config.toml").read_bytes(),
        )
        self.assertEqual(self.snapshot_file(checkpoint, "session.jsonl").read_bytes(), session.read_bytes())

    def test_online_backup_includes_committed_wal_without_copying_sidecars(self):
        database = self.home / "state_5.sqlite"
        with closing(sqlite3.connect(database)) as writer:
            self.assertEqual(writer.execute("PRAGMA journal_mode=WAL").fetchone()[0], "wal")
            writer.execute("CREATE TABLE fixture (value TEXT)")
            writer.execute("INSERT INTO fixture VALUES ('committed-in-wal')")
            writer.commit()
            self.assertTrue(Path(str(database) + "-wal").is_file())
            # Immutable mode deliberately ignores WAL, proving this fixture
            # cannot be recovered by copying just the main database file.
            with closing(sqlite3.connect(database.as_uri() + "?immutable=1", uri=True)) as main_only:
                self.assertEqual(
                    main_only.execute("SELECT count(*) FROM sqlite_master WHERE name='fixture'").fetchone()[0],
                    0,
                )
            checkpoint = self.persistence().checkpoint()
            backup = self.snapshot_file(checkpoint, "state_5.sqlite")
            snapshot = Path(checkpoint["snapshot"])
            self.assertEqual(list(snapshot.rglob("*-wal")), [])
            self.assertEqual(list(snapshot.rglob("*-shm")), [])
            with closing(sqlite3.connect(backup.as_uri() + "?mode=ro", uri=True)) as restored:
                self.assertEqual(restored.execute("PRAGMA quick_check").fetchone()[0], "ok")
                self.assertEqual(
                    restored.execute("SELECT value FROM fixture").fetchall(),
                    [("committed-in-wal",)],
                )

    def test_checkpoint_excludes_process_runtime_and_unix_sockets(self):
        excluded = ["app-server-control", "app-server-daemon", "thread-writer-locks", "tmp", ".tmp"]
        for name in excluded:
            path = self.home / name
            path.mkdir()
            (path / "process-only-sentinel").write_text("fixture", encoding="utf-8")
        with closing(socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)) as listener:
            # Bind a short relative path: the full temporary home can exceed
            # AF_UNIX's address limit even though the filesystem path is valid.
            previous_directory = Path.cwd()
            try:
                os.chdir(self.home)
                listener.bind("fixture.sock")
            finally:
                os.chdir(previous_directory)
            self.assertTrue((self.home / "fixture.sock").is_socket())
            checkpoint = self.persistence().checkpoint()
        snapshot = Path(checkpoint["snapshot"])
        self.assertEqual(list(snapshot.rglob("process-only-sentinel")), [])
        self.assertEqual(list(snapshot.rglob("fixture.sock")), [])

    def test_missing_home_restores_latest_checkpoint_and_supports_repeat_prepare(self):
        persistence = self.persistence()
        persistence.checkpoint()
        newest_auth = b'{"synthetic_test_credential":"newest-fixture"}\n'
        (self.home / "auth.json").write_bytes(newest_auth)
        persistence.checkpoint()
        original = self.user_home / ".codex.saved-fixture"
        self.home.rename(original)
        result = self.persistence().prepare()
        self.assertEqual(result["mode"], "persistent")
        self.assertTrue(self.home.is_symlink())
        self.assertEqual(self.home.resolve(), persistence.persistent_home.resolve())
        self.assertEqual((self.home / "auth.json").read_bytes(), newest_auth)
        self.assertEqual((original / "auth.json").read_bytes(), newest_auth)
        (self.home / "auth.json").write_bytes(self.auth_bytes)
        again = self.persistence().prepare()
        self.assertEqual(again["mode"], "persistent")
        self.assertEqual((self.home / "auth.json").read_bytes(), self.auth_bytes)

    def test_live_home_wins_over_older_checkpoint(self):
        self.persistence().checkpoint()
        updated = b'{"synthetic_test_credential":"live-after-checkpoint"}\n'
        (self.home / "auth.json").write_bytes(updated)
        result = self.persistence().prepare()
        self.assertEqual(result["mode"], "live")
        self.assertEqual((self.home / "auth.json").read_bytes(), updated)

    def test_repairs_missing_and_dangling_launcher(self):
        self.persistence().prepare()
        self.assertTrue(self.launcher.is_symlink())
        self.assertTrue(self.launcher.exists())
        self.launcher.unlink()
        self.launcher.symlink_to(self.user_home / "missing-codex")
        result = self.persistence().prepare()
        self.assertTrue(self.launcher.exists())
        self.assertEqual(self.launcher.resolve(), Path(result["binary"]).resolve())

    def test_existing_regular_launcher_is_preserved(self):
        self.launcher.parent.mkdir(parents=True)
        content = b"#!/bin/sh\n# synthetic operator-managed launcher\nexit 0\n"
        self.launcher.write_bytes(content)
        self.launcher.chmod(0o755)
        inode = self.launcher.stat().st_ino
        self.persistence().prepare()
        self.assertFalse(self.launcher.is_symlink())
        self.assertEqual(self.launcher.read_bytes(), content)
        self.assertEqual(self.launcher.stat().st_ino, inode)

    def test_foreign_legacy_symlink_is_rejected_without_modification(self):
        foreign = self.user_home / "foreign-codex-home"
        self.home.rename(foreign)
        self.home.symlink_to(foreign)
        before = self.tree_metadata()
        with self.assertRaises(Exception):
            self.persistence().prepare()
        self.assertEqual(before, self.tree_metadata())

    def test_explicit_external_source_is_rejected(self):
        foreign = self.user_home / "external-home"
        foreign.mkdir()
        (foreign / "auth.json").write_bytes(self.auth_bytes)
        before = self.tree_metadata()
        with self.assertRaises(Exception):
            self.persistence(source_home=foreign).prepare()
        self.assertEqual(before, self.tree_metadata())

    def test_private_destinations_are_ignored_and_restrictive(self):
        persistence = self.persistence()
        persistence.checkpoint()
        for directory in [persistence.storage, Path(persistence.checkpoint()["snapshot"])]:
            self.assertEqual(directory.stat().st_mode & 0o077, 0)
            ignored = subprocess.run(
                ["git", "-C", str(self.repo), "check-ignore", "--quiet", str(directory)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertEqual(ignored.returncode, 0)

    def test_checkpoint_refuses_unignored_private_destination(self):
        (self.repo / ".gitignore").write_text("", encoding="utf-8")
        with self.assertRaises(Exception):
            self.persistence().checkpoint()
        self.assertEqual(list(self.repo.rglob("auth.json")), [])
        self.assertEqual((self.home / "auth.json").read_bytes(), self.auth_bytes)


    def test_real_installer_link_survives_restore(self):
        current = self.home / "packages/standalone/current"
        release = current.parent / "releases" / "0.154.0-test"
        release.parent.mkdir()
        current.rename(release)
        current.symlink_to(Path("releases") / release.name)
        (self.home / "unrelated-link").symlink_to(self.root)
        p = self.persistence()
        p.checkpoint()
        self.home.rename(self.user_home / "pre-restart-home")
        restored = p.prepare()
        link = p.persistent_home / "packages/standalone/current"
        self.assertTrue(link.is_symlink())
        self.assertEqual(os.readlink(link), "releases/0.154.0-test")
        self.assertFalse((p.persistent_home / "unrelated-link").exists())
        self.assertEqual(subprocess.check_output([restored["binary"], "--version"], text=True).strip(), "codex-cli 0.154.0")
        self.assertEqual((p.persistent_home / "auth.json").read_bytes(), self.auth_bytes)

    def test_invalid_managed_link_preserves_prior_checkpoint(self):
        p = self.persistence()
        p.checkpoint()
        previous = (p.storage / "current").resolve()
        current = self.home / "packages/standalone/current"
        release = current.parent / "releases" / "selected"
        release.parent.mkdir()
        current.rename(release)
        for target in (str(self.root), "../../../../outside", "releases/missing"):
            with self.subTest(target=target):
                current.symlink_to(target)
                try:
                    with self.assertRaises(RuntimeError):
                        p.checkpoint()
                    self.assertEqual((p.storage / "current").resolve(), previous)
                finally:
                    current.unlink()

    def test_sqlite_backup_error_preserves_previous_snapshot(self):
        from unittest import mock
        db = self.home / "state.sqlite"
        with closing(sqlite3.connect(db)) as conn:
            conn.execute("CREATE TABLE sample (value TEXT)")
            conn.execute("INSERT INTO sample VALUES ('saved')")
            conn.commit()
        p = self.persistence()
        p.checkpoint()
        previous = (p.storage / "current").resolve()
        saved = (previous / "home/state.sqlite").read_bytes()
        with mock.patch.object(MODULE.sqlite3, "connect", side_effect=sqlite3.OperationalError("synthetic backup failure")):
            with self.assertRaises(RuntimeError):
                p.checkpoint()
        self.assertEqual((p.storage / "current").resolve(), previous)
        self.assertEqual((previous / "home/state.sqlite").read_bytes(), saved)


    def test_restored_support_program_remains_executable(self):
        helper = self.binary.parent / "codex-code-mode-host"
        helper.write_text(chr(10).join(["#!/bin/sh", "echo helper-ok", ""]), encoding="utf-8")
        helper.chmod(0o755)
        p = self.persistence()
        p.checkpoint()
        self.home.rename(self.user_home / "pre-restart-home")
        p.prepare()
        restored = p.persistent_home / "packages/standalone/current/bin/codex-code-mode-host"
        self.assertEqual(subprocess.check_output([str(restored)], text=True).strip(), "helper-ok")
        self.assertEqual(restored.stat().st_mode & 0o777, 0o700)


if __name__ == "__main__":
    unittest.main()
