/**
 * Public Panoramax federated STAC search: no account, no AI API key.
 * License-aware normalization is shared with the safe image download proxy.
 */
import { panoramaxSearchUrl, normalizePanoramaxResults } from "../src/panoramax.mjs";
import { parseSceneQuery } from "./scenes.js";

function respond(res,status,body) {
  res.statusCode=status;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","public, max-age=60");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.end(JSON.stringify(body));
}

export async function searchPanoramax(query,{fetcher=fetch}={}) {
  const scene=parseSceneQuery(query);
  const url=panoramaxSearchUrl(scene.lat,scene.lon,scene.radiusM,30);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try {
    const response=await fetcher(url,{
      method:"GET",
      headers:{Accept:"application/json","User-Agent":"virtual-location-camera/1.0 (https://github.com/Unjuno/virtual-location-camera)"},
      signal:controller.signal,redirect:"error"
    });
    if(!response.ok) throw Object.assign(new Error("Panoramax public search unavailable"),{status:502});
    const payload=await response.json();
    return {
      source:"panoramax",configured:true,
      camera:{lat:scene.lat,lon:scene.lon,heading:scene.heading},
      radiusM:scene.radiusM,
      candidates:normalizePanoramaxResults(payload,scene)
    };
  } finally { clearTimeout(timeout); }
}

export default async function handler(req,res) {
  if(req.method!=="GET")return respond(res,405,{error:"GETのみ対応します。"});
  try {
    const query=req.query??Object.fromEntries(new URL(req.url,"http://localhost").searchParams.entries());
    return respond(res,200,await searchPanoramax(query));
  } catch(error) {
    console.warn("Panoramax search",{name:error.name});
    const invalid=error instanceof RangeError||/緯度|経度|数値/.test(error.message);
    return respond(res,invalid?400:502,{
      error:invalid?"位置・検索範囲が不正です。":"Panoramaxの実景データを現在取得できません。別の画像ソースを選択してください。"
    });
  }
}
