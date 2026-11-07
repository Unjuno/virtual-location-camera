import test from "node:test";
import assert from "node:assert/strict";
import handler, { parseSceneQuery, queryMapillaryScenes } from "../api/scenes.js";

test("scene search validates decimal WGS84 and numeric radius/heading", () => {
  assert.equal(parseSceneQuery({ lat: "40.758", lon: "-73.9855", heading: "-19", radius: "150" }).heading, 341);
  for (const change of [
    {lat: "91"}, {lon: "190"}, {radius: "300"},
    {radius: "10"}, {radius: "not-numeric"}, {heading: "NaN"}
  ]) {
    assert.throws(() => parseSceneQuery({
      lat: "40.758", lon: "-73.9855", heading: "-19", radius: "150", ...change
    }));
  }
});

test("no Mapillary token returns unconfigured without making external calls", async () => {
  let called = 0;
  const response = await queryMapillaryScenes({lat: "40.758", lon: "-73.9855", heading: "0"}, {
    token: "", fetcher: async () => { called++; throw Error("Unexpected request"); }
  });
  assert.equal(called, 0);
  assert.equal(response.configured, false);
  assert.deepEqual(response.candidates, []);
});

test("provider request uses fixed bounding box and sends token only as Authorization header", async () => {
  let seen = 0;
  const result = await queryMapillaryScenes({lat: "40.758",lon:"-73.9855",heading:"343",radius:"150"}, {
    token: "mock-ONLY-SECRET",
    fetcher: async (url, options) => {
      seen++;
      const uri = new URL(url);
      assert.equal(uri.origin, "https://graph.mapillary.com");
      assert.equal(uri.pathname, "/images");
      assert.equal(uri.searchParams.get("limit"), "80");
      assert.equal(uri.searchParams.get("access_token"), null);
      assert.ok(uri.searchParams.get("fields").includes("computed_compass_angle"));
      assert.equal(options.headers.Authorization, "OAuth mock-ONLY-SECRET");
      return {ok:true, async json(){return{data:[{
        id:"12345678", computed_geometry:{coordinates:[-73.9855,40.758]},
        computed_compass_angle:345,captured_at:Date.UTC(2026,10,1)
      }]}}};
    }
  });
  assert.equal(seen,1);
  assert.equal(result.configured,true);
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].headingDifference,2);
  assert.equal(JSON.stringify(result).includes("mock-ONLY-SECRET"),false);
});

test("provider errors are sanitized and not represented as verified photos", async () => {
  await assert.rejects(
    queryMapillaryScenes({lat:40.758,lon:-73.9855},{token:"x",fetcher:async()=>({ok:false,status:429})}),
    e=>e.status===429
  );
});

test("API handler serves unconfigured JSON without exposing private settings", async () => {
  const old = process.env.MAPILLARY_ACCESS_TOKEN;
  delete process.env.MAPILLARY_ACCESS_TOKEN;
  const res={headers:{},setHeader(k,v){this.headers[k]=v},end(s){this.body=JSON.parse(s)}};
  try {
    await handler({method:"GET",query:{lat:"40.758",lon:"-73.9855",radius:"150"}},res);
    assert.equal(res.statusCode,200);
    assert.equal(res.body.configured,false);
    assert.deepEqual(res.body.candidates,[]);
    assert.equal(res.headers["X-Content-Type-Options"],"nosniff");
  } finally {
    if(old!==undefined)process.env.MAPILLARY_ACCESS_TOKEN=old;
  }
});
