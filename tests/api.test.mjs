import test from "node:test";
import assert from "node:assert/strict";
import health from "../api/health.js";
import render from "../api/render.js";

function mockRes() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(data) { this.body = JSON.parse(data); }
  };
}
test("public cloud health never claims model is configured", () => {
  const res = mockRes();
  health({method: "GET"}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.aiConfigured, false);
  assert.equal(res.body.provider, "local-huggingface-diffusers");
});
test("public cloud render never calls paid inference", () => {
  const res = mockRes();
  render({method: "POST"}, res);
  assert.equal(res.statusCode, 501);
  assert.match(res.body.error, /ローカルGPU/);
});
test("render GET is rejected", () => {
  const res = mockRes();
  render({method: "GET"}, res);
  assert.equal(res.statusCode, 405);
});
