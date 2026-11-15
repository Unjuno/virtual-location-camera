/**
 * Inspectable multi-view reconstructed world point cloud.
 *
 * Input: tightly-defined binary_little_endian PLY (float xyz, uchar rgb),
 * produced by scripts/reconstruct_world.py (Apache-2.0 MapAnything model).
 *
 * The renderer moves a CAMERA in a fixed 3D point cloud. Missing geometry
 * stays missing (dark), never hallucinated. The actor is a textured world-
 * anchored billboard with WebGL depth testing against observed world points.
 * No 3rd-party renderer, no paid API, no Google imagery extraction.
 */
export const WORLD_MAX_POINTS=800_000;
export const WORLD_FILE_LIMIT=15_000_000;
export const WORLD_CAMERA_DEFAULT=Object.freeze({x:0,y:0,z:0,yaw:0,pitch:0,fov:65});
export const WORLD_ACTOR_DEFAULT=Object.freeze({x:0,y:-0.45,z:-3.5,height:1.7});
const DEG=Math.PI/180;

const VERTEX_POINTS=[
 "attribute vec3 a_position,a_color;",
 "uniform vec3 u_camera;",
 "uniform float u_yaw,u_pitch,u_aspect,u_tan_half_fov,u_viewheight;",
 "varying vec3 v_color;",
 "void main(){",
 " vec3 v=a_position-u_camera;",
 " float cy=cos(u_yaw),sy=sin(u_yaw),cp=cos(u_pitch),sp=sin(u_pitch);",
 " float px=cy*v.x+sy*v.z, pz=-sy*v.x+cy*v.z;",
 " float py=cp*v.y+sp*pz, vz=-sp*v.y+cp*pz;",
 " float depth=-vz;",
 " if(depth<=0.05 || depth>=100.0){gl_Position=vec4(3.0,3.0,3.0,1.0);gl_PointSize=1.0;return;}",
 " float cz=-1.0010005*vz-0.10005;",
 " gl_Position=vec4(px/(u_aspect*u_tan_half_fov),py/u_tan_half_fov,cz,depth);",
 " gl_PointSize=clamp(12.0*u_viewheight/(900.0*depth),1.5,18.0);",
 " v_color=a_color;",
 "}"
].join("\n");
const FRAGMENT_POINTS=[
 "precision mediump float;",
 "varying vec3 v_color;",
 "void main(){",
 " vec2 p=gl_PointCoord-vec2(0.5);",
 " if(dot(p,p)>0.25)discard;",
 " gl_FragColor=vec4(v_color,1.0);",
 "}"
].join("\n");
const VERTEX_ACTOR=[
 "attribute vec2 a_square,a_uv;",
 "uniform vec3 u_camera,u_anchor;",
 "uniform float u_yaw,u_pitch,u_aspect,u_tan_half_fov,u_actor_w,u_actor_h;",
 "varying vec2 v_uv;",
 "void main(){",
 " vec3 v=u_anchor-u_camera;",
 " float cy=cos(u_yaw),sy=sin(u_yaw),cp=cos(u_pitch),sp=sin(u_pitch);",
 " float px=cy*v.x+sy*v.z, pz=-sy*v.x+cy*v.z;",
 " float py=cp*v.y+sp*pz, vz=-sp*v.y+cp*pz;",
 " px+=a_square.x*u_actor_w;py+=a_square.y*u_actor_h;",
 " float depth=-vz;",
 " if(depth<=0.05 || depth>=100.0){gl_Position=vec4(3.0,3.0,3.0,1.0);return;}",
 " gl_Position=vec4(px/(u_aspect*u_tan_half_fov),py/u_tan_half_fov,",
 "   -1.0010005*vz-0.10005,depth);",
 " v_uv=a_uv;",
 "}"
].join("\n");
const FRAGMENT_ACTOR=[
 "precision mediump float;",
 "varying vec2 v_uv;",
 "uniform sampler2D u_subject;",
 "void main(){",
 " vec4 c=texture2D(u_subject,v_uv);",
 " if(c.a<0.045)discard;",
 " gl_FragColor=c;",
 "}"
].join("\n");
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
export function normalizedWorldCamera(raw={}){
 const finite=(x,d)=>Number.isFinite(x)?x:d;
 return {
  x:clamp(finite(raw.x,0),-5,5),
  y:clamp(finite(raw.y,0),-4,4),
  z:clamp(finite(raw.z,0),-5,5),
  yaw:((finite(raw.yaw,0)%360+540)%360)-180,
  pitch:clamp(finite(raw.pitch,0),-75,75),
  fov:clamp(finite(raw.fov,65),35,105)
 };
}
export function normalizedWorldActor(raw={}){
 const finite=(x,d)=>Number.isFinite(x)?x:d;
 return {
  x:clamp(finite(raw.x,0),-6,6),
  y:clamp(finite(raw.y,-.45),-6,6),
  z:clamp(finite(raw.z,-3.5),-12,-.5),
  height:clamp(finite(raw.height,1.7),.3,3)
 };
}
export function translateWorldCamera(camera,direction,amount=.35){
 const c=normalizedWorldCamera(camera);
 if(!Number.isFinite(amount)||amount<=0||amount>3)throw new RangeError("Invalid world step");
 const yaw=c.yaw*DEG;
 const forward=[Math.sin(yaw),0,-Math.cos(yaw)];
 const right=[Math.cos(yaw),0,Math.sin(yaw)];
 const vectors={
  forward,back:forward.map(v=>-v),right,left:right.map(v=>-v),
  up:[0,1,0],down:[0,-1,0]
 };
 const vec=vectors[direction];
 if(!vec)throw new RangeError("Unknown camera direction");
 return normalizedWorldCamera({
  ...c,x:c.x+amount*vec[0],y:c.y+amount*vec[1],z:c.z+amount*vec[2]
 });
}

const HEADER_LIMIT=8192;
const HEADER_PATTERN=/^ply\r?\nformat binary_little_endian 1\.0\r?\n[\s\S]*?\bend_header\r?\n/;
export function parseWorldPly(input){
 if(!(input instanceof ArrayBuffer)||input.byteLength<80||input.byteLength>WORLD_FILE_LIMIT){
  throw new RangeError("PLYは15MB以内のバイナリ点群を指定してください。");
 }
 const ascii=new TextDecoder("ascii").decode(new Uint8Array(input,0,Math.min(input.byteLength,HEADER_LIMIT)));
 const header=ascii.match(HEADER_PATTERN)?.[0];
 if(!header)throw new Error("PLY形式はbinary_little_endian 1.0のみ対応します。");
 const vertexLine=/^element vertex (\d+)$/m.exec(header);
 const count=vertexLine?Number(vertexLine[1]):NaN;
 if(!Number.isInteger(count)||count<3||count>WORLD_MAX_POINTS){
  throw new RangeError("3D頂点数は3〜800000に制限しています。");
 }
 const props=header.split(/\r?\n/).filter(line=>line.startsWith("property "));
 const expected=[
  "property float x","property float y","property float z",
  "property uchar red","property uchar green","property uchar blue"
 ];
 if(props.length!==expected.length||props.some((p,i)=>p!==expected[i])){
  throw new Error("PLY属性はfloat x,y,zとuchar red,green,blueに限ります。");
 }
 if(/\belement (?!vertex )/m.test(header))throw new Error("このPLYは点群だけに対応しています。");
 const offset=new TextEncoder().encode(header).length;
 const stride=15;
 if(input.byteLength!==offset+count*stride){
  throw new Error("PLYのヘッダーと頂点バイト数が一致しません。");
 }
 const data=new DataView(input,offset);
 const positions=new Float32Array(count*3), colors=new Uint8Array(count*3);
 const mins=[Infinity,Infinity,Infinity], maxs=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<count;i++){
  const pos=i*stride;
  for(let axis=0;axis<3;axis++){
   const value=data.getFloat32(pos+axis*4,true);
   if(!Number.isFinite(value)||Math.abs(value)>10000)throw new Error("PLYに不正な3D座標があります。");
   positions[i*3+axis]=value;
   mins[axis]=Math.min(mins[axis],value); maxs[axis]=Math.max(maxs[axis],value);
   colors[i*3+axis]=data.getUint8(pos+12+axis);
  }
 }
 return {positions,colors,count,bounds:{min:mins,max:maxs}};
}

export function demoWorld(){
 // Synthetic geometry only; never label these points as a real location.
 const data=[],rgb=[];
 const push=(x,y,z,r,g,b)=>{data.push(x,y,z);rgb.push(r,g,b);};
 for(let z=-1;z>=-22;z-=.22)for(let x=-10;x<=10;x+=.22){
  push(x,-1.45,z,Math.abs(x)<2.2?60:112,Math.abs(x)<2.2?70:119,Math.abs(x)<2.2?78:122);
 }
 for(const sign of [-1,1])for(let z=-1;z>=-22;z-=.19)for(let y=-1.4;y<=5;y+=.19){
  const windows=(Math.floor((-z)/1.6)%3===0)&&(Math.floor((y+2)/1.3)%2===0);
  push(sign*7.5,y,z,windows?235:113,windows?189:132,windows?114:153);
 }
 for(let z=-2;z>=-22;z-=.3)for(let y=-1.4;y<=4;y+=.3){
  if(Math.abs(z%5)<.26)for(const x of [-4.5,4.5])push(x,y,z,180,190,180);
 }
 return {positions:new Float32Array(data),colors:new Uint8Array(rgb),
  count:data.length/3,bounds:{min:[-10,-1.45,-22],max:[10,5,-1]}};
}

function createShader(gl,type,source){
 const s=gl.createShader(type);
 if(!s)throw new Error("WebGL shader unavailable");
 gl.shaderSource(s,source);gl.compileShader(s);
 if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
  const error=gl.getShaderInfoLog(s)||"unknown";gl.deleteShader(s);
  throw new Error("3D描画シェーダーの構築に失敗："+error);
 }
 return s;
}
function makeProgram(gl,vertex,fragment){
 const v=createShader(gl,gl.VERTEX_SHADER,vertex);
 const f=createShader(gl,gl.FRAGMENT_SHADER,fragment);
 const p=gl.createProgram();
 gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
 gl.deleteShader(v);gl.deleteShader(f);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS))
  throw new Error("3D描画プログラムの初期化に失敗："+gl.getProgramInfoLog(p));
 return p;
}
export class WorldPointRenderer {
 constructor(canvas){
  const gl=canvas.getContext("webgl",{alpha:false,depth:true,antialias:true,preserveDrawingBuffer:true});
  if(!gl)throw new Error("ブラウザのWebGLが利用できません。");
  this.canvas=canvas;this.gl=gl;this.data=null;this.actorImage=null;
  this.worldProgram=makeProgram(gl,VERTEX_POINTS,FRAGMENT_POINTS);
  this.actorProgram=makeProgram(gl,VERTEX_ACTOR,FRAGMENT_ACTOR);
  this.posBuffer=gl.createBuffer();this.colorBuffer=gl.createBuffer();
  this.actorBuffer=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,this.actorBuffer);
  // square offsets and UV; (left,bottom)->(0,0) etc.
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([
    -.5,-.5, 0,0, .5,-.5, 1,0, -.5,.5, 0,1,
    -.5,.5, 0,1, .5,-.5, 1,0, .5,.5, 1,1
  ]),gl.STATIC_DRAW);
  this.actorTexture=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,this.actorTexture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 }
 load(data){
  if(!(data?.positions instanceof Float32Array)
    ||!(data?.colors instanceof Uint8Array)
    ||data.positions.length!==data.colors.length
    ||data.count!==data.positions.length/3
    ||data.count<3||data.count>WORLD_MAX_POINTS)throw new Error("3D世界の点群形式が不正です。");
  const gl=this.gl;
  this.data=data;
  gl.bindBuffer(gl.ARRAY_BUFFER,this.posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER,data.positions,gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER,data.colors,gl.STATIC_DRAW);
 }
 setActor(image){
  this.actorImage=null;
  if(!image?.naturalWidth||!image?.naturalHeight)return;
  const gl=this.gl;
  gl.bindTexture(gl.TEXTURE_2D,this.actorTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
  if(gl.getError()!==gl.NO_ERROR)throw new Error("3D世界に人物画像を読み込めませんでした。");
  this.actorImage=image;
 }
 render(camera,actor,width,height){
  if(!this.data)throw new Error("3D点群を先に読み込んでください。");
  if(!Number.isInteger(width)||!Number.isInteger(height)
    ||width<1||height<1||width>2500||height>2500)throw new RangeError("Invalid 3D viewport dimensions");
  const gl=this.gl,view=normalizedWorldCamera(camera),person=normalizedWorldActor(actor);
  if(this.canvas.width!==width)this.canvas.width=width;
  if(this.canvas.height!==height)this.canvas.height=height;
  gl.viewport(0,0,width,height);
  gl.clearColor(.015,.035,.065,1);
  gl.clearDepth(1);
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);
  gl.disable(gl.BLEND);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

  const shared=(p)=>{
   gl.uniform3f(gl.getUniformLocation(p,"u_camera"),view.x,view.y,view.z);
   gl.uniform1f(gl.getUniformLocation(p,"u_yaw"),view.yaw*DEG);
   gl.uniform1f(gl.getUniformLocation(p,"u_pitch"),view.pitch*DEG);
   gl.uniform1f(gl.getUniformLocation(p,"u_aspect"),width/height);
   gl.uniform1f(gl.getUniformLocation(p,"u_tan_half_fov"),Math.tan(view.fov*DEG/2));
  };
  gl.useProgram(this.worldProgram);shared(this.worldProgram);
  gl.uniform1f(gl.getUniformLocation(this.worldProgram,"u_viewheight"),height);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.posBuffer);
  const p=gl.getAttribLocation(this.worldProgram,"a_position");
  gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,3,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.colorBuffer);
  const c=gl.getAttribLocation(this.worldProgram,"a_color");
  gl.enableVertexAttribArray(c);gl.vertexAttribPointer(c,3,gl.UNSIGNED_BYTE,true,0,0);
  gl.drawArrays(gl.POINTS,0,this.data.count);
  gl.disableVertexAttribArray(p);gl.disableVertexAttribArray(c);

  if(this.actorImage){
   gl.useProgram(this.actorProgram);shared(this.actorProgram);
   gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
   gl.depthMask(false);
   gl.uniform3f(gl.getUniformLocation(this.actorProgram,"u_anchor"),person.x,person.y,person.z);
   gl.uniform1f(gl.getUniformLocation(this.actorProgram,"u_actor_h"),person.height);
   gl.uniform1f(gl.getUniformLocation(this.actorProgram,"u_actor_w"),
     person.height*this.actorImage.naturalWidth/this.actorImage.naturalHeight);
   gl.bindBuffer(gl.ARRAY_BUFFER,this.actorBuffer);
   const a=gl.getAttribLocation(this.actorProgram,"a_square");
   const uv=gl.getAttribLocation(this.actorProgram,"a_uv");
   gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,0);
   gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.actorTexture);
   gl.uniform1i(gl.getUniformLocation(this.actorProgram,"u_subject"),0);
   gl.drawArrays(gl.TRIANGLES,0,6);
   gl.disableVertexAttribArray(a);gl.disableVertexAttribArray(uv);
   gl.depthMask(true);gl.disable(gl.BLEND);
  }
  const error=gl.getError();
  if(error!==gl.NO_ERROR)throw new Error("3D描画のWebGLエラー: "+error);
 }
 dispose(){
  const gl=this.gl;
  for(const buffer of [this.posBuffer,this.colorBuffer,this.actorBuffer])gl.deleteBuffer(buffer);
  gl.deleteTexture(this.actorTexture);
  gl.deleteProgram(this.worldProgram);gl.deleteProgram(this.actorProgram);
  this.data=null;
 }
}
