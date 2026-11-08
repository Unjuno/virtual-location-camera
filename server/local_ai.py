#!/usr/bin/env python3
"""Local-only virtual photography server.

Uses weights downloaded from Hugging Face, NOT an inference API.
Binds to loopback deliberately: never expose this unauthenticated GPU worker
directly on the internet.
"""
from __future__ import annotations

import base64
import binascii
import io
import json
import os
import re
import threading
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("VLC_PORT", "8000"))
MODEL_ID = os.environ.get("VLC_MODEL_ID", "stable-diffusion-v1-5/stable-diffusion-v1-5")
DEPTH_MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"
ALLOW_CPU = os.environ.get("VLC_ALLOW_CPU", "") == "1"
OUTPUT_SIZE = (768, 432)
MAX_BODY_BYTES = 4_100_000
MAX_IMAGE_BYTES = 1_800_000
ALLOWED_PATHS = {
    "/": ROOT / "index.html",
    "/index.html": ROOT / "index.html",
    "/styles.css": ROOT / "styles.css",
    "/src/core.mjs": ROOT / "src" / "core.mjs",
    "/src/app.mjs": ROOT / "src" / "app.mjs",
    "/src/location.mjs": ROOT / "src" / "location.mjs",
    "/src/commons.mjs": ROOT / "src" / "commons.mjs",
    "/src/compositor.mjs": ROOT / "src" / "compositor.mjs",
    "/src/scenes.mjs": ROOT / "src" / "scenes.mjs",
    "/src/panoramax.mjs": ROOT / "src" / "panoramax.mjs",
    "/src/depth.mjs": ROOT / "src" / "depth.mjs",
}
CONTENT_TYPES = {".html": "text/html; charset=utf-8",
                 ".css": "text/css; charset=utf-8",
                 ".mjs": "text/javascript; charset=utf-8"}
GPU_LOCK = threading.Lock()
DATA_URL = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$")


class RequestError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def decode_image_url(value: str, name: str) -> bytes:
    if not isinstance(value, str) or len(value) > MAX_IMAGE_BYTES * 4 // 3 + 96:
        raise RequestError(name + "のサイズが大きすぎるか、形式が不正です。")
    match = DATA_URL.fullmatch(value)
    if not match:
        raise RequestError(name + "はPNG/JPEG/WebPの画像データで指定してください。")
    kind, encoded = match.groups()
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise RequestError(name + "のBase64が不正です。") from None
    if not 32 <= len(data) <= MAX_IMAGE_BYTES:
        raise RequestError(name + "は1.8MB以下にしてください。")
    signatures = {
        "png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpeg": data.startswith(b"\xff\xd8\xff"),
        "webp": data.startswith(b"RIFF") and data[8:12] == b"WEBP",
    }
    if not signatures[kind]:
        raise RequestError(name + "のヘッダーが不正です。")
    return data




def parse_compositing(value: object) -> dict:
    """Validate client controls before any GPU work (all fields unitless)."""
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise RequestError("写真の色・影の設定が不正です。")
    bounds = {
        "subjectExposure": (0.5, 1.5, 1.0),
        "subjectWarmth": (0.0, 0.3, 0.0),
        "contactShadow": (0.0, 0.8, 0.4),
        "shadowSoftness": (0.05, 1.0, 0.45),
    }
    import math
    results = {}
    for name, (low, high, default) in bounds.items():
        try:
            n = float(value.get(name, default))
        except (TypeError, ValueError):
            raise RequestError("写真設定 " + name + " は数値で指定してください。") from None
        if not math.isfinite(n) or n < low or n > high:
            raise RequestError("写真設定 " + name + " が範囲外です。")
        results[name] = n
    return results

def parse_request(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise RequestError("リクエストの形式が不正です。")
    if payload.get("acceptRights") is not True:
        raise RequestError("画像利用権の確認が必要です。")
    try:
        lat = float(payload["lat"])
        lon = float(payload["lon"])
        import math
        if not math.isfinite(lat) or not math.isfinite(lon):
            raise ValueError()
        if not -85.0511 <= lat <= 85.0511 or not -180 <= lon <= 180:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise RequestError("WGS84の緯度・経度が不正です。") from None
    placement = payload.get("placement")
    if not isinstance(placement, dict):
        raise RequestError("被写体の配置情報が必要です。")
    try:
        x = float(placement["x"])
        y = float(placement["y"])
        width = float(placement["widthRatio"])
        if not all(map(math.isfinite, [x, y, width])):
            raise ValueError()
        if not 0 <= x <= 1 or not 0 <= y <= 1 or not 0.06 <= width <= 0.85:
            raise ValueError()
    except (KeyError, ValueError, TypeError):
        raise RequestError("被写体の座標・大きさが範囲外です。") from None
    description = payload.get("description", "")
    if not isinstance(description, str) or len(description) > 600:
        raise RequestError("指示テキストは600文字以内にしてください。")
    subject_type = payload.get("subjectType", "person")
    if subject_type not in ("person", "product"):
        raise RequestError("被写体の種類が不正です。")
    return {
        "lat": lat, "lon": lon,
        "placement": {"x": x, "y": y, "widthRatio": width},
        "background": decode_image_url(payload.get("background"), "地図背景"),
        "subject": decode_image_url(payload.get("subject"), "被写体"),
        "reference": decode_image_url(payload["reference"], "参照画像") if payload.get("reference") else None,
        "description": description.strip(),
        "subjectType": subject_type,
        "compositing": parse_compositing(payload.get("compositing")),
        "occlusion": decode_image_url(payload["occlusionMask"], "前景マスク")
            if payload.get("occlusionMask") else None,
    }




def parse_depth_request(payload: object) -> bytes:
    """Validate explicitly authorized background, without importing ML libs."""
    if not isinstance(payload, dict):
        raise RequestError("リクエストの形式が不正です。")
    if payload.get("acceptRights") is not True:
        raise RequestError("現地写真の利用権とローカル推論への同意が必要です。")
    return decode_image_url(payload.get("image"), "深度推定の背景画像")


def get_depth_backend_state() -> tuple[bool, str, str]:
    """Detect local depth inference separately from optional diffusion models."""
    try:
        import torch
        import transformers  # noqa: F401
        from PIL import Image  # noqa: F401
        if torch.cuda.is_available():
            return True, "cuda", ""
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return True, "mps", ""
        if ALLOW_CPU:
            return True, "cpu", "CPU推論は遅い場合があります。"
        return False, "unavailable", "CUDA/MPS GPUが必要です。CPU実験はVLC_ALLOW_CPU=1を指定してください。"
    except ImportError:
        return False, "missing", "深度推定にはtorch、transformers、Pillowが必要です。"


@lru_cache(maxsize=1)
def load_depth_pipeline():
    from transformers import pipeline
    ready, device, message = get_depth_backend_state()
    if not ready:
        raise RequestError(message, status=503)
    # For the 24.8M parameter Apache-2.0 model; weights downloaded on first
    # use from Hugging Face Hub, then run on local CUDA / MPS / CPU.
    pipe = pipeline(task="depth-estimation", model=DEPTH_MODEL_ID, device=device)
    return pipe, device


def render_depth(image_bytes: bytes) -> dict:
    """Infer *relative* monocular depth, not calibrated distance in metres."""
    from PIL import Image, ImageOps
    source = open_image(image_bytes).convert("RGB")
    source = ImageOps.fit(source, OUTPUT_SIZE, method=Image.Resampling.LANCZOS)
    pipe, device = load_depth_pipeline()
    result = pipe(source)
    gray = result["depth"].convert("L")
    if gray.size != OUTPUT_SIZE:
        gray = gray.resize(OUTPUT_SIZE, Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    gray.save(buf, format="PNG")
    return {
        "model": DEPTH_MODEL_ID,
        "relativeOnly": True,
        "width": gray.width,
        "height": gray.height,
        "device": device,
        # DepthAnything pipeline returns normalized grayscale; the UI offers
        # explicit "invert" because sign and edges must be reviewed visually.
        "nearIsBright": "assumed; user adjustable",
        "depthMap": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"),
        "note": "相対深度です。物体境界・人物の前後・距離は実測値ではありません。"
    }

def get_backend_state() -> tuple[bool, str, str]:
    try:
        import torch
        from diffusers import AutoPipelineForImage2Image  # noqa: F401
        from PIL import Image  # noqa: F401
        if torch.cuda.is_available():
            return True, "cuda", ""
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return True, "mps", ""
        if ALLOW_CPU:
            return True, "cpu", "CPU推論は極めて低速になる場合があります。"
        return False, "unavailable", "CUDA GPUまたはApple Silicon MPSが必要です。CPUで試す場合はVLC_ALLOW_CPU=1。"
    except ImportError:
        return False, "missing", "Python依存関係が不足しています。requirements-ai.txtをインストールしてください。"


@lru_cache(maxsize=1)
def load_pipeline():
    # Intentionally lazy. First invocation downloads public model weights from HF.
    import torch
    from diffusers import AutoPipelineForImage2Image
    ok, device, problem = get_backend_state()
    if not ok:
        raise RequestError(problem, status=503)
    dtype = torch.float16 if device == "cuda" else torch.float32
    pipe = AutoPipelineForImage2Image.from_pretrained(
        MODEL_ID, torch_dtype=dtype, use_safetensors=True
    )
    pipe.to(device)
    pipe.enable_attention_slicing()
    return pipe, device, torch


def open_image(data: bytes):
    from PIL import Image
    try:
        with Image.open(io.BytesIO(data)) as candidate:
            candidate.verify()
        with Image.open(io.BytesIO(data)) as candidate:
            if candidate.width * candidate.height > 25_000_000:
                raise RequestError("画像の画素数が大きすぎます。")
            return candidate.convert("RGBA")
    except RequestError:
        raise
    except Exception as exc:
        raise RequestError("画像データをデコードできません。") from exc


def render_scene(data: dict) -> dict:
    from PIL import Image, ImageOps
    initial = open_image(data["reference"] or data["background"]).convert("RGB")
    init = ImageOps.fit(initial, OUTPUT_SIZE, method=Image.Resampling.LANCZOS)
    subject = open_image(data["subject"])
    pipe, device, torch = load_pipeline()
    prompt = (
        "Natural photorealistic nighttime city street photograph, "
        "realistic urban architecture, atmospheric light, detailed surface "
        "materials, believable perspective and texture, professional photography. "
        + data["description"][:450]
    )
    generator = torch.Generator(device="cpu").manual_seed(42)
    # Lower strength retains more of the map/reference composition.
    with torch.inference_mode():
        output = pipe(
            prompt=prompt,
            image=init,
            strength=0.42,
            guidance_scale=6.0,
            num_inference_steps=24,
            generator=generator,
        ).images[0].convert("RGBA")
    # Keep the generated background before composing the foreground subject.
    # The mask then restores that SAME background where scenery must be closer,
    # without mixing old street pixels with the newly generated street texture.
    generated_background = output.copy()
    # Preserve user image pixels instead of asking the model to regenerate
    # the person's face or product identity. Relighting is an approximation,
    # not a physically accurate estimate of the real street's light field.
    from PIL import ImageDraw, ImageEnhance, ImageFilter, ImageOps
    p = data["placement"]
    settings = data.get("compositing") or parse_compositing(None)
    width = max(1, round(p["widthRatio"] * OUTPUT_SIZE[0]))
    height = max(1, round(width * subject.height / subject.width))
    foreground = subject.resize((width, height), Image.Resampling.LANCZOS)
    x = round(p["x"] * OUTPUT_SIZE[0] - width / 2)
    y = round(p["y"] * OUTPUT_SIZE[1] - height / 2)

    if settings["subjectExposure"] != 1:
        foreground = ImageEnhance.Brightness(foreground).enhance(settings["subjectExposure"])

    warmth = settings["subjectWarmth"]
    if warmth:
        from PIL import Image as PilImage
        source_alpha = foreground.getchannel("A")
        warm_tone = ImageOps.colorize(
            ImageOps.grayscale(foreground.convert("RGB")),
            black=(34, 24, 24), white=(255, 228, 196)
        )
        toned = PilImage.blend(foreground.convert("RGB"), warm_tone, warmth)
        toned.putalpha(source_alpha)
        foreground = toned

    shadow_opacity = settings["contactShadow"]
    if shadow_opacity:
        radius_x = max(3.0, width * 0.32)
        radius_y = max(1.5, min(OUTPUT_SIZE[1] * 0.1, width * 0.14) / 2)
        cx = x + width / 2
        cy = y + height * 0.985
        shadow = Image.new("RGBA", OUTPUT_SIZE, (0, 0, 0, 0))
        drawer = ImageDraw.Draw(shadow)
        drawer.ellipse(
            (round(cx-radius_x), round(cy-radius_y), round(cx+radius_x), round(cy+radius_y)),
            fill=(4, 8, 18, round(shadow_opacity * 255))
        )
        shadow = shadow.filter(
            ImageFilter.GaussianBlur(radius=max(1.0, radius_y * 2 * settings["shadowSoftness"] * 0.7))
        )
        output = Image.alpha_composite(output, shadow)

    # Pasting through a full-size transparent layer safely clips subjects
    # whose bounding rectangle crosses an edge of the output canvas.
    subject_layer = Image.new("RGBA", OUTPUT_SIZE, (0, 0, 0, 0))
    subject_layer.paste(foreground, (x, y))
    output = Image.alpha_composite(output, subject_layer)
    if data.get("occlusion"):
        occlusion = open_image(data["occlusion"]).getchannel("A")
        occlusion = occlusion.resize(OUTPUT_SIZE, Image.Resampling.BILINEAR)
        output = Image.composite(generated_background, output, occlusion)
    buf = io.BytesIO()
    output.convert("RGB").save(buf, format="WEBP", quality=90)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return {
        "image": "data:image/webp;base64," + encoded,
        "model": MODEL_ID,
        "device": device,
        "isSynthetic": True,
        "location": {"lat": data["lat"], "lon": data["lon"]},
        "output": {"width": OUTPUT_SIZE[0], "height": OUTPUT_SIZE[1], "format": "webp"},
        "referenceMode": "reference-photo" if data["reference"] else "geospatial-map",
        "relativeDepthMaskApplied": bool(data.get("occlusion")),
        "notice": "AI生成画像です。地理的忠実性や現地撮影の事実は保証されません。",
    }


class AppHandler(BaseHTTPRequestHandler):
    server_version = "VirtualLocationCameraLocal/1.0"

    def respond_json(self, status: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def allowed_origin(self) -> bool:
        host = self.headers.get("Host", "")
        # DNS rebinding protection: only exact loopback names and local port.
        if host not in (f"127.0.0.1:{PORT}", f"localhost:{PORT}"):
            return False
        origin = self.headers.get("Origin")
        return not origin or origin in (
            f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"
        )

    def do_GET(self):
        if not self.allowed_origin():
            return self.respond_json(403, {"error": "接続元が許可されていません。"})
        path = urlsplit(self.path).path
        if path == "/api/scenes":
            # Local Python GPU runner deliberately has no Mapillary API token.
            # Browser transparently falls back to geotagged Commons imagery.
            return self.respond_json(200, {
                "source": "mapillary", "configured": False, "candidates": []
            })
        if path == "/api/panoramax-scenes":
            return self.respond_json(503, {"error": "Panoramax is available on the Node/Vercel server. Use Commons or your own photos in the local GPU server."})
        if path == "/api/panoramax-image":
            return self.respond_json(503, {"error": "Panoramax image proxy requires Node/Vercel."})
        if path == "/api/scene-image":
            return self.respond_json(503, {
                "error": "Mapillary images require the separate Node/Vercel proxy."
            })
        if path == "/api/depth-health":
            ok, device, message = get_depth_backend_state()
            return self.respond_json(200, {
                "available": ok, "device": device, "message": message,
                "model": DEPTH_MODEL_ID, "relativeOnly": True
            })
        if path == "/api/health":
            ok, device, msg = get_backend_state()
            return self.respond_json(200, {
                "service": "Virtual Location Camera (local Hugging Face model)",
                "aiConfigured": ok,
                "requiresAccessCode": False,
                "model": MODEL_ID,
                "device": device,
                "message": msg
            })
        target = ALLOWED_PATHS.get(path)
        if target is None or not target.is_file():
            return self.respond_json(404, {"error": "Not found"})
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES[target.suffix])
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self.allowed_origin():
            return self.respond_json(403, {"error": "接続元が許可されていません。"})
        endpoint = urlsplit(self.path).path
        if endpoint not in ("/api/render", "/api/depth"):
            return self.respond_json(404, {"error": "Not found"})
        try:
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                raise RequestError("Content-Typeはapplication/jsonを指定してください。", 415)
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise RequestError("リクエストサイズが不正です。")
            if size <= 0 or size > MAX_BODY_BYTES:
                raise RequestError("リクエストサイズが不正です。", 413)
            raw = self.rfile.read(size)
            user_input = json.loads(raw.decode("utf8"))
            payload = parse_request(user_input) if endpoint == "/api/render" else parse_depth_request(user_input)
            # No overlapping GPU jobs: prevent RAM/VRAM exhaustion.
            if not GPU_LOCK.acquire(blocking=False):
                raise RequestError("別の生成処理が実行中です。終了後に再試行してください。", 429)
            try:
                result = render_scene(payload) if endpoint == "/api/render" else render_depth(payload)
            finally:
                GPU_LOCK.release()
            return self.respond_json(200, result)
        except RequestError as exc:
            return self.respond_json(exc.status, {"error": str(exc)})
        except (ValueError, UnicodeError, json.JSONDecodeError):
            return self.respond_json(400, {"error": "リクエスト本文が不正です。"})
        except Exception as exc:
            # Do not leak local paths, tokens, or other internal error details.
            self.log_error("AI render failed: %s", type(exc).__name__)
            return self.respond_json(500, {
                "error": "ローカルモデル推論に失敗しました。端末側のGPU・CPUメモリとログを確認してください。"
            })


if __name__ == "__main__":
    print(f"Virtual Location Camera — Hugging Face local inference")
    print(f"Model: {MODEL_ID}")
    print(f"URL: http://{HOST}:{PORT}")
    print("Weights download from Hugging Face on the first generation.")
    ThreadingHTTPServer((HOST, PORT), AppHandler).serve_forever()
