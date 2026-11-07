import test from "node:test";
import assert from "node:assert/strict";
import {
  studioSettings, DEFAULT_STUDIO, subjectCssFilter,
  contactShadowGeometry, drawSubjectWithShadow
} from "../src/compositor.mjs";
import { coverSourceRect } from "../src/location.mjs";

test("studio defaults and strict numeric clipping", () => {
  assert.deepEqual(studioSettings(), DEFAULT_STUDIO);
  const s = studioSettings({
    subjectExposure: 3, subjectWarmth: -1, contactShadow: 10,
    shadowSoftness: 0, photoZoom: 50, photoFocusX: -100, photoFocusY: 5
  });
  assert.deepEqual(s, {
    subjectExposure: 1.5, subjectWarmth: 0, contactShadow: 0.8,
    shadowSoftness: 0.05, photoZoom: 2.5, photoFocusX: 0, photoFocusY: 1
  });
  assert.equal(studioSettings({subjectExposure: Infinity}).subjectExposure, 1);
});

test("subject filter string is valid brightness and sepia for canvas/CSS", () => {
  assert.equal(subjectCssFilter(), "brightness(1.000) sepia(0.000)");
  assert.equal(subjectCssFilter({subjectExposure: 1.25, subjectWarmth: 0.2}), "brightness(1.250) sepia(0.200)");
});

test("ground shadow follows current feet position and size", () => {
  const g = contactShadowGeometry(350, 700,
    {x:0.5,y:0.6,widthRatio:0.2},1600,900, {contactShadow:0.65});
  assert.equal(g.centerX, 800);
  assert.ok(g.centerY > 0 && g.centerY < 900);
  assert.equal(g.radiusX, 102.4);
  assert.equal(g.opacity,0.65);
  assert.ok(g.blur > 0);
});

test("render order draws ground shadow first, then relit subject", () => {
  const operations = [];
  const canvasContext = {
    filter: "", fillStyle: "",
    save() { operations.push("save"); },
    restore() { operations.push("restore"); },
    beginPath() { operations.push("path"); },
    ellipse() { operations.push("ellipse"); },
    fill() { operations.push("fill"); },
    drawImage() { operations.push("subject"); }
  };
  const img = {naturalWidth:350,naturalHeight:700};
  const rect = drawSubjectWithShadow(
    canvasContext,img,{x:.5,y:.5,widthRatio:.2},1600,900,
    {subjectExposure:1.1,subjectWarmth:.1,contactShadow:.5}
  );
  assert.equal(rect.width,320);
  assert.ok(operations.indexOf("ellipse") < operations.indexOf("subject"));
  assert.equal(operations.filter(op=>op==="subject").length,1);
});

test("shadow can be suppressed, and invalid image dimensions fail", () => {
  const ctx = {
    save() {}, restore() {}, drawImage() {},
    beginPath() {throw Error("Shadow should be disabled");}
  };
  drawSubjectWithShadow(ctx,{naturalWidth:100,naturalHeight:100},{},{...{width:1600},height:900}.width,900,{contactShadow:0});
  assert.throws(()=>drawSubjectWithShadow(ctx,{naturalWidth:0,naturalHeight:100},{},1600,900), RangeError);
});

test("background zoom and pan preserve target aspect ratio",()=>{
  const r=coverSourceRect(4000,3000,1600,900,0.75,0.25,1.5);
  assert.ok(r.sx>0);
  assert.ok(r.sy>=0);
  assert.ok(r.sx+r.sw<=4000);
  assert.ok(r.sy+r.sh<=3000);
  assert.ok(Math.abs(r.sw/r.sh-1600/900)<1e-9);
  const center=coverSourceRect(4000,3000,1600,900);
  assert.deepEqual(center,{sx:0,sy:375,sw:4000,sh:2250});
  assert.throws(()=>coverSourceRect(4000,3000,1600,900,-0.1,0.5,1),RangeError);
  assert.throws(()=>coverSourceRect(4000,3000,1600,900,0.5,0.5,2.6),RangeError);
});
