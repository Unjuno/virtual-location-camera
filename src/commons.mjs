/**
 * Optional geotagged-image discovery using Wikimedia Commons public API.
 * Auto-import is deliberately limited to images marked CC0 or Public domain.
 * Metadata must still be confirmed by the user at the linked file description.
 */
import { parseLocation } from "./core.mjs";
import { distanceMeters } from "./scenes.mjs";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const TRUSTED_IMAGE_HOST = "upload.wikimedia.org";
const FILE_PAGE_HOST = "commons.wikimedia.org";

export function commonsGeoSearchUrl(lat, lon, radiusMeters = 1000) {
  const c = parseLocation(lat, lon);
  if (!Number.isInteger(radiusMeters) || radiusMeters < 10 || radiusMeters > 10000) {
    throw new RangeError("Wikimediaの検索半径は10〜10000mの整数で指定してください。");
  }
  const params = new URLSearchParams({
    action: "query",
    generator: "geosearch",
    ggsprimary: "all",
    ggsnamespace: "6",
    ggslimit: "20",
    ggsradius: String(radiusMeters),
    ggscoord: c.lat + "|" + c.lon,
    prop: "imageinfo|coordinates",
    iiprop: "url|mime|extmetadata|size",
    iiurlwidth: "1600",
    format: "json",
    origin: "*"
  });
  return COMMONS_API + "?" + params.toString();
}

function validHttpAddress(address, host) {
  if (typeof address !== "string") return false;
  try {
    const url = new URL(address);
    return url.protocol === "https:" && url.hostname === host;
  } catch { return false; }
}

export function filterPublicDomainCommonsImages(apiResponse, maxItems = 8, target = null) {
  const items = Object.values(apiResponse?.query?.pages ?? {});
  const results = [];
  for (const item of items) {
    const info = item?.imageinfo?.[0];
    if (!info) continue;
    const license = String(info?.extmetadata?.LicenseShortName?.value ?? "").trim();
    if (!/^(?:CC0(?: 1\.0)?|Public domain)$/i.test(license)) continue;
    if (!["image/png", "image/jpeg", "image/webp"].includes(info.mime)) continue;
    const thumb = info.thumburl || info.url;
    const page = info.descriptionurl;
    if (!validHttpAddress(thumb, TRUSTED_IMAGE_HOST)) continue;
    if (!validHttpAddress(page, FILE_PAGE_HOST)) continue;
    const name = String(item.title || "Wikimedia Commons photo").replace(/^File:/, "").slice(0, 80);
    // Commons GeoData coordinates can refer to the depicted subject,
    // not necessarily to the exact camera position or facing direction.
    let photoPosition = null;
    let distanceM = null;
    if (target && item.coordinates?.[0]) {
      try {
        photoPosition = parseLocation(item.coordinates[0].lat, item.coordinates[0].lon);
        distanceM = Math.round(distanceMeters(target.lat, target.lon, photoPosition.lat, photoPosition.lon));
      } catch { photoPosition = null; }
    }
    results.push({
      provider: "wikimedia-commons",
      name, license, previewUrl: thumb, filePage: page,
      lat: photoPosition?.lat ?? null,
      lon: photoPosition?.lon ?? null,
      distanceM,
      cameraHeading: null,
      headingDifference: null,
      captureDate: null,
      exactViewVerified: false,
      credit: "Wikimedia Commons / " + license
    });
    if (results.length >= maxItems) break;
  }
  return results;
}

export function isTrustedCommonsImageUrl(value) {
  return validHttpAddress(value, TRUSTED_IMAGE_HOST);
}
