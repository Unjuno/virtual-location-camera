import test from "node:test";
import assert from "node:assert/strict";
import {
  DEPTH_MASK_SIZE,DEPTH_MODEL,DEFAULT_OCCLUSION,occlusionOptions,
  foregroundOpacity,depthImageToAlphaMask,occlusionStroke,
  depthResponseLooksValid
} from "../src/depth.mjs";

test("relative depth settings are clipped and defaults do not auto-occlude",()=>{
  assert.deepEqual(occlusionOptions(),DEFAULT_OCCLUSION);
  assert.deepEqual(occlusionOptions({
    threshold:2,feather:-1,invert:true,enabled:true
  }),{threshold:1,feather:0,invert:true,enabled:true});
  assert.equal(occlusionOptions({threshold:NaN}).threshold,0.65);
});

test("near-white foreground alpha obeys threshold, edge feather and inversion",()=>{
  assert.equal(foregroundOpacity(255,{threshold:0.5,feather:0.04}),255);
  assert.equal(foregroundOpacity(0,{threshold:0.5,feather:0.04}),0);
  assert.ok(foregroundOpacity(128,{threshold:0.5,feather:0.2})>0);
  assert.ok(foregroundOpacity(128,{threshold:0.5,feather:0.2})<255);
  assert.equal(foregroundOpacity(0,{threshold:0.5,feather:0.04,invert:true}),255);
  assert.equal(foregroundOpacity(255,{threshold:0.5,feather:0.04,invert:true}),0);
});

test("a 2x2 grayscale image produces a transparent or opaque white pixel mask",()=>{
  const input=new Uint8ClampedArray([
    0,0,0,255,255,255,255,255,
    64,64,64,255,200,200,200,255
  ]);
  const out=depthImageToAlphaMask(input,{threshold:0.5,feather:0.04});
  assert.equal(out.length,16);
  assert.deepEqual([out[3],out[7],out[11],out[15]],[0,255,0,255]);
  assert.equal(out[0],255);
  assert.equal(out[1],255);
  assert.throws(()=>depthImageToAlphaMask(new Uint8Array(16)),TypeError);
  assert.throws(()=>depthImageToAlphaMask(new Uint8ClampedArray(17)),TypeError);
});

test("a manual foreground stroke is normalized and has an explicit mode",()=>{
  assert.deepEqual(occlusionStroke(0.5,0.4,18,"foreground"),{
    x:0.5,y:0.4,radiusPx:18,mode:"foreground"
  });
  assert.deepEqual(occlusionStroke(1,0,5,"erase"),{
    x:1,y:0,radiusPx:5,mode:"erase"
  });
  for(const input of [
    [2,0.4,18,"foreground"],[0.5,-1,18,"foreground"],
    [0.2,0.2,0,"foreground"],[0.2,0.2,18,"unknown"]
  ])assert.throws(()=>occlusionStroke(...input),RangeError);
  assert.deepEqual(DEPTH_MASK_SIZE,{width:800,height:450});
});

test("relative depth response must match model, dimensions and PNG data URL",()=>{
  const valid={
    model:DEPTH_MODEL,relativeOnly:true,
    width:768,height:432,depthMap:"data:image/png;base64,iVBORw0KGgo="
  };
  assert.equal(depthResponseLooksValid(valid),true);
  assert.equal(depthResponseLooksValid({...valid,model:"other-model"}),false);
  assert.equal(depthResponseLooksValid({...valid,width:99999}),false);
  assert.equal(depthResponseLooksValid({...valid,depthMap:"https://unsafe.example/img.png"}),false);
  assert.equal(depthResponseLooksValid({...valid,relativeOnly:false}),false);
});
