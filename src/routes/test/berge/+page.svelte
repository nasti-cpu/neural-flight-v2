<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { browser } from "$app/environment";
import * as THREE from "three/webgpu";
import { createSky } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
	import TestNav from "$lib/components/TestNav.svelte";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let animId: number;

onMount(async () => {
	try {
		renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
		await renderer.init();
		renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		renderer.setSize(window.innerWidth, window.innerHeight);

		const scene = new THREE.Scene();

		const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
		camera.position.set(0, 4, 0.1);
		camera.lookAt(0, 0, -10);

		const sky = createSky("gletscher");
		scene.add(sky);

		const grid = new THREE.GridHelper(40, 10, 0x666666, 0x333333);
		grid.position.y = -3;
		scene.add(grid);

		function animate() {
			renderer.render(scene, camera);
			animId = requestAnimationFrame(animate);
		}
		animId = requestAnimationFrame(animate);
	} catch (e) {
		console.error("[Test] FEHLER:", e);
	}
});

onDestroy(() => {
	if (!browser) return;
	cancelAnimationFrame(animId);
	renderer?.dispose();
});
</script>

<svelte:head><title>Gletscher Himmel | ICAROS VR</title></svelte:head>
<div class="container">
	<canvas bind:this={canvas}></canvas>
</div>
<TestNav currentSlug="berge" />

<style>
	.container {
		position: fixed;
		inset: 0;
		overflow: hidden;
		max-width: none;
		padding: 0;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
