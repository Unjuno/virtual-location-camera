// Cloud deployment is a map/photography demo only.
// Do not advertise AI availability without real GPU-backed inference.
export default function handler(req, res) {
  res.statusCode = req.method === "GET" ? 200 : 405;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({
    service: "Virtual Location Camera — cloud demo",
    aiConfigured: false,
    requiresAccessCode: false,
    provider: "local-huggingface-diffusers",
    message: "ローカルGPUが必要です。公開Vercel版は地図・2D合成のみ対応しています。"
  }));
}
