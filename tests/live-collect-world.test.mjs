import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readdir,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {collectObservedPhotos,saveCollectedPhotos} from "../world/collect_street_images.mjs";

test("collect actual licensed Panoramax overlaps (not generic city text)",{
  skip:process.env.PANORAMAX_LIVE!=="1",
  timeout:60_000
},async()=>{
  const collection=await collectObservedPhotos({
    lat:48.859870109,lon:2.29472254,
    radius:150,count:3,heading:45,
    acceptImageRights:true
  });
  assert.ok(collection.count>=2,"Paris must have a real linked photo sequence");
  assert.equal(collection.geometricRegistrationVerified,false);
  for(const photo of collection.photos){
    assert.equal(photo.provider,"panoramax");
    assert.equal(photo.licenseSpdx,"etalab-2.0");
    assert.ok(photo.bytes.length>1000);
    assert.equal(photo.bytes[0],0xff);
    assert.equal(photo.bytes[1],0xd8);
    assert.ok(photo.viewerUrl.includes(photo.id));
  }
  const scratch=await mkdtemp(join(tmpdir(),"vlc-live-photo-set-"));
  try{
    const output=join(scratch,"observed");
    await saveCollectedPhotos(collection,output);
    const files=await readdir(output);
    assert.equal(files.filter(file=>file.endsWith(".jpg")).length,collection.count);
    const provenance=JSON.parse(await readFile(join(output,"sources.json"),"utf8"));
    assert.equal(provenance.count,collection.count);
    assert.equal(provenance.verifiedGeographicRegistration,false);
    console.log("MODEL INPUT VERIFIED:",collection.count,
      "actual licensed overlapping photos",collection.photos.map(p=>p.id).join(","));
  }finally{await rm(scratch,{recursive:true,force:true});}
});
