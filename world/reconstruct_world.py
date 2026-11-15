#!/usr/bin/env python3
"""Reconstruct local overlapping photographs using Apache-2.0 MapAnything.

Output is a bounded, binary little-endian XYZRGB point cloud and provenance
JSON. This program estimates geometry; it does NOT invent missing views or
register the point cloud to surveyed WGS84 coordinates.

Install official github.com/facebookresearch/map-anything and its requirements.
Checkpoint: facebook/map-anything-apache (Apache 2.0, not NC version).
"""
from __future__ import annotations
import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

MODEL_ID="facebook/map-anything-apache"

def validate_images(folder:Path,max_files:int=12)->list[Path]:
    if not folder.is_dir():
        raise ValueError("Source image directory not found.")
    if not 2<=max_files<=12:
        raise ValueError("Number of images must be between 2 and 12.")
    paths=sorted(p for p in folder.iterdir() if p.is_file() and not p.is_symlink()
                 and p.suffix.lower() in (".jpg",".jpeg",".png",".webp"))
    if not 2<=len(paths)<=max_files:
        raise ValueError(f"Need 2..{max_files} overlapping scene images; got {len(paths)}.")
    from PIL import Image
    for path in paths:
        if path.stat().st_size<100 or path.stat().st_size>15_000_000:
            raise ValueError(f"Invalid file size: {path.name}")
        try:
            with Image.open(path) as im:
                im.verify()
            with Image.open(path) as im:
                if im.width<128 or im.height<128 or im.width*im.height>30_000_000:
                    raise ValueError(f"Invalid image dimensions: {path.name}")
        except OSError as error:
            raise ValueError(f"Cannot decode image: {path.name}") from error
    return paths

def to_numpy(value):
    import numpy as np
    if hasattr(value,"detach"):value=value.detach().cpu().numpy()
    return np.asarray(value)

def export_points(predictions,max_points=180_000,max_depth=90.,confidence_percentile=20):
    """Convert MapAnything first-camera-relative points to WebGL coordinates.

    MapAnything 'camera_poses': OpenCV camera-to-world 4x4 matrices.
    MapAnything 'pts3d': B,H,W,3 world-frame positions.
    OpenCV +Y-down/+Z-forward -> WebGL +Y-up/-Z-forward.
    Units may drift without a calibrated baseline; no WGS84 claim.
    """
    import numpy as np
    if not 2<=len(predictions)<=12 or not 100<=max_points<=800_000:
        raise ValueError("Bad view count or output point budget.")
    if not 1<=max_depth<=500 or not 0<=confidence_percentile<=90:
        raise ValueError("Invalid filtering bounds.")
    reference=to_numpy(predictions[0]["camera_poses"]).reshape(-1,4,4)[0]
    if not np.all(np.isfinite(reference)):raise ValueError("Non-finite camera pose.")
    matrix=reference[:3,:3].astype("float64")
    if abs(np.linalg.det(matrix))<0.05:raise ValueError("Invalid camera pose.")
    inv=np.linalg.inv(matrix)
    origin=reference[:3,3].astype("float64")
    positions=[];colors=[]
    per_view=max(100,max_points//len(predictions))
    for pred in predictions:
        raw=to_numpy(pred["pts3d"])
        if raw.ndim==4:raw=raw[0]
        if raw.ndim!=3 or raw.shape[-1]!=3:raise ValueError("pts3d must be HxWx3.")
        h,w,_=raw.shape
        rgb=to_numpy(pred["img_no_norm"])
        if rgb.ndim==4:rgb=rgb[0]
        if rgb.shape!=(h,w,3):raise ValueError("Point/image resolution mismatch.")
        confidence=to_numpy(pred["conf"]).reshape(h,w)
        visible=to_numpy(pred["mask"]).reshape(h,w).astype(bool)
        rel=(raw.astype("float64")-origin)@inv.T
        valid=visible&np.isfinite(rel).all(axis=2)&np.isfinite(confidence)
        valid&=(rel[:,:,2]>.1)&(rel[:,:,2]<max_depth)
        if not np.any(valid):continue
        threshold=np.percentile(confidence[valid],confidence_percentile)
        valid&=(confidence>=threshold)
        stride=max(1,math.ceil(math.sqrt(h*w/per_view)))
        grid=np.zeros((h,w),dtype=bool)
        grid[::stride,::stride]=True
        indices=np.flatnonzero((valid&grid).reshape(-1))
        if indices.size>per_view:
            indices=indices[np.linspace(0,indices.size-1,per_view,dtype=np.int64)]
        if not indices.size:continue
        xyz=rel.reshape(-1,3)[indices].astype("float32")
        xyz[:,1]*=-1
        xyz[:,2]*=-1
        colour=rgb.reshape(-1,3)[indices].astype("float32")
        if colour.size and float(np.nanmax(colour))<=1.5:colour*=255.
        colour=np.clip(np.nan_to_num(colour,nan=0.,posinf=255.),0,255).astype("uint8")
        positions.append(xyz);colors.append(colour)
    if not positions:raise ValueError("No visible confident 3D points were recovered.")
    xyz=np.concatenate(positions);rgb=np.concatenate(colors)
    if len(xyz)>max_points:
        pick=np.linspace(0,len(xyz)-1,max_points,dtype=np.int64)
        xyz=xyz[pick];rgb=rgb[pick]
    if len(xyz)<100:raise ValueError("Too few reconstructed points. Supply overlapping photos.")
    return xyz,rgb

def write_ply(path:Path,positions,colors)->int:
    import numpy as np
    xyz=np.asarray(positions,dtype="<f4")
    rgb=np.asarray(colors,dtype="u1")
    if xyz.ndim!=2 or xyz.shape[1]!=3 or rgb.shape!=xyz.shape or not 3<=len(xyz)<=800_000:
        raise ValueError("Invalid PLY geometry or RGB shape.")
    if not np.isfinite(xyz).all() or np.max(np.abs(xyz))>10_000:
        raise ValueError("PLY contains unsafe point coordinates.")
    layout=np.dtype([("x","<f4"),("y","<f4"),("z","<f4"),
                     ("red","u1"),("green","u1"),("blue","u1")],align=False)
    assert layout.itemsize==15
    packed=np.empty(len(xyz),dtype=layout)
    for i,name in enumerate(("x","y","z")):packed[name]=xyz[:,i]
    for i,name in enumerate(("red","green","blue")):packed[name]=rgb[:,i]
    header=(
        "ply\nformat binary_little_endian 1.0\n"
        "comment model=facebook/map-anything-apache\n"
        "comment coordinates=first-camera-OpenGL\n"
        "comment geographic_registration=NOT_VERIFIED\n"
        f"element vertex {len(xyz)}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    ).encode("ascii")
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("wb") as output:
        output.write(header);output.write(packed.tobytes())
    if path.stat().st_size>15_000_000:
        path.unlink()
        raise ValueError("Output exceeds the browser's 15MB safety limit.")
    return len(xyz)

def run_model(files,allow_cpu=False):
    import torch
    from mapanything.models import MapAnything
    from mapanything.utils.image import load_images
    device="cuda" if torch.cuda.is_available() else "cpu"
    if device=="cpu" and not allow_cpu:
        raise RuntimeError(
            "CUDA is needed for regular MapAnything inference. "
            "Use --allow-cpu only for slow experiments."
        )
    model=MapAnything.from_pretrained(MODEL_ID).to(device).eval()
    views=load_images([str(f) for f in files])
    with torch.inference_mode():
        predictions=model.infer(
            views,memory_efficient_inference=True,minibatch_size=1,
            use_amp=device=="cuda",amp_dtype="bf16",
            apply_mask=True,mask_edges=True,apply_confidence_mask=True,
            confidence_percentile=20,use_multiview_confidence=False
        )
    return predictions,device

def create_manifest(out:Path,images:list[Path],count:int,device:str,
                    lat:float|None,lon:float|None, alignment=None,
                    photo_sources=None, alignment_error=None):
    if (lat is None)!=(lon is None):raise ValueError("lat/lon must be supplied together.")
    if lat is not None and (not math.isfinite(lat) or not math.isfinite(lon)
       or not -90<=lat<=90 or not -180<=lon<=180):
        raise ValueError("Invalid WGS84 coordinate.")
    data={
        "schemaVersion":1,"type":"predicted-multiview-pointcloud",
        "model":MODEL_ID,"modelLicense":"Apache-2.0",
        "format":"binary_little_endian_ply_xyzrgb",
        "sourceImages":[p.name for p in images],"count":len(images),
        "points":count,"device":device,
        "geometryFrame":"first camera: X right, Y up, -Z forward",
        "estimatedMetric":True,"cameraPoseVerified":False,
        "geographicReference":{"lat":lat,"lon":lon,"registered":False}
            if lat is not None else None,
        "unobservedRegions":"No points where source data is insufficient.",
        "estimatedGpsAlignment":alignment,
        "estimatedGpsAlignmentError":alignment_error,
        "sourcePhotoAttribution":photo_sources,
        "createdAt":datetime.now(timezone.utc).isoformat()
    }
    out.with_suffix(".json").write_text(
        json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf8"
    )

def main(argv=None)->int:
    p=argparse.ArgumentParser(description="Local MapAnything 3D from licensed overlapping images")
    p.add_argument("--images",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True,help="Output .ply path")
    p.add_argument("--accept-image-rights",action="store_true",required=True)
    p.add_argument("--allow-cpu",action="store_true")
    p.add_argument("--max-points",type=int,default=180_000)
    p.add_argument("--lat",type=float)
    p.add_argument("--lon",type=float)
    a=p.parse_args(argv)
    if (a.lat is None)!=(a.lon is None):p.error("--lat and --lon must be paired")
    photos=validate_images(a.images)
    predicted,device=run_model(photos,a.allow_cpu)
    xyz,rgb=export_points(predicted,a.max_points)
    count=write_ply(a.output,xyz,rgb)
    sources_file=a.images/"sources.json"
    alignment=None
    reason=None
    sources=None
    if sources_file.exists():
        manifest=json.loads(sources_file.read_text("utf8"))
        from world.georegister import align_from_predictions
        try:
            alignment=align_from_predictions(predicted,photos,manifest)
        except (KeyError,TypeError,ValueError,ArithmeticError) as error:
            reason=str(error)
        if isinstance(manifest.get("photos"),list):
            sources=[
                {k:p.get(k) for k in ("filename","provider","creator","license",
                  "licenseSpdx","licenseUrl","viewerUrl","captureDate")
                 if isinstance(p.get(k),(str,int,float,type(None)))}
                for p in manifest["photos"][:12] if isinstance(p,dict)
            ]
    create_manifest(a.output,photos,count,device,a.lat,a.lon,
                    alignment=alignment,photo_sources=sources,alignment_error=reason)
    print(json.dumps({"ply":str(a.output),"points":count,
                      "model":MODEL_ID,"device":device,"registrationVerified":False}))
    return 0

if __name__=="__main__":
    try:sys.exit(main())
    except (ValueError,ImportError,RuntimeError) as error:
        print("Reconstruction failed:",error,file=sys.stderr)
        sys.exit(2)
