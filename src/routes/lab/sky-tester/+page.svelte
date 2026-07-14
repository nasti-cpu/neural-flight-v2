<script lang="ts">
/**
 * LAB EXPERIMENT — Sky Tester (WebGPU)
 *
 * Testet die 6 Himmels-Varianten aus insect-world-v2 Biome/blauerHimmel/sky.ts.
 * Kamera innerhalb der Himmelskugel (VR-Setup).
 * Nutzt TSL-Material (MeshBasicNodeMaterial + nStopGradient).
 */
import { onDestroy, onMount } from "svelte";
import * as THREE from "three/webgpu";
import { createSky, SKY_PRESETS, type SkyPresetName } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";

const presets = Object.entries(SKY_PRESETS).map(([name]) => ({
	name: name as SkyPresetName,
}));

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let currentIndex = $state(0);
let skyMesh: THREE.Mesh | null = null;

function getPreset(index: number) {
	return presets[((index % presets.length) + presets.length) % presets.length];
}

function next() {
	currentIndex = (currentIndex + 1) % presets.length;
	rebuildSky();
}

function prev() {
	currentIndex = ((currentIndex - 1) % presets.length + presets.length) % presets.length;
	rebuildSky();
}

function rebuildSky() {
	if (!scene || !skyMesh) return;

	skyMesh.geometry.dispose();
	(skyMesh.material as THREE.Material).dispose();
	scene.remove(skyMesh);

	skyMesh = createSky(getPreset(currentIndex).name);
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

	skyMesh = createSky(getPreset(0).name);
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
		<span class="counter">{currentIndex + 1} / {presets.length}</span>
	</div>
	<button class="nav-btn" onclick={next}>▶</button>
</div>

<style>
	canvas { display: block; width: 100vw; height: 100vh; }
	:global(body) { margin: 0; overflow: hidden; background: #000; }
	.overlay {
		position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%);
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
	.info h2 { margin: 0; font-size: 1rem; font-weight: 600; }
	.counter { font-size: 0.7rem; color: #777; }
</style>
