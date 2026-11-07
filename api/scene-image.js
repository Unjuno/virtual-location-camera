/**
 * Same-origin image proxy: avoids leaking the private Mapillary token and
 * keeps the downloaded image canvas-exportable. This is NOT an open proxy:
 * only numeric image IDs and provider-reported allowlisted CDN hosts.
 */
const GRAPH_ORIGIN = "https://graph.mapillary.com";
const MAX_BYTES = 3_500_000;

export function isAllowedMapillaryImageUrl(candidate) {
  if (typeof candidate !== "string" || candidate.length > 4000) return false;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username && !url.password
      && (host === "fbcdn.net" || host.endsWith(".fbcdn.net")
        || host === "mapillary.com" || host.endsWith(".mapillary.com")
        || host === "mapillaryusercontent.com" || host.endsWith(".mapillaryusercontent.com"));
  } catch { return false; }
}

export async function fetchMapillaryImage(id, { token, fetcher = fetch } = {}) {
  if (!/^\d{1,20}$/.test(String(id ?? ""))) {
    throw Object.assign(new Error("画像IDが不正です。"), { status: 400 });
  }
  if (!token) throw Object.assign(new Error("Mapillaryが設定されていません。"), { status: 503 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const metadataUrl = GRAPH_ORIGIN + "/" + id + "?fields=id,thumb_1024_url";
    const info = await fetcher(metadataUrl, {
      method: "GET",
      headers: { Authorization: "OAuth " + token, Accept: "application/json" },
      signal: controller.signal,
      redirect: "error"
    });
    if (!info.ok) throw Object.assign(new Error("画像のメタデータを取得できません。"), { status: 502 });
    const json = await info.json();
    if (!isAllowedMapillaryImageUrl(json?.thumb_1024_url)) {
      throw Object.assign(new Error("許可されていない画像配信元です。"), { status: 502 });
    }
    const response = await fetcher(json.thumb_1024_url, {
      method: "GET", signal: controller.signal, redirect: "error"
    });
    if (!response.ok) throw Object.assign(new Error("画像の読み込みに失敗しました。"), { status: 502 });
    const sizeHeader = Number(response.headers.get("content-length"));
    if (sizeHeader > MAX_BYTES) throw Object.assign(new Error("画像が大きすぎます。"), { status: 413 });
    const mime = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
      throw Object.assign(new Error("画像形式が非対応です。"), { status: 415 });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 20 || bytes.length > MAX_BYTES) {
      throw Object.assign(new Error("画像サイズが不正です。"), { status: 413 });
    }
    const valid = mime === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mime === "image/png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!valid) throw Object.assign(new Error("画像データが破損しています。"), { status: 502 });
    return { bytes, mime };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.statusCode = 405; return res.end("Method not allowed"); }
  const query = req.query ?? Object.fromEntries(new URL(req.url, "http://localhost").searchParams.entries());
  try {
    const photo = await fetchMapillaryImage(query.id, { token: process.env.MAPILLARY_ACCESS_TOKEN || "" });
    res.statusCode = 200;
    res.setHeader("Content-Type", photo.mime);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(photo.bytes.length));
    res.end(photo.bytes);
  } catch (error) {
    const status = error?.status || 502;
    console.warn("Mapillary image proxy", { status, name: error?.name });
    res.statusCode = status;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(status >= 500 ? "街路画像を取得できませんでした。" : error.message);
  }
}
