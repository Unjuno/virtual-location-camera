// Cloud static demo does not run a neural depth model. GPU inference is
// available solely on the loopback Python worker (server/local_ai.py).
export default function handler(req,res){
  res.statusCode=req.method==="GET"?200:405;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.end(JSON.stringify({
    available:false,
    model:"depth-anything/Depth-Anything-V2-Small-hf",
    mode:"local-python-only",
    message:"深度推定はローカルPythonサーバーとGPUが必要です。前景ブラシはWeb版でも利用できます。"
  }));
}
