<script lang="ts">
  import { get } from 'svelte/store';
  import { currentTime, duration, fps, isPlaying, totalFrames, currentFrame, videoElement } from '../stores/playback-store';
  import { tracksStore, projectStore } from '../stores/project-store';
  import { selectedTrackId, selectedKeyframeId } from '../stores/ui-store';
  import { interpolateKeyframes } from '../../engine/keyframe-interpolator';

  $: tracks = $tracksStore;
  $: dur = $duration;
  $: ct = $currentTime;
  $: selKfId = $selectedKeyframeId;
  $: selTrackId = $selectedTrackId;
  $: cfr = $currentFrame;
  $: totalFr = $totalFrames;

  let timelineEl: HTMLDivElement;
  let isDraggingScrubber = false;

  function seek(time: number) {
    const vid = get(videoElement);
    if (!vid) return;
    vid.currentTime = Math.max(0, Math.min(time, get(duration)));
    currentTime.set(vid.currentTime);
  }

  function seekByFrame(delta: number) {
    const f = get(fps);
    seek(get(currentTime) + delta / f);
  }

  function togglePlay() {
    const vid = get(videoElement);
    if (!vid) return;
    if (get(isPlaying)) {
      vid.pause();
    } else {
      vid.play();
    }
  }

  function addKeyframe() {
    const trackId = get(selectedTrackId);
    if (!trackId) return;
    const project = get({ subscribe: projectStore.subscribe });
    if (!project) return;
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const t = get(currentTime);
    const meta = project.sourceVideoMeta;
    const existing = interpolateKeyframes(track.keyframes, t);
    const x = existing?.x ?? meta.width * 0.25;
    const y = existing?.y ?? meta.height * 0.25;
    const w = existing?.width ?? meta.width * 0.25;
    const h = existing?.height ?? meta.height * 0.25;
    const rot = existing?.rotation ?? 0;
    const vis = existing?.visible ?? true;
    projectStore.addKeyframe(trackId, t, x, y, w, h, rot, vis);
  }

  function deleteSelectedKeyframe() {
    const kfId = get(selectedKeyframeId);
    const trackId = get(selectedTrackId);
    if (!kfId || !trackId) return;
    projectStore.removeKeyframe(trackId, kfId);
    selectedKeyframeId.set(null);
  }

  function onTimelineClick(e: MouseEvent) {
    if (!timelineEl || get(duration) === 0) return;
    const rect = timelineEl.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seek(ratio * get(duration));
  }

  function onScrubberMouseDown(e: MouseEvent) {
    isDraggingScrubber = true;
    e.stopPropagation();
  }

  function onWindowMouseMove(e: MouseEvent) {
    if (!isDraggingScrubber || !timelineEl || get(duration) === 0) return;
    const rect = timelineEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(ratio * get(duration));
  }

  function onWindowMouseUp() {
    isDraggingScrubber = false;
  }

  function toggleMosaicVisibility() {
    const trackId = get(selectedTrackId);
    if (!trackId) return;
    const project = get({ subscribe: projectStore.subscribe });
    if (!project) return;
    const track = project.tracks.find((tr) => tr.id === trackId);
    if (!track) return;
    const t = get(currentTime);
    const rect = interpolateKeyframes(track.keyframes, t);
    if (!rect) return;
    const newVisible = !(rect.visible ?? true);
    projectStore.addKeyframe(trackId, t, rect.x, rect.y, rect.width, rect.height, rect.rotation ?? 0, newVisible);
  }

  function rotateSelectedTrack(code: string) {
    const trackId = get(selectedTrackId);
    if (!trackId) return;
    const project = get({ subscribe: projectStore.subscribe });
    if (!project) return;
    const track = project.tracks.find((tr) => tr.id === trackId);
    if (!track) return;
    const t = get(currentTime);
    const rect = interpolateKeyframes(track.keyframes, t);
    if (!rect) return;
    const delta = code === 'KeyQ' ? -5 : code === 'KeyE' ? 5 : 0;
    const newRotation = code === 'KeyR' ? 0 : (rect.rotation ?? 0) + delta;
    projectStore.addKeyframe(trackId, t, rect.x, rect.y, rect.width, rect.height, newRotation, rect.visible ?? true);
  }

  function formatTime(t: number): string {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 100);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
  }
</script>

<svelte:window
  on:mousemove={onWindowMouseMove}
  on:mouseup={onWindowMouseUp}
  on:keydown={(e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowLeft') { e.preventDefault(); seekByFrame(-1); }
    if (e.code === 'ArrowRight') { e.preventDefault(); seekByFrame(1); }
    if (e.code === 'KeyK') { e.preventDefault(); addKeyframe(); }
    if (e.code === 'Delete') { e.preventDefault(); deleteSelectedKeyframe(); }
    if (e.code === 'KeyQ' || e.code === 'KeyE' || e.code === 'KeyR') { e.preventDefault(); rotateSelectedTrack(e.code); }
    if (e.code === 'KeyH') { e.preventDefault(); toggleMosaicVisibility(); }
  }}
/>

<div class="timeline">
  <div class="timeline-controls">
    <button class="ctrl-btn" on:click={() => seekByFrame(-1)} title="1フレーム戻る">◀</button>
    <button class="ctrl-btn play-btn" on:click={togglePlay} title="再生/停止">
      {$isPlaying ? '⏸' : '▶'}
    </button>
    <button class="ctrl-btn" on:click={() => seekByFrame(1)} title="1フレーム進む">▶</button>
    <span class="timecode">{formatTime(ct)} / {formatTime(dur)}</span>
    <span class="framecode">F{cfr} / {totalFr}</span>
    <button class="ctrl-btn kf-btn" on:click={addKeyframe} title="キーフレーム追加 (K)">+ KF</button>
    {#if selKfId}
      <button class="ctrl-btn del-btn" on:click={deleteSelectedKeyframe} title="キーフレーム削除 (Del)">- KF</button>
    {/if}
  </div>

  <div
    class="scrubber-area"
    bind:this={timelineEl}
    on:click={onTimelineClick}
    on:keydown={(e) => e.code === 'Enter' && onTimelineClick(e as unknown as MouseEvent)}
    role="slider"
    aria-valuemin={0}
    aria-valuemax={dur}
    aria-valuenow={ct}
    tabindex="0"
  >
    {#each tracks as track}
      {#if track.enabled}
        {#each track.keyframes as kf}
          <div
            class="kf-marker"
            class:selected={kf.id === selKfId && track.id === selTrackId}
            style="left:{dur > 0 ? (kf.time / dur) * 100 : 0}%"
            title="t={kf.time.toFixed(2)}s"
            on:click|stopPropagation={() => {
              selectedTrackId.set(track.id);
              selectedKeyframeId.set(kf.id);
              seek(kf.time);
            }}
            role="button"
            tabindex="0"
            on:keydown={(e) => e.code === 'Enter' && (() => {
              selectedTrackId.set(track.id);
              selectedKeyframeId.set(kf.id);
              seek(kf.time);
            })()}
          ></div>
        {/each}
      {/if}
    {/each}

    <div
      class="playhead"
      style="left:{dur > 0 ? (ct / dur) * 100 : 0}%"
      on:mousedown={onScrubberMouseDown}
      role="presentation"
    ></div>

    <div class="progress-bar" style="width:{dur > 0 ? (ct / dur) * 100 : 0}%"></div>
  </div>
</div>

<style>
  .timeline {
    background: #252525;
    border-top: 1px solid #333;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    user-select: none;
  }

  .timeline-controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .ctrl-btn {
    background: #333;
    border: 1px solid #444;
    color: #ccc;
    padding: 0 10px;
    height: 28px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .ctrl-btn:hover {
    background: #444;
    color: #fff;
  }

  .play-btn {
    font-size: 16px;
    width: 36px;
  }

  .kf-btn { color: #00cc66; border-color: #00cc6644; }
  .del-btn { color: #ff4444; border-color: #ff444444; }

  .timecode, .framecode {
    font-family: monospace;
    font-size: 13px;
    color: #aaa;
    margin-left: 4px;
  }

  .scrubber-area {
    position: relative;
    height: 32px;
    background: #1a1a1a;
    border-radius: 4px;
    cursor: pointer;
    overflow: visible;
  }

  .progress-bar {
    height: 100%;
    background: #336699;
    border-radius: 4px;
    pointer-events: none;
  }

  .playhead {
    position: absolute;
    top: -4px;
    width: 2px;
    height: calc(100% + 8px);
    background: #ffffff;
    transform: translateX(-50%);
    cursor: ew-resize;
    z-index: 10;
  }

  .playhead::before {
    content: '';
    position: absolute;
    top: -4px;
    left: 50%;
    transform: translateX(-50%);
    width: 10px;
    height: 10px;
    background: #fff;
    border-radius: 50%;
  }

  .kf-marker {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 10px;
    height: 10px;
    background: #ffcc00;
    border-radius: 2px;
    rotate: 45deg;
    cursor: pointer;
    z-index: 5;
    border: 1px solid #000;
  }

  .kf-marker.selected {
    background: #00ff88;
    box-shadow: 0 0 4px #00ff88;
  }
</style>
