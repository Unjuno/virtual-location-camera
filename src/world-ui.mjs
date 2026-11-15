/**
 * Integrates world reconstruction with the existing location-photo UI.
 * The 3D world is a point cloud inferred from overlapping OBSERVED photographs
 * using an optional local Apache-2.0 MapAnything GPU model. World coordinates
 * are first-camera-relative; WGS84 is a label, NOT registered geometry.
 */
import {
  WorldPointRenderer,parseWorldPly,demoWorld,normalizedWorldCamera,
  normalizedWorldActor,translateWorldCamera,WORLD_FILE_LIMIT,
  WORLD_CAMERA_DEFAULT,WORLD_ACTOR_DEFAULT
} from "./world3d.mjs";

export function createWorldController({
  dom, actorImage, switchMode, currentMode, notify, refreshCapture
}){
  const $=id=>dom.getElementById(id);
  let renderer=null;
  let data=null;
  let fileLabel="";
  let synthetic=false;
  let view=normalizedWorldCamera();
  let actor=normalizedWorldActor();
  let pointer=null;

  const active=()=>currentMode()==="world" && Boolean(data);
  const ready=()=>Boolean(data);
  const allowed=()=>synthetic||$("worldRights").checked;
  const status=message=>$("worldStatus").textContent=message;
  const credit=()=>{
    const label=String($("worldCredit").value||"").trim().replace(/[\r\n]/g," ").slice(0,100);
    return synthetic?"SYNTHETIC DEMO · NOT A REAL LOCATION":
      "Predicted point cloud · "+(label||"user-provided licensed photographs")
      +" · location alignment not verified";
  };
  function ensure(){
    if(!renderer)renderer=new WorldPointRenderer($("worldCanvas"));
    return renderer;
  }
  function syncInputs(){
    const cameraFields=[["worldYaw",view.yaw,"°"],["worldPitch",view.pitch,"°"],["worldFov",view.fov,"°"]];
    for(const [id,value,suffix] of cameraFields){
      $(id).value=String(Math.round(value));
      $(id+"Value").textContent=Math.round(value)+suffix;
    }
    const actorFields=[["worldActorX",actor.x],["worldActorY",actor.y],
      ["worldActorZ",actor.z],["worldActorHeight",actor.height]];
    for(const [id,value] of actorFields){
      $(id).value=String(Number(value.toFixed(1)));
      $(id+"Value").textContent=value.toFixed(1);
    }
  }
  function renderPreview(){
    if(!active())return;
    const canvas=$("worldCanvas");
    const r=ensure();
    r.setActor(actorImage);
    r.render(view,actor,960,540);
    canvas.hidden=false;
  }
  function exportTo(context,width,height){
    if(!active())throw Error("World camera is not active.");
    const r=ensure();
    r.setActor(actorImage);
    r.render(view,actor,width,height);
    context.drawImage($("worldCanvas"),0,0,width,height);
    // Restore a responsive preview without changing the world camera pose.
    renderPreview();
  }
  function syncMode(){
    const activeWorld=active();
    $("worldCanvas").hidden=!activeWorld;
    $("worldControls").hidden=!activeWorld;
    $("worldMode").disabled=!ready();
    $("worldMode").classList.toggle("selected",activeWorld);
    $("worldMode").setAttribute("aria-pressed",String(activeWorld));
    if(activeWorld)renderPreview();
  }
  function activateWorld(value,{isDemo=false,label="licensed point cloud"}={}){
    const r=ensure();
    r.load(value);
    data=value;
    synthetic=isDemo;
    fileLabel=label;
    view=normalizedWorldCamera();
    actor=normalizedWorldActor();
    syncInputs();
    $("worldMode").disabled=false;
    status((isDemo?"架空のサンプル（実在地点ではありません）":"複数写真から復元した3D点群")
      +"：頂点 "+value.count.toLocaleString()+" 個。"
      +" 撮影原点は最初の写真です。GPSへの3D整合は未検証。空白部分は補完しません。");
    switchMode("world");
    syncMode();
    refreshCapture();
  }
  async function loadPly(event){
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file)return;
    if(!$("worldRights").checked){
      notify("3Dの元画像の利用権と出典を確認してください。",true);return;
    }
    if(!/\.ply$/i.test(file.name)||file.size<80||file.size>WORLD_FILE_LIMIT){
      notify("15MB以内のMapAnything出力PLYファイルが必要です。",true);return;
    }
    try{
      status("3D点群を検査しています…");
      const decoded=parseWorldPly(await file.arrayBuffer());
      activateWorld(decoded,{isDemo:false,label:file.name});
    }catch(error){
      status("3D世界を読み込めません："+error.message);
      notify(error.message,true);
    }
  }
  function loadDemo(){
    try{
      activateWorld(demoWorld(),{isDemo:true,label:"synthetic city demo"});
    }catch(error){notify("架空の3Dサンプルの読み込み失敗："+error.message,true);}
  }
  function move(direction){
    if(!active())return;
    view=translateWorldCamera(view,direction);
    syncInputs();renderPreview();
    status("3Dカメラ "+[view.x,view.y,view.z].map(x=>x.toFixed(2)).join(",")
      +" （モデル相対単位）。空白部分は未観測です。");
  }
  function reset(){
    if(!ready())return;
    view=normalizedWorldCamera();
    actor=normalizedWorldActor();
    syncInputs();renderPreview();
  }
  function clear(){
    if(active())switchMode("map");
    renderer?.dispose();
    renderer=null;data=null;synthetic=false;fileLabel="";
    view=normalizedWorldCamera();actor=normalizedWorldActor();
    syncInputs();syncMode();
    status("点群を解除しました。3D復元には重複する実景写真とMapAnythingローカルGPUが必要です。");
    refreshCapture();
  }
  function restore(snapshot){
    if(!ready() || !snapshot || snapshot.kind!=="multiview-reconstructed-pointcloud"){
      return false;
    }
    view=normalizedWorldCamera(snapshot.camera);
    actor=normalizedWorldActor(snapshot.person);
    syncInputs();
    if(active())renderPreview();
    return true;
  }
  function snapshot(){
    return {
      kind:"multiview-reconstructed-pointcloud",
      renderer:"webgl-observed-points",
      inputFileIncluded:false,
      pointCount:data?.count??0,
      sourceLabel:fileLabel,
      syntheticDemo:synthetic,
      origin:"first-input-camera",
      geographicRegistrationVerified:false,
      novelContentGenerated:false,
      camera:{...view},person:{...actor},
      originalPhotoAttribution:credit()
    };
  }
  function init(){
    $("worldUpload").addEventListener("change",loadPly);
    $("worldDemo").addEventListener("click",loadDemo);
    $("worldMode").addEventListener("click",()=>{if(ready())switchMode("world");});
    $("worldClear").addEventListener("click",clear);
    $("worldReset").addEventListener("click",reset);
    $("worldRights").addEventListener("change",refreshCapture);
    const directions={
      worldForward:"forward",worldBack:"back",
      worldLeft:"left",worldRight:"right",worldUp:"up",worldDown:"down"
    };
    for(const [id,direction] of Object.entries(directions))
      $(id).addEventListener("click",()=>move(direction));

    const camSliders={worldYaw:"yaw",worldPitch:"pitch",worldFov:"fov"};
    for(const [id,key] of Object.entries(camSliders)){
      $(id).addEventListener("input",()=>{
        if(!active())return;
        view=normalizedWorldCamera({...view,[key]:Number($(id).value)});
        syncInputs();renderPreview();
      });
    }
    const actorSliders={
      worldActorX:"x",worldActorY:"y",worldActorZ:"z",worldActorHeight:"height"
    };
    for(const [id,key] of Object.entries(actorSliders)){
      $(id).addEventListener("input",()=>{
        if(!active())return;
        actor=normalizedWorldActor({...actor,[key]:Number($(id).value)});
        syncInputs();renderPreview();
      });
    }

    const canvas=$("worldCanvas");
    canvas.addEventListener("pointerdown",event=>{
      if(!active()||(event.pointerType==="mouse"&&event.button!==0))return;
      event.preventDefault();event.stopPropagation();
      pointer={id:event.pointerId,x:event.clientX,y:event.clientY,
        yaw:view.yaw,pitch:view.pitch};
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove",event=>{
      if(!active()||pointer?.id!==event.pointerId)return;
      const r=canvas.getBoundingClientRect();
      if(!(r.width>0&&r.height>0))return;
      view=normalizedWorldCamera({
        ...view,
        yaw:pointer.yaw-(event.clientX-pointer.x)/r.width*120,
        pitch:pointer.pitch+(event.clientY-pointer.y)/r.height*75
      });
      syncInputs();renderPreview();
    });
    for(const type of ["pointerup","pointercancel","lostpointercapture"]){
      canvas.addEventListener(type,()=>{pointer=null;});
    }
    dom.addEventListener("keydown",event=>{
      if(!active()||event.altKey||event.ctrlKey||event.metaKey)return;
      const tag=dom.activeElement?.tagName||"";
      if(/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(tag))return;
      const key=event.key.toLowerCase();
      const controls={w:"forward",s:"back",a:"left",d:"right",q:"down",e:"up"};
      if(controls[key]){
        event.preventDefault();
        move(controls[key]);
      }
    });
    syncInputs();
  }
  return {init,ready,active,allowed,credit,clear,syncMode,renderPreview,
    exportTo,snapshot,restore,loadDemo};
}
