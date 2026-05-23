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

  // videoFile is set by VideoViewport (via bind) when the user drops or selects a file.
  // It is passed to ExportPanel so the worker can read the raw bytes.
  let videoFile: File | null = null;

  onMount(async () => {
    const cap = await checkCapabilities();
    capability.set(cap);
    logger.info('app:capabilities', cap);
  });
</script>

<div class="app">
  <header class="header">
    <div class="logo">🎬 wvmTool</div>
    <CapabilityBadge />
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
