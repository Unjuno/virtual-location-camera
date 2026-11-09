/**
 * Browser-only human cutout (no photo uploaded to an AI API).
 * MediaPipe Tasks Vision 1.2.2 / Apache-2.0 runtime; selfie segmenter float16.
 *
 * This is an optional enhancement; original photos and manual PNG cutouts work
 * even when the model/CDN/WebAssembly is unavailable.
 */
export const CUTOUT_VERSION = "1.2.2";
export const CUTOUT_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + CUTOUT_VERSION;
export const CUTOUT_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
export const MAX_CUTOUT_EDGE = 1600;

let cachedSegmenterPromise = null;

export function matteAlpha(probability, lower = 0.18, upper = 0.83) {
  const n = Number(probability);
  if (!Number.isFinite(n) || !(upper > lower) || lower < 0 || upper > 1) return 0;
  const s = Math.max(0, Math.min(1, (n - lower) / (upper - lower)));
  // Smoothstep reduces halos compared with a hard binary threshold.
  return Math.round((s * s * (3 - 2 * s)) * 255);
}

export function cutoutDimensions(width, height, limit = MAX_CUTOUT_EDGE) {
  if (![width, height, limit].every(x => Number.isFinite(x) && x > 0)) {
    throw new RangeError("切り抜き画像の縦横サイズが不正です。");
  }
  const scale = Math.min(1, limit / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export function alphaFromConfidence(values, width, height) {
  if (!(values instanceof Float32Array) || !Number.isInteger(width)
    || !Number.isInteger(height) || width < 1 || height < 1
    || width > 4096 || height > 4096 || values.length !== width * height) {
    throw new TypeError("人物セグメンテーション結果の形状が不正です。");
  }
  const result = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < values.length; i++) {
    result[4 * i] = 255;
    result[4 * i + 1] = 255;
    result[4 * i + 2] = 255;
    result[4 * i + 3] = matteAlpha(values[i]);
  }
  return result;
}

export async function getPersonSegmenter({ loadModule = () =>
  import(CUTOUT_CDN + "/vision_bundle.mjs") } = {}) {
  if (!cachedSegmenterPromise) {
    cachedSegmenterPromise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await loadModule();
      if (!FilesetResolver?.forVisionTasks || !ImageSegmenter?.createFromOptions) {
        throw new Error("人物切り抜きモデルの読み込みに失敗しました。");
      }
      const files = await FilesetResolver.forVisionTasks(CUTOUT_CDN + "/wasm");
      return ImageSegmenter.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: CUTOUT_MODEL_URL,
          delegate: "CPU"
        },
        runningMode: "IMAGE",
        outputCategoryMask: false,
        outputConfidenceMasks: true
      });
    })().catch(error => {
      cachedSegmenterPromise = null; // allow retry after transient CDN outage
      throw error;
    });
  }
  return cachedSegmenterPromise;
}

export async function segmentPerson(sourceImage, {
  documentObject = document,
  segmenterPromise = getPersonSegmenter()
} = {}) {
  if (!sourceImage?.naturalWidth || !sourceImage?.naturalHeight) {
    throw new Error("人物の元画像を読み込めませんでした。");
  }
  const segmenter = await segmenterPromise;
  const { width, height } = cutoutDimensions(sourceImage.naturalWidth, sourceImage.naturalHeight);
  const input = documentObject.createElement("canvas");
  input.width = width; input.height = height;
  const originalContext = input.getContext("2d", { willReadFrequently: false });
  if (!originalContext) throw new Error("写真のCanvasが利用できません。");
  originalContext.drawImage(sourceImage, 0, 0, width, height);

  const segmentation = segmenter.segment(input);
  const masks = segmentation?.confidenceMasks;
  // The SelfieSegmenter exposes ONE person-confidence mask in MediaPipe
  // Tasks (confirmed by the live Chromium test). Multi-class models may
  // return separate background/person channels instead.
  const mask = masks?.length === 1 ? masks[0] : masks?.[1];
  if (!mask || typeof mask.getAsFloat32Array !== "function") {
    segmentation?.close?.();
    throw new Error("モデルが人物領域を判定できませんでした。");
  }
  const w = mask.width;
  const h = mask.height;
  const scores = new Float32Array(mask.getAsFloat32Array());
  segmentation.close?.();
  const rgba = alphaFromConfidence(scores, w, h);
  // One mask pixel maps to its corresponding region of the resized photo.
  const matte = documentObject.createElement("canvas");
  matte.width = w; matte.height = h;
  const matteCtx = matte.getContext("2d");
  if (!matteCtx) throw new Error("切り抜きマスクを作成できません。");
  const rgbaPixels = matteCtx.createImageData(w, h);
  rgbaPixels.data.set(rgba);
  matteCtx.putImageData(rgbaPixels, 0, 0);

  originalContext.save();
  originalContext.globalCompositeOperation = "destination-in";
  originalContext.imageSmoothingEnabled = true;
  originalContext.imageSmoothingQuality = "high";
  originalContext.drawImage(matte, 0, 0, width, height);
  originalContext.restore();

  return input.toDataURL("image/png");
}
