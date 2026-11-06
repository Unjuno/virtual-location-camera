# Virtual Location Camera

**場所を選び、被写体を置き、仮想カメラで撮る。**

3D地理空間データと生成AIを組み合わせて、現地へ行かずに人物・商品写真を作るオープンソースWebアプリです。最初の撮影地点はニューヨーク・タイムズスクエアの夜間スタイルです。世界各地の緯度・経度を指定できます。

> **重要:** 現地の実景を厳密に再現するワールドモデルではありません。現時点では、MapLibre GL JSとOpenFreeMapによる地理空間3Dシーン、2D被写体の配置、任意の実景参照写真、条件付きGPT Image編集を組み合わせています。生成結果は**合成写真**です。実際の地理・人物・商品ロゴの忠実な再現は保証されません。

## 機能

| 機能 | 提供内容 |
| --- | --- |
| 3D地図 | OpenFreeMap/OpenStreetMap由来の建物。WebGL2対応ブラウザで操作 |
| 場所 | ニューヨーク、ブルックリン、東京、パリ、ロンドンおよび任意のWGS84緯度経度 |
| カメラ | マウス操作、ズーム・ピッチ・方位調整 |
| 被写体 | 人物・商品サンプル、ローカルPNG/JPEG/WebPアップロード |
| 合成 | ドラッグ配置、サイズ変更、明るさ調整、1600×900 PNG保存 |
| AI写真化 | 認証付きサーバーがOpenAIの画像編集APIへ構図画像+被写体+任意の実景参照を送信 |
| AI出力 | 1536×864 WebP（生成画像明記と地図出典表示を埋め込んで保存） |
| 再現性 | カメラ・被写体の配置JSON保存・読み込み。アップロード画像本体は保存しません |
| プライバシー | 通常の合成はブラウザ内処理。AI生成を同意した場合のみ外部APIへ送信 |

### アーキテクチャ

```text
Browser (WebGL2 + Canvas 2D)
  ├── MapLibre GL JS 6.16.0 → OpenFreeMap vector tiles → 3D buildings
  ├── Subject PNG/JPEG/WebP → draggable 2D layer → local PNG
  ├── Optional reference photograph
  └── Authenticated POST /api/render
                ↓
Node.js 22 / Vercel Function (OPENAI_API_KEY is server-only)
  ├── Access code / same-origin / MIME signatures / size / coordinate checks
  ├── Composition JPEG + subject PNG + optional reference JPEG
  └── OpenAI Images Edits, gpt-image-2.5-flare
                ↓
Generated WebP → browser preview → WebP with synthetic label + attribution
```

**これは学習型ワールドモデルではありません。** 実際の3D地図を幾何学的な構図のガイドに利用するハイブリッドアーキテクチャです。

## ローカル起動

Node.js 22以降が必要です。アプリ自体は外部npm依存を持たないため、`npm install` は不要です。

```bash
git clone https://github.com/Unjuno/virtual-location-camera.git
cd virtual-location-camera
npm run dev
```

`http://localhost:8000` を開きます。OpenFreeMapタイルとMapLibreのCDNを読むためネットワーク接続が必要です。

無料の3D合成写真モードはAPIキー不要です。AI写真化には次の設定が必要です。

```bash
cp .env.example .env
# .envをローカルで編集。秘密鍵やアクセスコードをGitHubへ登録しない
npm run dev
```

`.env` に以下を設定してください：

- `OPENAI_API_KEY`：OpenAI Platformのプロジェクト用APIキー
- `APP_ACCESS_TOKEN`：独自のランダムな16文字以上（32文字以上を推奨）のアクセスコード
- `OPENAI_IMAGE_MODEL`：`gpt-image-2.5-flare`（既定）または`gpt-image-2.5-sunburst`

AI利用時には右パネルへ`APP_ACCESS_TOKEN`を入力します。**APIキーそのものはブラウザに入力しません。**

## Vercelへのデプロイ

1. VercelでGitHubリポジトリ`Unjuno/virtual-location-camera`をインポート。
2. Framework PresetはOther（vanilla static HTML + Node.js Functions）、ルートは`/`。
3. Productionの環境変数に`OPENAI_API_KEY`と`APP_ACCESS_TOKEN`を設定。任意で`OPENAI_IMAGE_MODEL`。
4. デプロイし、`/api/health`で`aiConfigured: true` を確認。
5. 撮影画面で地図を表示、画像・撮影条件を設定して生成。

**セキュリティと費用：** 公開URLだけではAI生成できません。必ず強い`APP_ACCESS_TOKEN`を設定してください。個人・少人数の試作を前提とした方式であり、不特定多数へ公開する場合は本格的なユーザー認証、サーバー共有のレート制限、利用量の計測・課金、予算上限が必要です。OpenAI Platform側でも使用上限・アラートを設定してください。GitHub Pagesは静的サイトのため、AIサーバー機能を実行できません。

## テスト

```bash
npm run check
npm test
```

GitHub Actions（Node 22）で次を検証します：

- 座標の境界・入力検証、被写体の縦横比と配置計算
- 画像形式・アップロードサイズ
- 撮影条件JSONの整合性
- ブラウザDOMイベントのスモークテスト（モック）
- サーバー画像形式シグネチャ、同意、認証、送信元制限
- 画像編集APIのマルチ画像入力・品質・解像度のモック検証

**未自動検証：** OpenFreeMapライブタイルのWebGL描画、端末別PNG保存、OpenAIの実課金API呼び出し、人物同一性の知覚評価。実APIのE2Eテストには秘密鍵と課金承認が必要です。これらをPASSと主張しません。

## 現時点の制限事項

- MapLibreの3D建物は建物の形状・高さ中心で、写真品質の街路テクスチャはありません。緯度約±85.0511°より極側は初期地図投影で扱いません。
- 夜間はダーク地図のスタイル近似であり、実際の夜景照明・季節・気象の再現ではありません。
- 2D配置のため被写体の3D回転、正確な影や建物との遮蔽はありません。
- 生成AIはこれらの一部を視覚的に補間しますが、地理的忠実性、人物の同一性、商品ロゴ、物理精度は保証されません。
- 生成前の画像・メタデータは明示的な同意時のみOpenAIへ送られます。サーバーは画像を永続保存しません。
- MapLibreの地図タイルにCORS制約がある場合、Canvasでのエクスポートは失敗することがあります。アプリはエラーを通知します。

## データ・ライセンス

- 本リポジトリのオリジナルコード：MIT License © 2026 Unjuno
- MapLibre GL JS：BSD-3-Clause
- 地理空間タイル：OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors（ODbLおよび各提供元の規約）
- アップロード画像：ユーザーが正当な利用権を持つもののみ

アプリのMITライセンスは第三者コンテンツには適用されません。公開・商用運用前にタイルサービス、地理データ、生成物の利用条件と帰属表示を再確認してください。

## 参考資料

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [OpenFreeMap Quick Start](https://openfreemap.org/quick_start/)
- [OpenStreetMap Copyright](https://www.openstreetmap.org/copyright)
- [OpenAI Image Generation API](https://developers.openai.com/api/docs/guides/image-generation)
