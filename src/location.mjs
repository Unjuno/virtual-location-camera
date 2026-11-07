/**
 * Official Google Maps URLs are used strictly for navigation/location selection.
 * No Google Maps image or Street View content is fetched, scraped, cached, or
 * sent to the image generator.
 */
import { parseLocation } from "./core.mjs";

const COORD = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
const PAIR = new RegExp("^\\s*(" + COORD + ")\\s*,\\s*(" + COORD + ")\\s*$");
const AT = new RegExp("@(" + COORD + "),(" + COORD + ")(?:,|/|$)");
const PANO = new RegExp("!3d(" + COORD + ")!4d(" + COORD + ")(?:!|/|$)");
const PANO_REVERSED = new RegExp("!4d(" + COORD + ")!3d(" + COORD + ")(?:!|/|$)");

const ALLOWED_HOSTS = new Set([
  "google.com", "www.google.com", "maps.google.com",
  "google.co.jp", "www.google.co.jp", "maps.google.co.jp"
]);

export function parseGoogleMapsLocation(source) {
  const raw = String(source ?? "").trim();
  if (!raw || raw.length > 2048) {
    throw new Error("2048文字以内のGoogle MapsのURLを入力してください。");
  }
  let url;
  try { url = new URL(raw); }
  catch { throw new Error("https://で始まるGoogle MapsのURLが必要です。"); }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Google Mapsの公式HTTPS URLだけを受け付けます。");
  }
  if (!url.pathname.startsWith("/maps") && url.hostname.toLowerCase() !== "maps.google.com") {
    throw new Error("Google Mapsの地点URLを入力してください。");
  }

  // @ coordinates identify the *map viewport center*. They do not certify the
  // exact Street View camera origin or coordinates of a selected business.
  const at = decodeURIComponent(url.pathname).match(AT);
  if (at) return { ...parseLocation(at[1], at[2]), kind: "viewport-center" };

  for (const key of ["viewpoint", "query", "center", "q", "ll"]) {
    const matched = String(url.searchParams.get(key) || "").match(PAIR);
    if (matched) return { ...parseLocation(matched[1], matched[2]), kind: "coordinate" };
  }
  const pathname = decodeURIComponent(url.pathname);
  const pano = pathname.match(PANO);
  if (pano) return { ...parseLocation(pano[1], pano[2]), kind: "image-metadata" };
  const reversed = pathname.match(PANO_REVERSED);
  if (reversed) return { ...parseLocation(reversed[2], reversed[1]), kind: "image-metadata" };
  throw new Error("URLに数値の緯度・経度が見つかりません。短縮URLや地名だけのURLは非対応です。");
}

export function googleMapsPlaceUrl(lat, lon) {
  const point = parseLocation(lat, lon);
  const query = encodeURIComponent(point.lat + "," + point.lon);
  return "https://www.google.com/maps/search/?api=1&query=" + query;
}

export function googleMapsStreetViewUrl(lat, lon) {
  const point = parseLocation(lat, lon);
  const viewpoint = encodeURIComponent(point.lat + "," + point.lon);
  return "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=" + viewpoint;
}

/** Center-crop source bounds to fill a target box (as with object-fit: cover). */
/**
 * Center/cursor-aware object-fit: cover crop.
 *
 * photoZoom >= 1 denotes how much tighter than the minimum cover crop to draw.
 * photoFocusX/Y (0..1) choose a point within the available cropping interval.
 * For zoom=1 and focus=(0.5,0.5), output equals CSS object-fit: cover.
 */
export function coverSourceRect(imageWidth, imageHeight, targetWidth, targetHeight, focusX = 0.5, focusY = 0.5, photoZoom = 1) {
  if (![imageWidth, imageHeight, targetWidth, targetHeight].every(v => Number.isFinite(v) && v > 0)) {
    throw new RangeError("画像と出力の縦横寸法は正の有限数で指定してください。");
  }
  if (![focusX, focusY, photoZoom].every(Number.isFinite) || focusX < 0 || focusX > 1 || focusY < 0 || focusY > 1 || photoZoom < 1 || photoZoom > 2.5) {
    throw new RangeError("背景の位置は0～1、拡大率は1～2.5で指定してください。");
  }
  const sourceAspect = imageWidth / imageHeight;
  const targetAspect = targetWidth / targetHeight;
  const baseW = sourceAspect > targetAspect ? imageHeight * targetAspect : imageWidth;
  const baseH = sourceAspect > targetAspect ? imageHeight : imageWidth / targetAspect;
  const cropW = baseW / photoZoom;
  const cropH = baseH / photoZoom;
  return {
    sx: (imageWidth - cropW) * focusX,
    sy: (imageHeight - cropH) * focusY,
    sw: cropW,
    sh: cropH
  };
}
