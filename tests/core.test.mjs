import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESETS, CAPTURE, parseCoordinate, parseLocation, normalizePlacement,
  photoRect, isSupportedImage, MAX_UPLOAD_BYTES, sceneSnapshot
} from "../src/core.mjs";

test("New York preset uses a valid WGS84 location", () => {
  assert.equal(PRESETS[0].id, "times-square");
  assert.deepEqual(parseLocation("40.7580", "-73.9855"), { lat: 40.758, lon: -73.9855 });
});

test("coordinates accept boundaries and reject malformed or unsafe values", () => {
  assert.deepEqual(parseLocation(" -90 ", "+180"), { lat: -90, lon: 180 });
  for (const text of ["", " ", "abc", "NaN", "Infinity", "0x10", "40,7", "92"]) {
    assert.throws(() => parseCoordinate(text, "緯度", -90, 90), Error, text);
  }
  assert.throws(() => parseLocation("0", "181"));
});

test("placement is clamped and has stable defaults", () => {
  assert.deepEqual(normalizePlacement({ x: -1, y: 2, widthRatio: 7 }), {
    x: 0.02, y: 0.95, widthRatio: 0.85
  });
  assert.equal(normalizePlacement({}).x, 0.52);
});

test("capture geometry retains source aspect ratio and normalized center", () => {
  const rect = photoRect(400, 800, { x: 0.5, y: 0.5, widthRatio: 0.25 });
  assert.equal(rect.width, 400);
  assert.equal(rect.height, 800);
  assert.equal(rect.x, 600);
  assert.equal(rect.y, 50);
  assert.equal(CAPTURE.width, 1600);
  assert.equal(CAPTURE.height, 900);
  assert.throws(() => photoRect(0, 800, {}), RangeError);
});

test("uploaded image type and size are validated", () => {
  assert.equal(isSupportedImage({ type: "image/png", size: 2048 }), true);
  assert.equal(isSupportedImage({ type: "image/svg+xml", size: 1000 }), false);
  assert.equal(isSupportedImage({ type: "image/png", size: MAX_UPLOAD_BYTES + 1 }), false);
  assert.equal(isSupportedImage({ type: "image/jpeg", size: 0 }), false);
});

test("scene snapshots do not embed uploaded image data or tokens", () => {
  const scene = sceneSnapshot({
    lat: 40.758, lon: -73.9855, zoom: 16.8, pitch: 68, bearing: -19
  }, { x: 0.4, y: 0.7, widthRatio: 0.2 }, "uploaded", "2026-11-07T00:00:00.000Z");
  assert.equal(scene.schemaVersion, 1);
  assert.equal(scene.scene.lon, -73.9855);
  assert.equal(scene.subject.x, 0.4);
  assert.equal(scene.output.width, 1600);
  assert.equal(JSON.stringify(scene).includes("data:image"), false);
});
