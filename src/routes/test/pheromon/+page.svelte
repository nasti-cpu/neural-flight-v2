/**
 * Testseite für Pheromonspuren in insect-world-v2.
 * Zeigt 5 Varianten von leuchtenden Partikel-Spuren zu den Blüten.
 * Jede Spur hat die Farbe der Ziel-Blüte.
 *
 * Nutzt WebGPU (WebGPURenderer) laut Projekt-Vorgabe.
 */
<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three/webgpu";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

	import { createSky } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
	import { createMeadow, MEADOW_PRESETS } from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";
	import { createFlowers } from "$lib/experiences/insect-world-v2/Objekte/Blumen/blumen";
	import { PheromoneSystem, VARIANTS, type FlowerTarget } from "$lib/experiences/insect-world-v2/Sinne/Pheromonspuren/pheromonspuren";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGPURenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let animationId: number;
	let errorMsg = $state("");
	let loading = $state(true);
	let debugInfo = $state("");

	let pheromones: PheromoneSystem;
	let variantIndex = $state(1); // Glühwürmchen
	let prevVariant = $state(1);
	let flowerTargets: FlowerTarget[] = [];

	const variantNames = VARIANTS.map((v) => v.name);

	onMount(async () => {
		try {
			scene = new THREE.Scene();
			scene.background = new THREE.Color(0x0a1520);

			const w = canvas.clientWidth;
			const h = canvas.clientHeight;

			camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
			camera.position.set(4, 4, 8);

			renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
			await renderer.init();
			renderer.setSize(w, h);
			renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

			controls = new OrbitControls(camera, renderer.domElement);
			controls.target.set(0, 0.5, 0);
			controls.update();

			const ambient = new THREE.AmbientLight(0x445566, 0.4);
			scene.add(ambient);
			const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
			sun.position.set(30, 50, 20);
			scene.add(sun);

			const sky = createSky("tief");
			scene.add(sky);

			const meadow = createMeadow(MEADOW_PRESETS["Frühlingswiese"], 0, 0);
			scene.add(meadow.group);

			const flowers = await createFlowers(0, 0, undefined, meadow.getHeightAt);
			scene.add(flowers.group);

			// Blüten-Daten direkt aus flowers.targets
			flowerTargets = flowers.targets;
			debugInfo = `${flowerTargets.length} Blüten`;

			// Pheromon-System
			pheromones = new PheromoneSystem();
			pheromones.addTrails(flowerTargets);
			scene.add(pheromones.group);
			debugInfo += ` | ${pheromones.trailCount} Spuren (${pheromones.currentVariantName})`;

			loading = false;

			const clock = new THREE.Clock();
			function animate() {
				const elapsed = clock.getElapsedTime();
				pheromones.update(elapsed);
				controls.update();
				renderer.render(scene, camera);
				animationId = requestAnimationFrame(animate);
			}
			animationId = requestAnimationFrame(animate);

		} catch (e) {
			console.error("[Pheromon] FEHLER:", e);
			errorMsg = e instanceof Error ? e.message : String(e);
			loading = false;
		}
	});

	$effect(() => {
		if (variantIndex !== prevVariant && pheromones) {
			pheromones.setVariant(variantIndex);
			pheromones.rebuild(flowerTargets);
			prevVariant = variantIndex;
		}
	});

	onDestroy(() => {
		if (!browser) return;
		cancelAnimationFrame(animationId);
		pheromones?.dispose();
		renderer?.dispose();
		controls?.dispose();
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🧪 Pheromonspuren</h1>
		{#if loading}<p class="loading">Lade …</p>{/if}
		{#if errorMsg}<p class="error">{errorMsg}</p>{/if}
		<p class="debug">{debugInfo}</p>
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
	</div>

	<div class="controls">
		<p class="variant-label">Variante: <strong>{VARIANTS[variantIndex].name}</strong></p>
		<p class="variant-desc">{VARIANTS[variantIndex].desc}</p>
		<div class="buttons">
			{#each variantNames as name, i}
				<button class="variant-btn" class:active={variantIndex === i} onclick={() => (variantIndex = i)}>{name}</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.container { position: fixed; inset: 0; overflow: hidden; font-family: system-ui, -apple-system, sans-serif; }
	canvas { display: block; width: 100%; height: 100%; }
	.ui-overlay { position: absolute; top: 20px; left: 50%; transform: translateX(-50%); text-align: center; pointer-events: none; z-index: 10; }
	.ui-overlay h1 { color: white; font-size: 1.2rem; font-weight: 600; text-shadow: 0 2px 8px rgba(0,0,0,0.4); margin: 0 0 4px; }
	.loading { color: rgba(255,255,255,0.8); font-size: 0.85rem; }
	.error { color: #ff6b6b; font-size: 0.85rem; background: rgba(0,0,0,0.5); padding: 4px 12px; border-radius: 4px; }
	.debug { color: #4fc3f7; font-size: 0.85rem; margin: 4px 0; }
	.hint { color: rgba(255,255,255,0.5); font-size: 0.7rem; }
	.controls { position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); border-radius: 12px; padding: 16px 24px; text-align: center; z-index: 10; min-width: 420px; border: 1px solid rgba(255,255,255,0.1); }
	.variant-label { color: white; font-size: 0.95rem; margin: 0 0 2px; }
	.variant-label strong { color: #ffd700; }
	.variant-desc { color: rgba(255,255,255,0.6); font-size: 0.75rem; margin: 0 0 10px; }
	.buttons { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
	.variant-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: rgba(255,255,255,0.8); padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s; font-family: inherit; }
	.variant-btn:hover { background: rgba(255,255,255,0.2); }
	.variant-btn.active { background: #ffd700; color: #1a1a2e; border-color: #ffd700; font-weight: 600; }
</style>
