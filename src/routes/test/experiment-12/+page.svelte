<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { initWorld, disposeWorld } from "$lib/experiments/experiment-12/welt/underwaterWorld";

let container: HTMLDivElement;

onMount(async () => {
  if (container) {
    await initWorld(container);
  }
});

onDestroy(() => {
  disposeWorld();
});
</script>

<svelte:head>
  <title>Experiment 12 — Tiefsee-Unterwasserwelt</title>
</svelte:head>

<div class="info">
  🌊 <strong>Tiefsee-Unterwasserwelt</strong><br />
  Endloser Sandboden · Seegras · God Rays · Partikel<br />
  <strong>WASD</strong> = bewegen · <strong>Maus</strong> = schauen<br />
  <strong>Klick</strong> = Maus sperren · <strong>Q/E</strong> = hoch/runter · <strong>Shift</strong> = sprinten
</div>
<div class="debug" id="debug">Chunks: 0</div>
<div bind:this={container} class="container"></div>

<style>
  :global(body) {
    margin: 0;
    overflow: hidden;
    background: #000814;
  }
  .container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
  }
  .info {
    position: fixed;
    top: 16px;
    left: 16px;
    color: rgba(200, 230, 255, 0.85);
    font-family: system-ui, sans-serif;
    font-size: 14px;
    pointer-events: none;
    z-index: 10;
    text-shadow: 0 0 8px rgba(0, 150, 255, 0.4);
    line-height: 1.6;
  }
  .info strong {
    color: #7ec8ff;
  }
  .debug {
    position: fixed;
    bottom: 16px;
    left: 16px;
    color: rgba(200, 230, 255, 0.6);
    font-family: monospace;
    font-size: 12px;
    pointer-events: none;
    z-index: 10;
    line-height: 1.5;
  }
</style>
