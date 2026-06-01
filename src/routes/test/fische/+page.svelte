<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import { createFishSchool, updateFishSchool, disposeFishSchool, loadFishGeometry } from "$lib/experiences/underwater-world v2/Objekte/Fische/fish";
import type { SwimMode, FlockMode } from "$lib/experiences/underwater-world v2/Objekte/Fische/fish";

type Mode = "school" | "migration" | "solo";

interface ModeDef {
	id: Mode;
	label: string;
	swimMode: SwimMode;
	flockMode: FlockMode;
	count: number;
}

const MODES: ModeDef[] = [
	{ id: "school", label: "Fischschule", swimMode: "schooling", flockMode: "boids", count: 25 },
	{ id: "migration", label: "Migration", swimMode: "migrating", flockMode: "boids", count: 60 },
	{ id: "solo", label: "Einzelfisch", swimMode: "scattered", flockMode: "solo", count: 1 },
];

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let school: ReturnType<typeof createFishSchool> | null = null;
let clock = new THREE.Clock();
let modelGeo: THREE.BufferGeometry | null = null;

let currentMode = $state<Mode>("school");

function rebuild(mode: Mode): void {
	if (school) {
		disposeFishSchool(school, scene);
		school = null;
	}
	const def = MODES.find((m) => m.id === mode)!;
	school = createFishSchool(def.count, modelGeo ?? undefined, mode === "solo" ? 2 : 40, mode === "solo" ? 1 : 15);
	if (mode === "solo") {
		school.positions[0] = 0;
		school.positions[1] = 0;
		school.positions[2] = 0;
		school.rotations[0] = 0;
	}
	scene.add(school.mesh);
}

onMount(async () => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(0x001020);

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
	camera.position.set(0, 5, 30);
	camera.lookAt(0, 0, 0);

	const ambient = new THREE.AmbientLight(0xffffff, 0.5);
	scene.add(ambient);
	const sun = new THREE.DirectionalLight(0xffffff, 1.5);
	sun.position.set(10, 20, 10);
	scene.add(sun);

	modelGeo = await loadFishGeometry();

	const def = MODES.find((m) => m.id === currentMode)!;
	school = createFishSchool(def.count, modelGeo ?? undefined);
	scene.add(school.mesh);

	const center = new THREE.Vector3();

	renderer.setAnimationLoop(() => {
		const delta = Math.min(clock.getDelta(), 0.05);
		if (school) {
			const def = MODES.find((m) => m.id === currentMode)!;
			updateFishSchool(school, delta, clock.elapsedTime, def.swimMode, def.flockMode, center);
		}
		camera.position.set(0, 3, 40);
		camera.lookAt(0, 0, 0);
		renderer.render(scene, camera);
	});
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (school) disposeFishSchool(school, scene!);
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Fische Test — ICAROS VR</title>
</svelte:head>

<div class="ui">
	<div class="panel">
		<h2>Modus</h2>
		<div class="buttons">
			{#each MODES as mode}
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
	:global(body) { margin: 0; overflow: hidden; background: #001020; font-family: system-ui, sans-serif; }
	.canvas { display: block; width: 100vw; height: 100vh; }
	.ui {
		position: fixed; top: 16px; left: 16px; z-index: 10;
		pointer-events: none;
	}
	.panel {
		background: rgba(0,0,0,0.7);
		border: 1px solid rgba(0,229,255,0.3);
		border-radius: 12px;
		padding: 16px 20px;
		color: #ccf;
		pointer-events: auto;
		min-width: 200px;
	}
	h2 {
		font-size: 13px; text-transform: uppercase; letter-spacing: 1px;
		color: #00e5ff; margin: 0 0 8px;
	}
	.buttons { display: flex; gap: 6px; flex-wrap: wrap; }
	button {
		background: rgba(255,255,255,0.08);
		border: 1px solid rgba(255,255,255,0.15);
		color: #aac;
		padding: 5px 12px; border-radius: 6px; cursor: pointer;
		font-size: 13px; transition: all 0.15s;
	}
	button:hover { background: rgba(0,229,255,0.15); color: #fff; }
	button.active {
		background: rgba(0,229,255,0.25);
		border-color: #00e5ff;
		color: #fff;
	}
</style>
