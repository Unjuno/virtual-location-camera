# Virtual Location Camera

**現地に行かずに、地図で構図を決めて人物・商品写真を制作するバーチャルカメラ。**

[Webデモ（地図・2D画像合成）](https://virtual-location-camera.vercel.app)

## 動作方式（2026年11月）

このアプリは2つのモードで動作します。

| 機能 | Webデモ（Vercel） | ローカルAI（GPU搭載PC） |
| --- | --- | --- |
| WGS84座標・3D建物・カメラ移動 | 対応 | 対応 |
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

## A. 公開Webデモ（GPU不要）

https://virtual-location-camera.vercel.app

WebGL2対応ブラウザとネット接続が必要です。OpenFreeMap/MapLibreを使って地理空間の3D建物を描画します。夜景はダーク地図の近似で、衛星写真ではありません。

1. ニューヨーク・東京などの地点を選ぶか、任意の緯度・経度を入力。
2. カメラを動かし構図を決める。
3. 透明PNGまたはWebPの人物・商品を追加し、サイズと位置を調整。
4. 「写真を保存」で地図＋被写体のPNGを保存。

VercelはGPU推論用に設定していないため、**「ローカルAIで写真化する」ボタンは無効**です。

## B. Hugging Face公開モデルをローカルで動かす

前提：
- Python 3.11または3.12
- CUDA対応GPU（NVIDIA）またはApple Silicon MacのMPS
- PyTorch、Diffusers、Transformers、Pillowをインストール
- モデル重みを保存する空きディスク領域と十分なRAM/VRAM
- モデルの利用規約に同意できること

GPUの必要メモリや速度は解像度・PyTorch・ドライバ・環境で異なります。**このリポジトリでは特定GPUでの推論ベンチマークを測定していません。** GPU非搭載PCで \`VLC_ALLOW_CPU=1\` を指定することもできますが、大幅に低速になる場合があります。

\`\`\`bash
git clone https://github.com/Unjuno/virtual-location-camera.git
cd virtual-location-camera
python3 -m venv .venv
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1

# CUDA環境では先に公式手順に沿ってCUDA対応PyTorchをインストール:
# https://pytorch.org/get-started/locally/
python -m pip install -r requirements-ai.txt
python server/local_ai.py
\`\`\`

**http://127.0.0.1:8000** を開きます。

\`/api/health\` が \`aiConfigured: true\` を返すと、画像生成が有効になります。最初の生成時にHugging Faceから公開モデルの重みがダウンロードされ、その後はローカルのGPUで推論します。**画像自体はHugging Face Inference Providersに送信されません。**

ローカルサーバーは安全のため \`127.0.0.1\` にのみバインドし、同一オリジン以外のリクエストを拒否します。公開インターネットへ直接転送・公開しないでください。ユーザー認証・共有レート制限・ジョブキューなどはありません。

通常の無料デモをローカルで動かすだけならNode.js 22で \`npm run dev\` を利用できます（このNodeサーバーはAI生成に対応しません）。

### 画像の参照について

- 参照写真なし：地図の背景画像をImg2Imgの初期画像として使います。地図は低詳細度のため、**実写の建築物と一致するとは限りません**。
- 参照写真あり：指定した写真をImg2Imgの初期画像として使います。これは**地図で指定した視点と一致する保証がありません**。
- 被写体：元のPNG/WebPを前面に上書き合成します。透明背景なら輪郭・色・ラベルを維持できますが、**周囲の自然な影・遮蔽・視点変化は自動では生成されません**。非透過JPEGは矩形の背景が残ります。

この方式は「実写感」と「同じ人/商品を正確に残すこと」の初期トレードオフを検証するMVPです。より自然な照明や3D遮蔽には、局所inpainting、深度推定、ControlNet、IP-Adapterなどの追加開発が必要です。

## テスト

Node.js 22 + Python 3.11:

\`\`\`bash
npm run check
npm test
python -m compileall -q server tests/test_local_ai.py
python -m unittest discover -s tests -p 'test_local_ai.py' -v
\`\`\`

GitHub Actionsで、座標境界、画像バリデーション、UIイベント、Vercelの有料API無効化、ローカルサーバーのリクエスト検証・同一オリジン制限を確認します。

**未検証の事項**：実GPUでのモデル重みのダウンロード/推論、OS/ドライバ別動作、WebGL2のライブ地図描画と保存画像の肉眼評価、地理的精度、実写への類似性。上記のユニットテストが通過しても、これらの品質は保証されません。

## 技術構成

\`\`\`text
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
\`\`\`

ファイル一覧：
- \`index.html\` / \`styles.css\`：撮影UI
- \`src/core.mjs\`：カメラ・配置計算
- \`src/app.mjs\`：WebGL地図・シーン撮影・ローカルAI接続
- \`server/local_ai.py\`：ローカル推論サーバー
- \`server/dev.mjs\`：無料デモのNode開発サーバー
- \`api/render.js\`：Vercelでは501を返し、外部課金推論を行わない
- \`api/health.js\`：VercelではAI生成が無効と通知
- \`tests/\`：Node/Pythonユニットテスト
- \`LICENSE\`：アプリのMITライセンス

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
