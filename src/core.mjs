/**
 * Deterministic geometry, validation and capture metadata.
 * Coordinates are WGS84 decimal degrees; widthRatio, x and y are viewport fractions.
 * This module has no network or browser dependencies, so it can be tested in Node.
 */
export const PRESETS = Object.freeze([
  { id: "times-square", name: "New York · Times Square", lat: 40.7580, lon: -73.9855, zoom: 16.8, pitch: 68, bearing: -19 },
  { id: "brooklyn-bridge", name: "New York · Brooklyn Bridge", lat: 40.7061, lon: -73.9969, zoom: 16.1, pitch: 65, bearing: -35 },
  { id: "shibuya", name: "Tokyo · Shibuya", lat: 35.6595, lon: 139.7005, zoom: 16.8, pitch: 65, bearing: 5 },
  { id: "eiffel", name: "Paris · Eiffel Tower", lat: 48.8584, lon: 2.2945, zoom: 16.5, pitch: 60, bearing: 22 },
  { id: "london", name: "London · Tower Bridge", lat: 51.5055, lon: -0.0754, zoom: 16.4, pitch: 64, bearing: -35 }
]);

export const CAPTURE = Object.freeze({ width: 1600, height: 900 });
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function parseCoordinate(value, label, min, max) {
  const text = String(value ?? "").trim();
  // Number("") and Number("0x10") are intentionally not accepted as coordinates.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    throw new Error(label + "には十進数を入力してください。");
  }
  const n = Number(text);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(label + "は " + min + "〜" + max + " の範囲で入力してください。");
  }
  return n;
}

export function parseLocation(latitude, longitude) {
  return {
    lat: parseCoordinate(latitude, "緯度", -90, 90),
    lon: parseCoordinate(longitude, "経度", -180, 180)
  };
}

export function normalizePlacement(candidate = {}) {
  return {
    x: clamp(Number.isFinite(candidate.x) ? candidate.x : 0.52, 0.02, 0.98),
    y: clamp(Number.isFinite(candidate.y) ? candidate.y : 0.55, 0.05, 0.95),
    widthRatio: clamp(Number.isFinite(candidate.widthRatio) ? candidate.widthRatio : 0.21, 0.06, 0.85)
  };
}

export function photoRect(imageWidth, imageHeight, placement, width = CAPTURE.width, height = CAPTURE.height) {
  if (![imageWidth, imageHeight, width, height].every(v => Number.isFinite(v) && v > 0)) {
    throw new RangeError("Image and canvas dimensions must be positive finite numbers.");
  }
  const p = normalizePlacement(placement);
  const drawWidth = p.widthRatio * width;
  const drawHeight = drawWidth * imageHeight / imageWidth;
  return {
    x: p.x * width - drawWidth / 2,
    y: p.y * height - drawHeight / 2,
    width: drawWidth,
    height: drawHeight
  };
}

export function isSupportedImage(file) {
  return Boolean(file && ["image/png", "image/jpeg", "image/webp"].includes(file.type)
    && Number.isFinite(file.size) && file.size > 0 && file.size <= MAX_UPLOAD_BYTES);
}

export function sceneSnapshot(camera, placement, subjectType, timestamp = new Date().toISOString()) {
  const location = parseLocation(camera.lat, camera.lon);
  const numericCamera = {
    ...location,
    zoom: clamp(Number(camera.zoom) || 16, 1, 22),
    pitch: clamp(Number(camera.pitch) || 0, 0, 85),
    bearing: Number.isFinite(Number(camera.bearing)) ? Number(camera.bearing) : 0
  };
  return {
    schemaVersion: 1,
    type: "synthetic-geospatial-composite",
    generatedAt: timestamp,
    scene: numericCamera,
    subject: { type: String(subjectType), ...normalizePlacement(placement) },
    output: { ...CAPTURE },
    note: "Composite, not evidence of an on-site photograph. Uploaded image bytes are never included."
  };
}
