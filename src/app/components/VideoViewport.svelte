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
  import type { InterpolatedRect } from '../../engine/types';

  export let videoFile: File | null = null;

  let videoEl: HTMLVideoElement;
  let containerEl: HTMLDivElement;
  let overlayCanvas: HTMLCanvasElement;
  let glCanvas: HTMLCanvasElement;
  let glRenderer: WebGL2MosaicRenderer | null = null;
  let raf = 0;
  let videoObjectUrl = '';

  let nativeWidth = 0;
  let nativeHeight = 0;
  let displayWidth = 0;
  let displayHeight = 0;

  // Rect drawing state
  let isDrawingNew = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragCurrentX = 0;
  let dragCurrentY = 0;

  // Rect moving state
  let isDraggingRect = false;
  let dragTrackId = '';
  let dragInitialRect = { x: 0, y: 0, width: 0, height: 0, rotation: 0 };
  let dragMoveStartX = 0;
  let dragMoveStartY = 0;

  // Corner handle resize state
  const HANDLE_RADIUS = 7;
  let isDraggingHandle = false;
  let dragHandleType: 'tl' | 'tr' | 'bl' | 'br' = 'tl';
  let handleTrackId = '';
  let handleInitialRect = { x: 0, y: 0, width: 0, height: 0, rotation: 0 };

  let glReady = false;
  let glFailed = false;
  let fallbackCanvas: HTMLCanvasElement;

  $: tracks = $tracksStore;
  $: selTrackId = $selectedTrackId;
  $: mode = $drawingMode;

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

  function onVideoMetadataLoaded() {
    nativeWidth = videoEl.videoWidth || 1280;
    nativeHeight = videoEl.videoHeight || 720;
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
      if (videoEl && nativeWidth > 0 && videoEl.readyState >= 2) {
        const t = videoEl.currentTime;
        currentTime.set(t);
        if (glReady && glRenderer) {
          glRenderer.renderFrame(videoEl, tracks, t);
        } else if (glFailed) {
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
      tracks, time, nativeWidth, nativeHeight,
    );
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  function getCorners(cx: number, cy: number, hw: number, hh: number, rot: number) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return {
      tl: { x: cx + (-hw) * c - (-hh) * s, y: cy + (-hw) * s + (-hh) * c },
      tr: { x: cx +   hw  * c - (-hh) * s, y: cy +   hw  * s + (-hh) * c },
      bl: { x: cx + (-hw) * c -   hh  * s, y: cy + (-hw) * s +   hh  * c },
      br: { x: cx +   hw  * c -   hh  * s, y: cy +   hw  * s +   hh  * c },
    };
  }

  function hitTestHandle(
    pos: { x: number; y: number },
    rect: InterpolatedRect,
    sX: number,
    sY: number,
  ): 'tl' | 'tr' | 'bl' | 'br' | null {
    const dx = rect.x * sX, dy = rect.y * sY;
    const dw = rect.width * sX, dh = rect.height * sY;
    const rot = (rect.rotation ?? 0) * Math.PI / 180;
    const corners = getCorners(dx + dw / 2, dy + dh / 2, dw / 2, dh / 2, rot);
    for (const [type, corner] of Object.entries(corners)) {
      if (Math.hypot(pos.x - corner.x, pos.y - corner.y) <= HANDLE_RADIUS + 4) {
        return type as 'tl' | 'tr' | 'bl' | 'br';
      }
    }
    return null;
  }

  function computeHandleDragRect(
    mx: number,
    my: number,
    handleType: 'tl' | 'tr' | 'bl' | 'br',
    initRect: { x: number; y: number; width: number; height: number; rotation: number },
  ) {
    const { rotation } = initRect;
    const θ = rotation * Math.PI / 180;
    const cosθ = Math.cos(θ), sinθ = Math.sin(θ);
    const cx = initRect.x + initRect.width / 2;
    const cy = initRect.y + initRect.height / 2;
    const hw = initRect.width / 2;
    const hh = initRect.height / 2;

    // Local coords of the OPPOSITE corner
    const oppLocal = {
      tl: { x:  hw, y:  hh },
      tr: { x: -hw, y:  hh },
      bl: { x:  hw, y: -hh },
      br: { x: -hw, y: -hh },
    }[handleType];

    // Opposite corner in native coords (stays fixed during drag)
    const oppX = cx + oppLocal.x * cosθ - oppLocal.y * sinθ;
    const oppY = cy + oppLocal.x * sinθ + oppLocal.y * cosθ;

    // New center
    const newCx = (mx + oppX) / 2;
    const newCy = (my + oppY) / 2;

    // Diagonal from opposite corner to new handle position, projected into local frame
    const diagX = mx - oppX;
    const diagY = my - oppY;
    const localDX = diagX * cosθ + diagY * sinθ;
    const localDY = -diagX * sinθ + diagY * cosθ;

    const newHW = Math.max(Math.abs(localDX) / 2, 5);
    const newHH = Math.max(Math.abs(localDY) / 2, 5);

    return { x: newCx - newHW, y: newCy - newHH, width: newHW * 2, height: newHH * 2, rotation };
  }

  // ── overlay drawing ────────────────────────────────────────────────────────

  function drawOverlay(time: number) {
    if (!overlayCanvas || displayWidth === 0 || displayHeight === 0) return;
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // During playback, hide overlay so user sees pure mosaic
    if (get(isPlaying)) return;

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
      const rot = (rect.rotation ?? 0) * Math.PI / 180;
      const isSel = track.id === selTrackId;
      const isVisible = rect.visible !== false;

      ctx.save();
      ctx.globalAlpha = isVisible ? 1.0 : 0.35;
      ctx.translate(dx + dw / 2, dy + dh / 2);
      ctx.rotate(rot);
      ctx.strokeStyle = isSel ? '#00ff88' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash(isVisible ? (isSel ? [] : [4, 4]) : [2, 4]);
      ctx.strokeRect(-dw / 2, -dh / 2, dw, dh);
      ctx.setLineDash([]);
      ctx.fillStyle = (isSel ? '#00ff88' : '#ffffff') + '22';
      ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
      ctx.restore();

      // Corner handles on selected track only
      if (isSel) {
        const corners = getCorners(dx + dw / 2, dy + dh / 2, dw / 2, dh / 2, rot);
        ctx.save();
        ctx.globalAlpha = isVisible ? 1.0 : 0.35;
        for (const corner of Object.values(corners)) {
          ctx.beginPath();
          ctx.arc(corner.x, corner.y, HANDLE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = '#00ff88';
          ctx.fill();
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Draw-in-progress preview rect
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

  // ── mouse helpers ──────────────────────────────────────────────────────────

  function getCanvasPos(e: MouseEvent): { x: number; y: number } {
    const rect = overlayCanvas.getBoundingClientRect();
    return {
      x: clamp(e.clientX - rect.left, 0, displayWidth),
      y: clamp(e.clientY - rect.top, 0, displayHeight),
    };
  }

  function toNative(px: number, py: number) {
    return {
      x: px * (nativeWidth / displayWidth),
      y: py * (nativeHeight / displayHeight),
    };
  }

  // ── mouse handlers ─────────────────────────────────────────────────────────

  function onMouseDown(e: MouseEvent) {
    const pos = getCanvasPos(e);
    const scaleX = displayWidth / nativeWidth;
    const scaleY = displayHeight / nativeHeight;
    const t = get(currentTime);

    // 1. Check corner handles on the selected track first
    if (selTrackId && nativeWidth > 0) {
      const selTrack = tracks.find((tr) => tr.id === selTrackId);
      if (selTrack) {
        const rect = interpolateKeyframes(selTrack.keyframes, t);
        if (rect) {
          const handle = hitTestHandle(pos, rect, scaleX, scaleY);
          if (handle) {
            const n = toNative(pos.x, pos.y);
            isDraggingHandle = true;
            dragHandleType = handle;
            handleTrackId = selTrackId;
            handleInitialRect = { ...rect };
            return;
          }
        }
      }
    }

    // 2. Draw mode — start new rectangle
    if (mode === 'draw' && selTrackId) {
      isDrawingNew = true;
      dragStartX = pos.x;
      dragStartY = pos.y;
      dragCurrentX = pos.x;
      dragCurrentY = pos.y;
      return;
    }

    // 3. Select mode — hit-test existing rects for moving
    if (mode === 'select' && nativeWidth > 0) {
      for (const track of [...tracks].reverse()) {
        if (!track.enabled) continue;
        const rect = interpolateKeyframes(track.keyframes, t);
        if (!rect) continue;
        const dx = rect.x * scaleX;
        const dy = rect.y * scaleY;
        const dw = rect.width * scaleX;
        const dh = rect.height * scaleY;
        const rot = (rect.rotation ?? 0) * Math.PI / 180;
        const cosA = Math.cos(rot), sinA = Math.sin(rot);
        const cx = dx + dw / 2, cy = dy + dh / 2;
        const ox = pos.x - cx, oy = pos.y - cy;
        const lx = ox * cosA + oy * sinA;
        const ly = -ox * sinA + oy * cosA;
        if (Math.abs(lx) <= dw / 2 && Math.abs(ly) <= dh / 2) {
          selectedTrackId.set(track.id);
          isDraggingRect = true;
          dragTrackId = track.id;
          dragMoveStartX = pos.x;
          dragMoveStartY = pos.y;
          dragInitialRect = { ...rect };
          break;
        }
      }
    }
  }

  function onMouseMove(e: MouseEvent) {
    const pos = getCanvasPos(e);

    if (isDrawingNew) {
      dragCurrentX = pos.x;
      dragCurrentY = pos.y;
      return;
    }

    if (isDraggingHandle && nativeWidth > 0) {
      const n = toNative(pos.x, pos.y);
      const t = get(currentTime);
      const nr = computeHandleDragRect(n.x, n.y, dragHandleType, handleInitialRect);
      projectStore.addKeyframe(handleTrackId, t, nr.x, nr.y, nr.width, nr.height, nr.rotation);
      return;
    }

    if (isDraggingRect && nativeWidth > 0) {
      const dx = pos.x - dragMoveStartX;
      const dy = pos.y - dragMoveStartY;
      const scaleX = nativeWidth / displayWidth;
      const scaleY = nativeHeight / displayHeight;
      const t = get(currentTime);
      const newX = clamp(dragInitialRect.x + dx * scaleX, 0, nativeWidth - dragInitialRect.width);
      const newY = clamp(dragInitialRect.y + dy * scaleY, 0, nativeHeight - dragInitialRect.height);
      projectStore.addKeyframe(
        dragTrackId, t, newX, newY,
        dragInitialRect.width, dragInitialRect.height, dragInitialRect.rotation,
      );
    }
  }

  function onMouseUp(e: MouseEvent) {
    const pos = getCanvasPos(e);

    if (isDrawingNew && selTrackId && nativeWidth > 0) {
      const rx = Math.min(dragStartX, pos.x);
      const ry = Math.min(dragStartY, pos.y);
      const rw = Math.abs(pos.x - dragStartX);
      const rh = Math.abs(pos.y - dragStartY);
      if (rw > 5 && rh > 5) {
        const scaleX = nativeWidth / displayWidth;
        const scaleY = nativeHeight / displayHeight;
        const t = get(currentTime);
        projectStore.addKeyframe(selTrackId, t, rx * scaleX, ry * scaleY, rw * scaleX, rh * scaleY, 0);
        drawingMode.set('select');
      }
      isDrawingNew = false;
      return;
    }

    isDraggingHandle = false;
    isDraggingRect = false;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('video/')) videoFile = file;
  }

  onMount(() => {
    const ro = new ResizeObserver(() => updateDisplaySize());
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
    <canvas
      bind:this={glCanvas}
      class="gl-canvas"
      class:hidden={glFailed}
      style="width:{displayWidth}px;height:{displayHeight}px"
    ></canvas>
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

  .drop-icon { font-size: 48px; }

  .drop-hint p { margin: 0; font-size: 16px; }

  .drop-hint .sub { font-size: 13px; opacity: 0.6; }

  .file-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .video-wrapper { position: relative; }

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

  .gl-canvas.hidden { display: none; }

  .overlay-canvas {
    position: absolute;
    inset: 0;
    cursor: crosshair;
  }
</style>
