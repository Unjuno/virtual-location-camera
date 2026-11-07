import test from "node:test";
import assert from "node:assert/strict";
import {searchPanoramax} from "../api/panoramax-scenes.js";
import {getPanoramaxImage} from "../api/panoramax-image.js";

test("real public Panoramax API returns licensed photos and same-origin JPEG", {
  skip:process.env.PANORAMAX_LIVE!=="1"
},async()=>{
  const lat=48.859870109,lon=2.29472254;
  const result=await searchPanoramax({lat:String(lat),lon:String(lon),heading:"45",radius:"200"});
  assert.equal(result.configured,true);
  assert.ok(result.candidates.length>0,"No actual Eiffel area photos returned by Panoramax");
  const photo=result.candidates[0];
  assert.ok(["etalab-2.0","CC-BY-SA-4.0"].includes(photo.licenseSpdx));
  assert.ok(photo.distanceM<=212);
  assert.equal(photo.exactViewVerified,false);
  const preview=await getPanoramaxImage(photo.id,"thumb");
  assert.equal(preview.mime,"image/jpeg");
  assert.ok(preview.bytes.length>32);
  assert.equal(preview.bytes[0],0xff);
  assert.equal(preview.bytes[1],0xd8);
  assert.equal(preview.bytes[2],0xff);
  console.log("PROVIDER LIVE:",photo.provider,photo.id,photo.distanceM+" m",
    photo.license,photo.cameraHeading+"°",preview.bytes.length+" JPEG bytes");
});
