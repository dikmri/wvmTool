<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { currentTime, isPlaying, duration, fps, videoElement } from '../stores/playback-store';
  import { projectStore, tracksStore } from '../stores/project-store';
  import { selectedTrackId, drawingMode } from '../stores/ui-store';
  import { interpolateKeyframes } from '../../engine/keyframe-interpolator';
  import { clamp } from '../../engine/coordinate';
  import { WebGL2MosaicRenderer } from '../../render/webgl/gl-context';
  import { applyMosaicCanvas2D } from '../../render/canvas/canvas2d-fallback';
  import { logger } from '../../utils/logger';

  export let videoFile: File | null = null;

  let videoEl: HTMLVideoElement;
  let containerEl: HTMLDivElement;
  let overlayCanvas: HTMLCanvasElement;
  let glCanvas: HTMLCanvasElement;
  let glRenderer: WebGL2MosaicRenderer | null = null;
  let raf = 0;
  let videoObjectUrl = '';

  // Native dimensions from the video element (set on loadedmetadata)
  let nativeWidth = 0;
  let nativeHeight = 0;

  // Display dimensions (CSS pixels, aspect-fit inside container)
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
  let glFailed = false;          // true when WebGL2 is unavailable → use Canvas2D fallback
  let fallbackCanvas: HTMLCanvasElement;  // Canvas2D fallback overlay

  $: tracks = $tracksStore;
  $: selTrackId = $selectedTrackId;
  $: mode = $drawingMode;

  // React to videoFile prop changes (set by D&D or file input in this component,
  // or passed down from App)
  $: if (videoFile) loadVideo(videoFile);

  async function loadVideo(file: File) {
    glReady = false;
    cancelAnimationFrame(raf);
    glRenderer?.dispose();
    glRenderer = null;

    if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    videoObjectUrl = URL.createObjectURL(file);
    videoEl.src = videoObjectUrl;
    videoEl.load();
  }

  // Called by <video on:loadedmetadata>
  function onVideoMetadataLoaded() {
    nativeWidth = videoEl.videoWidth || 1280;
    nativeHeight = videoEl.videoHeight || 720;

    // Register metadata in project store so other components can read it
    if (videoFile) {
      projectStore.initProject(videoFile.name, {
        width: nativeWidth,
        height: nativeHeight,
        duration: videoEl.duration,
        fps: null,
        hasAudio: false,
      });
    }

    fps.set(30);
    duration.set(videoEl.duration);
    videoElement.set(videoEl);

    updateDisplaySize();
    initGL();

    logger.info('video:metadata-loaded', { nativeWidth, nativeHeight, duration: videoEl.duration });
  }

  function updateDisplaySize() {
    if (!containerEl || nativeWidth === 0 || nativeHeight === 0) return;
    const maxW = containerEl.clientWidth;
    const maxH = containerEl.clientHeight;
    const ratio = nativeWidth / nativeHeight;
    if (maxW / ratio <= maxH) {
      displayWidth = maxW;
      displayHeight = maxW / ratio;
    } else {
      displayHeight = maxH;
      displayWidth = maxH * ratio;
    }
    logger.debug('viewport:display-size', { displayWidth, displayHeight });
  }

  async function initGL() {
    if (nativeWidth === 0 || nativeHeight === 0) return;
    glFailed = false;
    try {
      glCanvas.width = nativeWidth;
      glCanvas.height = nativeHeight;
      glRenderer = new WebGL2MosaicRenderer(glCanvas);
      await glRenderer.init(nativeWidth, nativeHeight);
      glReady = true;
      logger.info('viewport:gl-ready', { nativeWidth, nativeHeight });
    } catch (e) {
      logger.warn('viewport:gl-init-failed — using Canvas2D fallback', e);
      glReady = false;
      glFailed = true;
    }
    startRenderLoop();
  }

  function startRenderLoop() {
    cancelAnimationFrame(raf);
    const render = () => {
      // BUG-A6 fix: only upload to GPU once the video has actual pixel data
      if (videoEl && nativeWidth > 0 && videoEl.readyState >= 2 /* HAVE_CURRENT_DATA */) {
        const t = videoEl.currentTime;
        currentTime.set(t);

        if (glReady && glRenderer) {
          // WebGL path
          glRenderer.renderFrame(videoEl, tracks, t);
        } else if (glFailed) {
          // BUG-A5 fix: Canvas2D fallback when WebGL is unavailable
          renderFallback(t);
        }

        drawOverlay(t);
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
  }

  function renderFallback(time: number) {
    if (!fallbackCanvas || nativeWidth === 0) return;
    fallbackCanvas.width = displayWidth;
    fallbackCanvas.height = displayHeight;
    const ctx = fallbackCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0, displayWidth, displayHeight);
    applyMosaicCanvas2D(
      ctx as unknown as OffscreenCanvasRenderingContext2D,
      tracks,
      time,
      nativeWidth,
      nativeHeight,
    );
  }

  function drawOverlay(time: number) {
    if (!overlayCanvas || displayWidth === 0 || displayHeight === 0) return;
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    const scaleX = displayWidth / nativeWidth;
    const scaleY = displayHeight / nativeHeight;

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

    if (mode === 'select' && nativeWidth > 0) {
      const scaleX = displayWidth / nativeWidth;
      const scaleY = displayHeight / nativeHeight;
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

    if (isDraggingRect && nativeWidth > 0) {
      const dx = x - dragStartX;
      const dy = y - dragStartY;
      const scaleX = nativeWidth / displayWidth;
      const scaleY = nativeHeight / displayHeight;
      const t = get(currentTime);
      const newX = clamp(dragInitialRect.x + dx * scaleX, 0, nativeWidth - dragInitialRect.width);
      const newY = clamp(dragInitialRect.y + dy * scaleY, 0, nativeHeight - dragInitialRect.height);
      projectStore.addKeyframe(dragTrackId, t, newX, newY, dragInitialRect.width, dragInitialRect.height);
    }
  }

  function onMouseUp(e: MouseEvent) {
    const { x, y } = getCanvasPos(e);

    if (isDrawingNew && selTrackId && nativeWidth > 0) {
      const rx = Math.min(dragStartX, x);
      const ry = Math.min(dragStartY, y);
      const rw = Math.abs(x - dragStartX);
      const rh = Math.abs(y - dragStartY);
      if (rw > 5 && rh > 5) {
        const scaleX = nativeWidth / displayWidth;
        const scaleY = nativeHeight / displayHeight;
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
      <p>MP4動画をドラッグ&amp;ドロップ</p>
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
      on:loadedmetadata={onVideoMetadataLoaded}
      on:play={() => isPlaying.set(true)}
      on:pause={() => isPlaying.set(false)}
      muted
      playsinline
    ></video>
    <!-- WebGL2 render canvas (hidden when GL unavailable) -->
    <canvas
      bind:this={glCanvas}
      class="gl-canvas"
      class:hidden={glFailed}
      style="width:{displayWidth}px;height:{displayHeight}px"
    ></canvas>
    <!-- Canvas2D fallback (shown only when WebGL2 init failed) -->
    {#if glFailed}
      <canvas
        bind:this={fallbackCanvas}
        class="gl-canvas"
        width={displayWidth}
        height={displayHeight}
        style="width:{displayWidth}px;height:{displayHeight}px"
      ></canvas>
    {/if}
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

  .gl-canvas.hidden {
    display: none;
  }

  .overlay-canvas {
    position: absolute;
    inset: 0;
    cursor: crosshair;
  }
</style>
