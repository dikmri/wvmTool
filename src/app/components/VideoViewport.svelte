<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { currentTime, isPlaying, duration, fps } from '../stores/playback-store';
  import { projectStore, tracksStore, videoMetaStore } from '../stores/project-store';
  import { selectedTrackId, drawingMode } from '../stores/ui-store';
  import { interpolateKeyframes } from '../../engine/keyframe-interpolator';
  import { displayToVideo, clamp } from '../../engine/coordinate';
  import { WebGL2MosaicRenderer } from '../../render/webgl/gl-context';
  import { logger } from '../../utils/logger';

  export let videoFile: File | null = null;

  let videoEl: HTMLVideoElement;
  let containerEl: HTMLDivElement;
  let overlayCanvas: HTMLCanvasElement;
  let glCanvas: HTMLCanvasElement;
  let glRenderer: WebGL2MosaicRenderer | null = null;
  let raf = 0;
  let videoObjectUrl = '';
  let displayWidth = 0;
  let displayHeight = 0;
  let isDraggingRect = false;
  let isDrawingNew = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragCurrentX = 0;
  let dragCurrentY = 0;
  let dragTrackId = '';
  let dragInitialRect = { x: 0, y: 0, width: 0, height: 0 };
  let glReady = false;

  $: meta = $videoMetaStore;
  $: tracks = $tracksStore;
  $: selTrackId = $selectedTrackId;
  $: mode = $drawingMode;

  $: if (videoFile) loadVideo(videoFile);

  async function loadVideo(file: File) {
    if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    videoObjectUrl = URL.createObjectURL(file);
    videoEl.src = videoObjectUrl;
    videoEl.load();
    glReady = false;
  }

  function onVideoLoaded() {
    duration.set(videoEl.duration);
    updateDisplaySize();
    initGL();
  }

  function updateDisplaySize() {
    if (!meta || !containerEl) return;
    const maxW = containerEl.clientWidth;
    const maxH = containerEl.clientHeight;
    const ratio = meta.width / meta.height;
    if (maxW / ratio <= maxH) {
      displayWidth = maxW;
      displayHeight = maxW / ratio;
    } else {
      displayHeight = maxH;
      displayWidth = maxH * ratio;
    }
  }

  async function initGL() {
    if (!meta) return;
    try {
      glRenderer?.dispose();
      glCanvas.width = meta.width;
      glCanvas.height = meta.height;
      glRenderer = new WebGL2MosaicRenderer(glCanvas);
      await glRenderer.init(meta.width, meta.height);
      glReady = true;
      logger.info('viewport:gl-ready', { width: meta.width, height: meta.height });
    } catch (e) {
      logger.warn('viewport:gl-init-failed', e);
    }
    startRenderLoop();
  }

  function startRenderLoop() {
    cancelAnimationFrame(raf);
    const render = () => {
      if (!glReady || !glRenderer || !videoEl || !meta) {
        raf = requestAnimationFrame(render);
        return;
      }
      const t = videoEl.currentTime;
      currentTime.set(t);
      glRenderer.renderFrame(videoEl, tracks, t);
      drawOverlay(t);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
  }

  function drawOverlay(time: number) {
    if (!overlayCanvas || !meta) return;
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    const scaleX = displayWidth / meta.width;
    const scaleY = displayHeight / meta.height;

    for (const track of tracks) {
      if (!track.enabled) continue;
      const rect = interpolateKeyframes(track.keyframes, time);
      if (!rect) continue;
      const dx = rect.x * scaleX;
      const dy = rect.y * scaleY;
      const dw = rect.width * scaleX;
      const dh = rect.height * scaleY;
      ctx.strokeStyle = track.id === selTrackId ? '#00ff88' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash(track.id === selTrackId ? [] : [4, 4]);
      ctx.strokeRect(dx, dy, dw, dh);
      ctx.setLineDash([]);
      ctx.fillStyle = (track.id === selTrackId ? '#00ff88' : '#ffffff') + '22';
      ctx.fillRect(dx, dy, dw, dh);
    }

    // Draw new rect being drawn
    if (isDrawingNew && mode === 'draw') {
      const x = Math.min(dragStartX, dragCurrentX);
      const y = Math.min(dragStartY, dragCurrentY);
      const w = Math.abs(dragCurrentX - dragStartX);
      const h = Math.abs(dragCurrentY - dragStartY);
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#ff444422';
      ctx.fillRect(x, y, w, h);
    }
  }

  function getCanvasPos(e: MouseEvent): { x: number; y: number } {
    const rect = overlayCanvas.getBoundingClientRect();
    return {
      x: clamp(e.clientX - rect.left, 0, displayWidth),
      y: clamp(e.clientY - rect.top, 0, displayHeight),
    };
  }

  function onMouseDown(e: MouseEvent) {
    const { x, y } = getCanvasPos(e);

    if (mode === 'draw' && selTrackId) {
      isDrawingNew = true;
      dragStartX = x;
      dragStartY = y;
      dragCurrentX = x;
      dragCurrentY = y;
      return;
    }

    if (mode === 'select' && meta) {
      const scaleX = displayWidth / meta.width;
      const scaleY = displayHeight / meta.height;
      const t = get(currentTime);

      for (const track of [...tracks].reverse()) {
        if (!track.enabled) continue;
        const rect = interpolateKeyframes(track.keyframes, t);
        if (!rect) continue;
        const dx = rect.x * scaleX;
        const dy = rect.y * scaleY;
        const dw = rect.width * scaleX;
        const dh = rect.height * scaleY;
        if (x >= dx && x <= dx + dw && y >= dy && y <= dy + dh) {
          selectedTrackId.set(track.id);
          isDraggingRect = true;
          dragTrackId = track.id;
          dragStartX = x;
          dragStartY = y;
          dragInitialRect = { ...rect };
          break;
        }
      }
    }
  }

  function onMouseMove(e: MouseEvent) {
    const { x, y } = getCanvasPos(e);

    if (isDrawingNew) {
      dragCurrentX = x;
      dragCurrentY = y;
      return;
    }

    if (isDraggingRect && meta) {
      const dx = x - dragStartX;
      const dy = y - dragStartY;
      const scaleX = meta.width / displayWidth;
      const scaleY = meta.height / displayHeight;
      const track = tracks.find((t) => t.id === dragTrackId);
      if (!track) return;
      const t = get(currentTime);
      const newX = clamp(dragInitialRect.x + dx * scaleX, 0, meta.width - dragInitialRect.width);
      const newY = clamp(dragInitialRect.y + dy * scaleY, 0, meta.height - dragInitialRect.height);
      projectStore.addKeyframe(dragTrackId, t, newX, newY, dragInitialRect.width, dragInitialRect.height);
    }
  }

  function onMouseUp(e: MouseEvent) {
    const { x, y } = getCanvasPos(e);

    if (isDrawingNew && selTrackId && meta) {
      const rx = Math.min(dragStartX, x);
      const ry = Math.min(dragStartY, y);
      const rw = Math.abs(x - dragStartX);
      const rh = Math.abs(y - dragStartY);
      if (rw > 5 && rh > 5) {
        const scaleX = meta.width / displayWidth;
        const scaleY = meta.height / displayHeight;
        const t = get(currentTime);
        projectStore.addKeyframe(selTrackId, t, rx * scaleX, ry * scaleY, rw * scaleX, rh * scaleY);
      }
      isDrawingNew = false;
      return;
    }

    isDraggingRect = false;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('video/')) {
      videoFile = file;
    }
  }

  onMount(() => {
    const ro = new ResizeObserver(() => {
      updateDisplaySize();
    });
    if (containerEl) ro.observe(containerEl);

    return () => ro.disconnect();
  });

  onDestroy(() => {
    cancelAnimationFrame(raf);
    glRenderer?.dispose();
    if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  });
</script>

<div
  class="viewport-container"
  bind:this={containerEl}
  on:dragover|preventDefault
  on:drop={onDrop}
  role="region"
  aria-label="Video viewport"
>
  {#if !videoFile}
    <div class="drop-hint">
      <div class="drop-icon">🎬</div>
      <p>MP4動画をドラッグ&ドロップ</p>
      <p class="sub">または クリックして選択</p>
      <input
        type="file"
        accept="video/mp4,video/*"
        class="file-input"
        on:change={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) videoFile = f;
        }}
      />
    </div>
  {/if}

  <div
    class="video-wrapper"
    style="width:{displayWidth}px;height:{displayHeight}px"
  >
    <!-- svelte-ignore a11y-media-has-caption -->
    <video
      bind:this={videoEl}
      class="video-el"
      on:loadedmetadata={onVideoLoaded}
      on:play={() => isPlaying.set(true)}
      on:pause={() => isPlaying.set(false)}
      muted
      playsinline
    ></video>
    <canvas
      bind:this={glCanvas}
      class="gl-canvas"
      style="width:{displayWidth}px;height:{displayHeight}px"
    ></canvas>
    <canvas
      bind:this={overlayCanvas}
      class="overlay-canvas"
      width={displayWidth}
      height={displayHeight}
      on:mousedown={onMouseDown}
      on:mousemove={onMouseMove}
      on:mouseup={onMouseUp}
      on:mouseleave={onMouseUp}
    ></canvas>
  </div>
</div>

<style>
  .viewport-container {
    position: relative;
    width: 100%;
    height: 100%;
    background: #1a1a1a;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .drop-hint {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #888;
    gap: 8px;
    z-index: 10;
    pointer-events: all;
  }

  .drop-icon {
    font-size: 48px;
  }

  .drop-hint p {
    margin: 0;
    font-size: 16px;
  }

  .drop-hint .sub {
    font-size: 13px;
    opacity: 0.6;
  }

  .file-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .video-wrapper {
    position: relative;
  }

  .video-el {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
  }

  .gl-canvas {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .overlay-canvas {
    position: absolute;
    inset: 0;
    cursor: crosshair;
  }
</style>
