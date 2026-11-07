import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHeading, headingDelta, distanceMeters, searchBoundingBox,
  sceneAssessment, normalizeMapillaryResults
} from "../src/scenes.mjs";

test("bearings normalize across north and angular deltas use shortest arc", () => {
  assert.equal(normalizeHeading(-19), 341);
  assert.equal(normalizeHeading(720), 0);
  assert.equal(normalizeHeading(null), null);
  assert.equal(headingDelta(350, 10), 20);
  assert.equal(headingDelta(-19, 341), 0);
  assert.equal(headingDelta(null, 10), null);
});

test("WGS84 distance in meters has known equatorial and local checks", () => {
  assert.equal(distanceMeters(40.758, -73.9855, 40.758, -73.9855), 0);
  const oneDegreeEquator = distanceMeters(0, 0, 0, 1);
  assert.ok(oneDegreeEquator > 111000 && oneDegreeEquator < 111300);
  assert.ok(distanceMeters(40.758, -73.9855, 40.7585, -73.9855) > 50);
});

test("small bounding box uses geographic coordinates and rejects dateline", () => {
  const bbox = searchBoundingBox(40.758, -73.9855, 150);
  assert.equal(bbox.length, 4);
  assert.ok(bbox[0] < -73.9855 && bbox[2] > -73.9855);
  assert.ok(bbox[1] < 40.758 && bbox[3] > 40.758);
  assert.throws(() => searchBoundingBox(85, 5, 150), RangeError);
  assert.throws(() => searchBoundingBox(40, -179.99999, 200), RangeError);
  assert.throws(() => searchBoundingBox(40, -73, 201), RangeError);
});

test("scene assessment never claims exact camera registration", () => {
  assert.equal(sceneAssessment(20, 15), "near-position-and-heading");
  assert.equal(sceneAssessment(70, 15), "candidate");
  assert.equal(sceneAssessment(15, null), "location-only");
  assert.equal(sceneAssessment(220, 15), "out-of-range");
});

test("Mapillary response stores source, coordinates, capture direction and license", () => {
  const req = { lat: 40.758, lon: -73.9855, heading: -19, radiusM: 150 };
  const data = {
    data: [
      { id: "12345678", computed_geometry: { coordinates: [-73.9855, 40.758] },
        computed_compass_angle: 343, captured_at: Date.UTC(2026, 6, 1),
        creator: { username: "Street Author" }, camera_type: "perspective" },
      { id: "12345678", computed_geometry: { coordinates: [-73.9855, 40.758] } },
      { id: "9999999", computed_geometry: { coordinates: [1800, 40.758] } },
      { id: "1234", computed_geometry: { coordinates: [-74.2, 40.758] } }
    ]
  };
  const scenes = normalizeMapillaryResults(data, req);
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].provider, "mapillary");
  assert.equal(scenes[0].distanceM, 0);
  assert.equal(scenes[0].headingDifference, 2);
  assert.equal(scenes[0].captureDate, "2026-07-01");
  assert.equal(scenes[0].assessment, "near-position-and-heading");
  assert.equal(scenes[0].exactViewVerified, false);
  assert.match(scenes[0].imageUrl, /^\/api\/scene-image\?id=12345678$/);
  assert.match(scenes[0].attribution, /Street Author/);
  assert.equal(scenes[0].license, "CC BY-SA 4.0");
});

test("invalid heading and stale or absent image geometry do not fabricate orientation", () => {
  assert.equal(normalizeHeading("not-a-heading"), null);
  const scenes = normalizeMapillaryResults({ data: [{
    id: "123", geometry: { coordinates: [-73.9855, 40.758] }, compass_angle: null
  }] }, { lat: 40.758, lon: -73.9855, heading: 10, radiusM: 150 });
  assert.equal(scenes[0].cameraHeading, null);
  assert.equal(scenes[0].headingDifference, null);
  assert.equal(scenes[0].assessment, "location-only");
});
