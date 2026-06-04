<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import { createDolphinPod, updateDolphinPod, disposeDolphinPod, loadDolphinGeometry, DOLPHIN_MODE_META } from "$lib/experiences/underwater-world v2/Objekte/Delfine/dolphin";
import type { DolphinMode } from "$lib/experiences/underwater-world v2/Objekte/Delfine/dolphin";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let pod: ReturnType<typeof createDolphinPod> | null = null;
let clock = new THREE.Clock();
let modelGeo: THREE.BufferGeometry | null = null;

let currentMode = $state<DolphinMode>("leisurely");

function rebuild(mode: DolphinMode): void {
	if (pod) {
		disposeDolphinPod(pod, scene);
		pod = null;
	}
	const def = DOLPHIN_MODE_META.find((m) => m.id === mode)!;
	pod = createDolphinPod(def.count, modelGeo ?? undefined);
	scene.add(pod.mesh);
}

onMount(async () => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(0x001828);

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
	camera.position.set(0, 5, 40);
	camera.lookAt(0, 0, 0);

	const ambient = new THREE.AmbientLight(0xffffff, 0.5);
	scene.add(ambient);
	const sun = new THREE.DirectionalLight(0xffffff, 1.5);
	sun.position.set(10, 20, 10);
	scene.add(sun);

	// Subtle grid floor for depth reference
	const grid = new THREE.GridHelper(60, 20, 0x00aaff, 0x004466);
	grid.position.y = -8;
	scene.add(grid);

	modelGeo = await loadDolphinGeometry();
	const def = DOLPHIN_MODE_META.find((m) => m.id === currentMode)!;
	pod = createDolphinPod(def.count, modelGeo ?? undefined);
	scene.add(pod.mesh);

	const center = new THREE.Vector3();

	renderer.setAnimationLoop(() => {
		const delta = Math.min(clock.getDelta(), 0.05);
		if (pod) {
			const def = DOLPHIN_MODE_META.find((m) => m.id === currentMode)!;
			updateDolphinPod(pod, delta, clock.elapsedTime, def.id, center);
		}
		camera.position.set(0, 5, 40);
		camera.lookAt(0, 0, 0);
		renderer.render(scene, camera);
	});
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (pod) disposeDolphinPod(pod, scene!);
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Delfine Test — ICAROS VR</title>
</svelte:head>

<div class="ui">
	<div class="panel">
		<h2>Modus</h2>
		<div class="buttons">
			{#each DOLPHIN_MODE_META as mode}
				<button
					class:active={currentMode === mode.id}
					onclick={() => {
						currentMode = mode.id;
						rebuild(mode.id);
					}}
				>{mode.label} ({mode.count})</button>
			{/each}
		</div>
	</div>
</div>

<canvas bind:this={canvas} class="canvas"></canvas>

<style>
	:global(body) { margin: 0; overflow: hidden; background: #001828; font-family: system-ui, sans-serif; }
	.canvas { display: block; width: 100vw; height: 100vh; }
	.ui {
		position: fixed; top: 16px; left: 16px; z-index: 10;
		pointer-events: none;
	}
	.panel {
		background: rgba(0,0,0,0.7);
		border: 1px solid rgba(0,170,255,0.3);
		border-radius: 12px;
		padding: 16px 20px;
		color: #ccf;
		pointer-events: auto;
		min-width: 200px;
	}
	h2 {
		font-size: 13px; text-transform: uppercase; letter-spacing: 1px;
		color: #00aaff; margin: 0 0 8px;
	}
	.buttons { display: flex; gap: 6px; flex-wrap: wrap; }
	button {
		background: rgba(255,255,255,0.08);
		border: 1px solid rgba(255,255,255,0.15);
		color: #aac;
		padding: 5px 12px; border-radius: 6px; cursor: pointer;
		font-size: 13px; transition: all 0.15s;
	}
	button:hover { background: rgba(0,170,255,0.15); color: #fff; }
	button.active {
		background: rgba(0,170,255,0.25);
		border-color: #00aaff;
		color: #fff;
	}
</style>
