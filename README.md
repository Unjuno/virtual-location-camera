# Virtual Location Camera

**世界中を仮想撮影スタジオにする**オープンソースのWebアプリMVPです。任意の緯度・経度を指定し、OpenStreetMap由来の3D建物データ上でカメラを操作し、人物・商品の画像を前面に配置して合成写真を保存できます。

> **重要:** 現時点ではAIが学習した「ワールドモデル」でも、生成AIによるフォトリアルな写真生成でもありません。MapLibre GL JS と OpenFreeMap を使用した **3D地理空間シーン + 2D画像合成** です。地図の夜間スタイルも実在のネオンや街灯を忠実に再現しません。撮影画像は現地で撮影した証拠として扱わないでください。

## 実装済み機能

- 初期地点: New York / Times Square（夜のダークマップ）
- 任意のWGS84緯度・経度の入力（緯度 -90～90、経度 -180～180）
- 世界5地点のプリセット
- MapLibre GL JS v6.16.0 による地理空間描画とOpenFreeMapの3D建物（高さのデータがある地域）
- カメラのパン・回転・チルト・ズーム
- サンプル人物/商品、または手元のPNG/JPEG/WebP画像を配置・ドラッグ・拡大縮小
- 背景露光調整、1600 × 900 PNG撮影、出典・合成画像表示の焼き込み
- 座標・カメラ・被写体の配置をJSONに保存（画像本体は含まない）
- 画像はサーバにアップロードせず、ブラウザ内でのみ処理

## 起動

Node.jsやnpmのインストールは必須ではありませんが、ES Modulesを使用するため `file://` ではなくローカルHTTPサーバから開いてください。

```bash
git clone https://github.com/Unjuno/virtual-location-camera.git
cd virtual-location-camera
python3 -m http.server 8000
```

`http://localhost:8000` をChrome、Firefox、SafariなどWebGL2対応ブラウザで開きます。外部ネットワーク（MapLibre CDN / OpenFreeMapタイルサービス）は必須で、オフライン環境では3D地図を表示できません。

**GitHub Pages** での公開も可能な静的サイト構成です。Settings → Pages → Deploy from a branch → main / root を選んでください。公開直後からWebGL2対応端末で利用できます（データ供給元の制約に依存）。

## 使い方

1. 「ロケーション」でニューヨーク、東京などを選ぶか、緯度経度を入力して「座標へ移動」
2. 地図上でカメラを動かし構図を調整（マウスまたはカメラのスライダー）
3. 人物・商品を選び、必要に応じて透明背景の画像をアップロード
4. 被写体をドラッグ、サイズと明るさを調整
5. 「写真を保存」から1600×900 PNGをダウンロード

「撮影条件をJSON保存」からシーンの座標やカメラ状態をバックアップできます。**シーンJSONの読み込み機能は未実装**であり、撮影再現を支援するメタデータ書き出しのみです。

## テスト

```bash
node --test tests/*.test.mjs
```

GitHub ActionsでNode.js 22の単体テストを自動実行します。テスト対象：WGS84入力検証、境界値、被写体配置の正規化、画像の縦横比保持、画像ファイル形式・上限、保存するシーンメタデータ。

**検証範囲の限界:** CIはMapLibreタイル取得・実ブラウザ操作・写真PNG書き出し・WebGL描画のE2Eを実行していません。実データの見た目と出力の確認は、ネットワーク接続可能なWebGL2環境で手動実施してください。

## アーキテクチャ

```text
index.html / styles.css    撮影UI
src/core.mjs              座標検証・配置計算・シーンJSON（Nodeテスト可能）
src/app.mjs               MapLibre読み込み、3D建物、カメラ、合成、PNG出力
tests/core.test.mjs       Unit tests（標準のnode:test）
.github/workflows/test.yml GitHub Actions
```

**前提:** WGS84座標系の経緯度（十進度）、画角を意味するカメラのズームはMapLibreのレベル、被写体の位置はキャンバスに対する割合（0～1）、撮影サイズ1600×900 px。MapLibreはWebGL2を使用、画像合成はCanvas 2D。クラウドAIモデル/APIは利用していません。距離・影の物理精度は保証されません。

## ライセンス・データ出典

- アプリのソースコード: [MIT](LICENSE) © 2026 Unjuno
- MapLibre GL JS（ライブラリ）: BSD-3-Clause
- OpenFreeMapの地図サービス: [OpenFreeMap](https://openfreemap.org/) の利用条件・出典要件に従う
- 地図データ: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)（ODbL）
- OpenMapTiles等: 各プロジェクト・地図データのライセンスに従う

画面および出力画像に **Map © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors** を表示しています。各プロバイダの商用利用・画像書き出し条件は運用時に再確認してください。第三者の地図データにMITライセンスが適用されるわけではありません。

## 非実装／今後の課題

- **画像生成AI**の接続（人物同一性・商品ロゴ維持・光と影の整合）
- **写真測量データやPhotorealistic 3D Tiles** を使った高品質な都市形状（別契約・APIキー・出力制約あり）
- 画像の背景除去（アップロードは透過PNGを推奨）
- 3D空間での被写体配置、遮蔽、姿勢変更、カメラ移動に対する被写体の視点変化
- 撮影地点の名称検索、シーンJSONからの復元、認証・課金
- テスト専用WebGL2環境での地理タイル読込・PNGエクスポートのE2E

Google Photorealistic 3D Tilesなどの第三者コンテンツを導入する場合、**閲覧可能なこと**と**生成画像に利用・再配布できること**は別です。権利処理と画像生成AIの学習使用許諾を必ず確認してください。

## 参考ドキュメント

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [3D Buildings](https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/)
- [OpenFreeMap Quick Start](https://openfreemap.org/quick_start/)
- [OpenStreetMap copyright](https://www.openstreetmap.org/copyright)
