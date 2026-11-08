/**
 * Approximate, relative-depth occlusion. Not metric 3D geometry.
 *
 * Input is a grayscale Depth Anything V2 output (0..255). "Near = bright"
 * is a user-adjustable convention, not a calibrated measurement of meters.
 * Pixels selected as foreground reveal the ORIGINAL, licensed photo over the
 * composited subject. This does not hallucinate missing street imagery.
 */
export const DEPTH_MASK_SIZE = Object.freeze({width:800,height:450});
export const DEPTH_MODEL = "depth-anything/Depth-Anything-V2-Small-hf";
export const DEFAULT_OCCLUSION = Object.freeze({
  threshold:0.65,  // fractional scale, not metres
  feather:0.04,    // relative transition width
  invert:false,
  enabled:false
});

export function occlusionOptions(value={}) {
  const finite=(n,d)=>Number.isFinite(n)?n:d;
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  return {
    threshold:clamp(finite(value.threshold,DEFAULT_OCCLUSION.threshold),0,1),
    feather:clamp(finite(value.feather,DEFAULT_OCCLUSION.feather),0,0.25),
    invert:value.invert===true,
    enabled:value.enabled===true
  };
}

export function foregroundOpacity(grayscale,options={}) {
  const o=occlusionOptions(options);
  const pixel=Number.isFinite(grayscale)?Math.min(255,Math.max(0,grayscale)):0;
  const normalized=o.invert?1-pixel/255:pixel/255;
  const soft=Math.max(1/255,o.feather);
  const t=(normalized-o.threshold)/soft+0.5;
  return Math.round(255*Math.max(0,Math.min(1,t)));
}

/**
 * The output is RGBA white with alpha from relative depth.
 * Inputs are RGBA pixel data returned by CanvasRenderingContext2D.getImageData.
 */
export function depthImageToAlphaMask(imageBytes,options={}) {
  if(!(imageBytes instanceof Uint8ClampedArray) || imageBytes.length%4!==0) {
    throw new TypeError("Depth pixels must be a four-channel Uint8ClampedArray.");
  }
  if(imageBytes.length>DEPTH_MASK_SIZE.width*DEPTH_MASK_SIZE.height*4*4) {
    throw new RangeError("Depth image is too large.");
  }
  const alpha=new Uint8ClampedArray(imageBytes.length);
  for(let offset=0;offset<imageBytes.length;offset+=4) {
    const intensity=imageBytes[offset]; // depth provider returns grayscale RGB
    alpha[offset]=255;
    alpha[offset+1]=255;
    alpha[offset+2]=255;
    alpha[offset+3]=foregroundOpacity(intensity,options);
  }
  return alpha;
}

export function occlusionStroke(x,y,radiusPx,mode="foreground") {
  if(!Number.isFinite(x)||!Number.isFinite(y)
    ||x<0||x>1||y<0||y>1||!Number.isFinite(radiusPx)||radiusPx<2||radiusPx>120
    ||!["foreground","erase"].includes(mode)) {
    throw new RangeError("Invalid mask brush stroke.");
  }
  return {x,y,radiusPx,mode};
}

export function depthResponseLooksValid(value) {
  return Boolean(value&&value.relativeOnly===true
    &&value.model===DEPTH_MODEL
    &&Number.isInteger(value.width)&&value.width>0&&value.width<=2048
    &&Number.isInteger(value.height)&&value.height>0&&value.height<=2048
    &&typeof value.depthMap==="string"
    &&/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.depthMap)
    &&value.depthMap.length<=3_000_000);
}
