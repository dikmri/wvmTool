<script lang="ts">
  import { projectStore, tracksStore, videoMetaStore } from '../stores/project-store';
  import { selectedTrackId, drawingMode } from '../stores/ui-store';
  import { get } from 'svelte/store';

  $: tracks = $tracksStore;
  $: selTrackId = $selectedTrackId;
  $: mode = $drawingMode;
  $: hasProject = $videoMetaStore !== null;

  function addTrack() {
    projectStore.addTrack();
    const project = get({ subscribe: projectStore.subscribe });
    if (project && project.tracks.length > 0) {
      selectedTrackId.set(project.tracks[project.tracks.length - 1].id);
    }
    drawingMode.set('draw');
  }

  function removeSelectedTrack() {
    const id = get(selectedTrackId);
    if (!id) return;
    projectStore.removeTrack(id);
    selectedTrackId.set(null);
  }

  function setMosaicSize(trackId: string, e: Event) {
    const size = parseInt((e.target as HTMLInputElement).value);
    if (!isNaN(size)) projectStore.setTrackMosaicSize(trackId, size);
  }
</script>

<div class="tool-panel">
  <h3 class="panel-title">ツール</h3>

  <div class="mode-buttons">
    <button
      class="mode-btn"
      class:active={mode === 'select'}
      on:click={() => drawingMode.set('select')}
      title="選択モード"
    >
      ↖ 選択
    </button>
    <button
      class="mode-btn"
      class:active={mode === 'draw'}
      on:click={() => drawingMode.set('draw')}
      title="描画モード"
    >
      □ 描画
    </button>
  </div>

  <div class="section-title">モザイクトラック</div>

  <div class="track-actions">
    <button
      class="action-btn add"
      on:click={addTrack}
      disabled={!hasProject}
      title={hasProject ? 'トラックを追加' : '動画を読み込んでください'}
    >＋ 追加</button>
    {#if selTrackId}
      <button class="action-btn remove" on:click={removeSelectedTrack}>× 削除</button>
    {/if}
  </div>
  {#if !hasProject}
    <p class="no-video-hint">動画を読み込むとトラックを追加できます</p>
  {/if}

  <div class="track-list">
    {#each tracks as track}
      <div
        class="track-item"
        class:selected={track.id === selTrackId}
        on:click={() => selectedTrackId.set(track.id)}
        role="button"
        tabindex="0"
        on:keydown={(e) => e.code === 'Enter' && selectedTrackId.set(track.id)}
      >
        <button
          class="toggle-btn"
          class:enabled={track.enabled}
          on:click|stopPropagation={() => projectStore.toggleTrack(track.id)}
          title={track.enabled ? '無効化' : '有効化'}
        >
          {track.enabled ? '●' : '○'}
        </button>
        <span class="track-name">{track.name}</span>
        <span class="kf-count">{track.keyframes.length} KF</span>
      </div>

      {#if track.id === selTrackId}
        <div class="track-settings">
          <label class="setting-row">
            <div class="setting-label-row">
              <span>モザイクサイズ</span>
              <span class="val">{track.mosaicSize}px</span>
            </div>
            <input
              type="range"
              min="5"
              max="80"
              value={track.mosaicSize}
              on:input={(e) => setMosaicSize(track.id, e)}
            />
          </label>
        </div>
      {/if}
    {/each}

    {#if tracks.length === 0}
      <div class="empty-hint">トラックを追加してください</div>
    {/if}
  </div>
</div>

<style>
  .tool-panel {
    background: #1e1e1e;
    border-right: 1px solid #333;
    padding: 12px;
    width: 200px;
    min-width: 180px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .panel-title {
    margin: 0;
    font-size: 13px;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .mode-buttons {
    display: flex;
    gap: 4px;
  }

  .mode-btn {
    flex: 1;
    background: #2a2a2a;
    border: 1px solid #444;
    color: #bbb;
    padding: 6px 4px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }

  .mode-btn.active {
    background: #224433;
    border-color: #00cc66;
    color: #00ff88;
  }

  .section-title {
    font-size: 11px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .track-actions {
    display: flex;
    gap: 4px;
  }

  .action-btn {
    flex: 1;
    padding: 5px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    border: 1px solid;
    transition: all 0.15s;
  }

  .add {
    background: #1a3322;
    border-color: #00cc6644;
    color: #00cc66;
  }

  .add:hover { background: #224433; }
  .add:disabled { opacity: 0.4; cursor: not-allowed; }
  .add:disabled:hover { background: #1a3322; }

  .remove {
    background: #331a1a;
    border-color: #cc000044;
    color: #cc3333;
  }

  .remove:hover { background: #442222; }

  .track-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .track-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
    background: #2a2a2a;
    transition: all 0.15s;
  }

  .track-item:hover { background: #333; }

  .track-item.selected {
    border-color: #00cc6644;
    background: #1a2e22;
  }

  .toggle-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    padding: 0;
    line-height: 1;
    color: #666;
  }

  .toggle-btn.enabled { color: #00cc66; }

  .track-name {
    flex: 1;
    font-size: 12px;
    color: #ccc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kf-count {
    font-size: 10px;
    color: #666;
  }

  .track-settings {
    padding: 6px 8px;
    background: #222;
    border-radius: 4px;
    margin-top: -2px;
  }

  .setting-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: #aaa;
  }

  .setting-label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .setting-row input[type='range'] {
    width: 100%;
    accent-color: #00cc66;
  }

  .val {
    color: #00cc66;
    white-space: nowrap;
  }

  .empty-hint {
    font-size: 11px;
    color: #555;
    text-align: center;
    padding: 12px;
  }

  .no-video-hint {
    font-size: 11px;
    color: #666;
    margin: 0;
    padding: 2px 0;
  }
</style>
