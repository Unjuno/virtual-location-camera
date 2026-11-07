/**
 * Optional server-side Mapillary search.
 * MAPILLARY_ACCESS_TOKEN is private. Missing token = graceful unconfigured.
 * No Google Maps pixels or imagery are requested.
 */
import { parseLocation } from "../src/core.mjs";
import { normalizeHeading, searchBoundingBox, normalizeMapillaryResults } from "../src/scenes.mjs";

const GRAPH_API = "https://graph.mapillary.com/images";
const FIELDS = [
  "id", "computed_geometry", "geometry", "computed_compass_angle",
  "compass_angle", "captured_at", "camera_type", "creator",
  "thumb_1024_url"
].join(",");

function jsonResponse(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, max-age=30");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(data));
}

export function parseSceneQuery(query) {
  const latlon = parseLocation(query?.lat, query?.lon);
  const radiusM = query?.radius === undefined ? 150 : Number(query.radius);
  const heading = normalizeHeading(query?.heading ?? "0");
  if (heading === null) throw new RangeError("カメラの方位が不正です。");
  const bbox = searchBoundingBox(latlon.lat, latlon.lon, radiusM);
  return { ...latlon, radiusM, heading, bbox };
}

export async function queryMapillaryScenes(query, { token = "", fetcher = fetch } = {}) {
  const input = parseSceneQuery(query);
  if (!token) return { configured: false, candidates: [], source: "mapillary" };

  const params = new URLSearchParams({
    bbox: input.bbox.join(","),
    limit: "80",
    fields: FIELDS
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(GRAPH_API + "?" + params, {
      method: "GET",
      headers: { Authorization: "OAuth " + token, Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      throw Object.assign(new Error("Mapillaryの街路データを取得できませんでした。"), {
        status: response.status === 429 ? 429 : 502
      });
    }
    const data = await response.json();
    return {
      configured: true,
      source: "mapillary",
      camera: { lat: input.lat, lon: input.lon, heading: input.heading },
      radiusM: input.radiusM,
      candidates: normalizeMapillaryResults(data, input)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return jsonResponse(res, 405, { error: "GETのみ対応します。" });
  try {
    const query = req.query ?? Object.fromEntries(new URL(req.url, "http://localhost").searchParams.entries());
    const result = await queryMapillaryScenes(query, { token: process.env.MAPILLARY_ACCESS_TOKEN || "" });
    return jsonResponse(res, 200, result);
  } catch (error) {
    const status = error?.status ?? (error instanceof RangeError || /^.+(?:緯度|経度|十進数|検索半径)/.test(error?.message) ? 400 : 502);
    console.warn("scene search", { status, name: error?.name });
    return jsonResponse(res, status, {
      error: status >= 500 ? "街路画像の検索に失敗しました。公開写真の手動検索をご利用ください。" : error.message
    });
  }
}
