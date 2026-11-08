"""Tests that don't download model weights or require GPU/PyTorch."""
import base64
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parent.parent / "server" / "local_ai.py"
spec = importlib.util.spec_from_file_location("virtual_location_camera_local", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

# Minimal PNG-like byte array: security headers are validated before image decode.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
PNG_DATA = "data:image/png;base64," + base64.b64encode(PNG_BYTES).decode("ascii")


def body(**changes):
    base = {
        "lat": 40.758,
        "lon": -73.9855,
        "placement": {"x": 0.52, "y": 0.65, "widthRatio": 0.21},
        "background": PNG_DATA,
        "subject": PNG_DATA,
        "acceptRights": True,
        "description": "New York by night",
        "subjectType": "person",
    }
    base.update(changes)
    return base


class LocalModelTests(unittest.TestCase):
    def test_valid_fields(self):
        data = module.parse_request(body())
        self.assertEqual(data["lat"], 40.758)
        self.assertEqual(data["lon"], -73.9855)
        self.assertEqual(data["placement"]["widthRatio"], 0.21)
        self.assertEqual(data["subject"], PNG_BYTES)
        self.assertIsNone(data["reference"])

    def test_boundary_coordinates_and_mercator_limit(self):
        self.assertEqual(module.parse_request(body(lat=85.0, lon=-180))["lon"], -180)
        for values in [{"lat": 91}, {"lat": 85.08}, {"lon": -181}, {"lat": "Infinity"}]:
            with self.subTest(values=values), self.assertRaises(module.RequestError):
                module.parse_request(body(**values))

    def test_missing_consent_or_reference_format_fails(self):
        cases = [
            {"acceptRights": False},
            {"reference": "https://example.com/secret.png"},
            {"subject": "data:image/png;base64," + base64.b64encode(b"this is not a png" * 5).decode("ascii")},
            {"subjectType": "unknown"},
            {"description": "a" * 601},
        ]
        for values in cases:
            with self.subTest(values=list(values)), self.assertRaises(module.RequestError):
                module.parse_request(body(**values))

    def test_placement_checks(self):
        for values in [{"x": -0.1}, {"widthRatio": 0.9}, {"y": 1.1}, {"x": "NaN"}]:
            p = dict(body()["placement"])
            p.update(values)
            with self.subTest(values=values), self.assertRaises(module.RequestError):
                module.parse_request(body(placement=p))

    def test_rejects_oversized_image(self):
        large = "data:image/png;base64," + "A" * (module.MAX_IMAGE_BYTES * 2)
        with self.assertRaises(module.RequestError):
            module.decode_image_url(large, "large")

    def test_hardware_probe_reports_disabled_without_dependencies(self):
        # Simulates missing deps, even when a CUDA driver exists on host.
        from builtins import __import__ as real_import
        def reject_torch(name, *args, **kwargs):
            if name == "torch":
                raise ImportError()
            return real_import(name, *args, **kwargs)
        with patch("builtins.__import__", side_effect=reject_torch):
            enabled, device, description = module.get_backend_state()
        self.assertFalse(enabled)
        self.assertEqual(device, "missing")
        self.assertTrue(description)

    def test_compositing_controls_use_safe_defaults(self):
        defaults = module.parse_compositing(None)
        self.assertEqual(defaults["subjectExposure"], 1.0)
        self.assertEqual(defaults["contactShadow"], 0.4)
        parsed = module.parse_request(body(compositing={
            "subjectExposure": 1.25, "subjectWarmth": 0.2,
            "contactShadow": 0.65, "shadowSoftness": 0.8
        }))
        self.assertEqual(parsed["compositing"]["subjectExposure"], 1.25)
        self.assertEqual(parsed["compositing"]["shadowSoftness"], 0.8)

    def test_compositing_rejects_nonfinite_and_out_of_range_values(self):
        candidates = [
            {"subjectExposure": float("nan")},
            {"subjectExposure": 5},
            {"subjectWarmth": -1},
            {"contactShadow": 0.95},
            {"shadowSoftness": 0},
            {"subjectExposure": "Infinity"},
        ]
        for candidate in candidates:
            with self.subTest(candidate=candidate), self.assertRaises(module.RequestError):
                module.parse_request(body(compositing=candidate))


    def test_depth_request_requires_rights_and_valid_image_header(self):
        parsed = module.parse_depth_request({
            "acceptRights": True, "image": PNG_DATA
        })
        self.assertEqual(parsed, PNG_BYTES)
        for item in [
            {"acceptRights": False, "image": PNG_DATA},
            {"acceptRights": True, "image": "data:image/jpeg;base64,AA=="},
            {"acceptRights": True, "image": "https://untrusted.example/scene.jpg"},
            {}
        ]:
            with self.subTest(input=item), self.assertRaises(module.RequestError):
                module.parse_depth_request(item)

    def test_depth_backend_probe_requires_local_model_libraries(self):
        from builtins import __import__ as real_import
        def reject_transformers(name, *args, **kwargs):
            if name == "transformers":
                raise ImportError()
            return real_import(name, *args, **kwargs)
        with patch("builtins.__import__", side_effect=reject_transformers):
            ready, device, message = module.get_depth_backend_state()
        self.assertFalse(ready)
        self.assertEqual(device, "missing")

    def test_depth_png_from_mocked_model_is_grayscale_and_relative(self):
        import io
        from PIL import Image, ImageOps
        src = Image.new("RGB", (160, 90), (125, 80, 20))
        encoded = io.BytesIO()
        src.save(encoded, format="PNG")
        fake_pipe = lambda photo: {"depth": ImageOps.grayscale(photo)}
        with patch.object(module, "load_depth_pipeline", return_value=(fake_pipe, "cpu")):
            result = module.render_depth(encoded.getvalue())
        self.assertEqual(result["model"], module.DEPTH_MODEL_ID)
        self.assertTrue(result["relativeOnly"])
        self.assertEqual((result["width"], result["height"]), module.OUTPUT_SIZE)
        self.assertTrue(result["depthMap"].startswith("data:image/png;base64,"))
        depth = Image.open(io.BytesIO(base64.b64decode(result["depthMap"].split(",",1)[1])))
        self.assertEqual(depth.mode, "L")
        self.assertEqual(depth.size, module.OUTPUT_SIZE)

    def test_local_diffusion_uses_same_generated_street_pixels_for_occlusion(self):
        import io
        from contextlib import nullcontext
        from types import SimpleNamespace
        from PIL import Image, ImageDraw

        def png_bytes(img):
            stream = io.BytesIO()
            img.save(stream, format="PNG")
            return stream.getvalue()

        background = png_bytes(Image.new("RGBA",(160,90),(35,60,80,255)))
        subject = png_bytes(Image.new("RGBA",(100,100),(235,35,35,255)))
        mask = Image.new("RGBA",(800,450),(255,255,255,0))
        ImageDraw.Draw(mask).rectangle((370,195,430,255),fill=(255,255,255,255))
        mask_bytes = png_bytes(mask)

        class Seed:
            def manual_seed(self, unused):
                return self

        fake_torch = SimpleNamespace(inference_mode=lambda: nullcontext(),
            Generator=lambda device="cpu": Seed())
        def fake_pipe(**unused):
            return SimpleNamespace(images=[Image.new("RGB",module.OUTPUT_SIZE,(25,50,80))])

        payload={
            "lat":40.758,"lon":-73.9855,
            "background":background,"reference":None,"subject":subject,
            "placement":{"x":0.5,"y":0.5,"widthRatio":0.2},
            "compositing":module.parse_compositing({"contactShadow":0}),
            "description":"","subjectType":"person","occlusion":None
        }
        with patch.object(module,"load_pipeline",return_value=(fake_pipe,"cpu",fake_torch)):
            clear=module.render_scene(payload)
            obscured=module.render_scene({**payload,"occlusion":mask_bytes})
        clear_img=Image.open(io.BytesIO(base64.b64decode(clear["image"].split(",",1)[1])))
        obscured_img=Image.open(io.BytesIO(base64.b64decode(obscured["image"].split(",",1)[1])))
        midpoint=(module.OUTPUT_SIZE[0]//2,module.OUTPUT_SIZE[1]//2)
        plain=clear_img.getpixel(midpoint)
        front=obscured_img.getpixel(midpoint)
        self.assertGreater(plain[0]-front[0],100)
        self.assertAlmostEqual(front[0],25,delta=12)
        self.assertFalse(clear["relativeDepthMaskApplied"])
        self.assertTrue(obscured["relativeDepthMaskApplied"])

    def test_listener_rejects_external_host(self):
        # Test origin/host safety directly without binding to the network.
        handler = object.__new__(module.AppHandler)
        handler.headers = {"Host": f"127.0.0.1:{module.PORT}", "Origin": f"http://localhost:{module.PORT}"}
        self.assertTrue(handler.allowed_origin())
        handler.headers["Host"] = "evil.example"
        self.assertFalse(handler.allowed_origin())
        handler.headers = {"Host": f"localhost:{module.PORT}", "Origin": "https://evil.example"}
        self.assertFalse(handler.allowed_origin())


if __name__ == "__main__":
    unittest.main()
