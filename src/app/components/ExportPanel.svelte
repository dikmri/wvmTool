<script lang="ts">
  import { get } from 'svelte/store';
  import { projectStore, exportSettingsStore, tracksStore, videoMetaStore } from '../stores/project-store';
  import { exportStatus, exportProgress, exportError } from '../stores/ui-store';
  import { downloadBlob, getOutputFileName } from '../../utils/file';
  import { logger } from '../../utils/logger';

  export let videoFile: File | null = null;

  $: settings = $exportSettingsStore;
  $: status = $exportStatus;
  $: progress = $exportProgress;
  $: errMsg = $exportError;
  $: tracks = $tracksStore;
  $: meta = $videoMetaStore;

  let worker: Worker | null = null;

  async function startExport() {
    if (!videoFile || !meta) return;
    exportStatus.set('exporting');
    exportProgress.set({ current: 0, total: 0 });
    exportError.set(null);

    const arrayBuffer = await videoFile.arrayBuffer();

    worker = new Worker(new URL('../../workers/export-worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        exportProgress.set({ current: msg.current, total: msg.total });
      } else if (msg.type === 'done') {
        exportStatus.set('done');
        const fileName = getOutputFileName(videoFile!.name, settings.outputFileSuffix);
        downloadBlob(msg.blob, fileName);
        logger.info('export:done', { fileName });
        worker?.terminate();
        worker = null;
      } else if (msg.type === 'error') {
        exportStatus.set('error');
        exportError.set(msg.message);
        logger.error('export:error', msg.message);
        worker?.terminate();
        worker = null;
      } else if (msg.type === 'cancelled') {
        exportStatus.set('cancelled');
        worker?.terminate();
        worker = null;
      }
    };

    worker.postMessage(
      {
        type: 'start',
        videoData: arrayBuffer,
        tracks: get(tracksStore),
        settings: get(exportSettingsStore),
        meta,
      },
      [arrayBuffer],
    );
  }

  function cancelExport() {
    worker?.postMessage({ type: 'cancel' });
  }

  $: progressPct =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
</script>

<div class="export-panel">
  <h3 class="panel-title">書き出し</h3>

  <div class="settings-grid">
    <label class="setting-item">
      <span>コーデック</span>
      <select
        value={settings.videoCodec}
        on:change={(e) =>
          projectStore.updateExportSettings({ videoCodec: (e.target as HTMLSelectElement).value as 'auto' | 'avc1' | 'vp09' | 'av01' })}
      >
        <option value="auto">Auto (H.264優先)</option>
        <option value="avc1">H.264 (AVC)</option>
        <option value="vp09">VP9</option>
        <option value="av01">AV1</option>
      </select>
    </label>

    <label class="setting-item">
      <span>音声保持</span>
      <input
        type="checkbox"
        checked={settings.preserveAudio}
        on:change={(e) =>
          projectStore.updateExportSettings({ preserveAudio: (e.target as HTMLInputElement).checked })}
      />
    </label>

    <label class="setting-item">
      <span>接尾辞</span>
      <input
        type="text"
        value={settings.outputFileSuffix}
        on:input={(e) =>
          projectStore.updateExportSettings({ outputFileSuffix: (e.target as HTMLInputElement).value })}
      />
    </label>
  </div>

  {#if status === 'idle' || status === 'done' || status === 'error' || status === 'cancelled'}
    <button
      class="export-btn"
      on:click={startExport}
      disabled={!videoFile || tracks.length === 0}
    >
      {status === 'done' ? '✓ 再書き出し' : '書き出し開始'}
    </button>
    {#if !videoFile}
      <p class="hint">動画を読み込んでください</p>
    {:else if tracks.length === 0}
      <p class="hint">モザイクトラックを追加してください</p>
    {/if}
  {/if}

  {#if status === 'exporting'}
    <div class="progress-area">
      <div class="progress-bar">
        <div class="progress-fill" style="width:{progressPct}%"></div>
      </div>
      <span class="progress-text">{progressPct}% ({progress.current}/{progress.total}フレーム)</span>
      <button class="cancel-btn" on:click={cancelExport}>キャンセル</button>
    </div>
  {/if}

  {#if status === 'error' && errMsg}
    <div class="error-msg">エラー: {errMsg}</div>
  {/if}

  {#if status === 'cancelled'}
    <div class="cancelled-msg">書き出しをキャンセルしました</div>
  {/if}
</div>

<style>
  .export-panel {
    background: #1e1e1e;
    border-top: 1px solid #333;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .panel-title {
    margin: 0;
    font-size: 13px;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .settings-grid {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }

  .setting-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #aaa;
  }

  .setting-item select,
  .setting-item input[type='text'] {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #ccc;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 12px;
  }

  .export-btn {
    background: #1a4433;
    border: 1px solid #00cc66;
    color: #00ff88;
    padding: 8px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .export-btn:hover:not(:disabled) {
    background: #225544;
    box-shadow: 0 0 8px #00cc6644;
  }

  .export-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .hint {
    font-size: 11px;
    color: #666;
    margin: 0;
  }

  .progress-area {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 200px;
  }

  .progress-bar {
    flex: 1;
    height: 8px;
    background: #2a2a2a;
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #00cc66;
    border-radius: 4px;
    transition: width 0.3s;
  }

  .progress-text {
    font-size: 11px;
    color: #aaa;
    white-space: nowrap;
  }

  .cancel-btn {
    background: #331a1a;
    border: 1px solid #cc334444;
    color: #cc4444;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .error-msg {
    color: #ff4444;
    font-size: 12px;
    background: #2a1010;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .cancelled-msg {
    color: #aaa;
    font-size: 12px;
  }
</style>
