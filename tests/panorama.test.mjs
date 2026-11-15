import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePanoramaView,isEquirectangularDimensions,
  perspectiveToEquirectangular,wrapPanoramaYaw
} from "../src/panorama.mjs";

test("only near-2:1 large images may be explicitly treated as full 360 spheres",()=>{
  assert.equal(isEquirectangularDimensions(4096,2048),true);
  assert.equal(isEquirectangularDimensions(3000,1500),true);
  assert.equal(isEquirectangularDimensions(4000,3000),false);
  assert.equal(isEquirectangularDimensions(100,50),false);
  assert.equal(isEquirectangularDimensions(NaN,1024),false);
});
test("the photographic perspective at zero rotation looks at panorama center",()=>{
  const p=perspectiveToEquirectangular(.5,.5,16/9);
  assert.ok(Math.abs(p.u-.5)<1e-8);
  assert.ok(Math.abs(p.v-.5)<1e-8);
});
test("yaw rotates through actual observed image columns, never translates location",()=>{
  const right=perspectiveToEquirectangular(.5,.5,16/9,{yaw:90});
  const left=perspectiveToEquirectangular(.5,.5,16/9,{yaw:-90});
  assert.ok(Math.abs(right.u-.75)<1e-8);
  assert.ok(Math.abs(left.u-.25)<1e-8);
  assert.equal(right.v,.5);
  assert.ok(Math.abs(perspectiveToEquirectangular(.5,.5,16/9,{yaw:180}).u-0)<1e-8);
  assert.equal(wrapPanoramaYaw(190),-170);
  assert.equal(wrapPanoramaYaw(-190),170);
  assert.equal(wrapPanoramaYaw(720),0);
});
test("positive pitch observes higher portions of the actual photo",()=>{
  const up=perspectiveToEquirectangular(.5,.5,16/9,{pitch:40});
  const down=perspectiveToEquirectangular(.5,.5,16/9,{pitch:-40});
  assert.ok(up.v<.5 && down.v>.5);
  assert.ok(Math.abs(up.v-(.5-40/180))<.000001);
});
test("FOV controls edge rays and preserves 16:9 perspective geometry",()=>{
  const narrow=perspectiveToEquirectangular(1,.5,16/9,{horizontalFov:35});
  const wide=perspectiveToEquirectangular(1,.5,16/9,{horizontalFov:110});
  assert.ok(wide.u>narrow.u);
  assert.ok(wide.u<1);
  const top=perspectiveToEquirectangular(.5,0,16/9,{horizontalFov:75});
  assert.ok(top.v<.5);
});
test("camera settings are clipped or wrapped and invalid rays rejected",()=>{
  assert.deepEqual(normalizePanoramaView(),{
    enabled:false,yaw:0,pitch:0,horizontalFov:75
  });
  assert.deepEqual(normalizePanoramaView({
    enabled:true,yaw:370,pitch:90,horizontalFov:180
  }),{enabled:true,yaw:10,pitch:65,horizontalFov:110});
  assert.throws(()=>perspectiveToEquirectangular(-1,.5,1.5),RangeError);
  assert.throws(()=>perspectiveToEquirectangular(.5,.5,0),RangeError);
  assert.throws(()=>perspectiveToEquirectangular(.5,Infinity,1),RangeError);
});
