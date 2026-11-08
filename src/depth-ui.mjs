/**
 * The optional relative-depth and always-available manual foreground editor.
 *
 * A mask reveals ORIGINAL background pixels over the 2D subject wherever
 * the user (or a relative depth model) marks the photo as closer. Nothing in
 * this module invents unseen geometry, reprojects the image or uses Google
 * Maps image content.
 */
import {
  DEPTH_MASK_SIZE, DEPTH_MODEL, occlusionOptions,
  depthImageToAlphaMask, occlusionStroke, depthResponseLooksValid
} from "./depth.mjs";

export function createDepthController({
  dom,
  photoActive,
  drawBackground,
  notice,
  rightsAllowed,
  photoRevision,
  cropKey,
  fetcher
}) {
  const $ = id => dom.getElementById(id);
  let options = occlusionOptions();
  let depthPicture = null;
  let strokes = [];
  let editable = false;
  let activePointer = null;
  let mask = null;
  let modelAvailable = false;
  let busy = false;
  let inferenceRevision = 0;

  function reset(message = "") {
    // A manual clear or photo replacement must invalidate an in-flight result.
    inferenceRevision++;
    options = occlusionOptions();
    strokes = [];
    depthPicture = null;
    mask = null;
    activePointer = null;
    editable = false;
    const canvas = $("occlusionCanvas");
    canvas.hidden = true;
    canvas.classList.remove("editing");
    $("depthEnabled").checked = false;
    $("depthEnabled").disabled = true;
    $("depthThreshold").disabled = true;
    $("depthThreshold").value = "65";
    $("depthThresholdValue").textContent = "65%";
    $("depthInvert").checked = false;
    $("depthPreview").hidden = true;
    $("maskEditToggle").setAttribute("aria-pressed", "false");
    $("maskEditToggle").textContent = "前景ブラシを開始";
    if (message) $("depthStatus").textContent = message;
  }

  function render() {
    const canvas = $("occlusionCanvas");
    const valid = photoActive();
    const useDepth = valid && options.enabled && Boolean(depthPicture);
    canvas.classList.toggle("editing", valid && editable);
    if (!valid || (!useDepth && strokes.length === 0)) {
      mask = null;
      canvas.hidden = !valid || !editable;
      if (canvas.getContext && canvas.getContext("2d")) {
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    const w = DEPTH_MASK_SIZE.width, h = DEPTH_MASK_SIZE.height;
    const imageMask = dom.createElement("canvas");
    imageMask.width = w; imageMask.height = h;
    const mctx = imageMask.getContext("2d");
    if (!mctx) throw new Error("前景マスクCanvasが利用できません。");
    if (useDepth) {
      mctx.drawImage(depthPicture, 0, 0, w, h);
      const picture = mctx.getImageData(0, 0, w, h);
      picture.data.set(depthImageToAlphaMask(picture.data, options));
      mctx.putImageData(picture, 0, 0);
    }
    for (const stroke of strokes) {
      mctx.save();
      mctx.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
      mctx.fillStyle = "#ffffff";
      mctx.beginPath();
      mctx.arc(stroke.x * w, stroke.y * h, stroke.radiusPx, 0, Math.PI * 2);
      mctx.fill();
      mctx.restore();
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("撮影マスクのプレビューが利用できません。");
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.drawImage($("photoCanvas"), 0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(imageMask, 0, 0, w, h);
    ctx.restore();
    mask = imageMask;
    canvas.hidden = false;
  }

  function drawOverSubject(ctx, width, height) {
    if (mask && photoActive()) {
      ctx.drawImage($("occlusionCanvas"), 0, 0, width, height);
    }
  }

  function maskDataURL() {
    return mask && photoActive() ? mask.toDataURL("image/png") : null;
  }

  function makeStroke(event) {
    if (!editable || !photoActive() || !activePointer) return;
    const element = $("occlusionCanvas");
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const radius = Number($("maskBrushRadius").value);
    const mode = $("maskBrushMode").value === "erase" ? "erase" : "foreground";
    const prev = activePointer.last;
    const dx = prev ? (x - prev.x) * DEPTH_MASK_SIZE.width : 0;
    const dy = prev ? (y - prev.y) * DEPTH_MASK_SIZE.height : 0;
    const n = prev ? Math.min(60, Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(radius / 2, 2)))) : 1;
    if (strokes.length + n > 4500) {
      editable = false;
      activePointer = null;
      $("maskEditToggle").setAttribute("aria-pressed", "false");
      $("maskEditToggle").textContent = "前景ブラシを開始";
      notice("前景のブラシ点数が上限に達しました。マスクをクリアして編集を続けてください。", true);
      render();
      return;
    }
    for (let i = 1; i <= n; i++) {
      const ratio = i / n;
      strokes.push(occlusionStroke(
        prev ? prev.x + (x - prev.x) * ratio : x,
        prev ? prev.y + (y - prev.y) * ratio : y,
        radius, mode
      ));
    }
    activePointer.last = {x, y};
    render();
  }

  function setDepthImage(image, source = "manual") {
    if (!photoActive()) throw new Error("現地写真を選択してください。");
    const ratio = image.naturalWidth / image.naturalHeight;
    if (!Number.isFinite(ratio) || Math.abs(ratio - 16 / 9) > 0.08) {
      throw new Error("16:9の深度マップを指定してください。");
    }
    depthPicture = image;
    options = occlusionOptions({...options, enabled: true});
    $("depthEnabled").checked = true;
    $("depthEnabled").disabled = false;
    $("depthThreshold").disabled = false;
    const preview = $("depthPreview");
    const ctx = preview.getContext("2d");
    if (ctx) ctx.drawImage(image, 0, 0, preview.width, preview.height);
    preview.hidden = false;
    $("depthStatus").textContent = source === "ai"
      ? "相対深度を生成しました。奥行きの方向・物体の境界を確認し、必要なら反転・ブラシで修正してください。"
      : "深度マップを読み込みました。白が手前という仮定は、反転・ブラシで補正できます。";
    render();
  }

  function readDepthImage(source, origin) {
    return new Promise((resolve, reject) => {
      const ImageClass = dom.defaultView?.Image;
      if (!ImageClass) return reject(new Error("ブラウザImage APIが利用できません。"));
      const image = new ImageClass();
      image.onload = () => {
        try { setDepthImage(image, origin); resolve(); }
        catch(error) { reject(error); }
      };
      image.onerror = () => reject(new Error("深度マップの読み込みに失敗しました。"));
      image.src = source;
    });
  }

  async function uploadDepth(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!photoActive()) return notice("現地写真を先に設定してください。", true);
    if (file.type !== "image/png" || file.size <= 0 || file.size > 3_000_000) {
      return notice("深度画像は3MB以内の16:9 PNGを指定してください。", true);
    }
    const url = dom.defaultView.URL.createObjectURL(file);
    try { await readDepthImage(url, "manual"); }
    catch(error) { notice(error.message, true); }
    finally { dom.defaultView.URL.revokeObjectURL(url); }
  }

  async function checkService() {
    try {
      const response = await fetcher("./api/depth-health", {cache: "no-store"});
      if (!response.ok) throw Error("depth not available");
      const result = await response.json();
      modelAvailable = result.available === true && result.model === DEPTH_MODEL;
      $("depthInfer").disabled = !modelAvailable;
      $("depthStatus").textContent = modelAvailable
        ? "ローカル推論を利用できます（" + (result.device || "GPU") + "）。初回はモデルの重みをダウンロードします。"
        : (result.message || "ブラウザでは手動の前景ブラシまたは深度PNGを利用できます。");
    } catch {
      modelAvailable = false;
      $("depthInfer").disabled = true;
      $("depthStatus").textContent = "深度AIはローカルPython版のみ。無料Web版では前景ブラシと深度PNGが利用できます。";
    }
  }

  async function inferDepth() {
    if (!photoActive()) return notice("現地写真を先に設定してください。", true);
    if (!modelAvailable || busy) return notice("ローカル深度AIが利用できません。", true);
    if (!rightsAllowed() || !$("depthConsent").checked) {
      return notice("画像の利用権とローカル推論の同意を確認してください。", true);
    }
    busy = true;
    $("depthInfer").disabled = true;
    $("depthStatus").textContent = "ローカルのDepth Anything V2を実行しています。初回はモデルをダウンロードします。";
    const revision = photoRevision();
    const currentCrop = cropKey();
    const runningInference = ++inferenceRevision;
    try {
      const source = dom.createElement("canvas");
      source.width = 768; source.height = 432;
      const context = source.getContext("2d");
      if (!context) throw Error("画像変換Canvasを初期化できません。");
      drawBackground(context, source.width, source.height);
      const response = await fetcher("./api/depth", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          acceptRights: true, image: source.toDataURL("image/jpeg", 0.8)
        })
      });
      const output = await response.json();
      if (!response.ok) throw Error(output.error || "深度推定に失敗しました。");
      if (!depthResponseLooksValid(output)) throw Error("深度モデルの応答形式が不正です。");
      if (!photoActive() || revision !== photoRevision()
        || currentCrop !== cropKey() || runningInference !== inferenceRevision) {
        throw Error("深度推定中に背景の写真や構図が変更されました。再推定してください。");
      }
      await readDepthImage(output.depthMap, "ai");
    } catch(error) {
      $("depthStatus").textContent = "深度推定失敗：" + error.message;
      notice(error.message, true);
    } finally {
      busy = false;
      $("depthInfer").disabled = !modelAvailable;
    }
  }

  function snapshot() {
    return {
      enabled: options.enabled,
      depthModel: depthPicture ? DEPTH_MODEL : null,
      threshold: options.threshold,
      feather: options.feather,
      invert: options.invert,
      manualStrokeCount: strokes.length,
      maskIncluded: false,
      note: "Depth map and foreground brush pixels are not included; recreate them after importing."
    };
  }

  function init() {
    $("depthUpload").addEventListener("change", uploadDepth);
    $("depthInfer").addEventListener("click", inferDepth);
    $("depthEnabled").addEventListener("change", () => {
      options = occlusionOptions({...options, enabled: $("depthEnabled").checked});
      render();
    });
    $("depthThreshold").addEventListener("input", () => {
      options = occlusionOptions({...options, threshold: Number($("depthThreshold").value) / 100});
      $("depthThresholdValue").textContent = $("depthThreshold").value + "%";
      render();
    });
    $("depthInvert").addEventListener("change", () => {
      options = occlusionOptions({...options, invert: $("depthInvert").checked});
      render();
    });
    $("maskEditToggle").addEventListener("click", () => {
      if (!photoActive()) return notice("現地写真モードで使用してください。", true);
      editable = !editable;
      $("maskEditToggle").setAttribute("aria-pressed", String(editable));
      $("maskEditToggle").textContent = editable ? "前景ブラシを終了" : "前景ブラシを開始";
      render();
      notice(editable ? "写真の手前に出す領域を塗ってください。消去ブラシも使えます。" : "前景編集を終了しました。");
    });
    $("clearOcclusion").addEventListener("click", () => {
      reset("深度と前景マスクを初期化しました。");
      render();
    });
    const canvas = $("occlusionCanvas");
    canvas.addEventListener("pointerdown",event => {
      if (!editable || !photoActive()) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      activePointer = {id: event.pointerId, last: null};
      canvas.setPointerCapture(event.pointerId);
      makeStroke(event);
    });
    canvas.addEventListener("pointermove",event => {
      if (activePointer?.id !== event.pointerId) return;
      event.preventDefault();
      makeStroke(event);
    });
    for (const eventName of ["pointerup","pointercancel","lostpointercapture"]) {
      canvas.addEventListener(eventName, () => {activePointer = null;});
    }
    checkService();
  }
  return {init, render, reset, drawOverSubject, maskDataURL, snapshot};
}
