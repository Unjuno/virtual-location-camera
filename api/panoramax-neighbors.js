/**
 * Navigate only to EXISTING Panoramax photographs adjacent within a recorded
 * capture sequence. Never synthesize an unobserved street view.
 * All referenced IDs are validated UUIDs, and every candidate's own STAC
 * license is independently checked by normalizePanoramaxResults.
 */
import {
  PANORAMAX_BASE,validPanoramaxId,normalizePanoramaxResults,isApprovedPanoramaxItem
} from "../src/panoramax.mjs";

function reply(res,status,data){
  res.statusCode=status;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","public, max-age=45");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.end(JSON.stringify(data));
}
async function readItem(id,fetcher,signal) {
  const target=PANORAMAX_BASE+"/api/search?ids="+id;
  const response=await fetcher(target,{
    method:"GET",redirect:"error",signal,
    headers:{Accept:"application/json","User-Agent":"virtual-location-camera/1.0"}
  });
  if(!response.ok)throw Object.assign(new Error("Upstream Panoramax unavailable"),{status:502});
  const data=await response.json();
  return (Array.isArray(data?.features)?data.features:[])
    .find(x=>x?.id?.toLowerCase()===id.toLowerCase())??null;
}
export async function findPanoramaxNeighbors(id,{fetcher=fetch}={}){
  if(!validPanoramaxId(id))
    throw Object.assign(new Error("画像IDはUUIDで指定してください。"),{status:400});
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8500);
  try {
    const current=await readItem(id,fetcher,controller.signal);
    if(!isApprovedPanoramaxItem(current,id))
      throw Object.assign(new Error("この画像の利用条件が確認できません。"),{status:404});
    const position=current?.geometry?.coordinates;
    if(!Array.isArray(position)||position.length<2)
      throw Object.assign(new Error("この撮影地点の座標が取得できません。"),{status:404});
    const query={
      lat:position[1],lon:position[0],
      heading:current?.properties?.["view:azimuth"]??null,
      radiusM:200
    };
    const links={};
    for(const rel of ["prev","next"]){
      const entry=(current.links??[]).find(x=>x?.rel===rel&&validPanoramaxId(x.id));
      if(entry && entry.id.toLowerCase()!==id.toLowerCase())links[rel]=entry.id.toLowerCase();
    }
    const uniqueIds=[...new Set(Object.values(links))];
    const fetched=await Promise.allSettled(
      uniqueIds.map(ref=>readItem(ref,fetcher,controller.signal))
    );
    const neighbors={};
    uniqueIds.forEach((ref,i)=>{
      if(fetched[i].status==="fulfilled" && fetched[i].value) {
        neighbors[ref]=fetched[i].value;
      }
    });
    // All photo candidates are filtered by rights and no more than 200m from
    // the selected picture. A missing or proprietary neighbor is unavailable.
    const candidates=normalizePanoramaxResults(
      {features:Object.values(neighbors)},query
    );
    const byId=new Map(candidates.map(p=>[p.id,p]));
    return {
      source:"panoramax",centerId:id.toLowerCase(),
      previous:links.prev?byId.get(links.prev)??null:null,
      next:links.next?byId.get(links.next)??null:null,
      navigationType:"observed-sequence-only",
      note:"次の写真は撮影済みの位置です。写真のない角度・地点は生成していません。"
    };
  }finally{clearTimeout(timeout);}
}
export default async function handler(req,res){
  if(req.method!=="GET")return reply(res,405,{error:"GETのみ対応しています。"});
  const query=req.query??Object.fromEntries(
    new URL(req.url,"http://localhost").searchParams.entries()
  );
  try{
    return reply(res,200,await findPanoramaxNeighbors(query.id));
  }catch(error){
    const status=[400,404].includes(error?.status)?error.status:502;
    console.warn("Panoramax sequence navigation",{name:error?.name,status});
    return reply(res,status,{
      error:status===400?"画像IDが不正です。":
        status===404?"撮影済み画像を見つけられません。":
        "公開街路写真の前後関係を取得できませんでした。"
    });
  }
}
