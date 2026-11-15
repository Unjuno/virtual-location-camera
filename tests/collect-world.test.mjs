import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {collectionOptions,collectObservedPhotos,saveCollectedPhotos} from "../world/collect_street_images.mjs";

const IDs=[
 "af0c80eb-5ce4-424d-9ac3-6accccbe68d4",
 "52e042b8-dced-4f59-9a2b-8ff8f01effde",
 "82d00dec-dc38-4a38-9e9a-ffbaddb98e9e"
];
const candidate=(id,license="etalab-2.0")=>({
 provider:"panoramax",id,
 lat:48.85987,lon:2.29472,
 cameraHeading:45,captureDate:"2025-07-21",
 creator:"Paris photo contributor",imageType:"perspective",
 licenseSpdx:license,license:license==="etalab-2.0"?"Etalab Open Licence 2.0":"CC BY-SA 4.0",
 licenseUrl:"https://www.data.gouv.fr/pages/legal/licences/etalab-2-0",
 viewerUrl:"https://api.panoramax.xyz/#focus=pic&pic="+id
});
const opts={lat:48.85987,lon:2.29472,heading:45,radius:150,count:3,acceptImageRights:true};
test("collector requires explicit photo rights and valid coordinates",()=>{
 assert.throws(()=>collectionOptions({lat:48,lon:2}),/rights/);
 assert.throws(()=>collectionOptions({...opts,lat:91}),/latitude/);
 assert.throws(()=>collectionOptions({...opts,count:20}),/count/);
 assert.throws(()=>collectionOptions({...opts,radius:201}),/radius/);
 assert.equal(collectionOptions(opts).count,3);
});
test("collector traces observed sequences and never invents a missing frame",async()=>{
 let requests=0;
 const jpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff]),Buffer.alloc(60),Buffer.from([0xff,0xd9])]);
 const expected=[candidate(IDs[0]),candidate(IDs[1]),candidate(IDs[2])];
 const collection=await collectObservedPhotos(opts,{
  search:async()=>({candidates:[expected[0]]}),
  neighbors:async id=>({
   previous:id===IDs[0]?expected[1]:null,
   next:id===IDs[0]?expected[2]:null
  }),
  download:async(id,size)=>{
   requests++;
   assert.equal(size,"sd");
   assert.ok(IDs.includes(id));
   return {mime:"image/jpeg",bytes:jpeg};
  }
 });
 assert.equal(collection.photos.length,3);
 assert.equal(requests,3);
 assert.equal(collection.geometricRegistrationVerified,false);
 const dir=await mkdtemp(join(tmpdir(),"vlc-collector-test-"));
 try{
  const path=join(dir,"new-sequence");
  await saveCollectedPhotos(collection,path);
  const files=await readdir(path);
  assert.ok(files.includes("sources.json"));
  assert.equal(files.filter(x=>x.endsWith(".jpg")).length,3);
  const source=JSON.parse(await readFile(join(path,"sources.json"),"utf8"));
  assert.equal(source.count,3);
  assert.equal(source.photos[0].licenseSpdx,"etalab-2.0");
  assert.equal(source.photos[0].bytes,undefined);
  assert.equal(source.verifiedGeographicRegistration,false);
  await assert.rejects(saveCollectedPhotos(collection,path),/exists/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("an absent or non-reusable sequence does not produce a fabricated world",async()=>{
 await assert.rejects(collectObservedPhotos(opts,{
  search:async()=>({candidates:[candidate(IDs[0],"CC-BY-SA-4.0")]}),
  neighbors:async()=>({}),download:async()=>{throw Error("Must not download")}
 }),/No reusable/);
 await assert.rejects(collectObservedPhotos(opts,{
  search:async()=>({candidates:[candidate(IDs[0])]}),
  neighbors:async()=>({previous:null,next:null}),
  download:async()=>({mime:"image/jpeg",bytes:Buffer.alloc(40)})
 }),/Fewer than 2/);
});
