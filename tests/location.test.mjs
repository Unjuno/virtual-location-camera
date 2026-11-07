import test from "node:test";
import assert from "node:assert/strict";
import {
  parseGoogleMapsLocation, googleMapsPlaceUrl, googleMapsStreetViewUrl, coverSourceRect
} from "../src/location.mjs";

test("imports Google Maps long URL map viewport center", () => {
  const point = parseGoogleMapsLocation("https://www.google.com/maps/place/Times+Square/@40.758,-73.9855,17z/");
  assert.deepEqual(point, { lat: 40.758, lon: -73.9855, kind: "viewport-center" });
});

test("imports official Google Maps API=1 viewpoint/search coordinates", () => {
  assert.deepEqual(
    parseGoogleMapsLocation("https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=40.758%2C-73.9855"),
    { lat: 40.758, lon: -73.9855, kind: "coordinate" }
  );
  assert.deepEqual(
    parseGoogleMapsLocation("https://www.google.com/maps/search/?api=1&query=48.8584%2C2.2945"),
    { lat: 48.8584, lon: 2.2945, kind: "coordinate" }
  );
});

test("imports Street View !3d latitude !4d longitude embedded coordinates", () => {
  assert.deepEqual(
    parseGoogleMapsLocation("https://www.google.com/maps/place/x/data=!3m1!4b1!3d40.758!4d-73.9855!9m2"),
    { lat: 40.758, lon: -73.9855, kind: "image-metadata" }
  );
  assert.deepEqual(
    parseGoogleMapsLocation("https://www.google.com/maps/place/x/data=!4d-73.9855!3d40.758!9m2"),
    { lat: 40.758, lon: -73.9855, kind: "image-metadata" }
  );
});

test("rejects fake domains, unexpanded short links, invalid coordinates and plain place names", () => {
  for (const source of [
    "https://www.google.com.evil.example/maps/@40.758,-73.985,17z",
    "http://www.google.com/maps/@40.758,-73.985,17z",
    "https://maps.app.goo.gl/abcdefghijklmn",
    "https://www.google.com/maps/place/Times+Square/",
    "https://www.google.com/maps/@91,-73.985,17z",
    "https://www.google.com/maps/search/?api=1&query=Times%20Square",
    "not a link"
  ]) {
    assert.throws(() => parseGoogleMapsLocation(source), Error, source);
  }
});

test("official Google Maps URLs have correct API mode, encoded coordinates", () => {
  const p = googleMapsPlaceUrl(40.758, -73.9855);
  const pano = googleMapsStreetViewUrl(40.758, -73.9855);
  const placeUrl = new URL(p);
  const panoUrl = new URL(pano);
  assert.equal(placeUrl.searchParams.get("api"), "1");
  assert.equal(placeUrl.searchParams.get("query"), "40.758,-73.9855");
  assert.equal(panoUrl.searchParams.get("map_action"), "pano");
  assert.equal(panoUrl.searchParams.get("viewpoint"), "40.758,-73.9855");
});

test("photo cover crop matches CSS object-fit cover at landscape and portrait ratios", () => {
  assert.deepEqual(coverSourceRect(4000, 3000, 1600, 900), {
    sx: 0, sy: 375, sw: 4000, sh: 2250
  });
  assert.deepEqual(coverSourceRect(3000, 4000, 1600, 900), {
    sx: 0, sy: 1156.25, sw: 3000, sh: 1687.5
  });
  assert.deepEqual(coverSourceRect(1600, 900, 1600, 900), {
    sx: 0, sy: 0, sw: 1600, sh: 900
  });
  assert.throws(() => coverSourceRect(0, 900, 1600, 900), RangeError);
});
