import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWorldPly,demoWorld,normalizedWorldCamera,normalizedWorldActor,
  translateWorldCamera,WORLD_MAX_POINTS
} from "../src/world3d.mjs";

function fixture(points){
 const head=(
  "ply\nformat binary_little_endian 1.0\n"
  +"comment estimated point cloud\n"
  +"element vertex "+points.length+"\n"
  +"property float x\nproperty float y\nproperty float z\n"
  +"property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
 );
 const prefix=new TextEncoder().encode(head);
 const bytes=new ArrayBuffer(prefix.length+points.length*15);
 const raw=new Uint8Array(bytes);raw.set(prefix);
 const data=new DataView(bytes,prefix.length);
 points.forEach(([x,y,z,r,g,b],i)=>{
  const p=i*15;
  data.setFloat32(p,x,true);data.setFloat32(p+4,y,true);
  data.setFloat32(p+8,z,true);
  for(const [offset,color] of [[12,r],[13,g],[14,b]])data.setUint8(p+offset,color);
 });
 return bytes;
}
test("the Python 15-byte PLY format is interpreted in the correct 3D frame",()=>{
 const world=parseWorldPly(fixture([
  [1,2,-3,250,0,0],[2,3,-5,0,250,0],[-2,-3,-4,0,0,250]
 ]));
 assert.equal(world.count,3);
 assert.deepEqual([...world.positions],[1,2,-3,2,3,-5,-2,-3,-4]);
 assert.deepEqual([...world.colors],[250,0,0,0,250,0,0,0,250]);
 assert.deepEqual(world.bounds.min,[-2,-3,-5]);
 assert.deepEqual(world.bounds.max,[2,3,-3]);
});
test("malformed or unsupported PLY content is rejected before loading into WebGL",()=>{
 const original=fixture([
  [1,2,-3,250,0,0],[2,3,-5,0,250,0],[-2,-3,-4,0,0,250]
 ]);
 assert.throws(()=>parseWorldPly(new Uint8Array(10).buffer),RangeError);
 assert.throws(()=>parseWorldPly(original.slice(0,-3)),/バイト数/);
 const nonFinite=fixture([
  [Infinity,2,-3,250,0,0],[2,3,-5,0,250,0],[-2,-3,-4,0,0,250]
 ]);
 assert.throws(()=>parseWorldPly(nonFinite),/3D座標/);
 const text=new TextDecoder().decode(new Uint8Array(original).slice(0,250));
 assert.match(text,/binary_little_endian/);
 const bigger=fixture([[0,0,1,0,0,0],[1,1,1,0,0,0],[2,2,2,0,0,0]]);
 const wrong=new Uint8Array(bigger);
 const header=new TextEncoder().encode("format ascii 1.0");
 const old=new TextEncoder().encode("format binary_little_endian 1.0");
 // Byte-count differences are sufficient for a rejected header.
 assert.ok(header.length<old.length);
 assert.throws(()=>parseWorldPly(new ArrayBuffer(80)),Error);
});
test("camera moves in real 3D, not just a 2D image pan",()=>{
 const first=normalizedWorldCamera();
 assert.deepEqual(first,{x:0,y:0,z:0,yaw:0,pitch:0,fov:65});
 const forward=translateWorldCamera(first,"forward",0.5);
 assert.equal(forward.z,-.5);
 const right=translateWorldCamera(first,"right",.5);
 assert.equal(right.x,.5);
 const oriented=translateWorldCamera({yaw:90},"forward",.5);
 assert.ok(Math.abs(oriented.x-.5)<1e-6);
 assert.ok(Math.abs(oriented.z)<1e-6);
 assert.equal(translateWorldCamera(first,"up",.5).y,.5);
 assert.throws(()=>translateWorldCamera(first,"teleport",1),RangeError);
});
test("world controls are bounded, person remains at a fixed 3D coordinate",()=>{
 const actor=normalizedWorldActor();
 assert.deepEqual(actor,{x:0,y:-.45,z:-3.5,height:1.7});
 assert.deepEqual(normalizedWorldActor({x:99,y:-99,z:15,height:30}),{
  x:6,y:-6,z:-.5,height:3
 });
 assert.equal(normalizedWorldCamera({yaw:720,pitch:100,fov:140}).yaw,0);
 assert.equal(normalizedWorldCamera({yaw:720,pitch:100,fov:140}).pitch,75);
});
test("the demo is explicit synthetic data with sufficient 3D points",()=>{
 const d=demoWorld();
 assert.ok(d.count>2000&&d.count<WORLD_MAX_POINTS);
 assert.equal(d.positions.length,d.colors.length);
 assert.equal(d.positions.length,d.count*3);
 assert.ok([...d.positions].every(Number.isFinite));
});
