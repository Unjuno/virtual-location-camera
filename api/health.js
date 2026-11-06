export default function handler(req, res) {
  res.statusCode = req.method === 'GET' ? 200 : 405;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    service: 'Virtual Location Camera',
    aiConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.APP_ACCESS_TOKEN && process.env.APP_ACCESS_TOKEN.length >= 16),
    requiresAccessCode: true
  }));
}
