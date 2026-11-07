import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "../src/core.mjs";
import * as location from "../src/location.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
const ids = Array.from(html.matchAll(/id="([^"]+)"/g), match => match[1]);

function createUI() {
  const elements = {};
  for (const id of ids) {
    const attributes = {};
    elements[id] = {
      value: ({
        preset: "times-square", latitude: "40.7580", longitude: "-73.9855",
        zoom: "16.8", pitch: "68", bearing: "-19", subjectScale: "21", exposure: "100"
      })[id] ?? "",
      style: { setProperty(name, value) { this[name] = value; } },
      dataset: {},
      checked: false,
      naturalWidth: id === "subjectImage" ? 350 : id === "locationPhoto" ? 4000 : 0,
      naturalHeight: id === "subjectImage" ? 700 : id === "locationPhoto" ? 3000 : 0,
      complete: true,
      removeAttribute(name) { if (name === "src") this.src = ""; },
      classList: { toggle() {}, add() {}, remove() {} },
      hidden: false,
      disabled: false,
      textContent: "",
      src: "",
      events: {},
      addEventListener(name, cb) { this.events[name] = cb; },
      setAttribute(name, value) { attributes[name] = value; },
      getAttribute(name) { return attributes[name]; },
      querySelector() { return { textContent: "" }; },
      focus() {},
      setPointerCapture() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 562.5 }; }
    };
  }
  const captured = { drawCalls: [], labels: [], downloads: [] };
  elements.__capture = captured;
  const fakeCtx = {
    filter: "none", fillStyle: "",
    save() {}, restore() {}, fillRect() {},
    createLinearGradient() { return { addColorStop() {} }; },
    drawImage(...args) { captured.drawCalls.push(args); },
    fillText(text) { captured.labels.push(text); }
  };
  const document = {
    activeElement: { tagName: "BODY" },
    body: { appendChild() {} },
    getElementById(id) { return elements[id]; },
    addEventListener() {},
    createElement(tag) {
      if (tag === "canvas") {
        return { width: 0, height: 0, getContext() { return fakeCtx; },
          toBlob(callback) { callback(new Blob(["mock-png"], { type: "image/png" })); } };
      }
      if (tag === "a") return {
        href: "", download: "",
        click() { captured.downloads.push(this.download); }, remove() {}
      };
      throw new Error("Unexpected DOM element: " + tag);
    }
  };
  const window = { addEventListener() {} };
  const URL = { createObjectURL() { return "blob:mock"; }, revokeObjectURL() {} };
  const withoutImport = source
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/core\.mjs["'];/, "")
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/location\.mjs["'];/m, "")
    .replace(/\nconnectWorld\(\);\s*$/, "\n");
  assert.equal(withoutImport.includes('from "./core.mjs"'), false);
  const params = [...Object.keys(core), ...Object.keys(location)];
  const app = new Function("document", "window", "URL", "console", ...params, withoutImport);
  app(document, window, URL, { warn() {}, error() {} }, ...Object.values(core), ...Object.values(location));
  return elements;
}

test("DOM references used by app exist in HTML", () => {
  for (const [, id] of source.matchAll(/\$\("([^"]+)"\)/g)) {
    assert.ok(ids.includes(id), "Missing DOM id: " + id);
  }
});

test("invalid latitude shows a validation message", () => {
  const e = createUI();
  e.latitude.value = "91";
  e.flyTo.events.click();
  assert.match(e.message.textContent, /緯度/);
});

test("scale, drag, reset and sample selection update the viewport", () => {
  const e = createUI();
  e.subjectScale.value = "35";
  e.subjectScale.events.input({ target: e.subjectScale });
  assert.equal(e.subjectHandle.style.width, "35%");
  e.sampleProduct.events.click();
  assert.ok(e.subjectImage.src.startsWith("data:image/svg+xml"));
  assert.equal(e.sampleProduct.getAttribute("aria-pressed"), "true");
  e.subjectHandle.events.pointerdown({
    button: 0, pointerType: "mouse", pointerId: 2,
    clientX: 400, clientY: 300, preventDefault() {}, stopPropagation() {}
  });
  e.subjectHandle.events.pointermove({ pointerId: 2, clientX: 500, clientY: 356.25 });
  assert.equal(e.subjectHandle.style.left, "62%");
  assert.equal(e.subjectHandle.style.top, "75%");
  e.resetSubject.events.click();
  assert.equal(e.subjectHandle.style.left, "52%");
  assert.equal(e.subjectHandle.style.width, "21%");
});


test("imports a Google Maps location URL into numerical WGS84 coordinates", () => {
  const e = createUI();
  e.googleMapsUrl.value = "https://www.google.com/maps/place/x/@40.760,-73.985,17z";
  e.importGoogleUrl.events.click();
  assert.equal(e.latitude.value, "40.760000");
  assert.equal(e.longitude.value, "-73.985000");
  assert.equal(e.preset.value, "custom");
});

test("licensed real photo can become a live shooting background without a 3D map", () => {
  const e = createUI();
  e.subjectImage.onload();
  e.photoRights.checked = true;
  e.photoUpload.events.change({
    target: { files: [{ type: "image/jpeg", size: 4000, name: "my-own-photo.jpg" }], value: "selection" }
  });
  e.locationPhoto.onload();
  assert.equal(e.stage.dataset.mode, "photo");
  assert.equal(e.shutter.disabled, false);
  assert.equal(e.photoMode.getAttribute("aria-pressed"), "true");
  assert.match(e.photoStatus.textContent, /my-own-photo.jpg/);
  e.clearPhoto.events.click();
  assert.equal(e.stage.dataset.mode, "map");
  assert.equal(e.shutter.disabled, true);
});

test("unlicensed photo cannot be used as a background", () => {
  const e = createUI();
  e.photoRights.checked = false;
  e.photoUpload.events.change({
    target: { files: [{ type: "image/png", size: 2048, name: "no-license.png" }], value: "selection" }
  });
  assert.equal(e.stage.dataset.mode, undefined);
  assert.match(e.message.textContent, /権利/);
});


test("real-photo composite shutter exports even with MapLibre completely unavailable", async () => {
  const e = createUI();
  e.subjectImage.onload();
  e.photoRights.checked = true;
  e.photoCredit.value = "Photo by Owner";
  e.photoUpload.events.change({
    target: { files: [{ type: "image/jpeg", size: 12345, name: "nyc-licensed.jpg" }], value: "" }
  });
  e.locationPhoto.onload();
  assert.equal(e.shutter.disabled, false);
  await e.shutter.events.click();
  assert.equal(e.__capture.downloads.length, 1);
  assert.match(e.__capture.downloads[0], /^virtual-location-camera-.*\.png$/);
  assert.equal(e.__capture.drawCalls[0][0], e.locationPhoto);
  assert.equal(e.__capture.drawCalls[1][0], e.subjectImage);
  assert.ok(e.__capture.labels.some(text => text.includes("Photo by Owner")));
  assert.match(e.message.textContent, /合成写真を保存/);
});
