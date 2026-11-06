import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { decodeDataUrl, buildPrompt, renderWithProvider } from '../api/render.js';

const PNG_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9W7hqAEAAAAASUVORK5CYII=';
const BODY = Object.freeze({
  lat: 40.758, lon: -73.9855, acceptRights: true,
  composite: PNG_DATA, subject: PNG_DATA, subjectType: 'product',
  description: 'Late night street portrait'
});
const MODEL_IMAGE_BASE64 = Buffer.alloc(128, 33).toString('base64');
const withEnv = async (env, cb) => {
  const keys = ['OPENAI_API_KEY', 'APP_ACCESS_TOKEN', 'OPENAI_IMAGE_MODEL'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await cb(); }
  finally {
    for (const k of keys) if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k];
  }
};
function mockResponse() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    end(body) { this.json = JSON.parse(body); } };
}
test('decodeDataUrl validates real PNG signature, not just MIME', () => {
  const parsed = decodeDataUrl(PNG_DATA, 'test');
  assert.equal(parsed.mime, 'image/png');
  assert.ok(parsed.bytes.length >= 16);
  assert.throws(() => decodeDataUrl('data:image/png;base64,' + Buffer.alloc(20).toString('base64'), 'fake'), /画像形式/);
  assert.throws(() => decodeDataUrl('data:text/html;base64,' + Buffer.alloc(30).toString('base64'), 'html'), /PNG/);
});
test('prompt includes coordinates and foreground fidelity conditions', () => {
  const text = buildPrompt({ location: { lat: 40.758, lon: -73.9855 }, subjectType: 'person', reference: true, description: 'neon atmosphere' });
  assert.match(text, /40\.758000/);
  assert.match(text, /face, hairstyle/);
  assert.match(text, /THIRD image/);
  assert.match(text, /neon atmosphere/);
});
test('provider receives image references, model, dimensions and never returns the key', async () => {
  let called = 0;
  const output = await renderWithProvider(BODY, { apiKey: 'private-secret', model: 'gpt-image-2.5-flare', fetcher: async (url, options) => {
    called++;
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.equal(options.headers.Authorization, 'Bearer private-secret');
    assert.equal(options.body.getAll('image[]').length, 2);
    assert.equal(options.body.get('size'), '1536x864');
    assert.equal(options.body.get('quality'), 'medium');
    assert.equal(options.body.get('output_format'), 'webp');
    assert.match(options.body.get('prompt'), /product silhouette/);
    return { ok: true, status: 200, async json() { return { data: [{ b64_json: MODEL_IMAGE_BASE64 }] }; } };
  } });
  assert.equal(called, 1);
  assert.equal(output.isSynthetic, true);
  assert.match(output.image, /^data:image\/webp;base64,/);
  assert.equal(JSON.stringify(output).includes('private-secret'), false);
});
test('invalid inputs are rejected before a paid external request is made', async () => {
  for (const change of [{lat: 91}, {acceptRights: false}, {composite: 'data:image/jpeg;base64,AA=='}, {lon: 190}]) {
    let called = false;
    await assert.rejects(renderWithProvider({...BODY, ...change}, {apiKey: 'private', fetcher: async () => { called = true; }}));
    assert.equal(called, false);
  }
});
test('handler refuses to run without configured secrets', async () => {
  await withEnv({OPENAI_API_KEY: '', APP_ACCESS_TOKEN: ''}, async () => {
    const res = mockResponse();
    await handler({method: 'POST', headers: {host: 'localhost:8000'}, body: BODY}, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.json.error, /未設定/);
  });
});
test('handler rejects unknown access code and cross-origin requests', async () => {
  await withEnv({OPENAI_API_KEY: 'private-key', APP_ACCESS_TOKEN: 'strong-passphrase-example'}, async () => {
    const denied = mockResponse();
    await handler({method: 'POST', headers: {host: 'localhost:8000', authorization: 'Bearer wrong'}, body: BODY}, denied);
    assert.equal(denied.statusCode, 401);
    const crossOrigin = mockResponse();
    await handler({method: 'POST', headers: {host: 'localhost:8000', authorization: 'Bearer strong-passphrase-example', origin: 'https://evil.example'}, body: BODY}, crossOrigin);
    assert.equal(crossOrigin.statusCode, 403);
  });
});
test('handler rejects non-POST requests', async () => {
  const res = mockResponse();
  await handler({method: 'GET', headers: {}}, res);
  assert.equal(res.statusCode, 405);
});
