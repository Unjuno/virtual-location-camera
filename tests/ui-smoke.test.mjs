import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "../src/core.mjs";
import * as location from "../src/location.mjs";
import * as commons from "../src/commons.mjs";
import * as compositor from "../src/compositor.mjs";
import * as scenes from "../src/scenes.mjs";
import * as panoramax from "../src/panoramax.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
const ids = Array.from(html.matchAll(/id="([^"]+)"/g), match => match[1]);

function createUI(fetchOverride = null) {
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
      events: {}, children: [],
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren() { this.children = []; },
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
    save() {}, restore() {}, fillRect() {}, clearRect() {},
    beginPath() {}, ellipse() {}, fill() {},
    createLinearGradient() { return { addColorStop() {} }; },
    drawImage(...args) { captured.drawCalls.push(args); },
    fillText(text) { captured.labels.push(text); }
  };
  elements.photoCanvas.width = 1600;
  elements.photoCanvas.height = 900;
  elements.photoCanvas.getContext = () => fakeCtx;
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
      return {
        tagName: tag.toUpperCase(), events: {}, children: [],
        classList: { add() {}, remove() {}, toggle() {} },
        style: {}, hidden: false, disabled: false,
        append(...nodes) { this.children.push(...nodes); },
        addEventListener(name, cb) { this.events[name] = cb; }
      };
    }
  };
  const window = { addEventListener() {} };
  const URL = { createObjectURL() { return "blob:mock"; }, revokeObjectURL() {} };
  const withoutImport = source
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/core\.mjs["'];/, "")
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/location\.mjs["'];/m, "")
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/commons\.mjs["'];/m, "")
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/compositor\.mjs["'];/m, "")
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/scenes\.mjs["'];/m, "")
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/panoramax\.mjs["'];/m, "")
    .replace(/\nconnectWorld\(\);\s*$/, "\n");
  assert.equal(withoutImport.includes('from "./core.mjs"'), false);
  const params = [...Object.keys(core), ...Object.keys(location), ...Object.keys(commons), ...Object.keys(compositor), ...Object.keys(scenes), ...Object.keys(panoramax)];
  const mockFetch = fetchOverride || (async url => ({
    ok: true,
    json: async () => url.includes("/api/health") ? { aiConfigured: false } : { configured: false, candidates: [] }
  }));
  const mockFile = function(files, name, options) {
    this.name = name; this.type = options.type; this.size = files[0].size;
  };
  const app = new Function("document", "window", "URL", "console", "fetch", "File", ...params, withoutImport);
  app(document, window, URL, { warn() {}, error() {} }, mockFetch, mockFile, ...Object.values(core), ...Object.values(location), ...Object.values(commons), ...Object.values(compositor), ...Object.values(scenes), ...Object.values(panoramax));
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
  assert.equal(e.subjectHandle.style.top, "65%");
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
  const backgroundDraws = e.__capture.drawCalls.filter(args => args[0] === e.locationPhoto);
  const subjectDraws = e.__capture.drawCalls.filter(args => args[0] === e.subjectImage);
  assert.ok(backgroundDraws.length >= 2, "Preview and exported photo both use licensed background");
  assert.equal(subjectDraws.length, 1, "Output contains the subject once");
  assert.ok(e.__capture.labels.some(text => text.includes("Photo by Owner")));
  assert.match(e.message.textContent, /合成写真を保存/);
});


test("subject relighting and contact shadow controls update preview and export", async () => {
  const e = createUI();
  e.subjectImage.onload();
  e.photoRights.checked = true;
  e.photoUpload.events.change({
    target: { files: [{ type: "image/png", size: 5000, name: "licensed-place.png" }], value: "" }
  });
  e.locationPhoto.onload();

  e.photoZoom.value = "150";
  e.photoZoom.events.input();
  e.photoFocusX.value = "80";
  e.photoFocusX.events.input();
  e.subjectLight.value = "125";
  e.subjectLight.events.input();
  e.subjectWarmth.value = "20";
  e.subjectWarmth.events.input();
  e.shadowStrength.value = "60";
  e.shadowStrength.events.input();

  assert.equal(e.photoZoomValue.textContent, "150%");
  assert.equal(e.photoFocusXValue.textContent, "80%");
  assert.equal(e.subjectLightValue.textContent, "125%");
  assert.equal(e.shadowStrengthValue.textContent, "60%");
  assert.match(e.subjectHandle.style["--subject-filter"], /brightness\(1\.250\)/);
  assert.equal(e.contactShadow.hidden, false);
  await e.shutter.events.click();
  assert.equal(e.__capture.downloads.length, 1);
});


test("Mapillary candidate search shows distance, heading and date with license guard", async () => {
  const sample = {
    provider: "mapillary", id: "12345678",
    lat: 40.758, lon: -73.9855, distanceM: 14,
    cameraHeading: 341, headingDifference: 4,
    captureDate: "2026-05-01", imageType: "perspective",
    creator: "Example Photographer",
    assessment: "near-position-and-heading",
    imageUrl: "/api/scene-image?id=12345678",
    viewerUrl: "https://www.mapillary.com/app/?pKey=12345678&focus=photo",
    attribution: "Mapillary · Example Photographer · CC BY-SA 4.0",
    license: "CC BY-SA 4.0"
  };
  const e = createUI(async url => {
    if (url.startsWith("./api/scenes?")) return {
      ok: true, json: async () => ({ configured: true, candidates: [sample] })
    };
    if (url.includes("/api/scene-image?id=")) return {
      ok: true, blob: async () => ({ type: "image/jpeg", size: 8192 })
    };
    return { ok: true, json: async () => ({ aiConfigured: false }) };
  });

  await e.findScenes.events.click();
  assert.equal(e.sceneResults.hidden, false);
  assert.equal(e.sceneResults.children.length, 1);
  const card = e.sceneResults.children[0];
  assert.match(card.children[2].textContent, /14 m/);
  assert.match(card.children[2].textContent, /方位差 4°/);
  assert.match(card.children[2].textContent, /2026-05-01/);

  await card.children[4].events.click();
  assert.match(e.message.textContent, /CC BY-SA/);
  e.subjectImage.onload();
  e.photoRights.checked = true;
  e.mapillaryShareAlike.checked = true;
  await card.children[4].events.click();
  e.locationPhoto.onload();
  assert.equal(e.stage.dataset.mode, "photo");
  assert.equal(e.sceneSelected.hidden, false);
  assert.match(e.photoCredit.value, /CC BY-SA 4\.0/);
  assert.equal(e.shutter.disabled, false);
  e.mapillaryShareAlike.checked = false;
  e.mapillaryShareAlike.events.change();
  assert.equal(e.shutter.disabled, true, "License acknowledgement is required for Mapillary capture");
});

test("unconfigured street-image API falls back without inventing a location view", async () => {
  const e = createUI(async url => {
    if (url.startsWith("./api/scenes?")) return {
      ok: true, json: async () => ({ configured: false, candidates: [] })
    };
    if (url.startsWith("https://commons.wikimedia.org/")) return {
      ok: true, json: async () => ({ query: { pages: {} } })
    };
    return { ok: true, json: async () => ({ aiConfigured: false }) };
  });
  await e.findScenes.events.click();
  assert.match(e.sceneGroundingStatus.textContent, /確認できる実景画像はありません/);
  assert.equal(e.sceneResults.hidden, true);
});


test("public Panoramax street photo works without Mapillary token or ShareAlike if Etalab-2.0",async()=>{
  const uuid="af0c80eb-5ce4-424d-9ac3-6accccbe68d4";
  const candidate={
    provider:"panoramax",id:uuid,lat:48.859870109,lon:2.29472254,
    distanceM:12,cameraHeading:45.3,headingDifference:5,captureDate:"2025-07-21",
    creator:"Paris photographer",assessment:"near-position-and-heading",imageType:"perspective",
    imageUrl:"/api/panoramax-image?id="+uuid+"&size=thumb",
    downloadUrl:"/api/panoramax-image?id="+uuid+"&size=sd",
    viewerUrl:"https://api.panoramax.xyz/#focus=pic&pic="+uuid,
    attribution:"Panoramax · Paris photographer · Etalab Open Licence 2.0",
    license:"Etalab Open Licence 2.0",licenseSpdx:"etalab-2.0",
    licenseUrl:"https://www.data.gouv.fr/pages/legal/licences/etalab-2-0",
    requiresShareAlike:false,exactViewVerified:false
  };
  const e=createUI(async(url)=>{
    if(url.startsWith("./api/scenes?"))return{ok:true,json:async()=>({configured:false,candidates:[]})};
    if(url.startsWith("./api/panoramax-scenes?"))return{ok:true,json:async()=>({configured:true,candidates:[candidate]})};
    if(url.startsWith("/api/panoramax-image?"))return{ok:true,blob:async()=>({type:"image/jpeg",size:13000})};
    return{ok:true,json:async()=>({aiConfigured:false})};
  });
  e.subjectImage.onload();
  await e.findScenes.events.click();
  assert.equal(e.sceneResults.children.length,1);
  assert.match(e.sceneResults.children[0].children[2].textContent,/Etalab/);
  e.photoRights.checked=true;
  // Etalab does not require a ShareAlike checkbox.
  e.mapillaryShareAlike.checked=false;
  await e.sceneResults.children[0].children[4].events.click();
  e.locationPhoto.onload();
  assert.equal(e.stage.dataset.mode,"photo");
  assert.equal(e.shutter.disabled,false);
  assert.match(e.photoCredit.value,/Etalab/);
  await e.shutter.events.click();
  assert.equal(e.__capture.downloads.length,1);
  assert.ok(e.__capture.labels.some(label=>label.includes("api.panoramax.xyz")));
});
