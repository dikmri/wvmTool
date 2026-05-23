# Webブラウザ動画モザイク編集アプリ 仕様書

## 1. 目的

GitHub Pages上で公開できる、ブラウザ完結型の高速な動画モザイク編集アプリを開発する。

本アプリは、短尺MP4動画を読み込み、ユーザーが指定した矩形範囲に対してフレーム単位・キーフレーム単位でモザイクを適用し、編集後の動画をブラウザ上で書き出す。

最重要方針は **パフォーマンス最優先** とする。

Vue/React/SvelteなどのUIフレームワークに動画フレーム処理を持たせず、UIと動画処理エンジンを完全に分離する。

---

## 2. 前提条件

### 2.1 公開環境

- GitHub Pagesで公開する
- 静的ホスティングのみを前提とする
- サーバーサイド処理は使用しない
- 動画処理はすべてユーザーのブラウザ内で実行する
- ユーザーの動画ファイルはサーバーへアップロードしない

### 2.2 対象ブラウザ

初期対応は以下を優先する。

- Google Chrome 最新版
- Microsoft Edge 最新版
- Firefox 最新版

Safariは可能な範囲で対応するが、WebCodecs / WebGPU / OffscreenCanvas周辺の互換性に差が出やすいため、初期MVPでは完全対応必須としない。

### 2.3 対象動画

初期MVPでは以下を対象とする。

- 入力形式: MP4
- 想定長: 5秒〜30秒程度
- 推奨解像度: 720p〜1080p
- 推奨フレームレート: 24fps / 30fps / 60fps
- 音声: 初期版では「保持できる場合は保持」、困難な場合は「音声なし書き出し」でも可

ただし、将来的には音声保持を正式対応する。

---

## 3. 技術選定

### 3.1 全体方針

パフォーマンスを最優先するため、以下の構成を採用する。

```txt
UI層:
  Svelte + TypeScript + Vite

動画処理層:
  Web Worker
  OffscreenCanvas
  WebCodecs
  WebGL2

将来拡張:
  WebGPU
  Rust + WebAssembly
  mp4box.js
  ffmpeg.wasm
```

### 3.2 UIフレームワーク

#### 採用: Svelte + TypeScript + Vite

理由:

- ランタイムが軽い
- DOM更新コストを抑えやすい
- GitHub Pagesへの静的デプロイが簡単
- UI実装量が増えても比較的読みやすい
- 動画処理エンジンと分離しやすい

ただし、Svelteに動画フレームやImageDataを持たせてはいけない。

Svelte側で管理してよいものは以下に限定する。

- 動画ファイルの参照
- 再生状態
- 現在時刻
- 選択中のモザイクトラック
- キーフレーム情報
- UI状態
- 書き出し進捗

Svelte側で管理してはいけないもの:

- 全フレーム画像
- ImageData配列
- VideoFrame配列
- Canvasピクセルデータ
- 巨大なUint8Arrayの頻繁なstate更新

---

## 4. アーキテクチャ

### 4.1 レイヤー構成

```txt
src/
  main.ts
  app/
    App.svelte
    components/
      VideoViewport.svelte
      Timeline.svelte
      ToolPanel.svelte
      ExportPanel.svelte
      MosaicTrackList.svelte
    stores/
      project-store.ts
      playback-store.ts
      ui-store.ts
  engine/
    types.ts
    project-model.ts
    keyframe-interpolator.ts
    coordinate.ts
    validation.ts
  workers/
    render-worker.ts
    export-worker.ts
  render/
    webgl/
      gl-context.ts
      mosaic-shader.ts
      preview-renderer.ts
      export-renderer.ts
    canvas/
      canvas2d-fallback.ts
  codecs/
    webcodecs/
      decoder.ts
      encoder.ts
    mux/
      mp4-muxer.ts
  utils/
    file.ts
    logger.ts
    performance.ts
```

### 4.2 メインスレッドの責務

メインスレッドではUI操作と軽い状態管理のみ行う。

担当:

- ファイルD&D
- UI描画
- タイムライン操作
- キーフレーム編集
- Workerへの処理依頼
- 進捗表示
- エラー表示
- 書き出し済みBlobのダウンロード

禁止:

- フレーム単位の重い画像処理
- 全フレームの保持
- Canvas 2Dでの大量ピクセル処理
- エンコード処理
- デコード処理

### 4.3 Workerの責務

Web Worker側で重い処理を担当する。

担当:

- 動画デコード
- フレーム単位のレンダリング
- モザイク適用
- 書き出し用フレーム生成
- エンコード
- 可能ならmux
- パフォーマンス計測

Workerは以下の2種類に分ける。

```txt
render-worker.ts:
  プレビュー用
  軽量・低遅延重視

export-worker.ts:
  書き出し用
  品質・安定性重視
```

初期実装でWorkerを1つにまとめてもよいが、設計上は分離可能にしておく。

---

## 5. 描画・動画処理方針

### 5.1 プレビュー処理

プレビューは以下の方針で行う。

```txt
HTMLVideoElementで通常再生
↓
Canvas / WebGL layerでモザイク結果を重ねる
↓
必要に応じてrequestVideoFrameCallbackで同期
```

プレビュー時は、必ずしも毎フレーム完全な書き出し品質で処理しなくてよい。

プレビュー優先事項:

1. UIが固まらないこと
2. 再生がカクつかないこと
3. モザイク位置が概ね正しく追従すること
4. 書き出し品質より低遅延を優先すること

### 5.2 書き出し処理

書き出しは以下の流れを基本とする。

```txt
File / ArrayBuffer
↓
WebCodecs VideoDecoder
↓
VideoFrame単位で取得
↓
OffscreenCanvas + WebGL2でモザイク適用
↓
WebCodecs VideoEncoder
↓
MP4 mux
↓
Blob生成
↓
_mosaic付きファイル名で保存
```

### 5.3 モザイク処理

モザイクはGPU処理を優先する。

初期実装ではWebGL2を採用する。

理由:

- WebGPUより対応環境が広い
- Canvas 2Dより動画ピクセル処理に向いている
- 矩形範囲のモザイク処理をシェーダーで高速化できる

モザイク処理の基本仕様:

- 指定矩形内のみモザイク化する
- モザイクサイズを指定可能にする
- 複数モザイク範囲に対応する
- フレームごとの位置補間に対応する
- 書き出し時は動画原寸で処理する
- プレビュー時は必要に応じて低解像度処理を許可する

### 5.4 WebGPUについて

WebGPUは将来的な高速化候補とする。

初期MVPではWebGPUを必須にしない。

理由:

- 実装コストが高い
- 互換性検証が必要
- WebGL2でも矩形モザイク用途なら十分高速化できる可能性が高い

ただし、設計上は以下のようにRendererを差し替え可能にする。

```ts
export interface MosaicRenderer {
  init(width: number, height: number): Promise<void>;
  renderFrame(input: VideoFrame | ImageBitmap, tracks: MosaicTrack[], time: number): Promise<VideoFrame | ImageBitmap>;
  dispose(): void;
}
```

将来的に以下を実装できるようにする。

```txt
WebGL2MosaicRenderer
WebGPUMosaicRenderer
Canvas2DFallbackRenderer
```

---

## 6. データ設計

### 6.1 Project

```ts
export type Project = {
  id: string;
  name: string;
  sourceFileName: string;
  sourceVideoMeta: VideoMeta;
  tracks: MosaicTrack[];
  exportSettings: ExportSettings;
  createdAt: string;
  updatedAt: string;
};
```

### 6.2 VideoMeta

```ts
export type VideoMeta = {
  width: number;
  height: number;
  duration: number;
  fps: number | null;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
};
```

### 6.3 MosaicTrack

```ts
export type MosaicTrack = {
  id: string;
  name: string;
  enabled: boolean;
  mosaicSize: number;
  shape: 'rect';
  keyframes: MosaicKeyframe[];
};
```

初期MVPではshapeはrectのみ対応する。

### 6.4 MosaicKeyframe

```ts
export type MosaicKeyframe = {
  id: string;
  time: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
```

座標は動画原寸ピクセル基準で保持する。

例:

```txt
1920x1080動画の場合
x=100, y=200, width=300, height=180
```

画面表示サイズに依存する座標で保存してはいけない。

### 6.5 ExportSettings

```ts
export type ExportSettings = {
  outputFileSuffix: string;
  videoCodec: 'avc1' | 'vp09' | 'av01' | 'auto';
  bitrateMode: 'auto' | 'manual';
  bitrate?: number;
  preserveAudio: boolean;
  trimStartFrames: number;
  trimEndFrames: number;
  previewScale: number;
};
```

初期値:

```ts
export const defaultExportSettings: ExportSettings = {
  outputFileSuffix: '_mosaic',
  videoCodec: 'auto',
  bitrateMode: 'auto',
  preserveAudio: true,
  trimStartFrames: 0,
  trimEndFrames: 0,
  previewScale: 0.5,
};
```

---

## 7. キーフレーム補間仕様

### 7.1 基本仕様

モザイク範囲はキーフレーム間で線形補間する。

対象プロパティ:

- x
- y
- width
- height

### 7.2 補間ルール

```txt
現在時刻が最初のキーフレームより前:
  最初のキーフレーム値を使用

現在時刻が最後のキーフレームより後:
  最後のキーフレーム値を使用

現在時刻が2つのキーフレームの間:
  線形補間
```

### 7.3 実装例

```ts
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

補間処理はUIではなく `engine/keyframe-interpolator.ts` に実装する。

---

## 8. UI仕様

### 8.1 画面構成

```txt
+--------------------------------------------------+
| Header                                           |
+--------------------------------------------------+
| ToolPanel |          VideoViewport               |
|           |                                      |
|           |                                      |
+--------------------------------------------------+
| Timeline                                         |
+--------------------------------------------------+
| ExportPanel                                      |
+--------------------------------------------------+
```

### 8.2 VideoViewport

機能:

- MP4動画の表示
- D&D読み込み
- モザイク矩形の表示
- 矩形のドラッグ移動
- 矩形のリサイズ
- 現在時刻でのキーフレーム追加
- 再生/停止
- 現在フレーム移動

実装注意:

- `<video>` 要素は表示・再生制御に使用する
- モザイク矩形UIはSVGまたはCanvas overlayで表示する
- 動画フレームそのものをSvelte stateに入れない

### 8.3 Timeline

機能:

- 動画全体の時間軸表示
- 現在時刻のシーク
- キーフレーム表示
- キーフレーム選択
- キーフレーム削除
- フレーム単位の移動

ショートカット:

```txt
Space: 再生/停止
ArrowLeft: 1フレーム戻る
ArrowRight: 1フレーム進む
Shift + ArrowLeft: 10フレーム戻る
Shift + ArrowRight: 10フレーム進む
K: 現在位置にキーフレーム追加
Delete: 選択中キーフレーム削除
Ctrl + S: プロジェクトJSON保存
Ctrl + O: 動画読み込み
```

### 8.4 ToolPanel

機能:

- モザイク範囲追加
- 選択中モザイク範囲削除
- モザイクサイズ設定
- トラック有効/無効切替
- プレビュー品質設定

### 8.5 ExportPanel

機能:

- 書き出し開始
- 書き出し進捗表示
- 書き出しキャンセル
- 出力ファイル名表示
- 先頭除去フレーム数設定
- 末尾除去フレーム数設定
- 音声保持オプション

---

## 9. パフォーマンス設計

### 9.1 絶対禁止事項

以下は禁止する。

```ts
// 禁止: 全フレームをUI stateに保持
const frames = writable<ImageData[]>([]);

// 禁止: VideoFrameをSvelte storeに入れる
const currentFrame = writable<VideoFrame | null>(null);

// 禁止: 毎フレーム巨大なbase64を生成
canvas.toDataURL();

// 禁止: 毎フレームDOMを大量更新
tracks.forEach(track => updateDomEveryFrame(track));
```

### 9.2 推奨事項

- 動画処理はWorkerへ送る
- Canvas処理はOffscreenCanvasを使う
- ピクセル処理はWebGL2シェーダーを使う
- UI更新は必要最小限にする
- プレビューは低解像度処理を許可する
- 書き出し時のみ原寸処理する
- ArrayBuffer / OffscreenCanvasなどはTransferableとして渡す
- Blob URLは不要になったら `URL.revokeObjectURL()` する
- VideoFrameは使い終わったら必ず `close()` する

### 9.3 VideoFrame管理

WebCodecsのVideoFrameは明示的に解放する。

```ts
try {
  // process frame
} finally {
  frame.close();
}
```

close忘れはメモリリークの原因になるため、必ずレビュー対象にする。

### 9.4 プレビュー最適化

プレビューでは以下を許可する。

- 1/2解像度レンダリング
- 1/4解像度レンダリング
- 60fps動画でも30fps相当プレビュー
- ドラッグ中は簡易描画
- ドラッグ終了後に高品質再描画

### 9.5 書き出し最適化

書き出しでは以下を行う。

- Worker内で逐次処理する
- 全フレームをメモリに保持しない
- フレーム処理後すぐエンコーダへ渡す
- 進捗は一定間隔でメインスレッドへ通知する
- キャンセル時はDecoder/Encoder/Frameを破棄する

---

## 10. WebCodecs設計

### 10.1 基本方針

VideoDecoder / VideoEncoderを使用する。

ただし、MP4コンテナのdemux/muxはWebCodecs単体では完結しないため、別ライブラリまたは自前処理が必要。

### 10.2 Demux/Mux候補

候補:

- mp4box.js
- mp4-muxer系ライブラリ
- ffmpeg.wasm fallback

初期方針:

```txt
第一候補:
  mp4box.jsでdemux
  WebCodecsでdecode/encode
  mp4-muxer系でmux

fallback:
  ffmpeg.wasmで変換/音声mux
```

ffmpeg.wasmは重いため、初期ロードに含めない。
必要になった場合だけ遅延ロードする。

### 10.3 Codec選択

初期は `auto` とする。

優先順:

```txt
1. 入力動画と同等の一般的なMP4互換設定
2. H.264 / AVCが使える場合はH.264優先
3. 使えない場合はブラウザ対応codecへfallback
4. 最後のfallbackとしてWebM出力も許容
```

ただし、GitHub Pagesで公開する都合上、サーバー側で変換し直すことはできない。

---

## 11. GitHub Pages対応

### 11.1 Vite設定

GitHub Pagesでサブディレクトリ公開される可能性があるため、`vite.config.ts` の `base` に注意する。

例:

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: '/REPOSITORY_NAME/',
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
});
```

リポジトリ名が未確定の場合は、READMEに変更箇所を明記する。

### 11.2 GitHub Actions

`.github/workflows/deploy.yml` を作成し、mainブランチへのpushで自動デプロイする。

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

---

## 12. エラーハンドリング

### 12.1 必須エラー表示

以下はユーザーに分かりやすく表示する。

- 非対応ブラウザ
- WebCodecsが使えない
- WebGL2が使えない
- 動画読み込み失敗
- 対応外codec
- メモリ不足
- 書き出し失敗
- 書き出しキャンセル
- 音声保持失敗

### 12.2 Capability Check

起動時に以下をチェックする。

```ts
export type Capability = {
  webCodecs: boolean;
  videoDecoder: boolean;
  videoEncoder: boolean;
  offscreenCanvas: boolean;
  webgl2: boolean;
  webgpu: boolean;
  worker: boolean;
};
```

結果を画面上に簡潔に表示する。

例:

```txt
高速モード: 有効
WebCodecs: OK
WebGL2: OK
Worker: OK
音声保持: 実験的
```

---

## 13. ログ設計

### 13.1 方針

Claude Codeによる実装・デバッグをしやすくするため、処理ブロックごとにログを出す。

ログは開発時に詳細、本番時に最小とする。

### 13.2 ログ例

```ts
logger.info('video:loaded', { width, height, duration });
logger.info('export:start', { frameCount, width, height });
logger.debug('frame:processed', { index, time });
logger.warn('audio:preserve-failed', { reason });
logger.error('export:failed', error);
```

### 13.3 診断情報出力

将来的に「診断ログをJSONで保存」できるようにする。

含める情報:

- ブラウザ情報
- Capability
- 動画メタ情報
- 書き出し設定
- エラー内容
- パフォーマンス測定結果

動画ファイル本体は含めない。

---

## 14. 開発手順

### 14.1 初期セットアップ

```bash
npm create vite@latest . -- --template svelte-ts
npm install
npm install -D eslint prettier typescript
```

必要ライブラリ候補:

```bash
npm install mp4box
```

muxライブラリは実装時点で最適なものを調査し、軽量なものを選定する。

ffmpeg.wasmは初期依存に入れない。

### 14.2 実装順序

以下の順で実装する。

1. Vite + Svelte + TypeScriptの最小構成
2. GitHub Pages用build/deploy設定
3. 動画D&D読み込み
4. `<video>` による再生
5. SVG/Canvas overlayによる矩形編集
6. MosaicTrack / Keyframeデータモデル
7. キーフレーム補間
8. プレビュー用WebGL2モザイク描画
9. Worker化
10. WebCodecsによるdecode検証
11. WebCodecsによるencode検証
12. MP4出力
13. 音声保持
14. 書き出しキャンセル
15. パフォーマンス計測
16. エラー表示整備
17. README整備

### 14.3 MVP完了条件

MVPでは以下を満たせば完了とする。

- GitHub Pagesで公開できる
- MP4動画をD&Dで読み込める
- 動画を再生できる
- モザイク矩形を追加できる
- モザイク矩形を移動・リサイズできる
- 現在時刻にキーフレームを追加できる
- キーフレーム間で矩形が補間される
- プレビューでモザイクが表示される
- 書き出しボタンでモザイク適用済み動画を保存できる
- 出力ファイル名に `_mosaic` が付く
- UIが大きく固まらない
- 処理中の進捗が表示される

---

## 15. 品質要件

### 15.1 パフォーマンス目標

目標:

- 1080p / 30fps / 5秒動画で実用的に編集できる
- プレビュー操作時にUIが固まらない
- ドラッグ操作中も大きな遅延を出さない
- 書き出し中も進捗表示が更新される

理想:

- 1080p / 60fps / 10秒動画でも実用可能
- 複数モザイク範囲でも破綻しない

### 15.2 メモリ要件

- 全フレームをメモリに保持しない
- 逐次処理する
- VideoFrameは必ずcloseする
- 不要なBlob URLはrevokeする
- 書き出し中のメモリ増加をログで確認できるようにする

### 15.3 セキュリティ・プライバシー

- 動画ファイルをサーバーへ送信しない
- すべてローカルブラウザ内で処理する
- 外部APIを呼ばない
- CDN依存は避け、基本はbundleに含める
- READMEに「動画はアップロードされません」と明記する

---

## 16. READMEに記載する内容

READMEには以下を記載する。

- アプリ概要
- GitHub Pages URL
- 対応ブラウザ
- 使い方
- 動画はサーバーにアップロードされないこと
- 既知の制限
- 開発方法
- build方法
- deploy方法
- 技術構成
- パフォーマンス方針

---

## 17. Claude Codeへの実装指示

以下の方針を厳守して実装すること。

### 17.1 最重要指示

- パフォーマンス最優先
- UIと動画処理を完全分離する
- Svelte storeにVideoFrame/ImageData/全フレーム配列を入れない
- 重い処理はWorkerへ逃がす
- Canvas処理はOffscreenCanvasを優先する
- モザイク処理はWebGL2を優先する
- VideoFrameは必ずcloseする
- 書き出しは逐次処理し、全フレームを保持しない
- GitHub Pagesで動く静的アプリとして実装する

### 17.2 実装時の注意

- 最初から完璧な音声保持にこだわりすぎない
- まずは映像のみの高速書き出しを成立させる
- その後に音声保持を追加する
- WebGPUは初期実装では不要
- ffmpeg.wasmは初期依存に入れない
- 必要になった場合のみ遅延ロードfallbackとして検討する
- ブラウザ互換性チェックを必ず実装する
- 非対応機能はユーザーに分かりやすく表示する

### 17.3 完了時に確認すること

- `npm run build` が成功すること
- GitHub Pagesで表示できること
- Chrome最新版で基本操作できること
- Edge最新版で基本操作できること
- 5秒程度のMP4動画でモザイク編集できること
- 書き出しファイルが再生できること
- UIスレッドが長時間固まらないこと
- メモリリークが明らかに発生していないこと

---

## 18. 将来拡張

将来的に以下を追加する。

- WebGPU renderer
- 音声完全保持
- 複数動画一括処理
- 楕円モザイク
- ブラー処理
- 黒塗り処理
- 自動追跡
- プロジェクトJSON保存/復元
- ショートカットカスタマイズ
- PWA対応
- OPFSによる大容量一時ファイル処理
- WebAssemblyによる補助処理高速化

---

## 19. まとめ

本アプリは、GitHub Pagesで公開する静的Webアプリでありながら、ブラウザの最新APIを活用して高性能な動画モザイク編集を目指す。

採用する基本構成は以下とする。

```txt
Vite + Svelte + TypeScript
Web Worker
OffscreenCanvas
WebCodecs
WebGL2
GitHub Pages
```

最重要ポイントは、UIフレームワークに動画処理をさせないことである。

UIはSvelte、重い処理はWorker、描画はWebGL2、動画入出力はWebCodecs、という役割分担を徹底する。
