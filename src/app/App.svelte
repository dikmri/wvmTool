<script lang="ts">
  import { onMount } from 'svelte';
  import VideoViewport from './components/VideoViewport.svelte';
  import Timeline from './components/Timeline.svelte';
  import ToolPanel from './components/ToolPanel.svelte';
  import ExportPanel from './components/ExportPanel.svelte';
  import CapabilityBadge from './components/CapabilityBadge.svelte';
  import { projectStore, videoMetaStore } from './stores/project-store';
  import { capability } from './stores/ui-store';
  import { fps as fpsStore } from './stores/playback-store';
  import { checkCapabilities } from '../engine/validation';
  import { logger } from '../utils/logger';

  let videoFile: File | null = null;
  let videoEl: HTMLVideoElement | null = null;

  onMount(async () => {
    const cap = await checkCapabilities();
    capability.set(cap);
    logger.info('app:capabilities', cap);
  });

  async function onVideoLoaded(file: File) {
    videoFile = file;

    // Extract metadata via a temporary video element
    const tempVideo = document.createElement('video');
    tempVideo.src = URL.createObjectURL(file);
    await new Promise<void>((res) => {
      tempVideo.onloadedmetadata = () => res();
      tempVideo.onerror = () => res();
    });

    const meta = {
      width: tempVideo.videoWidth || 1280,
      height: tempVideo.videoHeight || 720,
      duration: tempVideo.duration,
      fps: null as number | null,
      hasAudio: false,
    };

    URL.revokeObjectURL(tempVideo.src);

    fpsStore.set(30);
    projectStore.initProject(file.name, meta);
    logger.info('video:loaded', meta);
  }

  // Watch for new file dropped in viewport
  $: if (videoFile) onVideoLoaded(videoFile);

  let reactiveVideoFile: File | null = null;
  $: reactiveVideoFile = videoFile;
</script>

<div class="app">
  <header class="header">
    <div class="logo">🎬 Video Mosaic Editor</div>
    <CapabilityBadge />
  </header>

  <div class="main-area">
    <ToolPanel />
    <div class="viewport-area">
      <VideoViewport bind:videoFile={reactiveVideoFile} />
    </div>
  </div>

  <Timeline {videoEl} />
  <ExportPanel bind:videoFile={reactiveVideoFile} />
</div>

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
    gap: 16px;
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
</style>
