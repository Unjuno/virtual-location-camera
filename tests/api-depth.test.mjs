import test from "node:test";
import assert from "node:assert/strict";
import health from "../api/depth-health.js";
import depth from "../api/depth.js";
function res(){
  return {headers:{},setHeader(k,v){this.headers[k]=v;},
    end(v){this.result=JSON.parse(v);}};
}
test("public deployment never falsely advertises local depth GPU availability",()=>{
  const r=res();
  health({method:"GET"},r);
  assert.equal(r.statusCode,200);
  assert.equal(r.result.available,false);
  assert.equal(r.result.model,"depth-anything/Depth-Anything-V2-Small-hf");
  assert.match(r.result.message,/ローカル/);
});
test("public deployment disallows depth inference when no local Python worker exists",()=>{
  const r=res();
  depth({method:"POST"},r);
  assert.equal(r.statusCode,501);
  assert.match(r.result.error,/ローカルPython/);
  const x=res();
  depth({method:"GET"},x);
  assert.equal(x.statusCode,405);
});
