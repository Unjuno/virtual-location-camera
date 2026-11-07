/**
 * Panoramax: public federated STAC photo observations, no authentication.
 * Dataset licences differ by instance. Only allowlisted, reuse-permitted
 * SPDX licences are returned; we never assume all observations are CC BY-SA.
 */
import { parseLocation } from "./core.mjs";
import {
  distanceMeters, headingDelta, normalizeHeading, sceneAssessment
} from "./scenes.mjs";

export const PANORAMAX_BASE = "https://api.panoramax.xyz";
export const MAX_CANDIDATES = 8;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validPanoramaxId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

const APPROVED_LICENSES = Object.freeze({
  "etalab-2.0": {
    license: "Etalab Open Licence 2.0", spdx: "etalab-2.0",
    url: "https://www.data.gouv.fr/pages/legal/licences/etalab-2-0",
    requiresShareAlike: false
  },
  "cc-by-sa-4.0": {
    license: "CC BY-SA 4.0", spdx: "CC-BY-SA-4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    requiresShareAlike: true
  }
});

function licenseForItem(item) {
  const raw = String(item?.properties?.license ?? "").toLowerCase().trim();
  const match = APPROVED_LICENSES[raw];
  if (!match) return null;
  // Do not accept contradictory license links, even if the SPDX name looks supported.
  const declared = item?.links?.find(link => link.rel === "license");
  if (!declared?.href || typeof declared.href !== "string") return null;
  let parsed;
  try { parsed = new URL(declared.href); } catch { return null; }
  if (parsed.protocol !== "https:") return null;
  if (raw === "cc-by-sa-4.0"
    && !(parsed.hostname === "creativecommons.org" && parsed.pathname.startsWith("/licenses/by-sa/4.0"))) return null;
  if (raw === "etalab-2.0"
    && !["alliance.numerique.gouv.fr","www.data.gouv.fr","data.gouv.fr","www.etalab.gouv.fr"].includes(parsed.hostname)) return null;
  return match;
}

function getObservedHeading(item) {
  const property = item?.properties?.["view:azimuth"];
  if (Number.isFinite(Number(property)) && property !== null && property !== "") {
    return normalizeHeading(property);
  }
  // EXIF: "4532/100" degrees = 45.32°. Some cameras omit orientation.
  const raw = item?.properties?.exif?.["Exif.GPSInfo.GPSImgDirection"];
  if (typeof raw === "number") return normalizeHeading(raw);
  if (typeof raw !== "string") return null;
  const parts = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(raw);
  if (parts) {
    const denominator = Number(parts[2]);
    return denominator > 0 ? normalizeHeading(Number(parts[1]) / denominator) : null;
  }
  return normalizeHeading(raw);
}

export function panoramaxSearchUrl(lat, lon, radiusM = 200, limit = 30) {
  const c = parseLocation(lat, lon);
  if (!Number.isInteger(radiusM) || radiusM < 25 || radiusM > 200) {
    throw new RangeError("Panoramax検索半径は25〜200mを指定してください。");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw new RangeError("Invalid limit");
  // Panoramax STAC expects west,south,east,north (EPSG:4326).
  // Spherical approximation at local mid-latitudes; final distance filtering
  // uses a great-circle calculation rather than trusting the bounding box.
  if (Math.abs(c.lat) > 84.5) throw new RangeError("Unsupported high-latitude coordinate");
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos(c.lat * Math.PI / 180));
  if (c.lon - dLon < -180 || c.lon + dLon > 180) throw new RangeError("Dateline crossing");
  const bbox = [c.lon - dLon,c.lat - dLat,c.lon + dLon,c.lat + dLat];
  return PANORAMAX_BASE + "/api/search?" + new URLSearchParams({
    bbox: bbox.map(v=>v.toFixed(7)).join(","), limit: String(limit)
  }).toString();
}

export function normalizePanoramaxResults(data, request) {
  const target = parseLocation(request.lat,request.lon);
  const radiusM = Number(request.radiusM ?? 200);
  if (!Number.isInteger(radiusM) || radiusM < 25 || radiusM > 200) throw new RangeError("Invalid radius");
  const targetHeading = normalizeHeading(request.heading);
  const photos = [];
  const known = new Set();
  for (const item of (Array.isArray(data?.features) ? data.features : []).slice(0, 200)) {
    if (!validPanoramaxId(item?.id) || known.has(item.id)) continue;
    const licence = licenseForItem(item);
    if (!licence) continue;
    if (item?.geometry?.type !== "Point" || !Array.isArray(item.geometry.coordinates)) continue;
    let point;
    try { point = parseLocation(item.geometry.coordinates[1],item.geometry.coordinates[0]); }
    catch { continue; }
    const distanceM = distanceMeters(target.lat,target.lon,point.lat,point.lon);
    if (distanceM > radiusM + 12) continue;
    const heading = getObservedHeading(item);
    const direction = headingDelta(heading,targetHeading);
    const rawDate = String(item?.properties?.datetime ?? "");
    const captureDate = /^\d{4}-\d{2}-\d{2}T/.test(rawDate) ? rawDate.slice(0,10) : null;
    const updatedRaw = String(item?.properties?.updated ?? "");
    const lastUpdated = /^\d{4}-\d{2}-\d{2}T/.test(updatedRaw) ? updatedRaw.slice(0,10) : captureDate;
    const artist = item?.providers?.find(p => p?.roles?.includes("producer"))?.name
      || item?.properties?.exif?.["Exif.Image.Artist"]
      || "Panoramax contributor";
    const creator = String(artist).slice(0,70);
    const id = item.id.toLowerCase();
    known.add(id);
    photos.push({
      provider:"panoramax", id,
      lat:point.lat, lon:point.lon,
      distanceM:Math.round(distanceM),
      cameraHeading:heading,
      headingDifference:direction===null?null:Math.round(direction),
      captureDate, lastUpdated, imageType:"perspective",
      creator,
      assessment:sceneAssessment(distanceM,direction),
      imageUrl:"/api/panoramax-image?id="+id+"&size=thumb",
      downloadUrl:"/api/panoramax-image?id="+id+"&size=sd",
      viewerUrl:PANORAMAX_BASE+"/#focus=pic&pic="+id,
      attribution:"Panoramax · "+creator+" · "+licence.license,
      license:licence.license, licenseSpdx:licence.spdx,
      licenseUrl:licence.url,
      requiresShareAlike:licence.requiresShareAlike,
      exactViewVerified:false
    });
  }
  photos.sort((a,b)=>{
    const score=x=>x.distanceM+(x.headingDifference===null?85:x.headingDifference*0.6);
    return score(a)-score(b)||a.id.localeCompare(b.id);
  });
  return photos.slice(0,MAX_CANDIDATES);
}

export function isApprovedPanoramaxItem(item,uuid) {
  return validPanoramaxId(uuid) && item?.id?.toLowerCase()===uuid.toLowerCase()
    && Boolean(licenseForItem(item));
}
