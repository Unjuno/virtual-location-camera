"""Estimated GPS alignment for 2..12 MapAnything camera poses.

Not a surveyed registration: for local image sequences, WGS84 image coords
are projected to an approximate ENU tangent plane and compared with predicted
camera centres using a least-squares 2D similarity (rotation + scale + shift).
Height and gravity remain unregistered; errors are reported, not concealed.
"""
from __future__ import annotations
import math

def estimate_gps_alignment(camera_poses, source_photos):
    """Fit a world X/Z to local East/North similarity without claiming survey QA."""
    import numpy as np
    poses=np.asarray(camera_poses,dtype="float64")
    if poses.ndim!=3 or poses.shape[1:]!=(4,4) or len(poses)!=len(source_photos):
        raise ValueError("Source photo/GPU camera count mismatch.")
    if len(poses)<2:raise ValueError("Two or more camera observations are required.")
    if not np.isfinite(poses).all():raise ValueError("Invalid predicted pose.")
    gps=np.array([[float(x["lat"]),float(x["lon"])] for x in source_photos],dtype="float64")
    if not np.isfinite(gps).all() or np.max(np.abs(gps[:,0]))>85 or np.max(np.abs(gps[:,1]))>180:
        raise ValueError("Invalid WGS84 geotag values.")
    if np.ptp(gps[:,0])>0.01 or np.ptp(gps[:,1])>0.02:
        raise ValueError("Observations are too far apart for local ENU approximation.")
    lat0,lon0=gps[0]
    gps_xy=np.stack((
        (gps[:,1]-lon0)*111320*math.cos(math.radians(lat0)),
        (gps[:,0]-lat0)*111320
    ),axis=1)
    first=poses[0]
    to_ref=np.linalg.inv(first[:3,:3])
    camera_xyz=(poses[:,:3,3]-first[:3,3])@to_ref.T
    model_xy=np.stack((camera_xyz[:,0],-camera_xyz[:,2]),axis=1)
    x=model_xy-model_xy.mean(axis=0)
    y=gps_xy-gps_xy.mean(axis=0)
    baseline=float(np.max(np.linalg.norm(x[:,None]-x[None,:],axis=2)))
    gps_span=float(np.max(np.linalg.norm(y[:,None]-y[None,:],axis=2)))
    if baseline<0.03 or gps_span<1.5:
        raise ValueError("Insufficient observed camera motion to estimate alignment.")
    u,_,vt=np.linalg.svd(x.T@y)
    reflection=np.diag([1.,-1.]) if np.linalg.det(u@vt)<0 else np.eye(2)
    rot=u@reflection@vt
    scale=float(np.sum((x@rot)*y)/np.sum(x*x))
    if not math.isfinite(scale) or not 0.05<=scale<=100.:
        raise ValueError("Invalid estimated scale.")
    offset=gps_xy.mean(axis=0)-scale*(model_xy.mean(axis=0)@rot)
    predicted=scale*(model_xy@rot)+offset
    errors=np.linalg.norm(predicted-gps_xy,axis=1)
    rmse=float(np.sqrt(np.mean(errors*errors)))
    if not math.isfinite(rmse):raise ValueError("Non-finite GPS fit residual.")
    return {
        "type":"estimated-planar-local-ENU-similarity",
        "cameraCoordinates":"first-camera-OpenGL-XZ",
        "targetCoordinates":"local-ENU-east-north",
        "anchorWGS84":{"lat":float(lat0),"lon":float(lon0)},
        "worldToENU2x2":rot.tolist(),
        "scale":scale,"offsetEastNorthMeters":offset.tolist(),
        "residualRmseMeters":rmse,
        "cameraCount":len(poses),
        "observedGpsSpanMeters":gps_span,
        "modelBaselineUnits":baseline,
        "heightAligned":False,
        "surveyVerified":False,
        "accuracy":"estimated only; no ground control or visual correspondence QA"
    }

def align_from_predictions(predictions, photo_paths, source_manifest):
    import numpy as np
    metadata=source_manifest.get("photos") if isinstance(source_manifest,dict) else None
    if not isinstance(metadata,list) or len(metadata)!=len(photo_paths):
        raise ValueError("The photo manifest and image count differ.")
    if [r.get("filename") for r in metadata]!=[p.name for p in photo_paths]:
        raise ValueError("The photo manifest and inference frame order differ.")
    poses=[]
    for item in predictions:
        p=item["camera_poses"]
        if hasattr(p,"detach"):p=p.detach().cpu().numpy()
        poses.append(np.asarray(p).reshape(-1,4,4)[0])
    return estimate_gps_alignment(poses,metadata)
