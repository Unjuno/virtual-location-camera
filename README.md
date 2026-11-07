# Virtual Location Camera

**Google Mapsで実在の場所を指定し、利用許諾のある現地写真と自分の人物・商品写真を合成するバーチャルカメラ。**

[Webデモ（地図・2D画像合成）](https://virtual-location-camera.vercel.app)

## 動作方式（2026年11月）

このアプリは2つのモードで動作します。

| 機能 | Webデモ（Vercel） | ローカルAI（GPU搭載PC） |
| --- | --- | --- |
| WGS84座標・3D建物・カメラ移動 | 対応 | 対応 |
| Google Maps公式地点URLの座標取り込み | 対応 | 対応 |
| Google Maps/Street Viewの公式リンク | 対応 | 対応 |
| 利用許諾のある現地写真を撮影背景にする | 対応 | 対応 |
| Wikimedia Commonsの位置付きCC0/PD写真の検索 | 対応（ネット接続時） | 対応（ネット接続時） |
| 現地写真＋人物の合成（地図通信不要） | 対応 | 対応 |
| 明るさ・暖色補正・接地影・写真トリミング | 対応 | 対応 |
| 人物/商品画像アップロード・配置 | 対応 | 対応 |
| PNG 1600×900 合成撮影 | 対応 | 対応 |
| シーンJSON保存/読込 | 対応 | 対応 |
| Hugging Faceモデルで写真風生成 | **非対応** | **対応** |
| OpenAI/HF推論APIキー | 不要 | 不要 |

**公開Web版から有料画像生成APIへの依存を削除しました。** ローカルAI版は Hugging Face Hub から公開モデルをダウンロードし、CUDA GPUまたはApple Silicon MPS上のDiffusersで推論します。Hugging Faceのサーバー推論、ZeroGPU、OpenAI APIは呼びません。初回ダウンロードはインターネット接続が必要です。その後は既に取得した重みを再利用します。

選定モデル：
- [stable-diffusion-v1-5/stable-diffusion-v1-5](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5)
- ライセンス：**CreativeML OpenRAIL-M**（ソースコードのMITライセンスとは別。禁止用途や再配布条件を確認してください）
- 手法：Stable Diffusion Image-to-Image（入力の地図背景から夜の都市の質感を補完）＋**元の被写体画像を画素レベルで再合成**
- 出力：768×432 WebP。実写のような生成を試すためのMVP設定で、現地の事実を保証するものではありません。

**これはゼロから学習したAIワールドモデルではありません。** 位置・地形・建物・カメラ構図は地理空間エンジン、写真風の画素生成は公開Diffusersモデル、人物・商品の保持は2Dアルファ合成が担当します。影、遮蔽、実際の夜景、建物の外観は厳密には再現されません。

## 現実の場所で撮影する手順

Google Mapsは撮影場所を調べるために使用します。**地図・ストリートビュー画像を無断で保存・抽出して生成AIに利用する機能はありません。**

1. 画面の「Google Mapsで場所を確認」または「Street Viewを確認」を押して、公式Google Mapsを別タブで開く。
2. Google MapsのURLに数値座標が含まれる場合、アプリへ貼り付け「URLから座標を取り込む」。短縮URLと地名だけのURLは解析しません。URL中の @緯度,経度 は地図の表示中心であり、厳密な写真撮影位置ではありません。
3. 現地で撮影された**使用許諾のある画像**を準備する（自分の撮影物、または合成・公開・商用利用に適したライセンスの素材）。「写真の使用権を確認」にチェックしてアップロード。必要な撮影者名・ライセンスをクレジット欄に入力。
4. 画面が「現地写真」に切り替わり、背景に現地写真が表示される。人物・商品画像を上から重ね、位置・サイズを調整。
5. 「写真を保存」で地理座標とは別に、実際の写真のピクセルと自分の被写体を合成したPNGを保存する。**地図がロードできなくてもこの操作は可能です。**

現地写真はローカルのブラウザメモリだけで処理され、公開Vercelサーバーへアップロードされません。アプリは写真が指定の位置で撮られたかを自動検証しません。人物を自由な3Dアングルで回す、背景建物による遮蔽を自動推定する、同じ位置の別アングルを完全生成する機能は未実装です。

Google Mapsの公式 Maps URLs はAPIキーなしで使えますが、Google Mapsコンテンツのスクレイピング・無断の派生利用・AI学習にはGoogle Maps Platformの利用規約による制約があります。

## 位置付きの公開写真を検索（任意）

地点の緯度経度を指定後、「指定地点の近くの公開写真を探す」から[Wikimedia Commons](https://commons.wikimedia.org/)のGeoSearch APIで半径1kmのファイルを検索できます。APIキーは不要です。

- **CC0 1.0またはPublic domainとメタデータに表示される写真だけ**を自動取り込みの候補にします。CC BY-SA等の帰属・継承条件がある画像は自動取り込み対象にしません。
- 画像のファイル説明ページを別タブで開いて、撮影者・ライセンス・内容・人物等の権利関係を確認してください。メタデータが正しいことを保証できないため、利用権の確認チェックが必要です。
- 写真の地理タグは**カメラ方向・撮影時刻・同じ住所の別建物を保証しません**。実際の現地視点かどうか、利用者が確認してください。
- サービス側のCORS制約やライセンス表示によっては自動取り込みできません。その場合はファイルページを確認して、許諾された画像を手動でアップロードしてください。
- 検索結果の写真URLはWikimedia Commons APIに基づいています。Google Mapsのスクリーンショットや画像の抽出・保存は一切していません。

Wikimediaの検索APIと各画像のライセンスは別です。[Commonsの位置検索](https://commons.wikimedia.org/wiki/Commons:Search_by_location)と[Wikimediaのライセンス説明](https://attribution.wikimedia.org/attribution-signals/license.html)を参照してください。

## 写真合成の品質調整（今回追加）

地図・実景写真のどちらでも、次の操作を使えます。

- **被写体の明るさ（50～150%）**：人物・商品の露光を調整。背景の明るさとは独立。
- **暖色補正（0～30%）**：簡易セピア変換。色温度の厳密な推定ではありません。
- **接地影（0～80%）**：被写体の足元付近に、ぼかした楕円影を描画。影の位置は画像全体の矩形から推定するため、被写体が透明余白の多い写真や地面から浮いた商品だと手動調整が必要です。
- **背景写真の拡大（100～250%）と縦横の切り取り位置**：元の写真から16:9の領域を選び、出力画像へそのまま描画。不存在の建物や街路を生成しません。

各設定は**プレビューと保存PNGに反映**され、撮影条件JSONに保存されます。ただし、撮影場所の実景画像・元の被写体画像のバイト列はJSONには含めません。復元時は画像を再選択してください。

ローカルのHugging Face画像生成では、背景をDiffusersのImage-to-Imageで生成し、元の被写体を再合成するときに簡易的な明るさ・暖色補正・接地影を適用します。ブラウザのCanvasフィルターとPillowによる色変換は**近似的に同等であり、ピクセル単位で一致しません**。

本処理はグラフィックスと写真編集に基づく2D合成であり、3Dの光源推定・深度遮蔽・世界モデルの学習を行ったことにはなりません。人物の顔や商品のロゴを変更せずに自然な照明まで一致させるには、追加のデータと知覚評価が必要です。

## A. 公開Webデモ（GPU不要）

https://virtual-location-camera.vercel.app

WebGL2対応ブラウザとネット接続が必要です。OpenFreeMap/MapLibreを使って地理空間の3D建物を描画します。夜景はダーク地図の近似で、衛星写真ではありません。

1. ニューヨーク・東京などの地点を選ぶか、Google Maps URL・緯度経度を入力。
2. 3D地図で構図を選ぶか、**利用許諾のある現地写真**を背景にアップロード。
3. 透明PNGまたはWebPの人物・商品を追加し、位置とサイズを調整。
4. 「写真を保存」で、背景＋被写体の合成PNG（1600×900）を保存。

VercelはGPU推論用に設定していないため、**「ローカルAIで写真化する」ボタンは無効**です。

## B. Hugging Face公開モデルをローカルで動かす

前提：
- Python 3.11または3.12
- CUDA対応GPU（NVIDIA）またはApple Silicon MacのMPS
- PyTorch、Diffusers、Transformers、Pillowをインストール
- モデル重みを保存する空きディスク領域と十分なRAM/VRAM
- モデルの利用規約に同意できること

GPUの必要メモリや速度は解像度・PyTorch・ドライバ・環境で異なります。**このリポジトリでは特定GPUでの推論ベンチマークを測定していません。** GPU非搭載PCで `VLC_ALLOW_CPU=1` を指定することもできますが、大幅に低速になる場合があります。

```bash
git clone https://github.com/Unjuno/virtual-location-camera.git
cd virtual-location-camera
python3 -m venv .venv
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1

# CUDA環境では先に公式手順に沿ってCUDA対応PyTorchをインストール:
# https://pytorch.org/get-started/locally/
python -m pip install -r requirements-ai.txt
python server/local_ai.py
```

**http://127.0.0.1:8000** を開きます。

`/api/health` が `aiConfigured: true` を返すと、画像生成が有効になります。最初の生成時にHugging Faceから公開モデルの重みがダウンロードされ、その後はローカルのGPUで推論します。**画像自体はHugging Face Inference Providersに送信されません。**

ローカルサーバーは安全のため `127.0.0.1` にのみバインドし、同一オリジン以外のリクエストを拒否します。公開インターネットへ直接転送・公開しないでください。ユーザー認証・共有レート制限・ジョブキューなどはありません。

通常の無料デモをローカルで動かすだけならNode.js 22で `npm run dev` を利用できます（このNodeサーバーはAI生成に対応しません）。

### 画像の参照について

- 参照写真なし：地図の背景画像をImg2Imgの初期画像として使います。地図は低詳細度のため、**実写の建築物と一致するとは限りません**。
- 現地写真モード：ユーザーが読み込んだ現地写真をImg2Imgの背景として使います。Google Mapsの画像を取得することはありません。指定座標と写真の撮影地点が一致する保証はありません。
- 被写体：元のPNG/WebPを前面に上書き合成します。透明背景なら輪郭・色・ラベルを維持できますが、**周囲の自然な影・遮蔽・視点変化は自動では生成されません**。非透過JPEGは矩形の背景が残ります。

この方式は「実写感」と「同じ人/商品を正確に残すこと」の初期トレードオフを検証するMVPです。より自然な照明や3D遮蔽には、局所inpainting、深度推定、ControlNet、IP-Adapterなどの追加開発が必要です。

## テスト

Node.js 22 + Python 3.11:

```bash
npm run check
npm test
python -m compileall -q server tests/test_local_ai.py
python -m unittest discover -s tests -p 'test_local_ai.py' -v
```

### 実ブラウザE2Eテスト

Chromiumを使用し、外部地図CDNを遮断した状態で「現地写真の読み込み → 透明な被写体の読み込み → 背景トリミング・被写体光量・接地影の変更 → 1600×900 PNG保存」を確認するテストを追加しています。

```bash
python -m pip install 'playwright==1.57.0'
python -m playwright install chromium
python -m unittest discover -s tests -p 'test_browser_e2e.py' -v
```

GitHub ActionsではNodeの静的/スモーク検証とPythonリクエスト検証に加え、Playwright/Chromiumの実ブラウザテストを別ジョブで実行する設定です。**このチャット環境からのGitHub Actions実行結果および実際のChromeによるPNG出力結果はまだ確認していません。** E2Eテストの存在をテスト成功と誤認しないでください。

GitHub Actionsで、座標境界、Google Maps URL解析と悪意あるホストの除外、WikimediaのCC0/PDメタデータとHTTPSホスト検証、現地写真のアスペクト比・クロップ計算、ライセンス確認、地図未接続でも写真からPNGを書き出す操作（Canvasモック）、画像バリデーション、UIイベント、公開版の有料API無効化、ローカルサーバーのリクエスト検証・同一オリジン制限を確認します。

**未検証の事項**：実GPUでのモデル重みのダウンロード/推論、OS/ドライバ別動作、WebGL2のライブ地図描画、実ブラウザでのPNGダウンロードと保存画像の肉眼評価、地理的精度、実写への類似性。上記のユニットテストが通過しても、これらの品質は保証されません。

## 技術構成

```text
Browser
  ├─ MapLibre GL JS + OpenFreeMap → 3D地理データ・カメラ
  ├─ PNG/WebP主体の2D被写体オーバーレイ → 即時合成PNG
  └─ Local-only POST /api/render
                    ↓
Python 3.11+ 127.0.0.1:8000
  ├─ 画像・位置情報・利用同意の検証
  ├─ Diffusers AutoPipelineForImage2Image
  ├─ Stable Diffusion 1.5 weights from Hugging Face Hub
  ├─ CUDA/MPS (CPUはオプション)
  └─ PILによる元の被写体の再合成 → WebP
```

ファイル一覧：
- `index.html` / `styles.css`：撮影UI
- `src/core.mjs`：カメラ・配置計算
- `src/location.mjs`：Google Maps地点URL解析、公式リンク、実景写真の中心クロップ計算
- `src/compositor.mjs`：明るさ・接地影の計算とCanvas合成
- `src/commons.mjs`：GeoSearchによる位置付き公開写真検索と許諾条件による選別
- `src/app.mjs`：WebGL地図・シーン撮影・ローカルAI接続
- `server/local_ai.py`：ローカル推論サーバー
- `server/dev.mjs`：無料デモのNode開発サーバー
- `api/render.js`：Vercelでは501を返し、外部課金推論を行わない
- `api/health.js`：VercelではAI生成が無効と通知
- `tests/`：Node/Pythonユニットテスト
- `LICENSE`：アプリのMITライセンス

## ライセンスとデータ使用上の注意

- このリポジトリで制作したコード：MIT
- Stable Diffusion v1.5モデル重み：CreativeML OpenRAIL-M（商用利用の可否と条件を含め、全文を確認）
- OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors：地図の利用条件・ODbLと表示要件
- アップロード写真：利用する人が権利を持つものに限定

写真の実在性を誤認させないよう、UIと保存画像に「AI GENERATED / NOT ON LOCATION」の表記を加えています。生成結果を現地で撮った証明写真として扱わないでください。

## 一次資料

- Hugging Face Diffusers [Image-to-image](https://huggingface.co/docs/diffusers/using-diffusers/img2img)
- [Stable Diffusion v1.5 model card](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5)
- [OpenFreeMap](https://openfreemap.org/)
- [MapLibre](https://maplibre.org/maplibre-gl-js/docs/)
- [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)
- [Google Maps URLs — official guide](https://developers.google.com/maps/documentation/urls/get-started)
- [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms)
- [Wikimedia Commons location search](https://commons.wikimedia.org/wiki/Commons:Search_by_location)
- [MediaWiki cross-origin API](https://www.mediawiki.org/wiki/API:Cross-site_requests)
