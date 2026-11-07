import test from "node:test";
import assert from "node:assert/strict";
import {searchPanoramax} from "../api/panoramax-scenes.js";
const UUID="af0c80eb-5ce4-424d-9ac3-6accccbe68d4";
const item={
 id:UUID,type:"Feature",
 geometry:{type:"Point",coordinates:[2.29472254,48.859870109]},
 links:[{rel:"license",href:"https://alliance.numerique.gouv.fr/licence-ouverte-open-licence/"}],
 properties:{license:"etalab-2.0","view:azimuth":45.5,datetime:"2025-07-21T12:29:24Z"},
 providers:[{name:"Paris Contributor",roles:["producer"]}]
};
test("keyless public Panoramax image search never sends an API credential",async()=>{
  let calls=0;
  const res=await searchPanoramax({
    lat:"48.859870109",lon:"2.29472254",heading:"45",radius:"150"
  },{fetcher:async(url,options)=>{
    calls++;
    assert.equal(url.startsWith("https://api.panoramax.xyz/api/search?"),true);
    assert.equal(options.method,"GET");
    assert.equal(options.headers.Authorization,undefined);
    assert.equal(options.redirect,"error");
    return{ok:true,json:async()=>({features:[item]})};
  }});
  assert.equal(calls,1);
  assert.equal(res.source,"panoramax");
  assert.equal(res.configured,true);
  assert.equal(res.candidates.length,1);
  assert.equal(res.candidates[0].licenseSpdx,"etalab-2.0");
  assert.equal(res.candidates[0].headingDifference,1);
});
test("invalid world coordinates and out-of-range radius never call public API",async()=>{
  for(const query of [
    {lat:"91",lon:2,radius:150,heading:0},
    {lat:40,lon:181,radius:150,heading:0},
    {lat:40,lon:2,radius:500,heading:0},
    {lat:40,lon:2,radius:150,heading:"NaN"}
  ]){
    let called=false;
    await assert.rejects(searchPanoramax(query,{fetcher:async()=>{
      called=true;throw Error("Unexpected API request");
    }}));
    assert.equal(called,false);
  }
});
test("non-reusable items do not appear even when location matches",async()=>{
  const blocked={...item,properties:{...item.properties,license:"proprietary"}};
  const res=await searchPanoramax({lat:48.85987,lon:2.29472,heading:50,radius:150},{
    fetcher:async()=>({ok:true,json:async()=>({features:[blocked]})})
  });
  assert.equal(res.candidates.length,0);
});
