"""No GPU/model weight tests for the MapAnything reconstruction exporter."""
import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent.parent
FILE=ROOT/"world"/"reconstruct_world.py"
spec=importlib.util.spec_from_file_location("vlc_world_export",FILE)
world=importlib.util.module_from_spec(spec)
spec.loader.exec_module(world)

class ReconstructedWorldTests(unittest.TestCase):
    def sample_predictions(self):
        h,w=24,32
        yy,xx=np.mgrid[:h,:w]
        # First OpenCV camera at world origin (0,0,0), +Z forward.
        coords=np.stack(((xx-w/2)*.12,(yy-h/2)*.12,np.full((h,w),4.5)),axis=2)
        camera=np.eye(4,dtype=np.float32)[None]
        samples=[]
        for colour in ([0.,.95,.2],[.2,.5,1.]):
            rgb=np.empty((1,h,w,3),dtype=np.float32)
            rgb[:]=colour
            samples.append({
                "pts3d":coords[None].astype(np.float32),
                "img_no_norm":rgb,
                "camera_poses":camera,
                "conf":np.ones((1,h,w),dtype=np.float32),
                "mask":np.ones((1,h,w,1),dtype=bool)
            })
        return samples

    def test_true_3d_coordinates_and_colours_from_multiview_prediction(self):
        xyz,rgb=world.export_points(self.sample_predictions(),max_points=400)
        self.assertEqual(xyz.shape[1],3)
        self.assertEqual(xyz.shape,rgb.shape)
        self.assertTrue(len(xyz)>=100 and len(xyz)<=400)
        self.assertTrue(np.all(xyz[:,2]<0),"OpenCV +Z must convert to OpenGL -Z")
        self.assertAlmostEqual(float(np.mean(xyz[:,2])),-4.5,places=4)
        self.assertTrue(np.any(rgb[:,1]>180))
        self.assertGreater(np.unique(rgb,axis=0).shape[0],1,
                           "Predictions from two source views should carry RGB")

    def test_camera_origin_is_reference_image_and_not_assumed_gps(self):
        frames=self.sample_predictions()
        origin=np.eye(4,dtype=np.float32)
        origin[:3,3]=[12.,-3.,6.]
        for p in frames:
            p["pts3d"]=p["pts3d"]+np.array([12.,-3.,6.],np.float32)
            p["camera_poses"]=origin[None]
        xyz,_=world.export_points(frames,max_points=400)
        self.assertAlmostEqual(float(np.mean(xyz[:,2])),-4.5,places=4)
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"world.ply"
            count=world.write_ply(path,xyz,np.zeros_like(xyz,dtype=np.uint8))
            world.create_manifest(path,[Path("a.jpg"),Path("b.jpg")],
                                  count,"mock",48.8584,2.2945)
            data=json.loads(path.with_suffix(".json").read_text("utf8"))
            self.assertFalse(data["geographicReference"]["registered"])
            self.assertFalse(data["cameraPoseVerified"])
            self.assertEqual(data["model"],"facebook/map-anything-apache")
            self.assertEqual(data["modelLicense"],"Apache-2.0")

    def test_binary_ply_matches_browser_vertex_layout_exactly(self):
        xyz=np.array([[1.,2.,-4.],[.5,-.1,-3.],[0.,0.,-6.]],dtype=np.float32)
        rgb=np.array([[250,10,20],[10,220,30],[30,40,230]],dtype=np.uint8)
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/"world.ply"
            self.assertEqual(world.write_ply(file,xyz,rgb),3)
            blob=file.read_bytes()
            self.assertTrue(blob.startswith(b"ply\nformat binary_little_endian 1.0\n"))
            p=blob.index(b"end_header\n")+len(b"end_header\n")
            self.assertEqual(len(blob)-p,3*15)
            values=struct.unpack_from("<fffBBB",blob,p)
            self.assertEqual(values[:3],(1.,2.,-4.))
            self.assertEqual(values[3:],(250,10,20))

    def test_prediction_validation_never_exports_corrupt_geometry(self):
        frames=self.sample_predictions()
        frames[0]["pts3d"][:]=np.nan
        frames[1]["pts3d"][:]=np.nan
        with self.assertRaises(ValueError):
            world.export_points(frames,max_points=400)
        with self.assertRaises(ValueError):
            world.write_ply(Path("/tmp/neverwrite.ply"),
                np.array([[np.nan,0,0]]*3,dtype=np.float32),
                np.zeros((3,3),dtype=np.uint8))
        with self.assertRaises(ValueError):
            world.export_points(self.sample_predictions(),max_points=0)

    def test_licensed_image_collection_validation_and_missing_pairs(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            Image.new("RGB",(240,180),(20,40,90)).save(path/"a.jpg")
            Image.new("RGB",(240,180),(100,40,90)).save(path/"b.jpg")
            self.assertEqual(len(world.validate_images(path)),2)
            Image.new("RGB",(20,20),(10,10,10)).save(path/"c.jpg")
            with self.assertRaises(ValueError):
                world.validate_images(path)
            with self.assertRaises(ValueError):
                world.create_manifest(path/"a.ply",[path/"a.jpg"],100,
                                      "mock",90.,None)

if __name__=="__main__":
    unittest.main()
