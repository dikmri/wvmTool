<script lang="ts">
  import { onMount } from 'svelte';
  import VideoViewport from './components/VideoViewport.svelte';
  import Timeline from './components/Timeline.svelte';
  import ToolPanel from './components/ToolPanel.svelte';
  import ExportPanel from './components/ExportPanel.svelte';
  import CapabilityBadge from './components/CapabilityBadge.svelte';
  import { capability } from './stores/ui-store';
  import { checkCapabilities } from '../engine/validation';
  import { logger } from '../utils/logger';
  import packageJson from '../../package.json';

  let videoFile: File | null = null;
  let showHelp = false;
  const version = packageJson.version;

  onMount(async () => {
    const cap = await checkCapabilities();
    capability.set(cap);
    logger.info('app:capabilities', cap);
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.code === 'Escape' && showHelp) showHelp = false;
  }
</script>

<svelte:window on:keydown={onKeyDown} />

<div class="app">
  <header class="header">
    <div class="logo">🎬 wvmTool</div>
    <span class="version">v{version}</span>
    <CapabilityBadge />
    <div class="header-spacer"></div>
    <button class="help-btn" on:click={() => showHelp = true}>使い方</button>
  </header>

  <div class="main-area">
    <ToolPanel />
    <div class="viewport-area">
      <VideoViewport bind:videoFile />
    </div>
  </div>

  <Timeline />
  <ExportPanel {videoFile} />
</div>

{#if showHelp}
  <div
    class="modal-overlay"
    on:click|self={() => showHelp = false}
    on:keydown={(e) => e.code === 'Escape' && (showHelp = false)}
    role="dialog"
    aria-modal="true"
    aria-label="使い方"
    tabindex="-1"
  >
    <div class="modal">
      <div class="modal-header">
        <h2>使い方</h2>
        <button class="close-btn" on:click={() => showHelp = false}>✕</button>
      </div>

      <div class="modal-body">
        <h3>基本的な使い方</h3>
        <ol>
          <li>MP4動画をビューポートにドラッグ&amp;ドロップ（またはクリックして選択）</li>
          <li><kbd>N</kbd> キーまたは「＋ 追加」でモザイクトラックを作成（自動的に描画モードへ移行）</li>
          <li>ビューポート上でドラッグしてモザイク範囲を描く</li>
          <li>タイムラインをシークしながら、<kbd>K</kbd> キーでキーフレームを追加</li>
          <li>コーナーハンドルでリサイズ、ドラッグで移動</li>
          <li>「書き出し開始」で音声付きMP4を書き出し</li>
        </ol>

        <h3>キーボードショートカット</h3>
        <table>
          <thead><tr><th>キー</th><th>操作</th></tr></thead>
          <tbody>
            <tr><td><kbd>Space</kbd></td><td>再生 / 停止</td></tr>
            <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>1フレーム戻る / 進む</td></tr>
            <tr><td><kbd>K</kbd></td><td>現在位置にキーフレーム追加</td></tr>
            <tr><td><kbd>Delete</kbd></td><td>選択中キーフレームを削除</td></tr>
            <tr><td><kbd>Q</kbd> / <kbd>E</kbd></td><td>モザイク範囲を 5° 回転（反時計 / 時計）</td></tr>
            <tr><td><kbd>R</kbd></td><td>回転をリセット（0°）</td></tr>
            <tr><td><kbd>H</kbd></td><td>モザイク表示 / 非表示をキーフレームとして記録</td></tr>
            <tr><td><kbd>I</kbd></td><td>選択モードに切り替え</td></tr>
            <tr><td><kbd>N</kbd></td><td>新しいモザイクトラックを追加</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>このダイアログを閉じる</td></tr>
          </tbody>
        </table>

        <h3>モザイクトラックの操作</h3>
        <ul>
          <li><strong>複数トラック</strong>：トラックを複数追加するとそれぞれ独立したモザイク領域を持つ</li>
          <li><strong>●/○ ボタン</strong>：トラックの有効 / 無効を切り替え</li>
          <li><strong>コーナーハンドル</strong>：ドラッグでリサイズ（変更はキーフレームとして記録）</li>
          <li><strong>再生中</strong>：オーバーレイ枠線が消え、モザイクのみを確認できる</li>
        </ul>

        <h3>プライバシー</h3>
        <p>動画ファイルはサーバーにアップロードされません。すべての処理はブラウザ内で完結します。</p>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    background: #111;
    color: #eee;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    overflow: hidden;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: #161616;
    border-bottom: 1px solid #2a2a2a;
    flex-wrap: wrap;
    min-height: 44px;
  }

  .logo {
    font-size: 15px;
    font-weight: bold;
    color: #eee;
    white-space: nowrap;
  }

  .version {
    font-size: 11px;
    color: #555;
    white-space: nowrap;
    margin-top: 1px;
  }

  .header-spacer { flex: 1; }

  .help-btn {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #aaa;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .help-btn:hover {
    background: #333;
    color: #eee;
  }

  .main-area {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .viewport-area {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  /* ── モーダル ── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 8px;
    width: min(680px, 90vw);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 16px;
    color: #eee;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    transition: color 0.15s;
  }

  .close-btn:hover { color: #eee; }

  .modal-body {
    padding: 16px 20px 20px;
    overflow-y: auto;
    font-size: 13px;
    color: #ccc;
    line-height: 1.7;
  }

  .modal-body h3 {
    font-size: 13px;
    color: #00ff88;
    margin: 16px 0 6px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .modal-body h3:first-child { margin-top: 0; }

  .modal-body ol, .modal-body ul {
    margin: 0;
    padding-left: 20px;
  }

  .modal-body li { margin-bottom: 4px; }

  .modal-body p { margin: 4px 0; }

  .modal-body table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .modal-body th {
    text-align: left;
    padding: 4px 10px;
    background: #252525;
    color: #888;
    font-weight: normal;
  }

  .modal-body td {
    padding: 4px 10px;
    border-top: 1px solid #2a2a2a;
  }

  kbd {
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 3px;
    padding: 1px 5px;
    font-family: monospace;
    font-size: 11px;
    color: #ccc;
  }
</style>
