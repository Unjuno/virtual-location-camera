/**
 * Deterministic subject harmonization helpers. These are rendering heuristics,
 * not physically correct lighting, relighting or recovered 3D geometry.
 */
import { photoRect, clamp } from "./core.mjs";

export const DEFAULT_STUDIO = Object.freeze({
  subjectExposure: 1,
  subjectWarmth: 0,
  contactShadow: 0.4,
  shadowSoftness: 0.45,
  photoZoom: 1,
  photoFocusX: 0.5,
  photoFocusY: 0.5
});

export function studioSettings(raw = {}) {
  return {
    subjectExposure: clamp(Number.isFinite(raw.subjectExposure) ? raw.subjectExposure : DEFAULT_STUDIO.subjectExposure, 0.5, 1.5),
    subjectWarmth: clamp(Number.isFinite(raw.subjectWarmth) ? raw.subjectWarmth : DEFAULT_STUDIO.subjectWarmth, 0, 0.3),
    contactShadow: clamp(Number.isFinite(raw.contactShadow) ? raw.contactShadow : DEFAULT_STUDIO.contactShadow, 0, 0.8),
    shadowSoftness: clamp(Number.isFinite(raw.shadowSoftness) ? raw.shadowSoftness : DEFAULT_STUDIO.shadowSoftness, 0.05, 1),
    photoZoom: clamp(Number.isFinite(raw.photoZoom) ? raw.photoZoom : DEFAULT_STUDIO.photoZoom, 1, 2.5),
    photoFocusX: clamp(Number.isFinite(raw.photoFocusX) ? raw.photoFocusX : DEFAULT_STUDIO.photoFocusX, 0, 1),
    photoFocusY: clamp(Number.isFinite(raw.photoFocusY) ? raw.photoFocusY : DEFAULT_STUDIO.photoFocusY, 0, 1)
  };
}

export function subjectCssFilter(raw = {}) {
  const s = studioSettings(raw);
  // Browser CSS and CanvasRenderingContext2D both accept this filter grammar.
  return "brightness(" + s.subjectExposure.toFixed(3) + ") sepia(" + s.subjectWarmth.toFixed(3) + ")";
}

export function contactShadowGeometry(imageW, imageH, placement, canvasW, canvasH, rawSettings = {}) {
  const rect = photoRect(imageW, imageH, placement, canvasW, canvasH);
  const s = studioSettings(rawSettings);
  const shadowW = Math.max(6, rect.width * 0.64);
  const shadowH = Math.max(3, Math.min(canvasH * 0.1, rect.width * 0.14));
  return {
    centerX: rect.x + rect.width / 2,
    centerY: rect.y + rect.height * 0.985,
    radiusX: shadowW / 2,
    radiusY: shadowH / 2,
    blur: Math.max(1, shadowH * s.shadowSoftness * 0.7),
    opacity: s.contactShadow
  };
}

export function drawSubjectWithShadow(ctx, image, placement, canvasW, canvasH, rawSettings = {}) {
  if (!ctx || !image || !(image.naturalWidth > 0 && image.naturalHeight > 0)) {
    throw new RangeError("A decoded subject image and canvas are required.");
  }
  const settings = studioSettings(rawSettings);
  const rect = photoRect(image.naturalWidth, image.naturalHeight, placement, canvasW, canvasH);

  if (settings.contactShadow > 0) {
    const g = contactShadowGeometry(image.naturalWidth, image.naturalHeight, placement, canvasW, canvasH, settings);
    ctx.save();
    ctx.filter = "blur(" + g.blur.toFixed(2) + "px)";
    ctx.fillStyle = "rgba(4,8,18," + g.opacity.toFixed(3) + ")";
    ctx.beginPath();
    ctx.ellipse(g.centerX, g.centerY, g.radiusX, g.radiusY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.filter = subjectCssFilter(settings);
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
  return rect;
}
