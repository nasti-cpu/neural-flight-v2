<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import { createCity, disposeCity, updateCityPulse } from "$lib/experiences/underwater-world v2/Biome/Städte/city";
import type { CityVariant, CityResult } from "$lib/experiences/underwater-world v2/Biome/Städte/city";

interface ModeDef {
	id: CityVariant;
	label: string;
	description: string;
}

const MODES: ModeDef[] = [
	{ id: "altstadt", label: "Altstadt", description: "Enge Gassen, warmes Licht" },
	{ id: "zentrum", label: "Zentrum", description: "Wolkenkratzer, kühles Blau" },
	{ id: "vorort", label: "Vorort", description: "Flach, weitläufig, heimelig" },
];

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let city: CityResult | null = null;
let elapsed = 0;

let currentMode = $state<CityVariant>("altstadt");
let building = $state(false);

function rebuild(mode: CityVariant): void {
	if (city) {
		disposeCity(city, scene);
		city = null;
	}
	building = true;
	const tmp = createCity(mode);
	scene.add(tmp.group);
	tmp.group.visible = true;
	city = tmp;
	building = false;
}

onMount(() => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(0x001828);

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
	camera.position.set(0, 30, 85);
	camera.lookAt(0, 0, 0);

	const ambient = new THREE.AmbientLight(0xffffff, 0.3);
	scene.add(ambient);

	city = createCity("altstadt");
	scene.add(city.group);
	city.group.visible = true;

	renderer.setAnimationLoop(() => {
		elapsed += 0.016;
		camera.position.set(0, 30, 85);
		camera.lookAt(0, 0, 0);
		if (city) updateCityPulse(city, elapsed, true, 0);
		renderer.render(scene, camera);
	});
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (city) disposeCity(city, scene);
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Städte — ICAROS VR</title>
</svelte:head>

<div class="ui">
	<div class="panel">
		<h2>Stadt unter der Kuppel</h2>
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
		min-width: 280px;
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
