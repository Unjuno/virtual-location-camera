import test from "node:test";
import assert from "node:assert/strict";
import {findPanoramaxNeighbors} from "../api/panoramax-neighbors.js";

const root="af0c80eb-5ce4-424d-9ac3-6accccbe68d4";
const prev="52e042b8-dced-4f59-9a2b-8ff8f01effde";
const next="82d00dec-dc38-4a38-9e9a-ffbaddb98e9e";
const licenceLink={rel:"license",href:"https://alliance.numerique.gouv.fr/licence-ouverte-open-licence/"};
const metadata=(id,lon,lat,license="etalab-2.0")=>({
  type:"Feature",id,
  geometry:{type:"Point",coordinates:[lon,lat]},
  properties:{license,datetime:"2025-07-21T12:00:00Z","view:azimuth":42},
  providers:[{name:"Observation team",roles:["producer"]}],
  links:[licenceLink]
});
const current={
  ...metadata(root,2.29472254,48.859870109),
  links:[
    licenceLink,
    {rel:"prev",id:prev,geometry:{type:"Point",coordinates:[2.29467,48.85983]}},
    {rel:"next",id:next,geometry:{type:"Point",coordinates:[2.29477,48.85990]}}
  ]
};

test("adjacent photos come from real STAC prev/next UUID links, not guessed geometry",async()=>{
  const byId={
    [root]:current,
    [prev]:metadata(prev,2.29467,48.85983),
    [next]:metadata(next,2.29477,48.85990)
  };
  const requested=[];
  const result=await findPanoramaxNeighbors(root,{fetcher:async url=>{
    const id=new URL(url).searchParams.get("ids");
    requested.push(id);
    assert.equal(new URL(url).origin,"https://api.panoramax.xyz");
    return {ok:true,json:async()=>({features:[byId[id]]})};
  }});
  assert.equal(result.navigationType,"observed-sequence-only");
  assert.equal(result.centerId,root);
  assert.equal(result.previous.id,prev);
  assert.equal(result.next.id,next);
  assert.equal(result.previous.provider,"panoramax");
  assert.equal(result.next.exactViewVerified,false);
  assert.equal(result.next.licenseSpdx,"etalab-2.0");
  assert.equal(requested.length,3);
});

test("neighbour with unsupported licence or distant camera is never navigable",async()=>{
  const byId={
    [root]:current,
    [prev]:metadata(prev,2.29467,48.85983,"proprietary"),
    [next]:metadata(next,2.31,48.86)
  };
  const result=await findPanoramaxNeighbors(root,{fetcher:async url=>({
    ok:true,json:async()=>({features:[byId[new URL(url).searchParams.get("ids")]]})
  })});
  assert.equal(result.previous,null);
  assert.equal(result.next,null);
});

test("invalid neighbour IDs and unavailable photos cannot escape the allowlisted API",async()=>{
  let called=false;
  await assert.rejects(findPanoramaxNeighbors("https://metadata.example/secret",{
    fetcher:async()=>{called=true;}
  }),error=>error.status===400);
  assert.equal(called,false);
  await assert.rejects(findPanoramaxNeighbors(root,{fetcher:async()=>({
    ok:true,json:async()=>({features:[]})
  })}),error=>error.status===404);
});

test("arbitrary external URL from STAC links is ignored; only UUID is trusted",async()=>{
  const unsafe={...current,links:[
    licenceLink,{rel:"prev",id:"../etc/passwd",href:"http://localhost:8000/admin"},
    {rel:"next",id:next,href:"http://169.254.169.254/metadata"}
  ]};
  const calls=[];
  const result=await findPanoramaxNeighbors(root,{fetcher:async url=>{
    calls.push(url);
    return {ok:true,json:async()=>({features:[
      url.includes("ids="+root)?unsafe:metadata(next,2.29477,48.85990)
    ]})};
  }});
  assert.equal(result.previous,null);
  assert.equal(result.next.id,next);
  assert.equal(calls.length,2);
  assert.ok(calls.every(url=>url.startsWith("https://api.panoramax.xyz/api/search?ids=")));
});
