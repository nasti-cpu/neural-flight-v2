<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import { createModelCity, updateModelCityPulse, disposeModelCity } from "$lib/experiences/underwater-world v2/Biome/Städte/modelCity";
import type { ModelCityResult } from "$lib/experiences/underwater-world v2/Biome/Städte/modelCity";
import { createFishSchool, updateFishSchool, disposeFishSchool, loadFishGeometry } from "$lib/experiences/underwater-world v2/Objekte/Fische/fish";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let city: ModelCityResult | null = null;
let fishSchool: ReturnType<typeof createFishSchool> | null = null;
let loading = $state(true);
let loadError = $state("");
let clock = new THREE.Clock();

function createTerrain(): THREE.Mesh {
	const segs = 64;
	const size = 300;
	const geo = new THREE.PlaneGeometry(size, size, segs, segs);
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const z = pos.getY(i);
		const n = Math.sin(x * 0.01) * Math.cos(z * 0.008) * 2 + Math.sin(x * 0.02 + z * 0.015) * 0.8;
		pos.setZ(i, n);
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();
	const mat = new THREE.MeshStandardMaterial({
		color: 0xccaa77,
		roughness: 0.95,
		flatShading: true,
	});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.rotation.x = -Math.PI / 2;
	mesh.position.y = -1;
	return mesh;
}

onMount(async () => {
	try {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
		renderer.setSize(window.innerWidth, window.innerHeight);
		renderer.setClearColor(0x001828);

		scene = new THREE.Scene();
		scene.fog = new THREE.Fog(0x001828, 80, 250);

		camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
		camera.position.set(0, 20, 100);
		camera.lookAt(0, 0, 0);

		const ambient = new THREE.AmbientLight(0x4488cc, 0.6);
		scene.add(ambient);
		const sun = new THREE.DirectionalLight(0xffffff, 1.5);
		sun.position.set(10, 25, 10);
		scene.add(sun);

		// Large underwater landscape
		const terrain = createTerrain();
		scene.add(terrain);

		// Fish school outside the dome (dome radius ~65, fish at 90)
		const fishGeo = await loadFishGeometry();
		fishSchool = createFishSchool(40, fishGeo ?? undefined, 30, 12);
		fishSchool.mesh.position.set(30, 5, 100);
		scene.add(fishSchool.mesh);

		// City model with dome
		city = await createModelCity("stadt");
		scene.add(city.group);
		city.group.visible = true;

		loading = false;
	} catch (e) {
		loading = false;
		loadError = String(e);
		console.error("Test page error:", e);
	}

	renderer.setAnimationLoop(() => {
		const delta = Math.min(clock.getDelta(), 0.05);
		const elapsed = clock.elapsedTime;

		camera.position.set(0, 20, 100);
		camera.lookAt(0, 0, 0);

		if (city) updateModelCityPulse(city, elapsed, true, 0);
		if (fishSchool) {
			const playerPos = new THREE.Vector3(30, 5, 100);
			updateFishSchool(fishSchool, delta, elapsed, "schooling", playerPos);
		}

		renderer.render(scene, camera);
	});
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (city) disposeModelCity(city, scene!);
	if (fishSchool) disposeFishSchool(fishSchool, scene!);
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Unterwasser Stadt Test — ICAROS VR</title>
</svelte:head>

{#if loading}
	<div class="loading">Lade Stadtmodell (154 MB) …</div>
{/if}
{#if loadError}
	<div class="error">Fehler: {loadError}</div>
{/if}

<canvas bind:this={canvas} class="canvas"></canvas>

<style>
	:global(body) { margin: 0; overflow: hidden; background: #001828; font-family: system-ui, sans-serif; }
	.canvas { display: block; width: 100vw; height: 100vh; }
	.loading, .error {
		position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
		z-index: 10; padding: 12px 24px; border-radius: 8px;
		font-size: 14px; color: #fff;
	}
	.loading { background: rgba(0,0,0,0.7); }
	.error { background: rgba(200,30,30,0.9); }
</style>
