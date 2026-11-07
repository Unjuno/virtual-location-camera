/**
 * Location-scene grounding: location, camera direction, and observed photos.
 * Geographic measures are approximate WGS84 distances, not visual registration.
 * None of these functions generates or infers unseen structures.
 */
import { parseLocation, clamp } from "./core.mjs";

const EARTH_RADIUS_M = 6371008.8;
export const SCENE_RADIUS_LIMIT_M = 200;
export const MAX_SCENE_CANDIDATES = 12;

export function normalizeHeading(degrees) {
  if (degrees === null || degrees === undefined || degrees === "") return null;
  const n = Number(degrees);
  if (!Number.isFinite(n)) return null;
  const normalized = ((n % 360) + 360) % 360;
  // Removing floating-point wrap noise avoids displaying 45.3199999999°.
  return Math.round(normalized * 1e8) / 1e8;
}

export function headingDelta(a, b) {
  const left = normalizeHeading(a), right = normalizeHeading(b);
  if (left === null || right === null) return null;
  const diff = Math.abs(left - right);
  return Math.min(diff, 360 - diff);
}

export function distanceMeters(latA, lonA, latB, lonB) {
  const first = parseLocation(latA, lonA);
  const second = parseLocation(latB, lonB);
  const rad = Math.PI / 180;
  const dLat = (second.lat - first.lat) * rad;
  const dLon = (second.lon - first.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(first.lat * rad) * Math.cos(second.lat * rad) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

export function searchBoundingBox(lat, lon, radiusM = 150) {
  const c = parseLocation(lat, lon);
  if (!(Number.isInteger(radiusM) && radiusM >= 25 && radiusM <= SCENE_RADIUS_LIMIT_M)) {
    throw new RangeError("検索半径は25〜200mの整数で指定してください。");
  }
  if (Math.abs(c.lat) > 84.5) throw new RangeError("高緯度の地点は街路画像検索に非対応です。");
  const deltaLat = radiusM / 111320;
  const deltaLon = radiusM / (111320 * Math.cos(c.lat * Math.PI / 180));
  // Antimeridian wrapping is deliberately not supported in the first release.
  if (c.lon - deltaLon < -180 || c.lon + deltaLon > 180) {
    throw new RangeError("日付変更線付近の画像検索には非対応です。");
  }
  return [
    c.lon - deltaLon, c.lat - deltaLat,
    c.lon + deltaLon, c.lat + deltaLat
  ].map(value => Number(value.toFixed(7)));
}

export function sceneAssessment(distanceM, directionDelta) {
  if (!Number.isFinite(distanceM) || distanceM < 0) return "unknown";
  if (distanceM > SCENE_RADIUS_LIMIT_M) return "out-of-range";
  if (directionDelta === null) return "location-only";
  // Observed capture viewpoint/heading is approximate, not a camera match.
  if (distanceM <= 50 && directionDelta <= 35) return "near-position-and-heading";
  return "candidate";
}

function normalizedPhoto(candidate, request) {
  const id = String(candidate?.id ?? "");
  if (!/^\d{1,20}$/.test(id)) return null;
  const geometry = candidate?.computed_geometry ?? candidate?.geometry;
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  let photoLocation;
  try { photoLocation = parseLocation(coordinates[1], coordinates[0]); }
  catch { return null; }

  const distanceM = distanceMeters(request.lat, request.lon, photoLocation.lat, photoLocation.lon);
  if (!Number.isFinite(distanceM) || distanceM > request.radiusM + 20) return null;
  const heading = normalizeHeading(candidate?.computed_compass_angle ?? candidate?.compass_angle);
  const delta = headingDelta(heading, request.heading);
  const creator = String(candidate?.creator?.username ?? candidate?.creator?.name ?? "Mapillary contributor").slice(0, 70);
  const timestamp = Number(candidate?.captured_at);
  const captureDate = Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString().slice(0, 10) : null;
  return {
    provider: "mapillary",
    id, lat: photoLocation.lat, lon: photoLocation.lon,
    distanceM: Math.round(distanceM),
    cameraHeading: heading,
    headingDifference: delta === null ? null : Math.round(delta),
    captureDate,
    imageType: candidate?.camera_type === "spherical" ? "360" : "perspective",
    creator,
    assessment: sceneAssessment(distanceM, delta),
    // Image binary is deliberately served by a same-origin, allowlisted proxy
    // so Mapillary tokens never enter browser JS, logs or URL query strings.
    imageUrl: "/api/scene-image?id=" + id,
    viewerUrl: "https://www.mapillary.com/app/?pKey=" + id + "&focus=photo",
    attribution: "Mapillary · " + creator + " · CC BY-SA 4.0",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    exactViewVerified: false
  };
}

export function normalizeMapillaryResults(payload, request) {
  const latlon = parseLocation(request.lat, request.lon);
  const radiusM = Number(request.radiusM ?? 150);
  const heading = normalizeHeading(request.heading);
  if (!Number.isInteger(radiusM) || radiusM < 25 || radiusM > SCENE_RADIUS_LIMIT_M) {
    throw new RangeError("Invalid radius");
  }
  const values = Array.isArray(payload?.data) ? payload.data : [];
  const unique = new Map();
  for (const candidate of values.slice(0, 150)) {
    let photo;
    try { photo = normalizedPhoto(candidate, { ...latlon, heading, radiusM }); }
    catch { continue; }
    if (photo && !unique.has(photo.id)) unique.set(photo.id, photo);
  }
  return [...unique.values()]
    .sort((a, b) => {
      const score = item => item.distanceM +
        (item.headingDifference === null ? 80 : item.headingDifference * 0.65);
      return score(a) - score(b) || a.id.localeCompare(b.id);
    })
    .slice(0, MAX_SCENE_CANDIDATES);
}
