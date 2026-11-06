import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "../src/core.mjs";

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
  const document = {
    activeElement: { tagName: "BODY" },
    getElementById(id) { return elements[id]; },
    addEventListener() {}
  };
  const window = { addEventListener() {} };
  const URL = { createObjectURL() { return "blob:mock"; }, revokeObjectURL() {} };
  const withoutImport = source
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/core\.mjs["'];/, "")
    .replace(/\nconnectWorld\(\);\s*$/, "\n");
  assert.equal(withoutImport.includes('from "./core.mjs"'), false);
  const params = Object.keys(core);
  const app = new Function("document", "window", "URL", "console", ...params, withoutImport);
  app(document, window, URL, { warn() {}, error() {} }, ...Object.values(core));
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
