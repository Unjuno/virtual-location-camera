import test from "node:test";
import assert from "node:assert/strict";
import {
  commonsGeoSearchUrl, filterPublicDomainCommonsImages, isTrustedCommonsImageUrl
} from "../src/commons.mjs";

const base = {
  query: {
    pages: {
      "1": {
        title: "File:Times Square.jpg",
        imageinfo: [{
          mime: "image/jpeg",
          thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Times_Square.jpg/1600px-Times_Square.jpg",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Times_Square.jpg",
          extmetadata: { LicenseShortName: { value: "CC0" } }
        }]
      },
      "2": {
        title: "File:Another building.png",
        imageinfo: [{
          mime: "image/png",
          url: "https://upload.wikimedia.org/wikipedia/commons/0/01/Another_building.png",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Another_building.png",
          extmetadata: { LicenseShortName: { value: "Public domain" } }
        }]
      },
      "3": {
        title: "File:ShareAlike copyrighted.jpg",
        imageinfo: [{
          mime: "image/jpeg",
          thumburl: "https://upload.wikimedia.org/wikipedia/commons/a/x/image.jpg",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:ShareAlike.jpg",
          extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } }
        }]
      },
      "4": {
        title: "File:Fake url.jpg",
        imageinfo: [{
          mime: "image/jpeg",
          thumburl: "https://upload.wikimedia.org.evil.example/img.jpg",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Fake_url.jpg",
          extmetadata: { LicenseShortName: { value: "CC0" } }
        }]
      }
    }
  }
};

test("query uses Wikimedia Commons GeoSearch in File namespace and CORS", () => {
  const url = new URL(commonsGeoSearchUrl(40.758, -73.9855));
  assert.equal(url.hostname, "commons.wikimedia.org");
  assert.equal(url.searchParams.get("ggscoord"), "40.758|-73.9855");
  assert.equal(url.searchParams.get("ggsnamespace"), "6");
  assert.equal(url.searchParams.get("generator"), "geosearch");
  assert.equal(url.searchParams.get("origin"), "*");
  assert.equal(url.searchParams.get("ggsradius"), "1000");
});

test("invalid radius, latitude and longitude are rejected", () => {
  assert.throws(() => commonsGeoSearchUrl(40, -73, 0), RangeError);
  assert.throws(() => commonsGeoSearchUrl(40, -73, 10001), RangeError);
  assert.throws(() => commonsGeoSearchUrl(90.2, -73, 1000), Error);
  assert.throws(() => commonsGeoSearchUrl(40, -190, 1000), Error);
});

test("only CC0/Public domain and matching verified Wikimedia image domains appear", () => {
  const result = filterPublicDomainCommonsImages(base);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(r => r.license), ["CC0", "Public domain"]);
  assert.ok(result.every(r => r.filePage.startsWith("https://commons.wikimedia.org/")));
  assert.ok(result.every(r => r.credit.startsWith("Wikimedia Commons /")));
});

test("disallows remote or insecure image URLs", () => {
  assert.equal(isTrustedCommonsImageUrl("https://upload.wikimedia.org/wikipedia/commons/file.jpg"), true);
  assert.equal(isTrustedCommonsImageUrl("https://upload.wikimedia.org.evil.example/img.jpg"), false);
  assert.equal(isTrustedCommonsImageUrl("http://upload.wikimedia.org/evil.jpg"), false);
  assert.equal(isTrustedCommonsImageUrl("javascript:alert(1)"), false);
});
