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
  import { t, locale, LOCALES } from '../i18n';
  import type { Locale } from '../i18n';

  let videoFile: File | null = null;
  let showHelp = false;
  let showKofi = false;
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
    <div class="kofi-wrap">
      <button class="kofi-btn" on:click={() => showKofi = !showKofi}>☕ Support</button>
      {#if showKofi}
        <div
          class="kofi-backdrop"
          on:click={() => showKofi = false}
          on:keydown={(e) => e.code === 'Escape' && (showKofi = false)}
          role="presentation"
        ></div>
        <div class="kofi-popup">
          <iframe
            src="https://ko-fi.com/dikmri/?hidefeed=true&widget=true&embed=true&preview=true"
            title="Ko-fi"
            width="300"
            height="450"
            style="border:none;border-radius:8px;display:block"
          ></iframe>
        </div>
      {/if}
    </div>
    <select
      class="lang-sel"
      value={$locale}
      on:change={(e) => locale.set((e.target as HTMLSelectElement).value as Locale)}
    >
      {#each LOCALES as l}
        <option value={l.value}>{l.label}</option>
      {/each}
    </select>
    <button class="help-btn" on:click={() => showHelp = true}>{$t('help.btn')}</button>
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
    aria-label={$t('help.title')}
    tabindex="-1"
  >
    <div class="modal">
      <div class="modal-header">
        <h2>{$t('help.title')}</h2>
        <button class="close-btn" on:click={() => showHelp = false}>✕</button>
      </div>

      <div class="modal-body">
        <h3>{$t('help.section.basics')}</h3>
        <ol>
          <li>{$t('help.basics.1')}</li>
          <li><kbd>N</kbd>{$t('help.basics.2')}</li>
          <li>{$t('help.basics.3')}</li>
          <li>{$t('help.basics.4a')}<kbd>K</kbd>{$t('help.basics.4b')}</li>
          <li>{$t('help.basics.5')}</li>
          <li>{$t('help.basics.6')}</li>
        </ol>

        <h3>{$t('help.section.shortcuts')}</h3>
        <table>
          <thead><tr><th>{$t('help.th.key')}</th><th>{$t('help.th.action')}</th></tr></thead>
          <tbody>
            <tr><td><kbd>Space</kbd></td><td>{$t('help.key.space')}</td></tr>
            <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>{$t('help.key.lr')}</td></tr>
            <tr><td><kbd>Shift</kbd>+<kbd>←</kbd> / <kbd>→</kbd></td><td>{$t('help.key.shift_lr')}</td></tr>
            <tr><td><kbd>K</kbd></td><td>{$t('help.key.k')}</td></tr>
            <tr><td><kbd>Delete</kbd></td><td>{$t('help.key.del')}</td></tr>
            <tr><td><kbd>Q</kbd> / <kbd>E</kbd></td><td>{$t('help.key.qe')}</td></tr>
            <tr><td><kbd>R</kbd></td><td>{$t('help.key.r')}</td></tr>
            <tr><td><kbd>H</kbd></td><td>{$t('help.key.h')}</td></tr>
            <tr><td><kbd>I</kbd></td><td>{$t('help.key.i')}</td></tr>
            <tr><td><kbd>N</kbd></td><td>{$t('help.key.n')}</td></tr>
            <tr><td>{$t('help.key.wheel.key')}</td><td>{$t('help.key.wheel')}</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>{$t('help.key.esc')}</td></tr>
          </tbody>
        </table>

        <h3>{$t('help.section.tracks')}</h3>
        <ul>
          <li><strong>{$t('help.tracks.1.label')}</strong>：{$t('help.tracks.1.desc')}</li>
          <li><strong>{$t('help.tracks.2.label')}</strong>：{$t('help.tracks.2.desc')}</li>
          <li><strong>{$t('help.tracks.3.label')}</strong>：{$t('help.tracks.3.desc')}</li>
          <li><strong>{$t('help.tracks.4.label')}</strong>：{$t('help.tracks.4.desc')}</li>
        </ul>

        <h3>{$t('help.section.privacy')}</h3>
        <p>{$t('help.privacy')}</p>
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

  .kofi-wrap {
    position: relative;
  }

  .kofi-btn {
    background: #1a4433;
    border: 1px solid #00cc66;
    color: #00ff88;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    line-height: 1;
    transition: background 0.15s;
  }

  .kofi-btn:hover { background: #225544; }

  .kofi-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }

  .kofi-popup {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 1000;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }

  .lang-sel {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #aaa;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

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
