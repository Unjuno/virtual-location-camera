import test from "node:test";
import assert from "node:assert/strict";
import { fetchMapillaryImage, isAllowedMapillaryImageUrl } from "../api/scene-image.js";

test("proxy rejects DNS rebinding, insecure URLs and non-Mapillary CDN hosts", () => {
  for (const input of [
    "http://scontent.fbcdn.net/photo.jpg",
    "https://scontent.fbcdn.net.evil.example/a.jpg",
    "https://localhost/photo.jpg",
    "https://169.254.169.254/latest/meta-data",
    "file:///etc/passwd", "https://example.com/photo",
    "https://user:pass@fbcdn.net/img"
  ]) assert.equal(isAllowedMapillaryImageUrl(input), false, input);
  assert.equal(isAllowedMapillaryImageUrl("https://scontent-lhr1-2.xx.fbcdn.net/image.jpg"), true);
});

test("Mapillary thumbnail proxy never exposes the API token to image CDN", async () => {
  const bytes = Buffer.concat([Buffer.from([0xff,0xd8,0xff]),Buffer.alloc(40,0),Buffer.from([0xff,0xd9])]);
  let calls = 0;
  const output = await fetchMapillaryImage("12345678",{
    token:"private-test-key",
    fetcher:async (url,opts)=>{
      calls++;
      if(calls===1){
        assert.equal(url,"https://graph.mapillary.com/12345678?fields=id,thumb_1024_url");
        assert.equal(opts.headers.Authorization,"OAuth private-test-key");
        return {ok:true,json:async()=>({thumb_1024_url:"https://scontent.xx.fbcdn.net/abcd.jpg"})};
      }
      assert.equal(url,"https://scontent.xx.fbcdn.net/abcd.jpg");
      assert.equal(opts.headers,undefined);
      assert.equal(opts.redirect,"error");
      return {ok:true,headers:{get(name){return name==="content-type"?"image/jpeg":null}},arrayBuffer:async()=>bytes};
    }
  });
  assert.equal(calls,2);
  assert.equal(output.mime,"image/jpeg");
  assert.ok(output.bytes.equals(bytes));
});

test("thumbnail proxy rejects malformed image IDs before any network access", async () => {
  for(const bad of ["../../admin","", "abc", "123?token=steal", "-1"]){
    let called=false;
    await assert.rejects(fetchMapillaryImage(bad,{token:"secret",fetcher:async()=>{called=true;}}), /画像ID/);
    assert.equal(called,false);
  }
});

test("thumbnail proxy rejects evil redirects and fake image content", async () => {
  await assert.rejects(
    fetchMapillaryImage("123",{token:"secret",fetcher:async()=>{
      return{ok:true,json:async()=>({thumb_1024_url:"https://evil.example/private"})};
    }}), /許可されていない/
  );
  let call=0;
  await assert.rejects(
    fetchMapillaryImage("123",{token:"secret",fetcher:async()=>{
      call++;
      return call===1
        ? {ok:true,json:async()=>({thumb_1024_url:"https://scontent.fbcdn.net/abc.jpg"})}
        : {ok:true,headers:{get(n){return n==="content-type"?"image/jpeg":null}},arrayBuffer:async()=>Buffer.alloc(50,123)};
    }}), /破損/
  );
});


test("streaming image proxy stops oversized images before buffering", async () => {
  let calls = 0;
  await assert.rejects(fetchMapillaryImage("12345678",{
    token:"secret",
    fetcher:async ()=>{
      calls++;
      if(calls===1)return {ok:true,json:async()=>({thumb_1024_url:"https://scontent.xx.fbcdn.net/large.jpg"})};
      return {
        ok:true,
        headers:{get(){return null}},
        body:new ReadableStream({start(controller){
          controller.enqueue(new Uint8Array(3_600_000));
          controller.close();
        }})
      };
    }
  }), e=>e.status===413);
  assert.equal(calls,2);
});
