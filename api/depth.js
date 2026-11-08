// Paid/hosted depth inference is deliberately not enabled in Vercel.
export default function handler(req,res){
  res.statusCode=req.method==="POST"?501:405;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.end(JSON.stringify({error:"ローカルPythonでserver/local_ai.pyを起動してください。Web版では手動の前景ブラシが使えます。"}));
}
