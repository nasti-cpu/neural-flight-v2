<script lang="ts">
/**
 * LAB EXPERIMENT — Bienen-Tester (WebGPU)
 *
 * Komplette insect-world-v2 Szene:
 * Frühlingswiese + Himmel + 3 Lowpoly-Blumen + fliegende Bienen.
 *
 * OrbitControls zum Erkunden. Bienen fliegen auf natürlichen,
 * organischen Bahnen (übereinandergelegte Sinuswellen).
 *
 * Wiese: MeshBasicNodeMaterial (TSL/WebGPU)
 * Himmel: MeshBasicNodeMaterial + TSL-Gradient
 * Blumen: GLTF + InstancedMesh
 * Bienen: GLTF + individuelle THREE.Groups mit update-Logik
 */
import { onDestroy, onMount } from "svelte";
import { browser } from "$app/environment";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createMeadow, MEADOW_PRESETS } from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";
import { createSky, SKY_PRESETS } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
import { createFlowers } from "$lib/experiences/insect-world-v2/Objekte/Blumen/blumen";
import { createBees } from "$lib/experiences/insect-world-v2/Objekte/Bienen/bienen";
import beeUrl from "$lib/experiences/insect-world-v2/Objekte/Bienen/Bee.glb?url";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let meadow: ReturnType<typeof createMeadow> | null = null;
let skyMesh: THREE.Mesh | null = null;
let flowers: Awaited<ReturnType<typeof createFlowers>> | null = null;
let bees: Awaited<ReturnType<typeof createBees>> | null = null;
let loading = $state(true);

onMount(async () => {
	renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);
	await renderer.init();

	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 120);
	camera.position.set(0, 3, 12);
	camera.lookAt(0, 1, 0);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.target.set(0, 1.5, 0);
	controls.maxPolarAngle = Math.PI / 2.05;
	controls.minDistance = 1;
	controls.maxDistance = 50;
	controls.update();

	// Licht für Gras-Lighting + Blumen/Bienen
	const ambient = new THREE.AmbientLight(0x8899bb, 0.5);
	scene.add(ambient);

	const sun = new THREE.DirectionalLight(0xfff4e0, 2.5);
	sun.position.set(0.5, 0.8, 0.3).normalize();
	scene.add(sun);

	// Wiese
	const cfg = MEADOW_PRESETS["Frühlingswiese"];
	meadow = createMeadow(cfg, 0, 0);
	scene.add(meadow.group);

	// Himmel
	skyMesh = createSky("klassisch");
	scene.add(skyMesh);

	const fogColor = new THREE.Color((SKY_PRESETS.klassisch as unknown as number[])[2]);
	scene.background = fogColor;
	scene.fog = new THREE.Fog(fogColor, 30, 60);

	// Blumen
	const getHeightAt = meadow?.getHeightAt ?? undefined;
	flowers = await createFlowers(0, 0, { count: 120, fieldSize: 50 }, getHeightAt);
	scene.add(flowers.group);

	// Bienen
	bees = await createBees(beeUrl);
	scene.add(bees.group);

	loading = false;

	// Animationsschleife
	const clock = new THREE.Clock();
	renderer.setAnimationLoop(() => {
		const delta = clock.getDelta();
		const elapsed = clock.elapsedTime;
		if (meadow) meadow.tick(elapsed);
		if (bees) bees.update(elapsed, delta);
		controls.update();
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
	if (!browser) return;
	renderer?.setAnimationLoop(null);
	meadow?.dispose();
	if (skyMesh) {
		skyMesh.geometry.dispose();
		(skyMesh.material as THREE.Material).dispose();
	}
	flowers?.dispose();
	bees?.dispose();
	controls?.dispose();
	renderer?.dispose();
});
</script>

<canvas bind:this={canvas}></canvas>

<div class="overlay">
	<h1>🌾 Frühlingswiese mit Bienen</h1>
	{#if loading}
		<p class="loading">🔄 Lade Blumen & Bienen …</p>
	{/if}
	<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
</div>

<style>
	canvas { display: block; width: 100vw; height: 100vh; }
	:global(body) { margin: 0; overflow: hidden; background: #000; }

	.overlay {
		position: fixed;
		top: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		z-index: 10;
		font-family: system-ui, sans-serif;
		pointer-events: none;
	}

	h1 {
		color: #fff;
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0;
		text-shadow: 0 2px 8px rgba(0,0,0,0.5);
	}

	.loading {
		color: rgba(255,255,255,0.8);
		font-size: 0.85rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0,0,0,0.3);
	}

	.hint {
		color: rgba(255,255,255,0.5);
		font-size: 0.7rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0,0,0,0.3);
	}
</style>
