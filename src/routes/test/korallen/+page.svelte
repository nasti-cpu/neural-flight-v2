<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import { createCoralReef, disposeCoralReef } from "$lib/experiences/underwater-world v2/Biome/Korallenriff/korallenriff";
import type { CoralBiome, CoralReef } from "$lib/experiences/underwater-world v2/Biome/Korallenriff/korallenriff";

interface ModeDef {
	id: CoralBiome;
	label: string;
	description: string;
}

const MODES: ModeDef[] = [
	{ id: "shallow", label: "Flachriff", description: "Bunt, viele Arten" },
	{ id: "deep", label: "Tiefseeriff", description: "Dunkel, ruhig" },
];

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let reef: CoralReef | null = null;

let currentMode = $state<CoralBiome>("shallow");
let building = $state(false);

function rebuild(mode: CoralBiome): void {
	if (reef) {
		disposeCoralReef(reef, scene);
		reef = null;
	}
	building = true;
	const tmp = createCoralReef(mode);
	scene.add(tmp.terrain);
	scene.add(tmp.rocks);
	for (const m of tmp.coralMeshes) scene.add(m);
	reef = tmp;
	building = false;
}

onMount(() => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(0x001828);

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
	camera.position.set(0, 18, 35);
	camera.lookAt(0, 0, 0);

	const ambient = new THREE.AmbientLight(0xffffff, 0.6);
	scene.add(ambient);
	const sun = new THREE.DirectionalLight(0xffffff, 1.8);
	sun.position.set(15, 30, 15);
	scene.add(sun);

	reef = createCoralReef("shallow");
	scene.add(reef.terrain);
	scene.add(reef.rocks);
	for (const m of reef.coralMeshes) scene.add(m);

	renderer.setAnimationLoop(() => {
		camera.position.set(0, 18, 35);
		camera.lookAt(0, 0, 0);
		renderer.render(scene, camera);
	});
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (reef) disposeCoralReef(reef, scene);
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Korallenriff Biome — ICAROS VR</title>
</svelte:head>

<div class="ui">
	<div class="panel">
		<h2>Biom</h2>
		<div class="buttons">
			{#each MODES as mode}
				<button
					class:active={currentMode === mode.id}
					disabled={building}
					onclick={() => {
						currentMode = mode.id;
						rebuild(mode.id);
					}}
				>{mode.label}<span class="desc"> — {mode.description}</span></button>
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
		min-width: 260px;
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
	button:disabled { opacity: 0.4; cursor: not-allowed; }
	button:hover:not(:disabled) { background: rgba(0,170,255,0.15); color: #fff; }
	button.active {
		background: rgba(0,170,255,0.25);
		border-color: #00aaff;
		color: #fff;
	}
	.desc { opacity: 0.5; font-size: 11px; }
</style>
