// Public Vercel deployment intentionally never runs paid inference.
// GPU inference is available only from server/local_ai.py on 127.0.0.1.
export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.statusCode = req.method === "POST" ? 501 : 405;
  res.end(JSON.stringify({
    error: req.method === "POST"
      ? "このVercel公開版ではAI生成を実行しません。Hugging FaceモデルをローカルGPUサーバーで起動してください。"
      : "POSTのみ対応します。"
  }));
}
