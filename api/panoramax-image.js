/**
 * Same-origin, licence-checked Panoramax photo proxy.
 * The caller controls only a UUID and thumb/sd size. Every request checks the
 * live STAC licence before accessing the provider's bytes.
 *
 * Redirects are deliberately allowlisted; user-provided asset URLs are never
 * accepted, and response streams are bounded to protect Vercel memory.
 */
import { isApprovedPanoramaxItem, validPanoramaxId, PANORAMAX_BASE } from "../src/panoramax.mjs";

const MAX_BYTES=4_000_000;
const ALLOWED_REDIRECT_HOSTS=new Set([
  "api.panoramax.xyz",
  "panoramax.ign.fr",
  "panoramax.openstreetmap.fr",
  "panoramax.mapcomplete.org",
  "panoramax-storage-public-fast.s3.gra.perf.cloud.ovh.net"
]);

export function isAllowedRedirect(value) {
  try {
    const parsed=new URL(value);
    return parsed.protocol==="https:"&&!parsed.username&&!parsed.password
      && ALLOWED_REDIRECT_HOSTS.has(parsed.hostname.toLowerCase());
  }catch {return false;}
}

async function readWithByteLimit(response,max) {
  if(response.body && typeof response.body.getReader==="function"){
    const reader=response.body.getReader();
    const pieces=[];let count=0;
    try {
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        count+=value.byteLength;
        if(count>max){
          await reader.cancel();
          throw Object.assign(new Error("provider image too large"),{status:413});
        }
        pieces.push(Buffer.from(value));
      }
    }finally{reader.releaseLock();}
    return Buffer.concat(pieces,count);
  }
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>max)throw Object.assign(new Error("provider image too large"),{status:413});
  return bytes;
}

async function getWithAllowlistedRedirects(address,fetcher,signal) {
  let url=address;
  for(let attempt=0;attempt<4;attempt++){
    if(!isAllowedRedirect(url)){
      throw Object.assign(new Error("untrusted image redirect"),{status:502});
    }
    const res=await fetcher(url,{
      method:"GET",redirect:"manual",
      headers:{Accept:"image/jpeg,image/webp,image/png","User-Agent":"virtual-location-camera/1.0"},
      signal
    });
    if([301,302,303,307,308].includes(res.status)){
      const next=res.headers?.get("location");
      if(!next)throw Object.assign(new Error("invalid image redirect"),{status:502});
      url=new URL(next,url).href;
      continue;
    }
    return res;
  }
  throw Object.assign(new Error("too many image redirects"),{status:502});
}

export async function getPanoramaxImage(id,size="sd",{fetcher=fetch}={}){
  if(!validPanoramaxId(id))throw Object.assign(new Error("画像のUUIDが不正です。"),{status:400});
  if(!["thumb","sd"].includes(size))throw Object.assign(new Error("画像サイズはthumbまたはsdです。"),{status:400});

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),13000);
  try {
    const metadata=await fetcher(PANORAMAX_BASE+"/api/search?ids="+id,{
      method:"GET",redirect:"error",
      headers:{Accept:"application/json"},signal:controller.signal
    });
    if(!metadata.ok)throw Object.assign(new Error("picture metadata unavailable"),{status:502});
    const payload=await metadata.json();
    const feature=(payload?.features??[]).find(f=>isApprovedPanoramaxItem(f,id));
    if(!feature)throw Object.assign(new Error("利用条件を確認できない画像です。"),{status:403});

    // The URL is fixed to the public STAC catalog; the caller cannot choose
    // a hostname or an arbitrary path. Upstream redirects are allowlisted.
    const url=PANORAMAX_BASE+"/api/pictures/"+id+"/"+size+".jpg";
    const response=await getWithAllowlistedRedirects(url,fetcher,controller.signal);
    if(!response.ok)throw Object.assign(new Error("picture unavailable"),{status:502});
    const declared=Number(response.headers?.get("content-length"));
    if(declared>MAX_BYTES)throw Object.assign(new Error("provider image too large"),{status:413});
    const mime=String(response.headers?.get("content-type")||"").split(";")[0].toLowerCase();
    if(mime!=="image/jpeg")throw Object.assign(new Error("unsupported provider image"),{status:415});
    const data=await readWithByteLimit(response,MAX_BYTES);
    if(data.length<32||data[0]!==0xff||data[1]!==0xd8||data[2]!==0xff){
      throw Object.assign(new Error("corrupt JPEG"),{status:502});
    }
    return {bytes:data,mime};
  } finally {clearTimeout(timeout);}
}

export default async function handler(req,res) {
  if(req.method!=="GET"){res.statusCode=405;return res.end("Method not allowed");}
  const query=req.query??Object.fromEntries(new URL(req.url,"http://localhost").searchParams.entries());
  try{
    const picture=await getPanoramaxImage(query.id,query.size||"sd");
    res.statusCode=200;
    res.setHeader("Content-Type",picture.mime);
    res.setHeader("Content-Length",String(picture.bytes.length));
    res.setHeader("Cache-Control","public, max-age=300");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.end(picture.bytes);
  }catch(error){
    const status=error.status||502;
    console.warn("Panoramax proxy",{name:error.name,status});
    res.statusCode=status;
    res.setHeader("Content-Type","text/plain; charset=utf-8");
    res.setHeader("Cache-Control","no-store");
    res.end(status>=500?"実景画像を取得できませんでした。":error.message);
  }
}
