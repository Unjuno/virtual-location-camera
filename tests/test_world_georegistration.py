"""Independent geometry checks for approximate camera-to-GPS alignment."""
import unittest
import math
import numpy as np
from pathlib import Path
from world.georegister import estimate_gps_alignment,align_from_predictions

class GeoregistrationTests(unittest.TestCase):
    def fixture(self):
        latitude,longitude=48.85,2.30
        east=4.0/(111320*math.cos(math.radians(latitude)))
        north=3.0/111320
        sources=[
            {"lat":latitude,"lon":longitude,"filename":"01.jpg"},
            {"lat":latitude,"lon":longitude+east,"filename":"02.jpg"},
            {"lat":latitude+north,"lon":longitude,"filename":"03.jpg"}
        ]
        poses=np.stack([np.eye(4) for _ in range(3)])
        poses[1,:3,3]=[0,0,4]  # OpenCV +Z forward -> WebGL -Z, GPS east
        poses[2,:3,3]=[3,0,0]  # WebGL +X, GPS north
        return poses,sources

    def test_two_dimensional_similarity_recovers_scale_rotation_and_location(self):
        poses,sources=self.fixture()
        fitted=estimate_gps_alignment(poses,sources)
        self.assertEqual(fitted["type"],"estimated-planar-local-ENU-similarity")
        self.assertAlmostEqual(fitted["scale"],1.,delta=0.002)
        self.assertAlmostEqual(fitted["residualRmseMeters"],0.,delta=0.01)
        self.assertFalse(fitted["surveyVerified"])
        self.assertFalse(fitted["heightAligned"])
        rotation=np.array(fitted["worldToENU2x2"])
        np.testing.assert_allclose(rotation.T@rotation,np.eye(2),atol=1e-5)

    def test_manifest_requires_same_frame_order_as_inference(self):
        poses,sources=self.fixture()
        predictions=[{"camera_poses":p[None]} for p in poses]
        paths=[Path(p["filename"]) for p in sources]
        fitted=align_from_predictions(predictions,paths,{"photos":sources})
        self.assertEqual(fitted["cameraCount"],3)
        with self.assertRaises(ValueError):
            align_from_predictions(predictions,list(reversed(paths)),{"photos":sources})

    def test_never_claims_surveyed_geo_accuracy_when_model_is_degenerate(self):
        poses,sources=self.fixture()
        copies=poses.copy()
        copies[:,:3,3]=0
        with self.assertRaisesRegex(ValueError,"trajectory|motion"):
            estimate_gps_alignment(copies,sources)
        geo=[dict(x,lat=48.85,lon=2.30) for x in sources]
        with self.assertRaises(ValueError):
            estimate_gps_alignment(poses,geo)
        with self.assertRaises(ValueError):
            estimate_gps_alignment(poses[:1],geo[:1])
        geo[1]["lat"]=91.0
        with self.assertRaises(ValueError):
            estimate_gps_alignment(poses,geo)

    def test_small_gps_noise_is_reported_not_ignored(self):
        poses,sources=self.fixture()
        sources[2]["lat"]+=1/111320
        fit=estimate_gps_alignment(poses,sources)
        self.assertGreater(fit["residualRmseMeters"],0.01)
        self.assertFalse(fit["surveyVerified"])

if __name__=="__main__":
    unittest.main()
