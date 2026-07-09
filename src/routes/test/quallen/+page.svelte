<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import { createJellySwarm, updateJellySwarm, disposeJellySwarm, JELLY_MODE_META } from "$lib/experiences/underwater-world v2/Objekte/Quallen/jellyfish";
import type { JellyMode } from "$lib/experiences/underwater-world v2/Objekte/Quallen/jellyfish";

type Mode = "drifting" | "pulsing" | "bloom";

interface ModeDef {
	id: Mode;
	label: string;
}

const MODES: ModeDef[] = [
	{ id: "drifting", label: "Treibend" },
	{ id: "pulsing", label: "Pulsierend" },
	{ id: "bloom", label: "Blüte" },
];

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let swarm: ReturnType<typeof createJellySwarm> | null = null;
let clock = new THREE.Clock();

let currentMode = $state<JellyMode>("drifting");

function rebuild(mode: JellyMode): void {
	if (swarm) {
		disposeJellySwarm(swarm, scene);
		swarm = null;
	}
	swarm = createJellySwarm(5);
	scene.add(swarm.mesh);
}

onMount(() => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(0x001020);

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
	camera.position.set(0, 2, 20);
	camera.lookAt(0, 0, 0);

	const ambient = new THREE.AmbientLight(0x446688, 0.4);
	scene.add(ambient);
	const sun = new THREE.DirectionalLight(0xaaccff, 0.8);
	sun.position.set(5, 15, 10);
	scene.add(sun);
	const rim = new THREE.DirectionalLight(0x00ddff, 0.3);
	rim.position.set(-5, -5, -10);
	scene.add(rim);

	swarm = createJellySwarm(5);
	scene.add(swarm.mesh);

	renderer.setAnimationLoop(() => {
		const delta = Math.min(clock.getDelta(), 0.05);
		if (swarm) {
			updateJellySwarm(swarm, delta, clock.elapsedTime, currentMode);
		}
		camera.position.set(0, 3, 20);
		camera.lookAt(0, 0, 0);
		renderer.render(scene, camera);
	});
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (swarm) disposeJellySwarm(swarm, scene!);
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Quallen Test — ICAROS VR</title>
</svelte:head>

<div class="ui">
	<div class="panel">
		<h2>Modus</h2>
		<div class="buttons">
			{#each JELLY_MODE_META as mode}
				<button
					class:active={currentMode === mode.id}
					onclick={() => {
						currentMode = mode.id;
						rebuild(mode.id);
					}}
				>{mode.label}</button>
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
		border: 1px solid rgba(0,200,255,0.3);
		border-radius: 12px;
		padding: 16px 20px;
		color: #ccf;
		pointer-events: auto;
		min-width: 200px;
	}
	h2 {
		font-size: 13px; text-transform: uppercase; letter-spacing: 1px;
		color: #00ccff; margin: 0 0 8px;
	}
	.buttons { display: flex; gap: 6px; flex-wrap: wrap; }
	button {
		background: rgba(255,255,255,0.08);
		border: 1px solid rgba(255,255,255,0.15);
		color: #aac;
		padding: 5px 12px; border-radius: 6px; cursor: pointer;
		font-size: 13px; transition: all 0.15s;
	}
	button:hover { background: rgba(0,200,255,0.15); color: #fff; }
	button.active {
		background: rgba(0,200,255,0.25);
		border-color: #00ccff;
		color: #fff;
	}
</style>
