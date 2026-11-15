#!/usr/bin/env node
/**
 * Collect a short sequence of real licensed street photographs for local
 * MapAnything multiview reconstruction. No Google pixels or paid API.
 */
import {mkdtemp,mkdir,writeFile,rename,rm,access} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {searchPanoramax} from "../api/panoramax-scenes.js";
import {findPanoramaxNeighbors} from "../api/panoramax-neighbors.js";
import {getPanoramaxImage} from "../api/panoramax-image.js";
import {distanceMeters} from "../src/scenes.mjs";
import {validPanoramaxId} from "../src/panoramax.mjs";

function finite(value,min,max,name){
 const x=Number(value);
 if(!Number.isFinite(x)||x<min||x>max)throw new Error("Invalid "+name);
 return x;
}
export function collectionOptions(raw={}){
 const lat=finite(raw.lat,-90,90,"latitude"),lon=finite(raw.lon,-180,180,"longitude");
 const radius=finite(raw.radius??150,25,200,"radius");
 const count=finite(raw.count??6,2,12,"count");
 const heading=finite(raw.heading??0,-180,360,"heading");
 if(!Number.isInteger(radius)||!Number.isInteger(count))throw new Error("radius/count must be integers");
 if(raw.acceptImageRights!==true)
  throw new Error("Explicit --accept-image-rights acknowledgement is required.");
 return {lat,lon,radius,count,heading,acceptShareAlike:raw.acceptShareAlike===true};
}
export async function collectObservedPhotos(input,{search=searchPanoramax,
 neighbors=findPanoramaxNeighbors,download=getPanoramaxImage}={}){
 const c=collectionOptions(input);
 const result=await search({
  lat:String(c.lat),lon:String(c.lon),heading:String(c.heading),radius:String(c.radius)
 });
 const photos=Array.isArray(result.candidates)?result.candidates:[];
 const valid=p=>p?.provider==="panoramax" && validPanoramaxId(p.id)
   &&["etalab-2.0","CC-BY-SA-4.0"].includes(p.licenseSpdx)
   &&(p.licenseSpdx==="etalab-2.0"||c.acceptShareAlike)
   &&Number.isFinite(p.lat)&&Number.isFinite(p.lon)
   &&distanceMeters(c.lat,c.lon,p.lat,p.lon)<=c.radius+12
   &&p.imageType!=="360";
 const start=photos.find(valid);
 if(!start)throw new Error("No reusable nearby perspective street photograph found.");
 const visited=new Set(),pending=[start],output=[];
 while(pending.length && output.length<c.count){
  const picture=pending.shift();
  if(!picture||visited.has(picture.id))continue;
  visited.add(picture.id);
  if(!valid(picture))continue;
  let image;
  try{
   image=await download(picture.id,"sd");
   if(image.mime!=="image/jpeg"||!Buffer.isBuffer(image.bytes)
      ||image.bytes.length<32||image.bytes.length>4_000_000)continue;
  }catch{continue;}
  output.push({
   filename:String(output.length+1).padStart(2,"0")+"-"+picture.id+".jpg",
   bytes:image.bytes,
   id:picture.id,lat:picture.lat,lon:picture.lon,
   captureDate:picture.captureDate,cameraHeading:picture.cameraHeading,
   creator:picture.creator,provider:picture.provider,
   license:picture.license,licenseSpdx:picture.licenseSpdx,
   licenseUrl:picture.licenseUrl,viewerUrl:picture.viewerUrl,
   isModified:false,geographicRegistrationVerified:false
  });
  if(output.length>=c.count)break;
  try{
   const next=await neighbors(picture.id);
   for(const item of [next.previous,next.next]){
    if(valid(item)&&!visited.has(item.id)&&!pending.some(p=>p.id===item.id))
      pending.push(item);
   }
  }catch{ /* Missing neighbour metadata does not authorize guessing. */ }
 }
 if(output.length<2)
  throw new Error("Fewer than 2 licensed overlapping photos. Select another place or supply your own.");
 return {
  count:output.length,photos:output,source:"Panoramax observed photo sequence",
  anchor:{lat:c.lat,lon:c.lon,heading:c.heading,radiusM:c.radius},
  geometricRegistrationVerified:false,missingViewsSynthesized:false
 };
}
export async function saveCollectedPhotos(collection,outputPath){
 const destination=resolve(outputPath);
 try{await access(destination);throw Error("Destination exists; choose a fresh directory.");}
 catch(error){if(error?.code!=="ENOENT")throw error;}
 const temp=await mkdtemp(join(tmpdir(),"vlc-real-sequence-"));
 try{
  for(const photo of collection.photos){
   if(!/^\d{2}-[a-f0-9-]{36}\.jpg$/.test(photo.filename))
    throw Error("Unexpected photo filename.");
   await writeFile(join(temp,photo.filename),photo.bytes,{flag:"wx"});
  }
  const sources={
   schemaVersion:1,type:"licensed-observed-photo-sequence",
   anchor:collection.anchor,source:collection.source,
   count:collection.count,
   photos:collection.photos.map(({bytes,...meta})=>meta),
   verifiedGeographicRegistration:false,
   verified3DModel:false,
   note:"Source-image license controls derivatives; see each licenseUrl and viewerUrl."
  };
  await writeFile(join(temp,"sources.json"),JSON.stringify(sources,null,2)+"\n");
  await mkdir(resolve(destination,".."),{recursive:true});
  await rename(temp,destination);
  return destination;
 }catch(error){
  await rm(temp,{recursive:true,force:true});
  throw error;
 }
}
function parseArgs(argv){
 const opts={};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==="--accept-image-rights")opts.acceptImageRights=true;
  else if(arg==="--accept-sharealike")opts.acceptShareAlike=true;
  else if(["--lat","--lon","--radius","--count","--heading","--output"].includes(arg)){
   if(i+1>=argv.length)throw Error("Missing value for "+arg);
   opts[arg.slice(2)]=argv[++i];
  }else throw Error("Unknown argument: "+arg);
 }
 if(!opts.output)throw Error("Specify --output ./new-directory");
 return opts;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{
  const opts=parseArgs(process.argv.slice(2));
  const selected=await collectObservedPhotos(opts);
  const destination=await saveCollectedPhotos(selected,opts.output);
  console.log(JSON.stringify({
   output:destination,sourcePhotos:selected.count,
   metadata:join(destination,"sources.json"),
   next:"python world/reconstruct_world.py --images "+destination+
     " --output scene.ply --accept-image-rights"
  },null,2));
 }catch(error){
  console.error("Real-world photo collection failed:",error.message);
  process.exitCode=2;
 }
}
