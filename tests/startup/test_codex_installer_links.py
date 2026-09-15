"""Installer-link regressions; fixtures never touch real Codex state."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "codex_persistence_absolute_link_test", Path(__file__).resolve().parents[2] / "scripts/ensure-codex.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Persistence = module.Persistence

class AbsoluteManagedLinkTests(unittest.TestCase):
    release_name = "0.154.0-x86_64-unknown-linux-musl"

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="codex-absolute-link-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        (self.repo / ".gitignore").write_text(".config/\n")
        self.original_user = self.root / "original_user"
        self.home = self.original_user / ".codex"
        self.standalone = self.home / "packages/standalone"
        self.release = self.standalone / "releases" / self.release_name
        executable = self.release / "bin/codex"
        executable.parent.mkdir(parents=True)
        executable.write_text("#!/bin/sh\nprintf '%s\\n' 'codex-cli 0.154.0'\n")
        executable.chmod(0o700)
        self.current = self.standalone / "current"
        self.current.symlink_to(Path("releases") / self.release_name)
        (self.home / "sessions").mkdir()
        self.session_text = '{"fixture":"preserved session"}\n'
        (self.home / "sessions/fake-session.jsonl").write_text(self.session_text)

    def test_absolute_link_restores_and_executes_after_original_home_moves(self):
        self.current.unlink()
        self.current.symlink_to(self.release)
        Persistence(self.repo, self.original_user).checkpoint()
        self.original_user.rename(self.root / "retired_user")
        new_user = self.root / "new_user"
        new_user.mkdir()
        result = Persistence(self.repo, new_user).prepare()
        restored_home = self.repo / ".config/codex-home"
        restored_link = restored_home / "packages/standalone/current"
        self.assertFalse(Path(os.readlink(restored_link)).is_absolute())
        self.assertEqual(
            restored_link.resolve(strict=True),
            (restored_home / "packages/standalone/releases" / self.release_name).resolve(),
        )
        self.assertEqual((new_user / ".codex").resolve(), restored_home.resolve())
        self.assertEqual(
            (restored_home / "sessions/fake-session.jsonl").read_text(), self.session_text
        )
        completed = subprocess.run(
            [result["binary"], "--version"], capture_output=True, text=True, check=True
        )
        self.assertEqual(completed.stdout.strip(), "codex-cli 0.154.0")

    def test_outside_absolute_link_keeps_prior_checkpoint(self):
        persistence = Persistence(self.repo, self.original_user)
        receipt = persistence.checkpoint()
        pointer = self.repo / ".config/codex-persistence/current"
        previous_target = os.readlink(pointer)
        outside = self.root / "outside-release"
        outside.mkdir()
        self.current.unlink()
        self.current.symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, "invalid managed Codex release symlink"):
            persistence.checkpoint()
        self.assertEqual(os.readlink(pointer), previous_target)
        self.assertEqual(pointer.resolve(strict=True), Path(receipt["snapshot"]).resolve())
        self.assertEqual(
            (pointer / "home/sessions/fake-session.jsonl").read_text(), self.session_text
        )

if __name__ == "__main__":
    unittest.main()
