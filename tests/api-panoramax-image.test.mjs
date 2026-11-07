import test from "node:test";
import assert from "node:assert/strict";
import {getPanoramaxImage,isAllowedRedirect} from "../api/panoramax-image.js";
const id="af0c80eb-5ce4-424d-9ac3-6accccbe68d4";
const feature={
  id,
  links:[{rel:"license",href:"https://alliance.numerique.gouv.fr/licence-ouverte-open-licence/"}],
  properties:{license:"etalab-2.0"}
};
test("only known Panoramax and CDN HTTPS hosts can receive proxied image requests",()=>{
  assert.equal(isAllowedRedirect("https://api.panoramax.xyz/api/pictures/"+id+"/thumb.jpg"),true);
  assert.equal(isAllowedRedirect("https://panoramax-storage-public-fast.s3.gra.perf.cloud.ovh.net/a.jpg"),true);
  assert.equal(isAllowedRedirect("https://panoramax.openstreetmap.fr/derivates/a.jpg"),true);
  for(const bad of [
    "https://panoramax.ign.fr.evil.example/a.jpg",
    "https://127.0.0.1/secret",
    "http://api.panoramax.xyz/img",
    "file:///etc/passwd",
    "https://user:password@panoramax.ign.fr/img",
    "https://169.254.169.254/latest/meta-data"
  ])assert.equal(isAllowedRedirect(bad),false,bad);
});
test("licenced photo fetch follows only allowlisted redirects and checks JPEG signature",async()=>{
  const jpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff]),Buffer.alloc(60,2),Buffer.from([0xff,0xd9])]);
  const urls=[];
  const result=await getPanoramaxImage(id,"sd",{fetcher:async(url,opt)=>{
    urls.push(url);
    if(url.includes("/api/search?ids=")) {
      assert.equal(opt.redirect,"error");
      return{ok:true,json:async()=>({features:[feature]})};
    }
    if(url.includes("/api/pictures/"))return{
      status:302,headers:{get(k){return k==="location"
        ?"https://panoramax-storage-public-fast.s3.gra.perf.cloud.ovh.net/abc.jpg":null}}
    };
    assert.equal(url.startsWith("https://panoramax-storage-public-fast"),true);
    return{status:200,ok:true,headers:{get(k){
      return k==="content-type"?"image/jpeg":null
    }},arrayBuffer:async()=>jpeg};
  }});
  assert.equal(urls.length,3);
  assert.equal(result.mime,"image/jpeg");
  assert.deepEqual(result.bytes,jpeg);
});
test("unknown licence and invalid UUID never download photo content",async()=>{
  for(const uid of ["..","not-uuid","1234"]) {
    let called=false;
    await assert.rejects(getPanoramaxImage(uid,"sd",{fetcher:async()=>{called=true;}}));
    assert.equal(called,false);
  }
  let called=0;
  await assert.rejects(getPanoramaxImage(id,"thumb",{fetcher:async()=>{
    called++;
    return{ok:true,json:async()=>({features:[{...feature,properties:{license:"proprietary"}}]})};
  }}),e=>e.status===403);
  assert.equal(called,1);
});
test("image redirect to internal address and masquerading text are rejected",async()=>{
  let count=0;
  await assert.rejects(getPanoramaxImage(id,"sd",{fetcher:async()=>{
    count++;
    return count===1?{ok:true,json:async()=>({features:[feature]})}:{
      status:302,headers:{get(){return "https://localhost/photo.jpg"}}
    };
  }}),e=>e.status===502);
  await assert.rejects(getPanoramaxImage(id,"sd",{fetcher:async(url)=>{
    return url.includes("search?")
      ?{ok:true,json:async()=>({features:[feature]})}
      :{ok:true,status:200,headers:{get(){return "text/html"}},arrayBuffer:async()=>Buffer.alloc(90)};
  }}),e=>e.status===415);
});
test("byte limit enforces early cancellation on oversized streaming payload",async()=>{
  const stream=new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(4_100_000));controller.close();}
  });
  await assert.rejects(getPanoramaxImage(id,"sd",{fetcher:async url=>{
    if(url.includes("search?"))return{ok:true,json:async()=>({features:[feature]})};
    return{ok:true,status:200,headers:{get(k){return k==="content-type"?"image/jpeg":null}},body:stream};
  }}),e=>e.status===413);
});
