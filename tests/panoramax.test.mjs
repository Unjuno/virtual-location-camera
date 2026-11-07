import test from "node:test";
import assert from "node:assert/strict";
import {
  panoramaxSearchUrl,normalizePanoramaxResults,isApprovedPanoramaxItem,validPanoramaxId
} from "../src/panoramax.mjs";

export const PARIS_ID="af0c80eb-5ce4-424d-9ac3-6accccbe68d4";
const PARIS_ITEM={
  id:PARIS_ID,type:"Feature",
  geometry:{type:"Point",coordinates:[2.29472254,48.859870109]},
  links:[{rel:"license",href:"https://alliance.numerique.gouv.fr/licence-ouverte-open-licence/"}],
  providers:[{name:"Immergis pour la Ville de Paris",roles:["producer"]}],
  properties:{
    license:"etalab-2.0",datetime:"2025-07-21T12:29:24.784+00:00",
    updated:"2026-08-20T11:16:13.37+00:00",
    exif:{"Exif.GPSInfo.GPSImgDirection":"4532/100"}
  }
};
test("Panoramax query uses the verified public STAC bbox API and caps radius",()=>{
  const url=new URL(panoramaxSearchUrl(48.85987,2.29472,200,30));
  assert.equal(url.hostname,"api.panoramax.xyz");
  assert.equal(url.pathname,"/api/search");
  assert.equal(url.searchParams.get("limit"),"30");
  const box=url.searchParams.get("bbox").split(",").map(Number);
  assert.equal(box.length,4);
  assert.ok(box[0]<2.29472&&box[2]>2.29472&&box[1]<48.85987);
  assert.throws(()=>panoramaxSearchUrl(40,-73,250),RangeError);
  assert.throws(()=>panoramaxSearchUrl(86,0,200),RangeError);
});
test("approved Etalab photo retains position, facing direction, date and source",()=>{
  const images=normalizePanoramaxResults({features:[PARIS_ITEM]},{
    lat:48.859870109,lon:2.29472254,heading:50,radiusM:200
  });
  assert.equal(images.length,1);
  const p=images[0];
  assert.equal(p.provider,"panoramax");
  assert.equal(p.id,PARIS_ID);
  assert.equal(p.distanceM,0);
  assert.equal(p.cameraHeading,45.32);
  assert.equal(p.headingDifference,5);
  assert.equal(p.captureDate,"2025-07-21");
  assert.equal(p.licenseSpdx,"etalab-2.0");
  assert.equal(p.requiresShareAlike,false);
  assert.equal(p.exactViewVerified,false);
  assert.match(p.downloadUrl,/^\/api\/panoramax-image\?id=.*&size=sd$/);
  assert.match(p.attribution,/Immergis/);
});
test("CC BY-SA candidate requires ShareAlike and unknown licence fails closed",()=>{
  const cc={
    ...PARIS_ITEM,
    id:"22dbe0c8-ecd4-4a34-ab85-97fca408f414",
    links:[{rel:"license",href:"https://creativecommons.org/licenses/by-sa/4.0/"}],
    properties:{...PARIS_ITEM.properties,license:"CC-BY-SA-4.0","view:azimuth":359.5}
  };
  const p=normalizePanoramaxResults({features:[cc]},{
    lat:48.859870109,lon:2.29472254,heading:0,radiusM:200
  })[0];
  assert.equal(p.requiresShareAlike,true);
  assert.equal(p.headingDifference,1);
  const unknown={...PARIS_ITEM,properties:{...PARIS_ITEM.properties,license:"proprietary"}};
  assert.equal(isApprovedPanoramaxItem(unknown,PARIS_ID),false);
  const wrongLicenseUrl={...PARIS_ITEM,links:[{rel:"license",href:"https://evil.example/claim"}]};
  assert.equal(isApprovedPanoramaxItem(wrongLicenseUrl,PARIS_ID),false);
});
test("federated catalog requires stable UUID and position; de-duplicates results",()=>{
  assert.equal(validPanoramaxId(PARIS_ID),true);
  assert.equal(validPanoramaxId("../etc/passwd"),false);
  assert.equal(validPanoramaxId("123"),false);
  const absent={...PARIS_ITEM,geometry:{type:"Point",coordinates:[99,3]}};
  const result=normalizePanoramaxResults({features:[PARIS_ITEM,PARIS_ITEM,absent]},{
    lat:48.85987,lon:2.29472,heading:0,radiusM:100
  });
  assert.equal(result.length,1);
});
test("missing direction is labelled unknown, not inferred from the map",()=>{
  const item={...PARIS_ITEM,properties:{
    ...PARIS_ITEM.properties,exif:{}, "view:azimuth":null
  }};
  const a=normalizePanoramaxResults({features:[item]},{
    lat:48.85987,lon:2.29472,heading:341,radiusM:100
  })[0];
  assert.equal(a.cameraHeading,null);
  assert.equal(a.headingDifference,null);
});
