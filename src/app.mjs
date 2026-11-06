import {
  PRESETS, CAPTURE, parseLocation, normalizePlacement, photoRect,
  isSupportedImage, sceneSnapshot
} from "./core.mjs";

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
let exposure = 1;
let dragging = null;

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
}
function setExposure(value) {
  exposure = Math.min(1.4, Math.max(0.5, Number(value) / 100));
  stage.style.setProperty("--scene-brightness", String(exposure));
  $("exposureValue").textContent = Math.round(exposure * 100) + "%";
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
    notice("被写体を読み込みました。ドラッグで配置できます。");
  };
  actorImg.onerror = () => {
    actor.hidden = true;
    notice("画像を読み込めませんでした。別のPNG/JPEG/WebPを選んでください。", true);
  };
  subjectType = kind;
  updateSampleButtons(kind);
  actorImg.src = source;
}
function useSample(kind) {
  if (lastObjectUrl) { URL.revokeObjectURL(lastObjectUrl); lastObjectUrl = null; }
  setSubject(dataSvg(kind === "person" ? personSvg() : productSvg()), kind);
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
  if (!map) {
    notice("座標を設定しました。3D地図の接続後に反映されます。");
    return;
  }
  map.flyTo({
    center: [c.lon, c.lat],
    zoom: c.zoom,
    pitch: c.pitch,
    bearing: c.bearing,
    duration: 1000,
    essential: true
  });
  notice("指定した緯度・経度へ移動します。");
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

async function connectWorld() {
  setMapOverlay("3D地図エンジンを読み込み中…");
  try {
    // Dynamic import keeps non-map controls usable if the CDN is unavailable.
    const maplibregl = await import("https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs");
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
    map.on("movestart", () => { mapIdle = false; $("shutter").disabled = true; });
    map.on("moveend", syncCameraFromMap);
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
      setMapStatus("地図に接続しました");
    });
    map.on("idle", () => {
      mapIdle = true;
      if (mapLoaded) {
        $("shutter").disabled = false;
        setMapStatus("撮影可能 / 3D MAP");
        notice("実際の位置データを表示しています。被写体を配置して撮影できます。");
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
  notice("地図タイルの描画を確認し、写真を合成しています…");
  try {
    await waitForMapIdle();
    if (!actorImg.complete || actorImg.naturalWidth <= 0) {
      throw new Error("被写体画像の読み込みが完了していません。");
    }
    const output = document.createElement("canvas");
    output.width = CAPTURE.width;
    output.height = CAPTURE.height;
    const ctx = output.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2Dを初期化できません。");

    // Map source tiles must have CORS permissions for the canvas to remain exportable.
    ctx.filter = "brightness(" + exposure + ") saturate(1.1)";
    ctx.drawImage(map.getCanvas(), 0, 0, CAPTURE.width, CAPTURE.height);
    ctx.filter = "none";

    // Approximate grading mirrors the preview's night-treatment overlay.
    const grade = ctx.createLinearGradient(0, 0, 0, CAPTURE.height);
    grade.addColorStop(0, "rgba(4,9,29,.16)");
    grade.addColorStop(0.6, "rgba(4,9,29,.02)");
    grade.addColorStop(1, "rgba(10,8,25,.10)");
    ctx.fillStyle = grade;
    ctx.fillRect(0, 0, CAPTURE.width, CAPTURE.height);

    const rect = photoRect(actorImg.naturalWidth, actorImg.naturalHeight, placement);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 14;
    ctx.drawImage(actorImg, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();

    // Credits are drawn INSIDE the actual exported bitmap, not only in the UI.
    ctx.fillStyle = "rgba(8,15,27,.78)";
    ctx.fillRect(0, CAPTURE.height - 47, CAPTURE.width, 47);
    ctx.fillStyle = "#f5f7fb";
    ctx.font = "600 16px system-ui, sans-serif";
    ctx.fillText("VIRTUAL LOCATION CAMERA · SYNTHETIC COMPOSITE", 24, CAPTURE.height - 17);
    ctx.textAlign = "right";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("Map © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors", CAPTURE.width - 24, CAPTURE.height - 17);

    const blob = await new Promise((resolve, reject) => {
      try { output.toBlob(value => value ? resolve(value) : reject(new Error("PNG出力に失敗しました。")), "image/png"); }
      catch (error) { reject(error); }
    });
    downloadBlob(blob, "virtual-location-camera-" + dateStamp() + ".png");
    notice("1600 × 900 PNGを保存しました。実地撮影の写真ではなく合成画像です。");
  } catch (error) {
    console.error(error);
    notice("撮影できませんでした：" + (error.message || String(error)), true);
  } finally {
    btn.disabled = !mapIdle || !mapLoaded;
  }
}

function exportScene() {
  try {
    const snapshot = sceneSnapshot(currentCamera(), placement, subjectType);
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    downloadBlob(blob, "virtual-location-scene-" + dateStamp() + ".json");
    notice("撮影条件をJSONで保存しました。アップロード画像本体は含まれません。");
  } catch (error) { notice(error.message, true); }
}

function initializeUI() {
  $("preset").addEventListener("change", event => loadPreset(event.target.value));
  $("flyTo").addEventListener("click", () => { $("preset").value = "custom"; moveCamera(); });
  for (const id of ["latitude", "longitude"]) {
    $(id).addEventListener("keydown", event => {
      if (event.key === "Enter") { $("preset").value = "custom"; moveCamera(); }
    });
  }
  for (const id of ["zoom", "pitch", "bearing"]) {
    $(id).addEventListener("input", () => { updateCameraOutputs(); if (map) map.easeTo({
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
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = url;
    setSubject(url, "uploaded");
    event.target.value = "";
  });
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
  $("shutter").addEventListener("click", takePhoto);
  $("sceneExport").addEventListener("click", exportScene);

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
  window.addEventListener("beforeunload", () => { if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl); });
  setPosition();
  setExposure(100);
  useSample("person");
  updateCameraOutputs();
}

initializeUI();
connectWorld();
