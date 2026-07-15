<script lang="ts">
/**
 * LAB EXPERIMENT — Sky Tester (WebGPU)
 *
 * Zeigt alle 7 Himmels-Presets aus insect-world-v2.
 * Mit Toggle: Horizont-Fade (aktuell, grau) vs. ohne Fade (rein, alt).
 * So kannst Du die Himmelfarbe von "vor 2 Tagen" mit heute vergleichen.
 */
import { onDestroy, onMount } from "svelte";
import * as THREE from "three/webgpu";
import { createSky, SKY_PRESETS, type SkyPresetName } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";

const presetEntries = Object.entries(SKY_PRESETS).map(([name, colors]) => ({
	name: name as SkyPresetName,
	colors,
}));

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let currentIndex = $state(0);
let fadeEnabled = $state(true); // true = mit Horizont-Fade (aktuell), false = ohne (alt)
let skyMesh: THREE.Mesh | null = null;

function getPreset(index: number) {
	return presetEntries[((index % presetEntries.length) + presetEntries.length) % presetEntries.length];
}

function next() {
	currentIndex = (currentIndex + 1) % presetEntries.length;
	rebuildSky();
}

function prev() {
	currentIndex = ((currentIndex - 1) % presetEntries.length + presetEntries.length) % presetEntries.length;
	rebuildSky();
}

function toggleFade() {
	fadeEnabled = !fadeEnabled;
	rebuildSky();
}

function rebuildSky() {
	if (!scene || !skyMesh) return;

	skyMesh.geometry.dispose();
	(skyMesh.material as THREE.Material).dispose();
	scene.remove(skyMesh);

	// enableFade=false = alte Version ohne Horizont-Fade
	skyMesh = createSky(getPreset(currentIndex).name, 2, fadeEnabled);
	scene.add(skyMesh);
}

onMount(async () => {
	renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);
	await renderer.init();

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
	camera.position.set(0, 0, 0);

	skyMesh = createSky(getPreset(0).name, 2, fadeEnabled);
	scene.add(skyMesh);

	const clock = new THREE.Clock();
	renderer.setAnimationLoop(() => {
		const t = clock.getElapsedTime();
		skyMesh!.rotation.y = t * 0.03;
		renderer.render(scene, camera);
	});

	const onResize = () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	};
	window.addEventListener("resize", onResize);
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (skyMesh) {
		skyMesh.geometry.dispose();
		(skyMesh.material as THREE.Material).dispose();
	}
	renderer?.dispose();
});
</script>

<canvas bind:this={canvas}></canvas>

<div class="overlay">
	<button class="nav-btn" onclick={prev}>◀</button>
	<div class="info">
		<h2>{getPreset(currentIndex).name}</h2>
		<span class="counter">{currentIndex + 1} / {presetEntries.length}</span>
	</div>
	<button class="nav-btn" onclick={next}>▶</button>
</div>

<div class="toggle-bar">
	<button class="toggle-btn" class:fade-on={fadeEnabled} onclick={toggleFade}>
		{fadeEnabled ? "mit Horizont-Fade (aktuell)" : "ohne Horizont-Fade (rein)"}
	</button>
	<div class="color-swatches">
		{#each getPreset(currentIndex).colors as hex}
			<div class="swatch" style="background:#{hex.toString(16).padStart(6, '0')}"></div>
		{/each}
	</div>
</div>

<style>
	canvas { display: block; width: 100vw; height: 100vh; }
	:global(body) { margin: 0; overflow: hidden; background: #000; }
	.overlay {
		position: fixed; bottom: 5rem; left: 50%; transform: translateX(-50%);
		display: flex; align-items: center; gap: 1.5rem;
		background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
		padding: 0.75rem 1.5rem; border-radius: 12px; color: #fff;
		font-family: system-ui, sans-serif; user-select: none; z-index: 10;
	}
	.nav-btn {
		background: rgba(255,255,255,0.15); border: none; color: #fff;
		font-size: 1.25rem; width: 2.5rem; height: 2.5rem; border-radius: 50%;
		cursor: pointer;
	}
	.nav-btn:hover { background: rgba(255,255,255,0.3); }
	.info { text-align: center; min-width: 180px; }
	.info h2 { margin: 0; font-size: 1rem; font-weight: 600; text-transform: capitalize; }
	.counter { font-size: 0.7rem; color: #777; }
	.toggle-bar {
		position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
		display: flex; align-items: center; gap: 1rem;
		background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
		padding: 0.5rem 1rem; border-radius: 10px; z-index: 10;
	}
	.toggle-btn {
		background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3);
		color: #fff; padding: 0.4rem 0.8rem; border-radius: 6px;
		cursor: pointer; font-size: 0.75rem; font-family: system-ui, sans-serif;
		transition: background 0.2s;
	}
	.toggle-btn.fade-on { background: rgba(100,150,255,0.3); border-color: #69f; }
	.toggle-btn:hover { background: rgba(255,255,255,0.25); }
	.color-swatches { display: flex; gap: 4px; }
	.swatch {
		width: 24px; height: 24px; border-radius: 4px;
		border: 1px solid rgba(255,255,255,0.2);
	}
</style>
