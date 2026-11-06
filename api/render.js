/**
 * Authenticated GPT Image editing endpoint. Node.js 22 / Vercel Functions.
 * All OpenAI credentials remain on the server, never inside public JS.
 */
import { timingSafeEqual } from 'node:crypto';
import { parseLocation } from '../src/core.mjs';

export const config = { maxDuration: 120 };

const REQUEST_LIMIT = 3_600_000;
const IMAGE_LIMIT = 1_800_000;
const ALLOWED_MODELS = new Set(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function constantTimeEqual(actual, expected) {
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function getBody(req) {
  if (req.body !== undefined && req.body !== null) {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > REQUEST_LIMIT) throw Object.assign(new Error('画像の送信サイズが大きすぎます。'), { status: 413 });
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > REQUEST_LIMIT) throw Object.assign(new Error('画像の送信サイズが大きすぎます。'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function decodeDataUrl(value, label) {
  if (typeof value !== 'string' || value.length > IMAGE_LIMIT * 1.5 + 64) {
    throw Object.assign(new Error(label + 'のサイズまたは形式が不正です。'), { status: 400 });
  }
  const matched = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!matched || matched[2].length % 4 !== 0) {
    throw Object.assign(new Error(label + 'はPNG・JPEG・WebPのData URLにしてください。'), { status: 400 });
  }
  const bytes = Buffer.from(matched[2], 'base64');
  if (bytes.length < 16 || bytes.length > IMAGE_LIMIT) {
    throw Object.assign(new Error(label + 'は1.8MB以下の実画像にしてください。'), { status: 400 });
  }
  const kind = matched[1];
  const signature = kind === 'png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : kind === 'jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!signature) throw Object.assign(new Error(label + 'の画像形式が一致しません。'), { status: 400 });
  return { bytes, mime: MIME[kind], extension: EXT[kind] };
}

function normalizeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('無効なリクエストです。'), { status: 400 });
  if (body.acceptRights !== true) throw Object.assign(new Error('画像の権利と外部APIへの送信への同意が必要です。'), { status: 400 });
  const location = parseLocation(body.lat, body.lon);
  const scene = decodeDataUrl(body.composite, '構図画像');
  const subject = body.subject ? decodeDataUrl(body.subject, '被写体画像') : null;
  const reference = body.reference ? decodeDataUrl(body.reference, '実景参照画像') : null;
  const description = String(body.description ?? '').slice(0, 600).trim();
  const subjectType = body.subjectType === 'product' ? 'product' : 'person';
  return { location, scene, subject, reference, description, subjectType };
}

export function buildPrompt({ location, description, subjectType, reference }) {
  return [
    'Create one convincing, photorealistic nighttime location photograph in a wide 16:9 frame.',
    'The FIRST input image is a geospatial camera composition mock-up from a 3D map with a foreground subject. Use it as a guide for building layout, perspective, scale, subject placement, and framing; it is not ground-truth street imagery.',
    'The SECOND input image, if present, shows the isolated original subject. Retain its identity, geometry, materials, outfit, and color as closely as possible.',
    reference ? 'The THIRD image is a user-provided location reference. Use its visible lighting, architecture and materials to improve realism when consistent with the main composition.' : '',
    subjectType === 'product' ? 'Preserve the product silhouette, materials and any visible labels; do not invent replacement branding.' : 'Preserve the person’s face, hairstyle, proportions, and clothing; do not substitute a different person.',
    'Use physically plausible illumination, shadows, atmospheric depth and contact with the ground. Keep the intended camera perspective consistent.',
    'The geographic coordinate is contextual metadata, not photographic proof. Avoid fabricating specific readable signage or claiming factual accuracy of unobserved details.',
    'WGS84 latitude ' + location.lat.toFixed(6) + ', longitude ' + location.lon.toFixed(6) + '. Location context: urban nighttime environment.',
    description ? 'Additional art direction (lower priority than subject fidelity and framing): ' + description : '',
    'Deliver a single polished photo with no user-interface overlays, captions, borders or explanatory text.'
  ].filter(Boolean).join('\n');
}

export async function renderWithProvider(body, { apiKey, model = 'gpt-image-2.5-flare', fetcher = fetch } = {}) {
  if (!ALLOWED_MODELS.has(model)) throw Object.assign(new Error('サーバーの画像モデル設定が不正です。'), { status: 500 });
  const input = normalizeRequest(body);
  const multipart = new FormData();
  multipart.set('model', model);
  multipart.set('prompt', buildPrompt(input));
  multipart.set('size', '1536x864');
  multipart.set('quality', 'medium');
  multipart.set('output_format', 'webp');
  multipart.set('output_compression', '80');
  multipart.set('n', '1');
  multipart.append('image[]', new Blob([input.scene.bytes], { type: input.scene.mime }), 'composition.' + input.scene.extension);
  if (input.subject) multipart.append('image[]', new Blob([input.subject.bytes], { type: input.subject.mime }), 'subject.' + input.subject.extension);
  if (input.reference) multipart.append('image[]', new Blob([input.reference.bytes], { type: input.reference.mime }), 'location-reference.' + input.reference.extension);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 105_000);
  try {
    const response = await fetcher('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: multipart,
      signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok) {
      const detail = String(result?.error?.message || 'image API error').slice(0, 300);
      const mapped = response.status === 429 ? 429 : 502;
      throw Object.assign(new Error('画像生成API: ' + detail), { status: mapped });
    }
    const image = result?.data?.[0]?.b64_json;
    if (typeof image !== 'string' || image.length < 100) {
      throw Object.assign(new Error('画像生成APIから画像データが返りませんでした。'), { status: 502 });
    }
    return {
      image: 'data:image/webp;base64,' + image,
      model,
      isSynthetic: true,
      location: input.location,
      output: { width: 1536, height: 864, format: 'webp' },
      attribution: 'Derived from scene © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors',
      notice: '生成画像であり、現地で撮影した記録ではありません。地理的忠実性や被写体の同一性は保証されません。'
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'POSTのみ対応します。' });
  const apiKey = process.env.OPENAI_API_KEY;
  const passcode = process.env.APP_ACCESS_TOKEN;
  if (!apiKey || !passcode || passcode.length < 16) return reply(res, 503, { error: '生成AIは未設定です。管理者がAPIキーと16文字以上のアクセスコードを登録してください。' });
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return reply(res, 403, { error: 'この送信元は許可されていません。' });
    } catch { return reply(res, 403, { error: '送信元が不正です。' }); }
  }
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ') || !constantTimeEqual(auth.slice(7), passcode)) {
    return reply(res, 401, { error: 'アクセスコードが一致しません。' });
  }
  try {
    const body = await getBody(req);
    const output = await renderWithProvider(body, {
      apiKey,
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare'
    });
    return reply(res, 200, output);
  } catch (error) {
    const status = error.status || (error.name === 'AbortError' ? 504 : error instanceof SyntaxError ? 400 : 500);
    console.error('render error', { status, name: error.name });
    return reply(res, status, { error: status >= 500 && status !== 502 && status !== 503 && status !== 504 ? 'サーバーでエラーが発生しました。' : error.message });
  }
}
