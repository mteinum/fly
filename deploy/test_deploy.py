"""Sperrer i skriptet som kan skrive til webhotellet. Kjøres med `python3 -m unittest`."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parent / "deploy-cpanel.sh"
GOOD = "/home/testuser/fly.teinum.no"


class DeploySafetyTests(unittest.TestCase):
    def run_script(self, destination=GOOD, host="example.com", mode="--dry-run", site=None):
        env = {**os.environ, "CPANEL_HOST": host, "CPANEL_USERNAME": "testuser", "CPANEL_DEPLOY_PATH": destination,
               "CPANEL_SSH_KEY": "fake-key", "CPANEL_SSH_KNOWN_HOSTS": "fake-host"}
        args = ["bash", str(SCRIPT), mode] + ([str(site)] if site else [])
        return subprocess.run(args, env=env, capture_output=True, text=True)

    def test_rejects_other_sites_and_broad_roots(self):
        for path in ("/", "/home/testuser", "/home/testuser/public_html", "/home/testuser/morten.teinum.no",
                     "/home/testuser/fly.teinum.no.old", "/home/testuser/fly.teinum.no/../public_html"):
            with self.subTest(path=path):
                result = self.run_script(path)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("verified absolute document root", result.stderr)

    def test_rejects_shell_injection_in_host(self):
        result = self.run_script(host="example.com;whoami")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("plain hostname", result.stderr)

    def test_rejects_unknown_mode(self):
        result = self.run_script(mode="--force")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Usage:", result.stderr)

    def test_refuses_an_incomplete_build(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "index.html").write_text("<!doctype html>")
            result = self.run_script(site=d)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Missing", result.stderr)

    def test_refuses_stray_files_in_the_build(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for rel in ("index.html", ".htaccess", "data/index.json", "data/kjevik10/metadata.json", "data/kjevik10/heightmap.f32",
                        "data/kjevik10/colormap.png", "data/kjevik10/surface.bin", "audio/manifest.json"):
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text("x")
            (root / ".env").write_text("SECRET=1")
            result = self.run_script(site=d)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Unexpected files", result.stderr)


if __name__ == "__main__":
    unittest.main()
