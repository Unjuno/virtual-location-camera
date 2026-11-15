/**
 * Perspective views into a REAL 360-degree equirectangular photograph.
 * The camera rotates at one observation point; it never translates.
 * No novel-view synthesis, depth recovery, paid API or photo upload.
 */
export const DEFAULT_PANORAMA_VIEW = Object.freeze({
  enabled:false, yaw:0, pitch:0, horizontalFov:75
});
const PI=Math.PI, RAD=PI/180;
const VERTEX_SHADER=[
  "attribute vec2 a_position;",
  "varying vec2 v_uv;",
  "void main(){v_uv=0.5*(a_position+1.0);gl_Position=vec4(a_position,0.0,1.0);}"
].join("\n");
const FRAGMENT_SHADER=[
  "precision highp float;",
  "varying vec2 v_uv;",
  "uniform sampler2D u_image;",
  "uniform float u_yaw,u_pitch,u_tan_half_fov,u_aspect;",
  "const float PI=3.14159265358979323846;",
  "void main(){",
  "  vec2 screen=v_uv*2.0-1.0;",
  "  vec3 camera=normalize(vec3(screen.x*u_tan_half_fov,",
  "        screen.y*u_tan_half_fov/u_aspect,-1.0));",
  "  float cp=cos(u_pitch),sp=sin(u_pitch);",
  "  vec3 tilt=vec3(camera.x,camera.y*cp-camera.z*sp,camera.y*sp+camera.z*cp);",
  "  float cy=cos(u_yaw),sy=sin(u_yaw);",
  "  vec3 world=vec3(tilt.x*cy-tilt.z*sy,tilt.y,tilt.x*sy+tilt.z*cy);",
  "  float angle=atan(world.x,-world.z);",
  "  vec2 uv=vec2(fract(0.5+angle/(2.0*PI)),",
  "               0.5+asin(clamp(world.y,-1.0,1.0))/PI);",
  "  gl_FragColor=texture2D(u_image,uv);",
  "}"
].join("\n");
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
export function wrapPanoramaYaw(value){
  if(!Number.isFinite(value))return 0;
  return ((value+180)%360+360)%360-180;
}

export function normalizePanoramaView(raw={}){
  return {
    enabled:raw.enabled===true,
    yaw:wrapPanoramaYaw(raw.yaw),
    pitch:clamp(Number.isFinite(raw.pitch)?raw.pitch:0,-65,65),
    horizontalFov:clamp(Number.isFinite(raw.horizontalFov)?raw.horizontalFov:75,35,110)
  };
}
export function isEquirectangularDimensions(width,height){
  return Number.isFinite(width)&&Number.isFinite(height)&&width>=512&&height>=256
    &&Math.abs(width/height-2)<=0.08;
}
/**
 * Direction of one perspective pixel in a standard full-sphere panorama.
 * x,y: fractions in the perspective frame. Aspect: width/height.
 * u,v: fractions in source panorama, with 0 at the TOP left.
 * Heading is relative to the panorama center, not verified true north.
 */
export function perspectiveToEquirectangular(x,y,aspect,settings={}){
  if(![x,y,aspect].every(Number.isFinite)||x<0||x>1||y<0||y>1||aspect<=0)
    throw new RangeError("Invalid perspective pixel or aspect ratio.");
  const view=normalizePanoramaView(settings);
  const half=Math.tan(view.horizontalFov*RAD/2);
  const xx=(2*x-1)*half, yy=(1-2*y)*half/aspect;
  const norm=Math.hypot(xx,yy,1);
  const dx=xx/norm, dy=yy/norm, dz=-1/norm;
  const cp=Math.cos(view.pitch*RAD),sp=Math.sin(view.pitch*RAD);
  const py=dy*cp-dz*sp, pz=dy*sp+dz*cp;
  const cy=Math.cos(view.yaw*RAD),sy=Math.sin(view.yaw*RAD);
  const wx=dx*cy-pz*sy, wz=dx*sy+pz*cy;
  return {
    u:((0.5+Math.atan2(wx,-wz)/(2*PI))%1+1)%1,
    v:clamp(0.5-Math.asin(clamp(py,-1,1))/PI,0,1)
  };
}
function shader(gl,type,code){
  const result=gl.createShader(type);
  if(!result)throw new Error("360°画像のWebGLシェーダーを作成できません。");
  gl.shaderSource(result,code);
  gl.compileShader(result);
  if(!gl.getShaderParameter(result,gl.COMPILE_STATUS)){
    const reason=gl.getShaderInfoLog(result)||"Unknown shader error";
    gl.deleteShader(result);
    throw new Error("360°画像の描画準備に失敗しました: "+reason);
  }
  return result;
}
export class PanoramaProjector {
  constructor({documentObject=document}={}){
    const canvas=documentObject.createElement("canvas");
    const gl=canvas.getContext("webgl",{alpha:false,antialias:false,preserveDrawingBuffer:true,
      depth:false,stencil:false});
    if(!gl)throw new Error("360°画像の視点変更にはWebGLが必要です。通常の背景写真は利用できます。");
    const vertex=shader(gl,gl.VERTEX_SHADER,VERTEX_SHADER);
    const fragment=shader(gl,gl.FRAGMENT_SHADER,FRAGMENT_SHADER);
    const program=gl.createProgram();
    gl.attachShader(program,vertex);gl.attachShader(program,fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
      throw new Error("Panorama WebGL shader link failed: "+(gl.getProgramInfoLog(program)||""));
    }
    const buffer=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([
      -1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1
    ]),gl.STATIC_DRAW);
    const texture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    // Non-power-of-two 2:1 photos require CLAMP_TO_EDGE in WebGL 1.
    // Longitude wrapping is handled by the fract() in the fragment shader.
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.gl=gl;this.canvas=canvas;this.program=program;
    this.texture=texture;this.buffer=buffer;
    this.source=null;this.documentObject=documentObject;
    this.uniforms={
      yaw:gl.getUniformLocation(program,"u_yaw"),
      pitch:gl.getUniformLocation(program,"u_pitch"),
      fov:gl.getUniformLocation(program,"u_tan_half_fov"),
      aspect:gl.getUniformLocation(program,"u_aspect"),
      image:gl.getUniformLocation(program,"u_image")
    };
    this.position=gl.getAttribLocation(program,"a_position");
  }
  load(image){
    if(!isEquirectangularDimensions(image?.naturalWidth,image?.naturalHeight))
      throw new Error("360°全天球画像は横:縦=2:1の写真を選んでください。");
    if(this.source===image)return;
    const {gl,texture}=this;
    const maximum=Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE)||2048,8192);
    const scale=Math.min(1,maximum/image.naturalWidth,maximum/image.naturalHeight);
    const safeW=Math.max(2,Math.floor(image.naturalWidth*scale/2)*2);
    const safeH=Math.max(1,Math.floor(safeW/2));
    const preview=this.documentObject.createElement("canvas");
    preview.width=safeW;preview.height=safeH;
    const ctx=preview.getContext("2d");
    if(!ctx)throw new Error("Panorama texture preparation failed.");
    ctx.drawImage(image,0,0,safeW,safeH);
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,preview);
    const error=gl.getError();
    if(error!==gl.NO_ERROR)throw new Error("Panorama texture upload failed (WebGL "+error+").");
    this.source=image;
  }
  render(targetContext,image,view,width,height){
    if(!(width>0&&height>0&&width<=4096&&height<=4096))
      throw new RangeError("Panorama output dimensions must be positive and <=4096.");
    const {gl,canvas,program}=this;
    this.load(image);
    if(canvas.width!==width||canvas.height!==height){
      canvas.width=width;canvas.height=height;
    }
    gl.viewport(0,0,width,height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,0,0);
    gl.enableVertexAttribArray(this.position);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,this.texture);
    const v=normalizePanoramaView(view);
    gl.uniform1i(this.uniforms.image,0);
    gl.uniform1f(this.uniforms.yaw,v.yaw*RAD);
    gl.uniform1f(this.uniforms.pitch,v.pitch*RAD);
    gl.uniform1f(this.uniforms.fov,Math.tan(v.horizontalFov*RAD/2));
    gl.uniform1f(this.uniforms.aspect,width/height);
    gl.drawArrays(gl.TRIANGLES,0,6);
    const error=gl.getError();
    if(error!==gl.NO_ERROR)throw new Error("Panorama rendering failed (WebGL "+error+").");
    targetContext.drawImage(canvas,0,0,width,height);
  }
  invalidate(){this.source=null;}
  dispose(){
    const {gl}=this;
    gl.deleteTexture(this.texture);gl.deleteBuffer(this.buffer);
    gl.deleteProgram(this.program);
    this.source=null;
  }
}
