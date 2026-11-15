"""Real Chromium E2E: licensed photo -> subject -> shadow/relight -> PNG.

This test deliberately blocks outside map/CDN traffic so it verifies that the
real-photo camera is usable even when WebGL/world tiles cannot load. It does not
test online map rendering or local Diffusers GPU inference.
"""
import base64
import json
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
            self.assertFalse(page.locator("#cutoutPerson").is_disabled())
            self.assertTrue(page.locator("#restorePerson").is_disabled())

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



    def test_street_image_selection_with_direction_and_license_gate(self):
        """Mock the optional Mapillary provider, exercise real browser gallery,
        scene provenance, attribution and PNG download without paid API.
        """
        context = self.browser.new_context(
            accept_downloads=True, viewport={"width": 1500, "height": 1000}
        )
        page = context.new_page()
        try:
            page.route("https://**/*", lambda route: route.abort())
            page.goto(BASE_URL + "/", wait_until="domcontentloaded")
            fixture = page.evaluate("""() => {
                const c=document.createElement('canvas');
                c.width=800; c.height=450;
                const ctx=c.getContext('2d');
                ctx.fillStyle='#3b4452';ctx.fillRect(0,0,800,450);
                ctx.fillStyle='#d8b67a';ctx.fillRect(220,90,240,340);
                return c.toDataURL('image/png');
            }""")
            binary = base64.b64decode(fixture.split(",",1)[1])
            scene = {
                "provider": "mapillary",
                "id": "12345678",
                "lat": 40.758, "lon": -73.9855,
                "distanceM": 15, "cameraHeading": 343,
                "headingDifference": 2,
                "captureDate": "2026-07-01",
                "imageType": "perspective",
                "creator": "Test contributor",
                "assessment": "near-position-and-heading",
                "imageUrl": "/api/scene-image?id=12345678",
                "viewerUrl": "https://www.mapillary.com/app/?pKey=12345678&focus=photo",
                "attribution": "Mapillary · Test contributor · CC BY-SA 4.0",
                "license": "CC BY-SA 4.0"
            }
            page.route("**/api/scenes?**", lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"source":"mapillary","configured":True,"candidates":[scene]})
            ))
            page.route("**/api/scene-image?id=12345678", lambda route: route.fulfill(
                status=200,
                headers={"content-type":"image/png"},
                body=binary
            ))
            page.locator("#findScenes").click()
            page.wait_for_function(
                "() => document.querySelector('#sceneResults').children.length === 1"
            )
            page.locator("#sceneResults .scene-card .meta").first.wait_for()
            metadata = page.locator("#sceneResults .scene-card .meta").inner_text()
            self.assertIn("15 m", metadata)
            self.assertIn("方位差 2°", metadata)
            self.assertIn("2026-07-01", metadata)

            # Clicking without respecting rights/ShareAlike must fail closed.
            page.locator("#sceneResults .scene-card button").click()
            self.assertIn("CC BY-SA", page.locator("#message").inner_text())
            page.locator("#photoRights").check()
            page.locator("#mapillaryShareAlike").check()
            page.locator("#sceneResults .scene-card button").click()
            page.wait_for_function(
                "() => document.querySelector('#stage').dataset.mode === 'photo'"
            )
            self.assertIn("CC BY-SA", page.locator("#photoCredit").input_value())
            self.assertFalse(page.locator("#shutter").is_disabled())
            page.locator("#mapillaryShareAlike").uncheck()
            self.assertTrue(page.locator("#shutter").is_disabled())
            page.locator("#mapillaryShareAlike").check()

            with page.expect_download(timeout=15000) as download_info:
                page.locator("#shutter").click()
            data = download_info.value
            self.assertTrue(data.suggested_filename.endswith(".png"))

            with page.expect_download(timeout=15000) as scene_info:
                page.locator("#sceneExport").click()
            with tempfile.TemporaryDirectory() as directory:
                dest = Path(directory) / "scene.json"
                scene_info.value.save_as(dest)
                metadata = json.loads(dest.read_text(encoding="utf-8"))
                self.assertEqual(metadata["background"]["evidence"]["id"], "12345678")
                self.assertFalse(metadata["background"]["evidence"]["exactViewVerified"])
                self.assertEqual(metadata["background"]["evidence"]["license"], "CC BY-SA 4.0")
        finally:
            context.close()

    def test_keyless_panoramax_scene_selection_and_png(self):
        """Public Panoramax API shape is exercised with licensed mock imagery.

        No Mapillary token, external Google image or paid image model is used.
        """
        context=self.browser.new_context(
            accept_downloads=True,viewport={"width":1500,"height":1050}
        )
        page=context.new_page()
        try:
            page.route("https://**/*",lambda route:route.abort())
            page.goto(BASE_URL+"/",wait_until="domcontentloaded")
            fixture=page.evaluate("""() => {
              const canvas=document.createElement('canvas');
              canvas.width=800;canvas.height=450;
              const c=canvas.getContext('2d');
              c.fillStyle='#303f52';c.fillRect(0,0,800,450);
              c.fillStyle='#a4c3c0';c.fillRect(190,75,270,340);
              return canvas.toDataURL('image/png');
            }""")
            png=base64.b64decode(fixture.split(",",1)[1])
            uid="af0c80eb-5ce4-424d-9ac3-6accccbe68d4"
            candidate={
              "provider":"panoramax","id":uid,
              "lat":48.859870109,"lon":2.29472254,
              "distanceM":15,"cameraHeading":45.32,
              "headingDifference":5,"captureDate":"2025-07-21",
              "creator":"Paris contributor","imageType":"perspective",
              "assessment":"near-position-and-heading",
              "imageUrl":"/api/panoramax-image?id="+uid+"&size=thumb",
              "downloadUrl":"/api/panoramax-image?id="+uid+"&size=sd",
              "viewerUrl":"https://api.panoramax.xyz/#focus=pic&pic="+uid,
              "attribution":"Panoramax · Paris contributor · Etalab Open Licence 2.0",
              "license":"Etalab Open Licence 2.0",
              "licenseSpdx":"etalab-2.0",
              "licenseUrl":"https://www.data.gouv.fr/pages/legal/licences/etalab-2-0",
              "requiresShareAlike":False,
              "exactViewVerified":False
            }
            page.route("**/api/scenes?**",lambda route:route.fulfill(
              status=200,content_type="application/json",
              body=json.dumps({"source":"mapillary","configured":False,"candidates":[]})
            ))
            page.route("**/api/panoramax-scenes?**",lambda route:route.fulfill(
              status=200,content_type="application/json",
              body=json.dumps({"source":"panoramax","configured":True,"candidates":[candidate]})
            ))
            page.route("**/api/panoramax-image?**",lambda route:route.fulfill(
              status=200,headers={"content-type":"image/png"},body=png
            ))
            page.locator("#findScenes").click()
            page.wait_for_function("() => document.querySelector('#sceneResults').children.length === 1")
            self.assertIn("Etalab",page.locator("#sceneResults .scene-card .meta").inner_text())
            page.locator("#photoRights").check()
            self.assertFalse(page.locator("#mapillaryShareAlike").is_checked())
            page.locator("#sceneResults .scene-card button").click()
            page.wait_for_function("() => document.querySelector('#stage').dataset.mode === 'photo'")
            self.assertFalse(page.locator("#shutter").is_disabled())
            self.assertIn("Panoramax",page.locator("#photoCredit").input_value())
            with page.expect_download(timeout=15000) as dl:
                page.locator("#shutter").click()
            self.assertTrue(dl.value.suggested_filename.endswith(".png"))
            with page.expect_download(timeout=15000) as saved:
                page.locator("#sceneExport").click()
            with tempfile.TemporaryDirectory() as directory:
                target=Path(directory)/"scene.json"
                saved.value.save_as(target)
                data=json.loads(target.read_text(encoding="utf-8"))
                provenance=data["background"]["evidence"]
                self.assertEqual(provenance["provider"],"panoramax")
                self.assertEqual(provenance["licenseSpdx"],"etalab-2.0")
                self.assertFalse(provenance["exactViewVerified"])
        finally:
            context.close()



    def test_manual_and_relative_depth_restore_nearby_street_pixels(self):
        """Real Chromium: foreground depth mask has priority over the subject.

        No GPU/online images are needed: background, actor and depth are
        synthetic fixtures generated inside the browser.
        """
        context=self.browser.new_context(
            accept_downloads=True,viewport={"width":1500,"height":1050}
        )
        page=context.new_page()
        try:
            page.route("https://**/*",lambda route:route.abort())
            page.goto(BASE_URL+"/",wait_until="domcontentloaded")
            images=page.evaluate("""() => {
              const create=(w,h,colour) => {
                const canvas=document.createElement('canvas');
                canvas.width=w;canvas.height=h;
                const ctx=canvas.getContext('2d');
                ctx.fillStyle=colour;ctx.fillRect(0,0,w,h);
                return canvas.toDataURL('image/png');
              };
              return {
                background:create(800,450,'#223e60'),
                actor:create(150,300,'#ed2b30'),
                depth:create(800,450,'#ffffff')
              };
            }""")
            def binary(name):
                return base64.b64decode(images[name].split(",",1)[1])
            page.locator("#photoRights").check()
            page.locator("#photoUpload").set_input_files({
                "name":"blue-background.png","mimeType":"image/png",
                "buffer":binary("background")
            })
            page.wait_for_function("() => document.querySelector('#stage').dataset.mode==='photo'")
            page.locator("#imageUpload").set_input_files({
                "name":"red-subject.png","mimeType":"image/png",
                "buffer":binary("actor")
            })
            page.wait_for_function("() => !document.querySelector('#shutter').disabled")

            async_pixel = """async ({src,x,y}) => {
              const img=new Image(); img.src=src; await img.decode();
              const canvas=document.createElement('canvas');
              canvas.width=img.width;canvas.height=img.height;
              const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
              return Array.from(ctx.getImageData(x,y,1,1).data);
            }"""
            def shoot_rgb():
                with page.expect_download(timeout=15000) as req:
                    page.locator("#shutter").click()
                with tempfile.TemporaryDirectory() as folder:
                    output=Path(folder)/"capture.png"
                    req.value.save_as(output)
                    src="data:image/png;base64,"+base64.b64encode(output.read_bytes()).decode()
                return page.evaluate(async_pixel, {"src":src,"x":832,"y":495})

            before=shoot_rgb()
            self.assertGreater(before[0],150,"subject should be red before masking")
            self.assertLess(before[2],120,"subject should not have blue background pixels")

            page.locator("#depthUpload").set_input_files({
                "name":"all-near.png","mimeType":"image/png",
                "buffer":binary("depth")
            })
            page.wait_for_function("() => document.querySelector('#depthEnabled').checked")
            self.assertFalse(page.locator("#depthPreview").is_hidden())
            hidden=shoot_rgb()
            self.assertLess(hidden[0],70)
            self.assertGreater(hidden[2],60)
            self.assertLess(hidden[2],130)

            page.locator("#depthInvert").check()
            visible=shoot_rgb()
            self.assertGreater(visible[0],150)

            page.locator("#clearOcclusion").click()
            page.locator("#maskEditToggle").click()
            self.assertEqual(page.locator("#maskEditToggle").get_attribute("aria-pressed"),"true")
            stage=page.locator("#occlusionCanvas")
            box=stage.bounding_box()
            stage.click(position={"x":box["width"]*0.52,"y":box["height"]*0.55})
            brush=shoot_rgb()
            self.assertLess(brush[0],70)
            self.assertGreater(brush[2],60)
            self.assertEqual(page.locator("#depthEnabled").is_checked(),False)
        finally:
            context.close()


    @unittest.skipUnless(os.environ.get("TEST_CUTOUT_LIVE") == "1", "Optional live MediaPipe WASM/CDN test")
    def test_person_cutout_with_live_mediapipe_model(self):
        """Real browser model inference: no paid API or image upload to server.

        Only an internally generated cartoon portrait is used. This verifies
        API compatibility and alpha PNG creation, not human-mask accuracy.
        """
        context = self.browser.new_context(accept_downloads=True,viewport={"width":1440,"height":1000})
        page = context.new_page()
        errors = []
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.on("console",lambda msg:errors.append("console: "+msg.text) if msg.type == "error" else None)
        page.on("requestfailed",lambda req:errors.append("fetch: "+req.url[:220]+" "+str(req.failure)))
        try:
            page.goto(BASE_URL + "/",wait_until="domcontentloaded")
            source = page.evaluate("""() => {
              const c=document.createElement('canvas');c.width=512;c.height=720;
              const x=c.getContext('2d');
              x.fillStyle='#a5c6d8';x.fillRect(0,0,512,720);
              x.fillStyle='#3d404c';x.fillRect(90,560,320,140);
              x.fillStyle='#324f84';x.beginPath();x.ellipse(256,470,170,230,0,0,Math.PI*2);x.fill();
              x.fillStyle='#cea58c';x.beginPath();x.ellipse(256,215,97,137,0,0,Math.PI*2);x.fill();
              x.fillStyle='#26252b';x.beginPath();x.ellipse(256,118,101,60,0,0,Math.PI*2);x.fill();
              return c.toDataURL('image/png');
            }""")
            img = base64.b64decode(source.split(",",1)[1])
            page.locator("#imageUpload").set_input_files({
                "name":"synthetic-selfie.png","mimeType":"image/png","buffer":img
            })
            page.wait_for_function("() => !document.querySelector('#cutoutPerson').disabled")
            page.locator("#cutoutPerson").click()
            try:
                page.wait_for_function("""() => {
                  const text=document.querySelector('#cutoutStatus').textContent;
                  return text.includes('切り抜きました') || text.includes('失敗しました');
                }""",timeout=75000)
            except Exception as exc:
                raise AssertionError(
                    "MediaPipe segmentation did not settle: "
                    + page.locator("#cutoutStatus").inner_text()
                    + " errors=" + repr(errors[-10:])
                ) from exc
            state = page.locator("#cutoutStatus").inner_text()
            self.assertIn("切り抜きました",state,
                "MediaPipe runtime/model failed: " + state
                + " message=" + page.locator("#message").inner_text()
                + " errors=" + repr(errors[-10:]))
            self.assertFalse(page.locator("#restorePerson").is_disabled())
            self.assertTrue(page.locator("#subjectImage").get_attribute("src").startswith("data:image/png;base64,"))
            page.locator("#restorePerson").click()
            self.assertTrue(page.locator("#restorePerson").is_disabled())
            self.assertIn("元のアップロード写真",page.locator("#cutoutStatus").inner_text())
        finally:
            context.close()


    @unittest.skipUnless(os.environ.get("TEST_PUBLIC_SITE") == "1", "Optional real production-site acceptance")
    def test_production_panorama_photo_search_and_capture(self):
        """Inspect real production deployment against a known public geotag.

        Does not use any personal image, maps screenshot or paid image API.
        """
        context=self.browser.new_context(accept_downloads=True,viewport={"width":1440,"height":1000})
        page=context.new_page()
        errors=[]
        page.on("pageerror",lambda error:errors.append(str(error)))
        try:
            page.goto("https://virtual-location-camera.vercel.app/",wait_until="domcontentloaded",timeout=30000)
            self.assertTrue(page.locator("#findScenes").count()>0)
            self.assertTrue(page.locator("#depthEnabled").count()>0)
            page.locator("#latitude").fill("48.859870109")
            page.locator("#longitude").fill("2.29472254")
            page.locator("#bearing").evaluate(
                "(el) => {el.value='45';el.dispatchEvent(new Event('input',{bubbles:true}));}"
            )
            page.locator("#sceneRadius").select_option("200")
            page.locator("#findScenes").click()
            try:
                page.wait_for_function(
                    "() => document.querySelector('#sceneResults').children.length > 0 || document.querySelector('#sceneGroundingStatus').textContent.includes('失敗') || document.querySelector('#sceneGroundingStatus').textContent.includes('ありません')",
                    timeout=45000
                )
            except Exception as exc:
                raise AssertionError("Production scene search did not resolve. Status="
                    +page.locator("#sceneGroundingStatus").inner_text()
                    +" errors="+repr(errors[-12:])) from exc
            candidates=page.locator("#sceneResults .scene-card")
            self.assertGreater(candidates.count(),0,
                "No live Paris Panoramax photo in production. Status="
                +page.locator("#sceneGroundingStatus").inner_text()
                +" errors="+repr(errors[-12:]))
            # Select a photo explicitly marked with licence terms.
            licenced=page.locator("#sceneResults .scene-card").filter(has_text="Etalab")
            if licenced.count()==0:
                licenced=page.locator("#sceneResults .scene-card").filter(has_text="CC BY-SA")
            self.assertGreater(licenced.count(),0,"Production results lack licence metadata")
            page.locator("#photoRights").check()
            if "CC BY-SA" in licenced.first.inner_text():
                page.locator("#mapillaryShareAlike").check()
            licenced.first.locator("button").click()
            try:
                page.wait_for_function("() => document.querySelector('#stage').dataset.mode==='photo'",
                    timeout=30000)
            except Exception as exc:
                raise AssertionError("Production location photo download failed: "
                    +page.locator("#sceneGroundingStatus").inner_text()
                    +" errors="+repr(errors[-12:])) from exc
            self.assertFalse(page.locator("#shutter").is_disabled())
            with page.expect_download(timeout=20000) as dl:
                page.locator("#shutter").click()
            with tempfile.TemporaryDirectory() as temp:
                path=Path(temp)/"export.png"
                dl.value.save_as(path)
                png=path.read_bytes()
                self.assertEqual(png[:8],b"\x89PNG\r\n\x1a\n")
                self.assertEqual(struct.unpack(">II",png[16:24]),(1600,900))
        finally:
            context.close()


    def test_observed_street_sequence_navigates_between_actual_camera_positions(self):
        """A neighbouring shot must be an observed, licensed picture UUID.

        The test simulates STAC prev/next metadata while exercising Chromium
        UI, camera coordinates, actor composite and PNG export.
        """
        context=self.browser.new_context(accept_downloads=True,viewport={"width":1500,"height":1000})
        page=context.new_page()
        center="af0c80eb-5ce4-424d-9ac3-6accccbe68d4"
        next_id="82d00dec-dc38-4a38-9e9a-ffbaddb98e9e"
        base={
            "provider":"panoramax","cameraHeading":43,
            "headingDifference":0,"captureDate":"2025-07-21",
            "imageType":"perspective","creator":"Test photographer",
            "assessment":"near-position-and-heading",
            "attribution":"Panoramax · Test photographer · Etalab Open Licence 2.0",
            "license":"Etalab Open Licence 2.0","licenseSpdx":"etalab-2.0",
            "requiresShareAlike":False,"exactViewVerified":False
        }
        def candidate(uid,lat,lon,dist):
            return {
                **base,"id":uid,"lat":lat,"lon":lon,"distanceM":dist,
                "imageUrl":"/api/panoramax-image?id="+uid+"&size=thumb",
                "downloadUrl":"/api/panoramax-image?id="+uid+"&size=sd",
                "viewerUrl":"https://api.panoramax.xyz/#focus=pic&pic="+uid
            }
        first=candidate(center,48.859870109,2.29472254,0)
        second=candidate(next_id,48.85991,2.29477,7)
        try:
            page.route("https://**/*",lambda route:route.abort())
            page.goto(BASE_URL+"/",wait_until="domcontentloaded")
            images=page.evaluate("""() => {
              function img(colour){
                const c=document.createElement('canvas');c.width=800;c.height=450;
                const x=c.getContext('2d');
                x.fillStyle=colour;x.fillRect(0,0,800,450);
                return c.toDataURL('image/png');
              }
              return {first:img('#d92a31'),second:img('#1c33df')};
            }""")
            photo_first=base64.b64decode(images["first"].split(",",1)[1])
            photo_second=base64.b64decode(images["second"].split(",",1)[1])
            page.route("**/api/scenes?**",lambda route:route.fulfill(
                status=200,content_type="application/json",
                body=json.dumps({"configured":False,"candidates":[]})
            ))
            page.route("**/api/panoramax-scenes?**",lambda route:route.fulfill(
                status=200,content_type="application/json",
                body=json.dumps({"source":"panoramax","configured":True,"candidates":[first]})
            ))
            def photo_proxy(route):
                route.fulfill(status=200,
                    headers={"content-type":"image/png"},
                    body=photo_second if next_id in route.request.url else photo_first)
            page.route("**/api/panoramax-image?**",photo_proxy)
            def neighbors(route):
                selected=next_id if next_id in route.request.url else center
                content={
                    "centerId":selected,
                    "navigationType":"observed-sequence-only",
                    "previous":first if selected==next_id else None,
                    "next":second if selected==center else None
                }
                route.fulfill(status=200,content_type="application/json",body=json.dumps(content))
            page.route("**/api/panoramax-neighbors?**",neighbors)
            page.locator("#photoRights").check()
            page.locator("#findScenes").click()
            page.wait_for_function("() => document.querySelector('#sceneResults').children.length === 1")
            page.locator("#sceneResults .scene-card button").click()
            page.wait_for_function("() => !document.querySelector('#nextObserved').disabled")
            self.assertEqual(page.locator("#stage").get_attribute("data-mode"),"photo")
            self.assertAlmostEqual(float(page.locator("#latitude").input_value()),48.859870109,places=6)
            page.locator("#nextObserved").click()
            page.wait_for_function(
              "() => document.querySelector('#photoStatus').textContent.includes('82d00dec')"
            )
            self.assertAlmostEqual(float(page.locator("#latitude").input_value()),48.85991,places=6)
            self.assertTrue(page.locator("#nextObserved").is_disabled())
            self.assertFalse(page.locator("#previousObserved").is_disabled())

            with page.expect_download(timeout=15000) as image_download:
                page.locator("#shutter").click()
            with tempfile.TemporaryDirectory() as folder:
                saved=Path(folder)/"photo.png"
                image_download.value.save_as(saved)
                photo_b64=base64.b64encode(saved.read_bytes()).decode()
            pixel=page.evaluate("""async encoded => {
              const photo=new Image();
              photo.src='data:image/png;base64,'+encoded;
              await photo.decode();
              const canvas=document.createElement('canvas');
              canvas.width=1600;canvas.height=900;
              const ctx=canvas.getContext('2d');ctx.drawImage(photo,0,0);
              return Array.from(ctx.getImageData(100,260,1,1).data);
            }""",photo_b64)
            self.assertGreater(pixel[2],140,"The next photo must show the observed blue street")
            self.assertLess(pixel[0],100)

            with page.expect_download(timeout=15000) as scene_download:
                page.locator("#sceneExport").click()
            with tempfile.TemporaryDirectory() as folder:
                path=Path(folder)/"scene.json"
                scene_download.value.save_as(path)
                obj=json.loads(path.read_text("utf-8"))
            self.assertEqual(obj["background"]["evidence"]["id"],next_id)
            self.assertFalse(obj["background"]["evidence"]["exactViewVerified"])
        finally:
            context.close()


    def test_provider_confirmed_360_street_photo_activates_real_panorama_camera(self):
        """A licensed, STAC-confirmed sphere loads directly in 360 mode.

        Provider responses are simulated, but the renderer and PNG pixels are
        real Chromium/WebGL. This never assumes ordinary photographs are 360.
        """
        context=self.browser.new_context(accept_downloads=True,viewport={"width":1500,"height":1000})
        page=context.new_page()
        try:
            page.route("https://**/*",lambda route:route.abort())
            page.goto(BASE_URL+"/",wait_until="domcontentloaded")
            fixture=page.evaluate("""() => {
              const pano=document.createElement('canvas');
              pano.width=2048;pano.height=1024;
              const ctx=pano.getContext('2d');
              ctx.fillStyle='#a32127';ctx.fillRect(0,0,2048,1024);
              ctx.fillStyle='#134ed3';ctx.fillRect(1280,0,512,1024);
              return pano.toDataURL('image/png');
            }""")
            image=base64.b64decode(fixture.split(",",1)[1])
            uid="af0c80eb-5ce4-424d-9ac3-6accccbe68d4"
            scene={
              "provider":"panoramax","id":uid,"lat":48.859870109,"lon":2.29472254,
              "distanceM":4,"cameraHeading":45.32,"headingDifference":5,
              "captureDate":"2025-07-21","creator":"Example producer",
              "imageType":"360","assessment":"near-position-and-heading",
              "imageUrl":"/api/panoramax-image?id="+uid+"&size=thumb",
              "downloadUrl":"/api/panoramax-image?id="+uid+"&size=sd",
              "viewerUrl":"https://api.panoramax.xyz/#focus=pic&pic="+uid,
              "attribution":"Panoramax · Example producer · Etalab Open Licence 2.0",
              "license":"Etalab Open Licence 2.0","licenseSpdx":"etalab-2.0",
              "requiresShareAlike":False,"exactViewVerified":False
            }
            page.route("**/api/scenes?**",lambda route:route.fulfill(
              status=200,content_type="application/json",
              body=json.dumps({"configured":False,"candidates":[]})
            ))
            page.route("**/api/panoramax-scenes?**",lambda route:route.fulfill(
              status=200,content_type="application/json",
              body=json.dumps({"configured":True,"candidates":[scene]})
            ))
            page.route("**/api/panoramax-image?**",lambda route:route.fulfill(
              status=200,headers={"content-type":"image/png"},body=image
            ))
            page.route("**/api/panoramax-neighbors?**",lambda route:route.fulfill(
              status=200,content_type="application/json",
              body=json.dumps({"centerId":uid,"previous":None,"next":None})
            ))
            page.locator("#photoRights").check()
            page.locator("#findScenes").click()
            page.wait_for_function("() => document.querySelector('#sceneResults').children.length === 1")
            page.locator("#sceneResults .scene-card button").click()
            page.wait_for_function("() => document.querySelector('#stage').dataset.panorama === 'true'")
            self.assertTrue(page.locator("#panoramaToggle").is_checked())
            self.assertFalse(page.locator("#panoramaControls").is_hidden())
            self.assertFalse(page.locator("#shutter").is_disabled())
            # Move the test actor away from the sampled camera pixel. We want
            # to test the observed background direction, not the actor colour.
            page.locator("#subjectScale").evaluate(
              "(el) => {el.value='6';el.dispatchEvent(new Event('input',{bubbles:true}));}"
            )
            page.locator("#panoramaYaw").evaluate(
              "(el) => {el.value='90';el.dispatchEvent(new Event('input',{bubbles:true}));}"
            )
            with page.expect_download(timeout=15000) as download:
                page.locator("#shutter").click()
            with tempfile.TemporaryDirectory() as temp:
                path=Path(temp)/"image.png"
                download.value.save_as(path)
                body=path.read_bytes()
            self.assertEqual(body[:8],b"\x89PNG\r\n\x1a\n")
            uri="data:image/png;base64,"+base64.b64encode(body).decode()
            rgb=page.evaluate("""async uri => {
              const img=new Image();img.src=uri;await img.decode();
              const c=document.createElement('canvas');
              c.width=img.width;c.height=img.height;
              const g=c.getContext('2d');g.drawImage(img,0,0);
              return Array.from(g.getImageData(800,260,1,1).data);
            }""",uri)
            self.assertGreater(rgb[2],140,"90-degree yaw must reveal actual rightward sector")
            self.assertLess(rgb[0],120)
        finally:
            context.close()


    def test_imported_multiview_pointcloud_moves_camera_and_keeps_world_anchored_subject(self):
        """Actual Chromium/WebGL image comparison, not a mocked world viewer.

        Source PLY is a deterministic 3D green wall. The red human-like
        sprite sits at a fixed world coordinate in FRONT of the wall, so the
        camera changing x must move its projected position left on the frame.
        """
        import struct
        import hashlib
        context=self.browser.new_context(accept_downloads=True,viewport={"width":1500,"height":1000})
        page=context.new_page()
        try:
            page.route("https://**/*",lambda route:route.abort())
            page.goto(BASE_URL+"/",wait_until="domcontentloaded")
            points=[]
            for row in range(-18,19):
                for col in range(-35,36):
                    points.append((col*.12,row*.12,-6.,80,190,120))
            header=(
                "ply\nformat binary_little_endian 1.0\n"
                "comment first-camera-coordinates\n"
                "element vertex "+str(len(points))+"\n"
                "property float x\nproperty float y\nproperty float z\n"
                "property uchar red\nproperty uchar green\nproperty uchar blue\n"
                "end_header\n"
            ).encode("ascii")
            binary=header+b"".join(struct.pack("<fffBBB",*row) for row in points)
            actor=page.evaluate("""() => {
              const canvas=document.createElement('canvas');
              canvas.width=180;canvas.height=360;
              const ctx=canvas.getContext('2d');
              ctx.clearRect(0,0,180,360);
              ctx.fillStyle='#f21f2a';
              ctx.fillRect(0,0,180,360);
              return canvas.toDataURL('image/png');
            }""")
            page.locator("#imageUpload").set_input_files({
                "name":"red-actor.png","mimeType":"image/png",
                "buffer":base64.b64decode(actor.split(",",1)[1])
            })
            page.locator("#worldRights").check()
            page.locator("#worldCredit").fill("Synthetic fixture / verified permission")
            page.locator("#worldUpload").set_input_files({
                "name":"observed-points.ply","mimeType":"application/octet-stream",
                "buffer":binary
            })
            page.wait_for_function("() => document.querySelector('#stage').dataset.mode==='world'")
            self.assertFalse(page.locator("#worldControls").is_hidden())
            self.assertFalse(page.locator("#shutter").is_disabled())

            def capture_red_centre():
                with page.expect_download(timeout=15000) as download:
                    page.locator("#shutter").click()
                with tempfile.TemporaryDirectory() as folder:
                    dst=Path(folder)/"captured.png"
                    download.value.save_as(dst)
                    body=dst.read_bytes()
                    self.assertEqual(body[:8],b"\x89PNG\r\n\x1a\n")
                    self.assertEqual(struct.unpack(">II",body[16:24]),(1600,900))
                uri="data:image/png;base64,"+base64.b64encode(body).decode()
                return page.evaluate("""async uri => {
                    const image=new Image();image.src=uri;await image.decode();
                    const c=document.createElement('canvas');c.width=1600;c.height=900;
                    const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
                    const pixels=ctx.getImageData(0,0,1600,800).data;
                    let count=0,sx=0;
                    for(let y=30;y<800;y+=3)for(let x=0;x<1600;x+=3){
                      const i=(y*1600+x)*4;
                      if(pixels[i]>160&&pixels[i+1]<90&&pixels[i+2]<95){
                        count++;sx+=x;
                      }
                    }
                    return {count,center:count?sx/count:0};
                }""",uri)

            first=capture_red_centre()
            self.assertGreater(first["count"],50,"world-anchored red actor must be visible")
            page.locator("#worldRight").click()
            second=capture_red_centre()
            self.assertGreater(second["count"],50)
            self.assertLess(second["center"],first["center"]-3,
                "Moving the CAMERA right must project a fixed actor left")
            page.locator("#worldForward").click()
            self.assertIn("3Dカメラ",page.locator("#worldStatus").inner_text())
            with page.expect_download(timeout=15000) as saved:
                page.locator("#sceneExport").click()
            with tempfile.TemporaryDirectory() as folder:
                dst=Path(folder)/"scene.json"
                saved.value.save_as(dst)
                scene=json.loads(dst.read_text("utf-8"))
                self.assertEqual(scene["background"]["mode"],"reconstructed-world")
                self.assertEqual(scene["world"]["kind"],"multiview-reconstructed-pointcloud")
                self.assertFalse(scene["world"]["geographicRegistrationVerified"])
                self.assertFalse(scene["world"]["novelContentGenerated"])
                self.assertGreater(scene["world"]["pointCount"],1000)
                self.assertGreater(scene["world"]["camera"]["x"],0)
                self.assertLess(scene["world"]["camera"]["z"],0)
            page.locator("#worldClear").click()
            self.assertEqual(page.locator("#stage").get_attribute("data-mode"),"map")
        finally:
            context.close()


    def test_real_360_panorama_camera_rotates_and_exports_observed_colours(self):
        """Real WebGL ray-cast of a 2:1 panorama; never a fabricated street view.

        Source image has four directional colour sectors. A 90-degree yaw MUST
        change the exported pixel from centre red to right-side blue.
        """
        context=self.browser.new_context(accept_downloads=True,viewport={"width":1500,"height":1000})
        page=context.new_page()
        errors=[]
        page.on("pageerror",lambda e:errors.append(str(e)))
        try:
            page.route("https://**/*",lambda route:route.abort())
            page.goto(BASE_URL+"/",wait_until="domcontentloaded")
            source=page.evaluate("""() => {
              const pano=document.createElement('canvas');pano.width=2048;pano.height=1024;
              const g=pano.getContext('2d');
              for (const [x,w,c] of [
                [0,256,'#822399'],[256,512,'#15b73b'],
                [768,512,'#de1829'],[1280,512,'#1623db'],[1792,256,'#822399']
              ]){g.fillStyle=c;g.fillRect(x,0,w,1024);}
              return pano.toDataURL('image/png');
            }""")
            png=base64.b64decode(source.split(",",1)[1])
            page.locator("#photoRights").check()
            page.locator("#photoUpload").set_input_files({
              "name":"user-provided-360.png","mimeType":"image/png","buffer":png
            })
            page.wait_for_function("() => document.querySelector('#stage').dataset.mode === 'photo'")
            self.assertFalse(page.locator("#panoramaToggle").is_disabled())
            page.locator("#subjectScale").evaluate(
              "(el) => {el.value='6';el.dispatchEvent(new Event('input',{bubbles:true}));}"
            )
            page.locator("#panoramaToggle").check()
            page.wait_for_function("() => document.querySelector('#stage').dataset.panorama === 'true'")
            self.assertFalse(page.locator("#shutter").is_disabled())

            def output_pixel():
                with page.expect_download(timeout=15000) as download:
                    page.locator("#shutter").click()
                with tempfile.TemporaryDirectory() as root:
                    path=Path(root)/"photo.png"
                    download.value.save_as(path)
                    image_bytes=path.read_bytes()
                    self.assertEqual(image_bytes[:8],b"\x89PNG\r\n\x1a\n")
                    self.assertEqual(struct.unpack(">II",image_bytes[16:24]),(1600,900))
                uri="data:image/png;base64,"+base64.b64encode(image_bytes).decode()
                return page.evaluate("""async uri => {
                  const image=new Image();
                  image.src=uri; await image.decode();
                  const scratch=document.createElement('canvas');
                  scratch.width=image.width;scratch.height=image.height;
                  const c=scratch.getContext('2d');
                  c.drawImage(image,0,0);
                  return Array.from(c.getImageData(800,260,1,1).data);
                }""",uri)

            before=output_pixel()
            self.assertGreater(before[0],140,"Yaw=0 must use original red centre stripe")
            self.assertLess(before[2],110)

            page.locator("#panoramaYaw").evaluate(
              "(el) => {el.value='90';el.dispatchEvent(new Event('input',{bubbles:true}));}"
            )
            after=output_pixel()
            self.assertGreater(after[2],140,"Yaw=90 must use actual blue stripe at 3/4 longitude")
            self.assertLess(after[0],100)
            self.assertNotEqual(before[:3],after[:3])

            with page.expect_download(timeout=15000) as scene_download:
                page.locator("#sceneExport").click()
            with tempfile.TemporaryDirectory() as temp:
                path=Path(temp)/"scene.json"
                scene_download.value.save_as(path)
                state=json.loads(path.read_text("utf-8"))
                self.assertEqual(state["background"]["panorama"]["enabled"],True)
                self.assertEqual(state["background"]["panorama"]["yaw"],90)
                self.assertTrue(state["background"]["panorama"]["fixedCameraPosition"])

            page.locator("#panoramaToggle").uncheck()
            self.assertEqual(page.locator("#stage").get_attribute("data-panorama"),"false")
            self.assertFalse(page.locator("#photoZoom").is_disabled())
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
