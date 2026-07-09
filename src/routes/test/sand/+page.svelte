<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import { createDuneSand, disposeDuneSand } from "$lib/experiences/underwater-world v2/Biome/Sand/sand";
import type { DuneSandResult } from "$lib/experiences/underwater-world v2/Biome/Sand/sand";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let biome: DuneSandResult | null = null;

onMount(async () => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(0x002840);

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
	camera.position.set(0, 14, 30);
	camera.lookAt(0, 0, 0);

	const ambient = new THREE.AmbientLight(0xffffff, 0.7);
	scene.add(ambient);
	const sun = new THREE.DirectionalLight(0xffffff, 1.5);
	sun.position.set(10, 25, 10);
	scene.add(sun);

	biome = createDuneSand();
	scene.add(biome.terrain);

	renderer.setAnimationLoop(() => {
		camera.position.set(0, 14, 30);
		camera.lookAt(0, 0, 0);
		renderer.render(scene, camera);
	});
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (biome) disposeDuneSand(biome, scene);
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Dünensand — ICAROS VR</title>
</svelte:head>

<canvas bind:this={canvas} class="canvas"></canvas>

<style>
	:global(body) { margin: 0; overflow: hidden; background: #002840; font-family: system-ui, sans-serif; }
	.canvas { display: block; width: 100vw; height: 100vh; }
</style>
