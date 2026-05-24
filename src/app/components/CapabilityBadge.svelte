<script lang="ts">
  import { capability } from '../stores/ui-store';

  $: cap = $capability;
</script>

{#if cap}
  <div class="capability-bar">
    <span class="badge" class:ok={cap.webCodecs}>WebCodecs: {cap.webCodecs ? 'OK' : '×'}</span>
    <span class="badge" class:ok={cap.webgl2}>WebGL2: {cap.webgl2 ? 'OK' : '×'}</span>
    <span class="badge" class:ok={cap.offscreenCanvas}>OffscreenCanvas: {cap.offscreenCanvas ? 'OK' : '×'}</span>
    <span class="badge" class:ok={cap.worker}>Worker: {cap.worker ? 'OK' : '×'}</span>
    {#if !cap.webCodecs || !cap.webgl2}
      <span class="badge warn">⚠ このブラウザは一部機能に非対応です</span>
    {/if}
  </div>
{/if}

<style>
  .capability-bar {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }

  .badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    background: #3a1a1a;
    color: #cc4444;
    border: 1px solid #cc444433;
  }

  .badge.ok {
    background: #1a2e1a;
    color: #44cc44;
    border-color: #44cc4433;
  }

  .badge.warn {
    background: #2a1a00;
    color: #ffaa00;
    border-color: #ffaa0033;
  }
</style>
