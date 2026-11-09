import {
  PRESETS, CAPTURE, parseLocation, normalizePlacement, photoRect,
  isSupportedImage, sceneSnapshot
} from "./core.mjs";
import {
  parseGoogleMapsLocation, googleMapsPlaceUrl, googleMapsStreetViewUrl, coverSourceRect
} from "./location.mjs";
import {
  commonsGeoSearchUrl, filterPublicDomainCommonsImages, isTrustedCommonsImageUrl
} from "./commons.mjs";
import {
  studioSettings, subjectCssFilter, contactShadowGeometry, drawSubjectWithShadow
} from "./compositor.mjs";
import { normalizeHeading } from "./scenes.mjs";
import { validPanoramaxId } from "./panoramax.mjs";
import { createDepthController } from "./depth-ui.mjs";

const $ = id => document.getElementById(id);
const stage = $("stage");
const actor = $("subjectHandle");
const actorImg = $("subjectImage");
const initial = PRESETS[0];

let map = null;
let mapLoaded = false;
let mapIdle = false;
let subjectType = "person";
let placement = normalizePlacement();
let lastObjectUrl = null;
let originalUploadUrl = null;
let subjectRevision = 0;
let cutoutBusy = false;
let exposure = 1;
let dragging = null;
let studio = studioSettings();
let backgroundMode = "map";
let photoObjectUrl = null;
let photoLoaded = false;
let photoFile = null;
let photoSourcePageUrl = null;
let selectedSceneEvidence = null;
let sceneSearchSequence = 0;
let backgroundRevision = 0;

function resetSceneEvidence() {
  selectedSceneEvidence = null;
  $("sceneSelected").hidden = true;
}
function sceneSearchStale() {
  const status = $("sceneGroundingStatus");
  if (status && !status.textContent.startsWith("未検索")) {
    status.textContent = "地点または方位が変わりました。実景を再検索してください。";
  }
}

function photoActive() {
  return backgroundMode === "photo" && photoLoaded;
}
function subjectReady() {
  return Boolean(actorImg.complete && actorImg.naturalWidth > 0);
}
function canCapture() {
  const legalConfirmation = !selectedSceneEvidence?.requiresShareAlike || $("mapillaryShareAlike").checked;
  const backgroundReady = photoActive()
    ? $("photoRights").checked && legalConfirmation
    : mapLoaded && mapIdle;
  return subjectReady() && backgroundReady;
}
function updateCaptureAvailability() {
  $("shutter").disabled = !canCapture();
}

function setBackgroundMode(mode) {
  if (mode !== "map" && mode !== "photo") throw new Error("不明な撮影モードです。");
  if (mode === "photo" && !photoLoaded) {
    notice("先に利用許諾のある現地写真を読み込んでください。", true);
    return;
  }
  backgroundMode = mode;
  stage.dataset.mode = mode;
  $("locationPhoto").hidden = true;
  $("photoCanvas").hidden = mode !== "photo";
  for (const id of ["photoZoom", "photoFocusX", "photoFocusY"]) {
    $(id).disabled = !photoLoaded;
  }
  $("mapMode").classList.toggle("selected", mode === "map");
  $("photoMode").classList.toggle("selected", mode === "photo");
  $("mapMode").setAttribute("aria-pressed", String(mode === "map"));
  $("photoMode").setAttribute("aria-pressed", String(mode === "photo"));
  $("viewHelp").textContent = mode === "photo"
    ? "現地写真の上で被写体をドラッグ ／ 地図で地点を変更しても背景写真は自動更新されません"
    : "被写体をドラッグして配置 ／ 背景をドラッグして視点変更";
  $("sceneLabel").textContent = "SYNTHETIC COMPOSITE · NOT AN ON-SITE PHOTOGRAPH";
  $("mapState").textContent = mode === "photo" ? "実景写真モード / 合成撮影" : (mapLoaded ? "3D地図" : "地図に接続中");
  updateCaptureAvailability();
  if (mode === "photo") renderPhotoPreview();
  else depthController.render();
}

function renderSceneBackground(ctx, width, height) {
  // This draw operation owns the background pixels. A licensed photograph is
  // never loaded from Google Maps URLs, only from a user-selected local file.
  ctx.save();
  ctx.filter = "brightness(" + exposure + ") saturate(1.1)";
  if (photoActive()) {
    const img = $("locationPhoto");
    const r = coverSourceRect(
      img.naturalWidth, img.naturalHeight, width, height,
      studio.photoFocusX, studio.photoFocusY, studio.photoZoom
    );
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, width, height);
  } else {
    if (!map || !mapLoaded) throw new Error("地図がまだ読み込まれていません。");
    ctx.drawImage(map.getCanvas(), 0, 0, width, height);
  }
  ctx.restore();
  if (!photoActive()) {
    const grade = ctx.createLinearGradient(0, 0, 0, height);
    grade.addColorStop(0, "rgba(4,9,29,.16)");
    grade.addColorStop(0.6, "rgba(4,9,29,.02)");
    grade.addColorStop(1, "rgba(10,8,25,.10)");
    ctx.fillStyle = grade;
    ctx.fillRect(0, 0, width, height);
  }
}
function renderPhotoPreview() {
  if (!photoActive()) return;
  const canvas = $("photoCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    notice("現地写真のプレビューCanvasを利用できません。", true);
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderSceneBackground(ctx, canvas.width, canvas.height);
  depthController.render();
}

function sourceAttribution() {
  return photoActive()
    ? "Background: " + (String($("photoCredit").value || "").trim().replace(/[\r\n]/g, " ").slice(0, 70) || "user-supplied licensed photograph")
    : "Map © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors";
}


function notice(text, error = false) {
  const el = $("message");
  el.textContent = text;
  el.classList.toggle("error", error);
}
function setMapStatus(text) { $("mapState").textContent = text; }
function setMapOverlay(text, error = false) {
  const el = $("loadingOverlay");
  el.hidden = false;
  el.classList.toggle("error", error);
  el.querySelector("strong").textContent = text;
  el.querySelector("p").textContent = error
    ? "ネットワーク接続とWebGLの利用可否を確認してください。"
    : "MapLibre GL JS + OpenFreeMap";
}
function setPosition() {
  placement = normalizePlacement(placement);
  actor.style.left = (placement.x * 100) + "%";
  actor.style.top = (placement.y * 100) + "%";
  actor.style.width = (placement.widthRatio * 100) + "%";
  $("subjectScale").value = String(Math.round(placement.widthRatio * 100));
  $("scaleValue").textContent = Math.round(placement.widthRatio * 100) + "%";
  updateSubjectAppearance();
}

function updateSubjectAppearance() {
  actor.style.setProperty("--subject-filter", subjectCssFilter(studio));
  const overlay = $("contactShadow");
  if (!actorImg.complete || !(actorImg.naturalWidth > 0) || !(actorImg.naturalHeight > 0) || !studio.contactShadow) {
    overlay.hidden = true;
    return;
  }
  const g = contactShadowGeometry(
    actorImg.naturalWidth, actorImg.naturalHeight, placement,
    CAPTURE.width, CAPTURE.height, studio
  );
  overlay.hidden = false;
  overlay.style.left = (g.centerX / CAPTURE.width * 100) + "%";
  overlay.style.top = (g.centerY / CAPTURE.height * 100) + "%";
  overlay.style.width = (g.radiusX * 2 / CAPTURE.width * 100) + "%";
  overlay.style.height = (g.radiusY * 2 / CAPTURE.height * 100) + "%";
  overlay.style.filter = "blur(" + (g.blur / CAPTURE.width * (stage.clientWidth || CAPTURE.width)).toFixed(1) + "px)";
  overlay.style.background = "rgba(4,8,18," + g.opacity.toFixed(3) + ")";
}

function syncStudioInputs() {
  const pairs = [
    ["subjectLight", studio.subjectExposure],
    ["subjectWarmth", studio.subjectWarmth],
    ["shadowStrength", studio.contactShadow],
    ["photoZoom", studio.photoZoom],
    ["photoFocusX", studio.photoFocusX],
    ["photoFocusY", studio.photoFocusY]
  ];
  for (const [id, value] of pairs) {
    const percent = Math.round(value * 100);
    $(id).value = String(percent);
    $(id + "Value").textContent = percent + "%";
  }
  updateSubjectAppearance();
  renderPhotoPreview();
}

function updateStudioControl(id, key, divisor, outputSuffix) {
  const value = Number($(id).value);
  studio = studioSettings({ ...studio, [key]: value / divisor });
  $(id + "Value").textContent = outputSuffix(value);
  if (id === "photoZoom" || id === "photoFocusX" || id === "photoFocusY") {
    depthController.reset("背景の切り取りを変更したため前景マスクを解除しました。");
    renderPhotoPreview();
  }
  updateSubjectAppearance();
}

function setExposure(value) {
  exposure = Math.min(1.4, Math.max(0.5, Number(value) / 100));
  stage.style.setProperty("--scene-brightness", String(exposure));
  $("exposureValue").textContent = Math.round(exposure * 100) + "%";
  renderPhotoPreview();
}

// These sample SVGs are intentionally illustrations, not photographic assets.
function personSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="700" viewBox="0 0 350 700">
  <defs><linearGradient id="j" x1="0" x2="1"><stop stop-color="#456072"/><stop offset=".5" stop-color="#1b283a"/><stop offset="1" stop-color="#4c6074"/></linearGradient>
  <linearGradient id="p" x1="0" x2="1"><stop stop-color="#222c3f"/><stop offset="1" stop-color="#0b1424"/></linearGradient>
  <linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ddb4a0"/><stop offset="1" stop-color="#997363"/></linearGradient></defs>
  <ellipse cx="177" cy="686" rx="92" ry="12" fill="#000" opacity=".30"/>
  <path d="M120 402L114 615L102 669Q104 686 135 684L155 665L174 476L195 666L214 684Q244 684 246 670L237 614L231 402Z" fill="url(#p)"/>
  <path d="M105 659Q135 650 145 663L147 679Q130 693 96 683Z" fill="#e4e8eb"/>
  <path d="M210 663Q228 650 247 662L256 681Q224 693 208 680Z" fill="#e4e8eb"/>
  <path d="M122 203Q144 184 177 183Q217 184 235 206L267 420L218 449L128 448L84 421Z" fill="url(#j)"/>
  <path d="M124 224L106 289L83 425L105 443L151 315Z" fill="#26374b"/>
  <path d="M233 222L256 295L283 428L261 443L205 313Z" fill="#2a3e53"/>
  <path d="M93 422Q89 444 105 460Q121 459 127 440L105 419Z" fill="url(#s)"/>
  <path d="M260 417Q254 441 261 458Q281 461 287 440L282 420Z" fill="url(#s)"/>
  <path d="M156 161L157 211Q177 229 194 209L195 159Z" fill="url(#s)"/>
  <ellipse cx="175" cy="106" rx="52" ry="67" fill="url(#s)"/>
  <path d="M121 91Q114 43 152 29Q207 6 230 71L224 124L210 98L209 67Q173 78 137 64L134 111Z" fill="#1c222e"/>
  <path d="M148 118Q156 121 162 118M185 117Q192 121 198 117" stroke="#493d3e" stroke-width="4" stroke-linecap="round" fill="none"/>
  <path d="M168 144Q177 148 185 142" stroke="#885a5b" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M172 198L175 398" stroke="#60788c" stroke-width="3" opacity=".6"/>
  </svg>`;
}
function productSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="700" viewBox="0 0 350 700">
  <defs><linearGradient id="b" x1="0" x2="1"><stop stop-color="#142a36"/><stop offset=".28" stop-color="#436a78"/><stop offset=".7" stop-color="#132d3c"/><stop offset="1" stop-color="#0e202c"/></linearGradient>
  <linearGradient id="l" x1="0" x2="1"><stop stop-color="#f8e9d4"/><stop offset=".5" stop-color="#fffdf4"/><stop offset="1" stop-color="#d7c3a8"/></linearGradient></defs>
  <ellipse cx="175" cy="673" rx="105" ry="13" fill="#000" opacity=".25"/>
  <rect x="145" y="64" width="60" height="96" rx="7" fill="#b7b0a2"/>
  <rect x="134" y="48" width="82" height="46" rx="7" fill="#1e2d38"/>
  <rect x="121" y="80" width="108" height="9" fill="#56717e" opacity=".7"/>
  <path d="M145 149L135 192Q84 223 83 286L83 585Q83 640 135 646L214 646Q267 639 267 585L267 286Q267 223 216 192L205 149Z" fill="url(#b)" stroke="#90a8af" stroke-width="3"/>
  <rect x="102" y="332" width="148" height="207" rx="5" fill="url(#l)"/>
  <path d="M102 377L250 377" stroke="#b6a890" stroke-width="2"/>
  <text x="176" y="414" fill="#26343b" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" letter-spacing="5">WORLD</text>
  <text x="176" y="454" fill="#182935" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="bold" letter-spacing="2">STUDIO</text>
  <text x="176" y="490" fill="#6b7373" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" letter-spacing="3">NO. 01</text>
  <path d="M109 261Q113 211 148 197" fill="none" stroke="#c0d2dc" stroke-width="6" stroke-linecap="round" opacity=".3"/>
  </svg>`;
}
function dataSvg(svg) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
function updateSampleButtons(active) {
  for (const [key, id] of [["person", "samplePerson"], ["product", "sampleProduct"]]) {
    const selected = key === active;
    $(id).classList.toggle("selected", selected);
    $(id).setAttribute("aria-pressed", String(selected));
  }
}
function setSubject(source, kind) {
  actorImg.onload = () => {
    actor.hidden = false;
    updateSubjectAppearance();
    updateCaptureAvailability();
    notice("被写体を読み込みました。ドラッグで配置できます。");
  };
  actorImg.onerror = () => {
    actor.hidden = true;
    $("contactShadow").hidden = true;
    updateCaptureAvailability();
    notice("画像を読み込めませんでした。別のPNG/JPEG/WebPを選んでください。", true);
  };
  subjectType = kind;
  updateSampleButtons(kind);
  actorImg.src = source;
}
function useSample(kind) {
  subjectRevision++;
  originalUploadUrl = null;
  $("cutoutPerson").disabled = true;
  $("restorePerson").disabled = true;
  $("cutoutStatus").textContent = "サンプル画像には切り抜きは不要です。自分の人物写真を読み込んでください。";
  if (lastObjectUrl) { URL.revokeObjectURL(lastObjectUrl); lastObjectUrl = null; }
  setSubject(dataSvg(kind === "person" ? personSvg() : productSvg()), kind);
  $("aiSubjectKind").value = kind;
}

async function removePersonBackground() {
  if (!originalUploadUrl || cutoutBusy) {
    notice("人物の写真をアップロードしてから実行してください。", true);
    return;
  }
  const url = originalUploadUrl;
  const revision = subjectRevision;
  cutoutBusy = true;
  $("cutoutPerson").disabled = true;
  $("restorePerson").disabled = true;
  $("cutoutStatus").textContent = "人物領域を端末内で推定しています。初回はモデルをダウンロードします。";
  try {
    const img = new Image();
    img.src = url;
    if (typeof img.decode === "function") await img.decode();
    else await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("元画像を開けませんでした。"));
    });
    const { segmentPerson } = await import("./cutout.mjs");
    const cutout = await segmentPerson(img);
    if (revision !== subjectRevision || originalUploadUrl !== url) return;
    setSubject(cutout, "uploaded");
    $("restorePerson").disabled = false;
    $("cutoutStatus").textContent = "人物の背景を切り抜きました。髪・手足・透明部分の境界を確認してください。";
  } catch (error) {
    if (revision !== subjectRevision) return;
    $("cutoutStatus").textContent = "自動切り抜きに失敗しました。元の画像は保持しています。背景透過PNGも利用できます。";
    notice("切り抜き失敗：" + error.message, true);
  } finally {
    cutoutBusy = false;
    $("cutoutPerson").disabled = !originalUploadUrl;
  }
}

function restorePersonOriginal() {
  if (!originalUploadUrl) return;
  subjectRevision++;
  setSubject(originalUploadUrl, "uploaded");
  $("restorePerson").disabled = true;
  $("cutoutStatus").textContent = "元のアップロード写真に戻しました。";
}

function loadPreset(id) {
  const p = PRESETS.find(item => item.id === id);
  if (!p) return;
  $("latitude").value = String(p.lat);
  $("longitude").value = String(p.lon);
  $("zoom").value = String(p.zoom);
  $("pitch").value = String(p.pitch);
  $("bearing").value = String(p.bearing);
  updateCameraOutputs();
  moveCamera();
}
function cameraInputs() {
  return {
    ...parseLocation($("latitude").value, $("longitude").value),
    zoom: Number($("zoom").value),
    pitch: Number($("pitch").value),
    bearing: Number($("bearing").value)
  };
}
function updateCameraOutputs() {
  $("zoomValue").textContent = Number($("zoom").value).toFixed(1);
  $("pitchValue").textContent = Math.round(Number($("pitch").value)) + "°";
  $("bearingValue").textContent = Math.round(Number($("bearing").value)) + "°";
}
function moveCamera() {
  let c;
  try { c = cameraInputs(); }
  catch (error) { notice(error.message, true); $("latitude").focus(); return; }
  if (Math.abs(c.lat) > 85.0511) {
    notice("このWeb地図では北緯・南緯85.0511°を超える地域は表示できません。", true);
    return;
  }
  if (!map) {
    notice("撮影座標を設定しました。地図がつながると反映されます。現地写真の撮影地点は自動では照合しません。");
    return;
  }
  sceneSearchStale();
  map.flyTo({
    center: [c.lon, c.lat],
    zoom: c.zoom,
    pitch: c.pitch,
    bearing: c.bearing,
    duration: 1000,
    essential: true
  });
  notice("座標を変更しました。現地写真を使う場合は、その写真の場所との一致を確認してください。");
}
function syncCameraFromMap() {
  if (!map) return;
  const c = map.getCenter();
  $("latitude").value = c.lat.toFixed(6);
  $("longitude").value = c.lng.toFixed(6);
  $("zoom").value = String(Math.round(map.getZoom() * 10) / 10);
  $("pitch").value = String(Math.round(map.getPitch()));
  $("bearing").value = String(Math.round(map.getBearing()));
  updateCameraOutputs();
}

function add3DBuildings() {
  // Recipe and field names follow the MapLibre official OpenFreeMap example.
  if (!map.getSource("openfreemap-world")) {
    map.addSource("openfreemap-world", {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet"
    });
  }
  const firstLabel = map.getStyle().layers.find(
    layer => layer.type === "symbol" && layer.layout && layer.layout["text-field"]
  )?.id;
  if (map.getLayer("world-buildings-3d")) return;
  map.addLayer({
    id: "world-buildings-3d",
    type: "fill-extrusion",
    source: "openfreemap-world",
    "source-layer": "building",
    filter: ["!=", ["get", "hide_3d"], true],
    minzoom: 13,
    paint: {
      "fill-extrusion-color": "#6a839c",
      "fill-extrusion-opacity": 0.84,
      "fill-extrusion-height": [
        "interpolate", ["linear"], ["zoom"],
        13, 0, 14, ["coalesce", ["get", "render_height"], 0]
      ],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0]
    }
  }, firstLabel);
}

async function loadMapLibreEngine() {
  if (window.maplibregl?.Map) return window.maplibregl;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/maplibre-gl@5.17.0/dist/maplibre-gl.js";
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (window.maplibregl?.Map) resolve(window.maplibregl);
      else reject(new Error("MapLibreの初期化に失敗しました。"));
    };
    script.onerror = () => reject(new Error("MapLibreのCDNを読み込めませんでした。"));
    document.head.appendChild(script);
  });
}

async function connectWorld() {
  setMapOverlay("3D地図エンジンを読み込み中…");
  try {
    // MapLibre 6 ESM workers failed to initialize in real Chromium testing.
    // Use the pinned 5.17 UMD build with its integrated worker for the
    // zero-bundler, static-hosted camera. Loading remains optional: photo mode
    // still operates if the CDN is unreachable.
    const maplibregl = await loadMapLibreEngine();
    if (typeof maplibregl.supported === "function" && !maplibregl.supported()) {
      throw new Error("このブラウザではWebGLを利用できません。");
    }
    const c = cameraInputs();
    map = new maplibregl.Map({
      container: "map",
      style: "https://tiles.openfreemap.org/styles/dark",
      center: [c.lon, c.lat],
      zoom: c.zoom,
      pitch: c.pitch,
      bearing: c.bearing,
      minZoom: 1,
      maxZoom: 22,
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
      attributionControl: true
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.on("movestart", () => { mapIdle = false; updateCaptureAvailability(); });
    map.on("moveend", () => {
      syncCameraFromMap();
      sceneSearchStale();
    });
    map.on("error", ev => {
      const detail = ev?.error?.message || "地図タイルの取得に失敗しました。";
      console.warn("MapLibre:", detail);
      notice("地図データの一部を取得できませんでした。ネットワークを確認してください。", true);
    });
    map.on("load", () => {
      mapLoaded = true;
      try { add3DBuildings(); }
      catch (error) { notice("3D建物の取得に失敗しました。地図の表示は続行できます。", true); console.warn(error); }
      $("loadingOverlay").hidden = true;
      if (backgroundMode === "map") setMapStatus("地図に接続しました");
    });
    map.on("idle", () => {
      mapIdle = true;
      if (mapLoaded) {
        updateCaptureAvailability();
        if (backgroundMode === "map") {
          setMapStatus("撮影可能 / 3D MAP");
          notice("位置データを表示しました。背景は3D地図であり実写写真ではありません。");
        }
      }
    });
  } catch (error) {
    setMapStatus("地図接続エラー");
    setMapOverlay("地図を表示できませんでした", true);
    notice(error?.message || "地図エンジンを読み込めません。", true);
  }
}

function waitForMapIdle(timeout = 12000) {
  if (!map || !mapLoaded) return Promise.reject(new Error("地図の初期化が完了していません。"));
  if (mapIdle && !map.isMoving()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      map.off("idle", ready);
      reject(new Error("地図の描画が完了しませんでした。ネット接続を確認して再試行してください。"));
    }, timeout);
    function ready() {
      clearTimeout(timer);
      resolve();
    }
    map.once("idle", ready);
  });
}

function currentCamera() {
  if (map) {
    const c = map.getCenter();
    return { lat: c.lat, lon: c.lng, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  }
  return cameraInputs();
}
function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}
function dateStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function takePhoto() {
  const btn = $("shutter");
  btn.disabled = true;
  notice("撮影データを合成しています…");
  try {
    if (!photoActive()) await waitForMapIdle();
    if (!canCapture()) throw new Error("背景と被写体の準備が完了していません。");
    const output = document.createElement("canvas");
    output.width = CAPTURE.width;
    output.height = CAPTURE.height;
    const ctx = output.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2Dを初期化できません。");

    renderSceneBackground(ctx, CAPTURE.width, CAPTURE.height);

    drawSubjectWithShadow(ctx, actorImg, placement, CAPTURE.width, CAPTURE.height, studio);
    depthController.drawOverSubject(ctx, CAPTURE.width, CAPTURE.height);

    // Explicit synthetic disclosure and correct per-source attribution in pixels.
    const hasStreetLicense = ["mapillary","panoramax"].includes(selectedSceneEvidence?.provider);
    ctx.fillStyle = "rgba(8,15,27,.85)";
    ctx.fillRect(0, CAPTURE.height - (hasStreetLicense ? 76 : 52), CAPTURE.width, hasStreetLicense ? 76 : 52);
    if (hasStreetLicense) {
      ctx.fillStyle = "#f5f7fb";
      ctx.textAlign = "right";
      ctx.font = "13px system-ui,sans-serif";
      const original = selectedSceneEvidence.provider === "mapillary"
        ? "mapillary.com/app/?pKey=" + selectedSceneEvidence.id
        : "api.panoramax.xyz/#focus=pic&pic=" + selectedSceneEvidence.id;
      const date = selectedSceneEvidence.licenseSpdx === "etalab-2.0" && selectedSceneEvidence.lastUpdated
        ? " · updated " + selectedSceneEvidence.lastUpdated : "";
      ctx.fillText(selectedSceneEvidence.license + date + " · modified street image · " + original,
        CAPTURE.width - 24, CAPTURE.height - 51);
    }
    ctx.fillStyle = "#f5f7fb";
    ctx.font = "600 16px system-ui,sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("VIRTUAL LOCATION CAMERA · SYNTHETIC COMPOSITE", 24, CAPTURE.height - 18);
    ctx.textAlign = "right";
    ctx.font = "14px system-ui,sans-serif";
    ctx.fillText(sourceAttribution(), CAPTURE.width - 24, CAPTURE.height - 18);

    const blob = await new Promise((resolve, reject) => {
      try { output.toBlob(value => value ? resolve(value) : reject(new Error("PNG出力に失敗しました。")), "image/png"); }
      catch (error) { reject(error); }
    });
    downloadBlob(blob, "virtual-location-camera-" + dateStamp() + ".png");
    notice("1600×900の合成写真を保存しました。現地撮影の証明画像ではありません。");
  } catch (error) {
    console.error("capture error", error);
    notice("撮影できませんでした：" + (error.message || String(error)), true);
  } finally {
    updateCaptureAvailability();
  }
}

function exportScene() {
  try {
    const snapshot = sceneSnapshot(currentCamera(), placement, subjectType);
    snapshot.background = {
      mode: photoActive() ? "user-photo" : "map",
      imageIncluded: false,
      locationVerified: false,
      filePage: photoActive() ? photoSourcePageUrl : null,
      evidence: photoActive() ? selectedSceneEvidence : null,
      photoZoom: studio.photoZoom,
      photoFocusX: studio.photoFocusX,
      photoFocusY: studio.photoFocusY,
      exposure
    };
    snapshot.occlusion = depthController.snapshot();
    snapshot.compositing = {
      subjectExposure: studio.subjectExposure,
      subjectWarmth: studio.subjectWarmth,
      contactShadow: studio.contactShadow,
      shadowSoftness: studio.shadowSoftness
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    downloadBlob(blob, "virtual-location-scene-" + dateStamp() + ".json");
    notice("撮影条件をJSONで保存しました。アップロード画像本体は含まれません。");
  } catch (error) { notice(error.message, true); }
}


async function importScene(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 200_000) throw new Error("撮影条件ファイルは200KB以下にしてください。");
    const scene = JSON.parse(await file.text());
    if (scene?.schemaVersion !== 1 || !scene.scene || !scene.subject) {
      throw new Error("対応していない撮影条件ファイルです。");
    }
    const coordinates = parseLocation(scene.scene.lat, scene.scene.lon);
    const camera = {
      ...coordinates, zoom: Number(scene.scene.zoom),
      pitch: Number(scene.scene.pitch), bearing: Number(scene.scene.bearing)
    };
    if (!Number.isFinite(camera.zoom) || camera.zoom < 1 || camera.zoom > 22
      || !Number.isFinite(camera.pitch) || camera.pitch < 0 || camera.pitch > 85
      || !Number.isFinite(camera.bearing) || camera.bearing < -180 || camera.bearing > 180) {
      throw new Error("撮影条件のカメラ設定が不正です。");
    }
    placement = normalizePlacement(scene.subject);
    depthController.reset("前景マスクはJSONに含まれません。深度PNGを再読み込みするか塗り直してください。");
    const bg = scene.background && typeof scene.background === "object" ? scene.background : {};
    const comp = scene.compositing && typeof scene.compositing === "object" ? scene.compositing : {};
    studio = studioSettings({
      ...studio,
      subjectExposure: comp.subjectExposure,
      subjectWarmth: comp.subjectWarmth,
      contactShadow: comp.contactShadow,
      shadowSoftness: comp.shadowSoftness,
      photoZoom: bg.photoZoom,
      photoFocusX: bg.photoFocusX,
      photoFocusY: bg.photoFocusY
    });
    const importedExposure = Number(bg.exposure);
    $("exposure").value = String(Math.round((Number.isFinite(importedExposure) && importedExposure >= 0.5 && importedExposure <= 1.4 ? importedExposure : 1) * 100));
    setExposure($("exposure").value);
    syncStudioInputs();
    setPosition();
    $("preset").value = "custom";
    $("latitude").value = String(camera.lat);
    $("longitude").value = String(camera.lon);
    $("zoom").value = String(camera.zoom);
    $("pitch").value = String(camera.pitch);
    $("bearing").value = String(camera.bearing);
    updateCameraOutputs();
    if (scene.subject.type === "person" || scene.subject.type === "product") {
      useSample(scene.subject.type);
      $("aiSubjectKind").value = scene.subject.type;
    }
    moveCamera();
    if (scene.background?.mode === "user-photo") {
      if (photoLoaded) setBackgroundMode("photo");
      else notice("撮影条件を復元しました。背景写真はJSONに含まれないため、再度アップロードしてください。", true);
    } else {
      setBackgroundMode("map");
      notice("撮影条件を復元しました。元画像ファイルはJSONに含まれません。");
    }
  } catch (error) {
    notice("撮影条件を読み込めません：" + error.message, true);
  } finally {
    event.target.value = "";
  }
}


function openGoogleMapsView(mode = "map") {
  try {
    const point = cameraInputs();
    const target = mode === "street"
      ? googleMapsStreetViewUrl(point.lat, point.lon)
      : googleMapsPlaceUrl(point.lat, point.lon);
    const opened = window.open(target, "_blank", "noopener,noreferrer");
    // Some browsers return null for noopener windows even when opening works.
    if (opened === null) notice("Google Mapsを別タブで開きます。ブラウザでポップアップを許可してください。");
  } catch (error) { notice("Google Mapsを開けません：" + error.message, true); }
}

function importGoogleLocation() {
  try {
    const result = parseGoogleMapsLocation($("googleMapsUrl").value);
    $("latitude").value = result.lat.toFixed(6);
    $("longitude").value = result.lon.toFixed(6);
    $("preset").value = "custom";
    moveCamera();
    const qualified = result.kind === "viewport-center"
      ? "このURLの座標は地図の表示中心で、写真の撮影位置とは限りません。"
      : "取り込んだ位置と背景写真が一致しているか確認してください。";
    notice("Google MapsのURLから座標を取り込みました。" + qualified);
  } catch (error) { notice("URLを読み込めません：" + error.message, true); }
}

function installLocationPhoto(file, credit = "", sourcePage = null, evidence = null) {
  const candidate = URL.createObjectURL(file);
  const img = $("locationPhoto");
  img.onload = () => {
    if (img.naturalWidth * img.naturalHeight > 35_000_000) {
      URL.revokeObjectURL(candidate);
      img.removeAttribute("src");
      photoLoaded = false;
      photoFile = null;
      $("clearPhoto").disabled = true;
      setBackgroundMode("map");
      notice("背景写真は3500万画素以下にしてください。", true);
      return;
    }
    if (photoObjectUrl && photoObjectUrl !== candidate) URL.revokeObjectURL(photoObjectUrl);
    const replacingCommonsPhoto = Boolean(photoSourcePageUrl);
    photoObjectUrl = candidate;
    photoFile = file;
    photoSourcePageUrl = sourcePage;
    photoLoaded = true;
    backgroundRevision++;
    depthController.reset("写真を切り替えたため前景マスクを解除しました。");
    selectedSceneEvidence = evidence ? { ...evidence, exactViewVerified: false } : null;
    if (evidence) {
      $("sceneSelected").hidden = false;
      $("sceneSelectedTitle").textContent = "背景画像の根拠：実景データ";
      const distance = evidence.distanceM == null ? "距離不明" : evidence.distanceM + " m";
      const direction = evidence.headingDifference == null ? "撮影方向不明" : "方位差 " + evidence.headingDifference + "°";
      $("sceneSelectedDescription").textContent = [
        evidence.provider, distance, direction, evidence.captureDate || "日時不明",
        "完全なカメラ一致は未検証"
      ].join(" / ");
      $("sceneSelectedSource").href = sourcePage || "#";
    } else resetSceneEvidence();
    if (credit) $("photoCredit").value = credit.slice(0, 70);
    else if (replacingCommonsPhoto) $("photoCredit").value = "";
    $("photoStatus").textContent = "背景写真：" + file.name + "。地図上の地点との一致は手動で確認してください。";
    $("clearPhoto").disabled = false;
    setBackgroundMode("photo");
    notice("実在の場所の写真を背景に設定しました。地図の読み込みに依存せず合成できます。");
  };
  img.onerror = () => {
    URL.revokeObjectURL(candidate);
    photoLoaded = false;
    photoFile = null;
    photoSourcePageUrl = null;
    $("clearPhoto").disabled = true;
    setBackgroundMode("map");
    notice("背景写真を読み込めませんでした。別の画像を選んでください。", true);
  };
  img.src = candidate;
}

function onPhotoUpload(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!$("photoRights").checked) {
    notice("写真を合成に使う権利があることを確認してチェックしてください。", true);
    return;
  }
  if (!isSupportedImage(file)) {
    notice("現地写真はPNG・JPEG・WebP、15MB以下にしてください。", true);
    return;
  }
  installLocationPhoto(file);
}

function clearLocationPhoto() {
  const img = $("locationPhoto");
  img.onload = null;
  img.onerror = null;
  img.removeAttribute("src");
  if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
  photoObjectUrl = null;
  photoFile = null;
  photoSourcePageUrl = null;
  backgroundRevision++;
  depthController.reset("背景画像を解除したため前景マスクも解除しました。");
  resetSceneEvidence();
  photoLoaded = false;
  $("photoCredit").value = "";
  $("photoStatus").textContent = "写真は未設定です。利用権のある現地写真を選んでください。";
  $("clearPhoto").disabled = true;
  setBackgroundMode("map");
  notice("現地写真を解除しました。");
}


async function loadCommonsChoice(option) {
  if (!$("photoRights").checked) {
    notice("公開画像のファイルページで利用条件を確認し、写真の使用権チェックを入れてください。", true);
    return;
  }
  if (!isTrustedCommonsImageUrl(option.previewUrl)) {
    notice("画像の取得元がWikimediaではありません。", true);
    return;
  }
  try {
    $("commonsStatus").textContent = "Wikimedia Commonsの写真を取得しています…";
    const response = await fetch(option.previewUrl, {
      mode: "cors", credentials: "omit", redirect: "follow"
    });
    if (!response.ok) throw new Error("画像の取得に失敗しました。");
    const blob = await response.blob();
    if (!isSupportedImage({ type: blob.type, size: blob.size })) {
      throw new Error("この画像形式やファイルサイズは直接利用できません。");
    }
    const file = new File([blob], "commons-location-photo." + (blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg"), { type: blob.type });
    installLocationPhoto(file, option.credit, option.filePage, {
      provider: "wikimedia-commons",
      lat: option.lat, lon: option.lon,
      distanceM: option.distanceM,
      headingDifference: null,
      cameraHeading: null,
      captureDate: null,
      license: option.license,
      exactViewVerified: false
    });
    $("commonsStatus").textContent = "選択した公開写真を読み込みました。撮影方向が指定地点と一致するか確認してください。";
  } catch (error) {
    $("commonsStatus").textContent = "自動取得できませんでした。ファイルページから許諾条件を確認し、画像を手動で選択してください。";
    notice("周辺写真を読み込めません：" + error.message, true);
  }
}

async function searchCommonsPhotos() {
  const button = $("searchCommons");
  button.disabled = true;
  $("commonsStatus").textContent = "公開写真を検索しています…";
  try {
    const c = cameraInputs();
    const response = await fetch(commonsGeoSearchUrl(c.lat, c.lon), {
      cache: "no-store", credentials: "omit"
    });
    if (!response.ok) throw new Error("Wikimedia Commonsが応答しませんでした。");
    const data = await response.json();
    const items = filterPublicDomainCommonsImages(data, 8, c);
    const gallery = $("commonsResults");
    gallery.replaceChildren();
    gallery.hidden = items.length === 0;

    for (const item of items) {
      const card = document.createElement("div");
      card.className = "commons-card";
      const image = document.createElement("img");
      image.src = item.previewUrl;
      image.alt = item.name;
      image.loading = "lazy";
      const description = document.createElement("small");
      description.textContent = item.name + " / " + item.license;
      const link = document.createElement("a");
      link.href = item.filePage;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "撮影者とライセンスを確認 ↗";
      const choose = document.createElement("button");
      choose.type = "button";
      choose.textContent = "背景に使う";
      choose.addEventListener("click", () => loadCommonsChoice(item));
      card.append(image, description, link, choose);
      gallery.append(card);
    }
    $("commonsStatus").textContent = items.length
      ? "半径1km以内のCC0/パブリックドメイン表示画像 " + items.length + "件。現地の眺めと一致するとは限りません。使用前にファイルページを確認してください。"
      : "この地点の近くに自動利用候補がありません。自分の写真をアップロードしてください。";
  } catch (error) {
    $("commonsResults").hidden = true;
    $("commonsStatus").textContent = "周辺写真を取得できませんでした。ネット接続を確認するか、写真を手動で選択してください。";
    notice("周辺写真の検索に失敗：" + error.message, true);
  } finally {
    button.disabled = false;
  }
}


function makeSceneCard(candidate, kind) {
  const card = document.createElement("div");
  card.className = "scene-card";
  if (candidate.assessment === "near-position-and-heading") card.classList.add("nearest");
  const photo = document.createElement("img");
  photo.loading = "lazy";
  const isStreet = kind === "mapillary" || kind === "panoramax";
  photo.src = isStreet ? candidate.imageUrl : candidate.previewUrl;
  photo.alt = isStreet
    ? "実際に観測された位置付き街路写真" : "Wikimedia Commonsの付近の公開写真";
  const title = document.createElement("small");
  title.className = "status";
  title.textContent = isStreet
    ? (candidate.assessment === "near-position-and-heading"
      ? "位置・方位が近い実景" : "付近の実景（方向は要確認）")
    : "付近の写真（方位不明）";
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = isStreet
    ? [
        candidate.distanceM + " m",
        candidate.headingDifference == null ? "方位不明" : "方位差 " + candidate.headingDifference + "°",
        candidate.captureDate || "撮影日不明",
        candidate.imageType === "360" ? "360°撮影" : "通常撮影",
        candidate.creator,
        candidate.license
      ].join(" / ")
    : [candidate.name, candidate.license, candidate.distanceM == null ? "場所の厳密性不明" : candidate.distanceM + " m"].join(" / ");

  const link = document.createElement("a");
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "元画像と利用条件を確認 ↗";
  link.href = isStreet ? candidate.viewerUrl : candidate.filePage;

  const choose = document.createElement("button");
  choose.type = "button";
  choose.textContent = "撮影背景にする";
  choose.addEventListener("click", () => isStreet
    ? loadObservedScene(candidate)
    : loadCommonsChoice(candidate));
  card.append(photo, title, meta, link, choose);
  return card;
}

async function loadObservedScene(candidate) {
  const isMapillary = candidate.provider === "mapillary" && /^\d{1,20}$/.test(candidate.id);
  const isPanoramax = candidate.provider === "panoramax" && validPanoramaxId(candidate.id);
  if (!isMapillary && !isPanoramax) {
    notice("街路画像の識別子が不正です。", true); return;
  }
  const needsShareAlike = isMapillary || candidate.requiresShareAlike === true;
  if (!$("photoRights").checked || (needsShareAlike && !$("mapillaryShareAlike").checked)) {
    notice("街路画像の利用権とライセンスの改変・共有条件を確認してください。CC BY-SAの場合は共有条件への同意も必要です。", true);
    return;
  }
  try {
    $("sceneGroundingStatus").textContent = "指定した街路画像を読み込んでいます…";
    const selectedImageUrl = isPanoramax ? candidate.downloadUrl : candidate.imageUrl;
    const response = await fetch(selectedImageUrl, { credentials: "omit", cache: "no-store" });
    if (!response.ok) throw new Error("街路画像サーバーが利用できません。");
    const bytes = await response.blob();
    if (!isSupportedImage({ type: bytes.type, size: bytes.size })) {
      throw new Error("街路画像の形式またはサイズに問題があります。");
    }
    const ext = bytes.type === "image/png" ? "png" : bytes.type === "image/webp" ? "webp" : "jpg";
    const file = new File([bytes], candidate.provider + "-scene-" + candidate.id + "." + ext, { type: bytes.type });
    const evidence = {
      provider: candidate.provider, id: candidate.id,
      lat: candidate.lat, lon: candidate.lon,
      distanceM: candidate.distanceM,
      cameraHeading: candidate.cameraHeading,
      headingDifference: candidate.headingDifference,
      captureDate: candidate.captureDate,
      lastUpdated: candidate.lastUpdated || candidate.captureDate || null,
      license: candidate.license, licenseSpdx: candidate.licenseSpdx || "CC-BY-SA-4.0",
      licenseUrl: candidate.licenseUrl || "https://creativecommons.org/licenses/by-sa/4.0/",
      requiresShareAlike: needsShareAlike,
      exactViewVerified: false
    };
    installLocationPhoto(file, candidate.attribution, candidate.viewerUrl, evidence);
    $("sceneGroundingStatus").textContent = "街路画像を背景に設定しました。撮影位置・方向は参考値です。利用条件: "+candidate.license+"。";
  } catch (error) {
    $("sceneGroundingStatus").textContent = "画像の読み込みに失敗しました。地図、Wikimedia、または手元の写真を利用してください。";
    notice("街路画像を取得できません：" + error.message, true);
  }
}

async function findObservedScenes() {
  const button = $("findScenes");
  const cardArea = $("sceneResults");
  const status = $("sceneGroundingStatus");
  button.disabled = true;
  cardArea.replaceChildren();
  cardArea.hidden = true;
  status.textContent = "位置・撮影方向と実景画像の対応を検索中…";
  const requestId = ++sceneSearchSequence;
  try {
    const c = cameraInputs();
    const query = new URLSearchParams({
      lat: String(c.lat), lon: String(c.lon),
      heading: String(normalizeHeading(c.bearing)),
      radius: String($("sceneRadius").value)
    });
    const response = await fetch("./api/scenes?" + query.toString(), {
      credentials: "omit", cache: "no-store"
    });
    const result = await response.json();
    if (requestId !== sceneSearchSequence) return;
    if (!response.ok) throw new Error(result.error || "街路データの取得に失敗しました。");
    const images = Array.isArray(result.candidates) ? result.candidates : [];
    if (result.configured && images.length) {
      for (const item of images) cardArea.append(makeSceneCard(item, "mapillary"));
      cardArea.hidden = false;
      const nearby = images.filter(x => x.assessment === "near-position-and-heading").length;
      status.textContent = "街路画像 " + images.length + "件（位置・方向が近い候補 " + nearby + "件）。撮影位置と撮影方向は参考値です。";
      return;
    }

    // Keyless public street photos. Panoramax is a federated STAC catalog
    // with per-photo licensing (Etalab 2.0 / CC BY-SA 4.0); never assume all
    // global Panoramax imagery has the same licence.
    try {
      const panoRes = await fetch("./api/panoramax-scenes?" + query.toString(), {
        credentials: "omit", cache: "no-store"
      });
      if (panoRes.ok) {
        const panoData = await panoRes.json();
        if (requestId !== sceneSearchSequence) return;
        const panoItems = Array.isArray(panoData.candidates) ? panoData.candidates : [];
        if (panoItems.length) {
          for (const item of panoItems) cardArea.append(makeSceneCard(item, "panoramax"));
          cardArea.hidden = false;
          const oriented = panoItems.filter(x => x.assessment === "near-position-and-heading").length;
          status.textContent = "Panoramax公開街路写真 " + panoItems.length
            + "件（位置・方位が近い " + oriented
            + "件）。利用条件は各写真に表示。撮影視点の完全一致は未検証です。";
          return;
        }
      }
    } catch (error) {
      console.warn("Panoramax search unavailable", error.name);
    }

    // Lower-confidence CC0/Public Domain image fallback when no street photo
    // with an approved licence is available from either provider.
    const commonsRes = await fetch(commonsGeoSearchUrl(c.lat, c.lon, 1000), {
      credentials: "omit", cache: "no-store"
    });
    if (!commonsRes.ok) throw new Error("公開画像データも取得できません。");
    const commonsData = await commonsRes.json();
    const candidates = filterPublicDomainCommonsImages(commonsData, 8, c);
    if (requestId !== sceneSearchSequence) return;
    for (const candidate of candidates) cardArea.append(makeSceneCard(candidate, "commons"));
    cardArea.hidden = candidates.length === 0;
    status.textContent = candidates.length
      ? (result.configured ? "Mapillary近傍に一致する画像なし。" : "Mapillaryの検索サーバー未設定。")
        + " Wikimediaの位置付き公開写真 " + candidates.length + "件を表示します。撮影方向は不明です。"
      : "この地点で確認できる実景画像はありません。地名だけで景色を推測生成せず、許諾済みの現地写真を登録してください。";
  } catch (error) {
    status.textContent = "実景検索に失敗：" + error.message + "。現地写真を手動で追加できます。";
  } finally {
    button.disabled = false;
  }
}

function initializeUI() {
  $("preset").addEventListener("change", event => loadPreset(event.target.value));
  $("flyTo").addEventListener("click", () => { $("preset").value = "custom"; moveCamera(); });
  $("importGoogleUrl").addEventListener("click", importGoogleLocation);
  $("openGoogleMaps").addEventListener("click", () => openGoogleMapsView("map"));
  $("openStreetView").addEventListener("click", () => openGoogleMapsView("street"));
  $("photoUpload").addEventListener("change", onPhotoUpload);
  $("searchCommons").addEventListener("click", searchCommonsPhotos);
  $("mapMode").addEventListener("click", () => setBackgroundMode("map"));
  $("photoMode").addEventListener("click", () => setBackgroundMode("photo"));
  $("clearPhoto").addEventListener("click", clearLocationPhoto);
  $("findScenes").addEventListener("click", findObservedScenes);
  $("mapillaryShareAlike").addEventListener("change", updateCaptureAvailability);
  $("photoRights").addEventListener("change", updateCaptureAvailability);
  for (const id of ["latitude", "longitude"]) {
    $(id).addEventListener("keydown", event => {
      if (event.key === "Enter") { $("preset").value = "custom"; moveCamera(); }
    });
  }
  for (const id of ["zoom", "pitch", "bearing"]) {
    $(id).addEventListener("input", () => {
      if (id === "bearing") sceneSearchStale();
      updateCameraOutputs();
      if (map) map.easeTo({
      zoom: Number($("zoom").value), pitch: Number($("pitch").value), bearing: Number($("bearing").value),
      duration: 100, essential: true
    }); });
  }

  $("samplePerson").addEventListener("click", () => useSample("person"));
  $("sampleProduct").addEventListener("click", () => useSample("product"));
  $("imageUpload").addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!isSupportedImage(file)) {
      notice("PNG・JPEG・WebPの画像を15MB以内で選択してください。", true);
      event.target.value = "";
      return;
    }
    const url = URL.createObjectURL(file);
    subjectRevision++;
    originalUploadUrl = url;
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = url;
    $("cutoutPerson").disabled = false;
    $("restorePerson").disabled = true;
    $("cutoutStatus").textContent = "人物写真なら「背景を自動で切り抜く」を押せます。商品や透過PNGならそのまま使用してください。";
    setSubject(url, "uploaded");
    event.target.value = "";
  });
  $("cutoutPerson").addEventListener("click", removePersonBackground);
  $("restorePerson").addEventListener("click", restorePersonOriginal);
  $("subjectScale").addEventListener("input", event => {
    placement.widthRatio = Number(event.target.value) / 100;
    setPosition();
  });
  $("resetSubject").addEventListener("click", () => {
    placement = normalizePlacement();
    setPosition();
    notice("被写体の配置を初期化しました。");
  });
  $("exposure").addEventListener("input", event => setExposure(event.target.value));
  $("subjectLight").addEventListener("input", () => updateStudioControl("subjectLight", "subjectExposure", 100, v => v + "%"));
  $("subjectWarmth").addEventListener("input", () => updateStudioControl("subjectWarmth", "subjectWarmth", 100, v => v + "%"));
  $("shadowStrength").addEventListener("input", () => updateStudioControl("shadowStrength", "contactShadow", 100, v => v + "%"));
  $("photoZoom").addEventListener("input", () => updateStudioControl("photoZoom", "photoZoom", 100, v => v + "%"));
  $("photoFocusX").addEventListener("input", () => updateStudioControl("photoFocusX", "photoFocusX", 100, v => v + "%"));
  $("photoFocusY").addEventListener("input", () => updateStudioControl("photoFocusY", "photoFocusY", 100, v => v + "%"));
  $("shutter").addEventListener("click", takePhoto);
  $("sceneExport").addEventListener("click", exportScene);
  $("sceneImport").addEventListener("change", importScene);

  actor.addEventListener("pointerdown", event => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.stopPropagation();
    dragging = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      startX: placement.x, startY: placement.y };
    actor.setPointerCapture(event.pointerId);
  });
  actor.addEventListener("pointermove", event => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const rect = stage.getBoundingClientRect();
    placement.x = dragging.startX + (event.clientX - dragging.clientX) / rect.width;
    placement.y = dragging.startY + (event.clientY - dragging.clientY) / rect.height;
    setPosition();
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
    actor.addEventListener(eventName, () => { dragging = null; });
  }
  document.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName ?? "")) return;
    const d = event.shiftKey ? 0.025 : 0.01;
    placement.x += event.key === "ArrowLeft" ? -d : event.key === "ArrowRight" ? d : 0;
    placement.y += event.key === "ArrowUp" ? -d : event.key === "ArrowDown" ? d : 0;
    setPosition();
    event.preventDefault();
  });
  window.addEventListener("beforeunload", () => {
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
  });
  setPosition();
  syncStudioInputs();
  setExposure(100);
  useSample("person");
  updateCameraOutputs();
}

const depthController = createDepthController({
  dom: document,
  photoActive,
  drawBackground: renderSceneBackground,
  notice,
  rightsAllowed: () => $("photoRights").checked,
  photoRevision: () => backgroundRevision,
  cropKey: () => [studio.photoZoom, studio.photoFocusX, studio.photoFocusY].join(":"),
  fetcher: (...args) => fetch(...args)
});

initializeUI();

// 05 / Generative photography. The scene and upload images are processed in
// memory. Local AI generation uses Hugging Face weights on the user's GPU.
let aiReady = false;
// Reference image is the currently selected locally supplied photo background.
let generatedPhoto = null;

function backgroundCanvasForAI() {
  if (!photoActive() && (!map || !mapLoaded || !mapIdle)) {
    throw new Error("地図の読み込みが完了していません。現地写真を背景にすると地図接続なしでも生成できます。");
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2Dを初期化できません。");
  renderSceneBackground(ctx, canvas.width, canvas.height);
  return canvas;
}

function scaledImageData(image, longestSide, mime, quality) {
  if (!image?.naturalWidth || !image?.naturalHeight) throw new Error("画像の縦横サイズを取得できません。");
  const ratio = Math.min(1, longestSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像変換に失敗しました。");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(mime, quality);
}

function blobImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const photo = new Image();
    photo.onload = () => { URL.revokeObjectURL(url); resolve(photo); };
    photo.onerror = () => { URL.revokeObjectURL(url); reject(new Error("参照写真を読み込めませんでした。")); };
    photo.src = url;
  });
}

function updateAIStatus(value) { $("aiStatus").textContent = value; }

async function checkAIReady() {
  try {
    const result = await fetch("./api/health", { cache: "no-store" });
    if (!result.ok) throw new Error("server unavailable");
    const status = await result.json();
    aiReady = status.aiConfigured === true;
    updateAIStatus(aiReady
      ? "Hugging Faceローカルモデルを使用可能（" + (status.device || "GPU") + "）。初回はモデルのダウンロードが発生します。"
      : (status.message || "公開Web版ではAI生成は無効です。PCのローカルGPUサーバーから起動してください。"));
  } catch {
    aiReady = false;
    updateAIStatus("AI生成はローカルGPUサーバーでのみ使えます。Web公開版では2D合成撮影を利用できます。");
  }
  $("aiRender").disabled = !aiReady;
}

async function generateAIPhoto() {
  const button = $("aiRender");
  if (!aiReady) { notice("生成AIサーバーが設定されていません。", true); return; }
  if (!$("rightsConsent").checked) { notice("画像の利用権とローカル推論への使用に同意してください。", true); return; }
  button.disabled = true;
  button.textContent = "AIで写真を生成中…";
  updateAIStatus("ローカルGPUで推論しています。初回はモデルのダウンロードが必要です。");
  try {
    if (!photoActive()) await waitForMapIdle();
    if (!canCapture()) throw new Error("画像と被写体の準備が完了していません。");
    const background = backgroundCanvasForAI().toDataURL("image/jpeg", 0.78);
    const subject = scaledImageData(actorImg, 800, "image/png", 1);
    // For photo mode the licensed photograph is already the background;
    // do not double-send it or silently use unrelated Google content.
    const reference = null;
    const c = currentCamera();
    const response = await fetch("./api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: c.lat, lon: c.lon,
        background, subject, reference,
        placement: normalizePlacement(placement),
        compositing: studio,
        occlusionMask: depthController.maskDataURL(),
        subjectType: $("aiSubjectKind").value,
        description: $("artDirection").value.slice(0, 600),
        acceptRights: true
      })
    });
    let output;
    try { output = await response.json(); }
    catch { throw new Error("生成サーバーの応答を読み込めませんでした。"); }
    if (!response.ok) throw new Error(output?.error || "画像生成に失敗しました。");
    if (!output?.image?.startsWith("data:image/webp;base64,")) throw new Error("生成画像データが不正です。");
    generatedPhoto = output.image;
    $("aiResultImage").src = output.image;
    $("aiResult").hidden = false;
    $("aiDownload").disabled = false;
    updateAIStatus("ローカル生成完了。被写体は元画像から再合成しました。地理的な正確性と物理的な影は保証されません。");
    notice("生成写真を表示しました。必要に応じて編集画面へ戻れます。");
  } catch (error) {
    console.error("AI generation failed", error.name);
    const reason = error instanceof TypeError ? "ネットワークが切断されたか、サーバーへ接続できません。" : error.message;
    updateAIStatus("生成失敗：" + reason);
    notice("生成できませんでした：" + reason, true);
  } finally {
    button.disabled = !aiReady;
    button.innerHTML = '<span>ローカルAIで写真化する</span><span aria-hidden="true">✦</span>';
  }
}

async function downloadGenerated() {
  if (!generatedPhoto) { notice("生成された画像はありません。", true); return; }
  try {
    const img = $("aiResultImage");
    if (typeof img.decode === "function") await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 1536;
    canvas.height = img.naturalHeight || 864;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("出力用Canvasが使えません。");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const bandHeight = 48;
    ctx.fillStyle = "rgba(7,13,22,.82)";
    ctx.fillRect(0, canvas.height - bandHeight, canvas.width, bandHeight);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.font = "600 15px sans-serif";
    ctx.fillText("AI GENERATED · NOT ON LOCATION", 20, canvas.height - 17);
    ctx.textAlign = "right";
    ctx.font = "13px sans-serif";
    ctx.fillText(sourceAttribution(), canvas.width - 20, canvas.height - 17);
    if (["mapillary","panoramax"].includes(selectedSceneEvidence?.provider)) {
      ctx.font = "12px sans-serif";
      const original = selectedSceneEvidence.provider === "mapillary"
        ? "mapillary.com/app/?pKey=" + selectedSceneEvidence.id
        : "api.panoramax.xyz/#focus=pic&pic=" + selectedSceneEvidence.id;
      ctx.fillText(selectedSceneEvidence.license + " · modified · " + original,
        canvas.width - 20, canvas.height - 38);
    }
    const resultBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("画像を保存できません。")), "image/webp", 0.9);
    });
    downloadBlob(resultBlob, "virtual-location-ai-" + dateStamp() + ".webp");
    notice("生成写真をWebPで保存しました。クレジットと生成画像表示を埋め込みました。");
  } catch (error) {
    notice("保存できませんでした：" + error.message, true);
  }
}

function initializeAIUI() {
  $("aiRender").addEventListener("click", generateAIPhoto);
  $("aiDownload").addEventListener("click", downloadGenerated);
  $("editAgain").addEventListener("click", () => {
    $("aiResult").hidden = true;
    notice("編集画面へ戻りました。");
  });
}

initializeAIUI();
depthController.init();
checkAIReady();

connectWorld();
