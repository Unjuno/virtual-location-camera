import test from "node:test";
import assert from "node:assert/strict";
import {
  CUTOUT_CDN,CUTOUT_MODEL_URL,cutoutDimensions,matteAlpha,
  alphaFromConfidence,getPersonSegmenter,segmentPerson
} from "../src/cutout.mjs";

test("cutout respects original aspect ratio and maximum image dimension",()=>{
  assert.deepEqual(cutoutDimensions(2000,1000),{width:1600,height:800});
  assert.deepEqual(cutoutDimensions(600,1200),{width:600,height:1200});
  assert.deepEqual(cutoutDimensions(900,1600),{width:900,height:1600});
  assert.throws(()=>cutoutDimensions(0,100),RangeError);
  assert.throws(()=>cutoutDimensions(Infinity,100),RangeError);
});

test("smooth person alpha preserves high-confidence foreground and transparent backdrop",()=>{
  assert.equal(matteAlpha(0),0);
  assert.equal(matteAlpha(0.12),0);
  assert.equal(matteAlpha(1),255);
  assert.equal(matteAlpha(0.97),255);
  assert.ok(matteAlpha(0.45)>0&&matteAlpha(0.45)<255);
  assert.equal(matteAlpha(NaN),0);
  const data=alphaFromConfidence(new Float32Array([0,1,0.5,0.1]),2,2);
  assert.equal(data.length,16);
  assert.equal(data[0],255);
  assert.equal(data[3],0);
  assert.equal(data[7],255);
  assert.ok(data[11]>0&&data[11]<255);
  assert.equal(data[15],0);
  assert.throws(()=>alphaFromConfidence(new Uint8Array(4),2,2),TypeError);
  assert.throws(()=>alphaFromConfidence(new Float32Array(3),2,2),TypeError);
});

test("runtime is pinned, offline inference uses MediaPipe CPU and a user-selected image",async()=>{
  assert.match(CUTOUT_CDN,/@1\.2\.2/);
  assert.match(CUTOUT_MODEL_URL,/selfie_segmenter.*\.tflite$/);
  let instances=0;
  const segmenter={
    segment(){
      return {confidenceMasks:[{},{
        width:2,height:2,getAsFloat32Array(){return new Float32Array([0,1,1,0]);}
      }],close(){}};
    }
  };
  const runtime=await getPersonSegmenter({
    loadModule:async()=>({
      FilesetResolver:{forVisionTasks:async(url)=>{assert.match(url,/\/wasm$/);return "fileSet";}},
      ImageSegmenter:{createFromOptions:async(files,options)=>{
        instances++;
        assert.equal(files,"fileSet");
        assert.equal(options.baseOptions.delegate,"CPU");
        assert.equal(options.baseOptions.modelAssetPath,CUTOUT_MODEL_URL);
        assert.equal(options.outputConfidenceMasks,true);
        return segmenter;
      }}
    })
  });
  assert.equal(instances,1);
  assert.equal(runtime,segmenter);

  const record={images:0,mattes:0};
  const mkCanvas=()=>({
    width:0,height:0,
    getContext(){
      return {
        globalCompositeOperation:"source-over",
        save(){},restore(){},
        drawImage(){record.images++;},
        createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4)};},
        putImageData(){record.mattes++;}
      };
    },
    toDataURL(){return "data:image/png;base64,TEST";}
  });
  const result=await segmentPerson({naturalWidth:800,naturalHeight:400},{
    documentObject:{createElement(tag){assert.equal(tag,"canvas");return mkCanvas();}},
    segmenterPromise:Promise.resolve(segmenter)
  });
  assert.match(result,/^data:image\/png;base64,/);
  assert.equal(record.mattes,1);
  assert.equal(record.images,2);
});

test("portrait model response shape is validated rather than trusting unexpected API output",async()=>{
  await assert.rejects(segmentPerson({naturalWidth:400,naturalHeight:800},{
    documentObject: {
      createElement() {
        return {
          width:0,height:0,
          getContext() {
            return {drawImage(){},save(){},restore(){}};
          }
        };
      }
    },
    segmenterPromise:Promise.resolve({segment(){return{confidenceMasks:[]};}})
  }),/人物領域/);
});
