"""Real Chromium E2E: licensed photo -> subject -> shadow/relight -> PNG.

This test deliberately blocks outside map/CDN traffic so it verifies that the
real-photo camera is usable even when WebGL/world tiles cannot load. It does not
test online map rendering or local Diffusers GPU inference.
"""
import base64
import os
import struct
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "http://127.0.0.1:8765"


class BrowserPhotoE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = subprocess.Popen(
            ["node", "server/dev.mjs"], cwd=ROOT,
            env={**os.environ, "PORT": "8765"},
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
        )
        for _ in range(80):
            try:
                with urlopen(BASE_URL + "/api/health", timeout=1) as response:
                    if response.status == 200:
                        break
            except Exception:
                time.sleep(0.1)
        else:
            cls.server.terminate()
            raise RuntimeError("Local test server did not start.")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "browser"):
            cls.browser.close()
        if hasattr(cls, "playwright"):
            cls.playwright.stop()
        if hasattr(cls, "server"):
            cls.server.terminate()
            try:
                cls.server.wait(timeout=8)
            except subprocess.TimeoutExpired:
                cls.server.kill()

    def test_photo_export_when_maplibre_is_offline(self):
        context = self.browser.new_context(accept_downloads=True, viewport={"width": 1500, "height": 1000})
        page = context.new_page()
        try:
            # Reject all third-party requests. Production geodata and external
            # imagery are expressly not part of this test.
            page.route("https://**/*", lambda route: route.abort())
            page.goto(BASE_URL + "/", wait_until="domcontentloaded")

            # Create entirely synthetic test fixtures in the browser.
            fixtures = page.evaluate("""() => {
              const bg=document.createElement('canvas');
              bg.width=1600; bg.height=900;
              const c=bg.getContext('2d');
              c.fillStyle='#1f2c4d'; c.fillRect(0,0,1600,900);
              c.fillStyle='#536779'; c.fillRect(200,110,340,620);
              c.fillStyle='#9b967e'; c.fillRect(1000,190,370,540);
              const actor=document.createElement('canvas');
              actor.width=300; actor.height=620;
              const s=actor.getContext('2d');
              s.fillStyle='rgba(255,255,255,0)'; s.clearRect(0,0,300,620);
              s.fillStyle='#d3a184'; s.beginPath(); s.arc(150,100,65,0,Math.PI*2); s.fill();
              s.fillStyle='#c33c42'; s.fillRect(90,175,120,330);
              s.fillStyle='#222c3b'; s.fillRect(90,505,45,105);s.fillRect(165,505,45,105);
              return {background:bg.toDataURL('image/png'),subject:actor.toDataURL('image/png')};
            }""")
            background = base64.b64decode(fixtures["background"].split(",", 1)[1])
            subject = base64.b64decode(fixtures["subject"].split(",", 1)[1])

            page.locator("#photoRights").check()
            page.locator("#photoCredit").fill("Original test image")
            page.locator("#photoUpload").set_input_files({
                "name": "licensed-city.png",
                "mimeType": "image/png",
                "buffer": background
            })
            page.wait_for_function("document.querySelector('#stage').dataset.mode === 'photo'")

            page.locator("#imageUpload").set_input_files({
                "name": "isolated-subject.png",
                "mimeType": "image/png",
                "buffer": subject
            })
            page.wait_for_function("!document.querySelector('#shutter').disabled")

            for field, value in [
                ("photoZoom", "140"),
                ("photoFocusX", "70"),
                ("subjectLight", "120"),
                ("shadowStrength", "60")
            ]:
                page.locator("#" + field).evaluate(
                    "(el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }",
                    value
                )
            self.assertEqual(page.locator("#photoZoomValue").inner_text(), "140%")
            self.assertIn("brightness(1.200)", page.locator("#subjectHandle").get_attribute("style") or "")
            self.assertTrue(page.locator("#contactShadow").is_visible())

            with page.expect_download(timeout=15000) as download_info:
                page.locator("#shutter").click()
            download = download_info.value
            self.assertTrue(download.suggested_filename.endswith(".png"))

            with tempfile.TemporaryDirectory() as scratch:
                path = Path(scratch) / download.suggested_filename
                download.save_as(path)
                data = path.read_bytes()
                self.assertGreater(len(data), 1000)
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                self.assertEqual(struct.unpack(">II", data[16:24]), (1600, 900))
            self.assertIn("合成写真を保存", page.locator("#message").inner_text())
        finally:
            context.close()


    def test_live_geospatial_map_initialization(self):
        """Network test: verify real CDN + OpenFreeMap style and 3D map startup.

        Uses actual public map data and no paid API. Fails with diagnostic
        console messages if a CDN path/style is broken.
        """
        context = self.browser.new_context(
            accept_downloads=True, viewport={"width": 1500, "height": 950}
        )
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text)
                if message.type == "error" else None)
        try:
            page.goto(BASE_URL + "/", wait_until="domcontentloaded")
            try:
                page.wait_for_function(
                    "() => !document.querySelector('#shutter').disabled && document.querySelector('#stage').dataset.mode !== 'photo'",
                    timeout=60000
                )
            except Exception as exc:
                state = page.locator("#mapState").inner_text()
                notice = page.locator("#message").inner_text()
                raise AssertionError(
                    "Live map did not become capture-ready. "
                    + "state=" + state + " notice=" + notice
                    + " errors=" + repr(errors[-15:])
                ) from exc
            self.assertTrue(page.locator("canvas.maplibregl-canvas").count() > 0)
            self.assertIn("3D MAP", page.locator("#mapState").inner_text())
            self.assertTrue(page.locator("#map canvas").count() > 0)

            # Real map pixels must be exportable (WebGL2 / CORS / context).
            with page.expect_download(timeout=15000) as download_info:
                page.locator("#shutter").click()
            photo = download_info.value
            with tempfile.TemporaryDirectory() as scratch:
                exported = Path(scratch) / photo.suggested_filename
                photo.save_as(exported)
                data = exported.read_bytes()
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                self.assertEqual(struct.unpack(">II", data[16:24]), (1600, 900))
                self.assertGreater(len(data), 1000)

            # Moving to another city should update coordinates and remain
            # capture-ready rather than getting stuck after a 3D tile swap.
            page.locator("#preset").select_option("shibuya")
            page.wait_for_function(
                "() => Math.abs(Number(document.querySelector('#latitude').value) - 35.6595) < 0.003 && !document.querySelector('#shutter').disabled",
                timeout=45000
            )
        finally:
            context.close()


if __name__ == "__main__":
    unittest.main()
