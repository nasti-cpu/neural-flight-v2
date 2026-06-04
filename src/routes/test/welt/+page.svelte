<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import { setup, tick, dispose } from "$lib/experiences/underwater-world v2/scene";
import type { UnderwaterWorldState } from "$lib/experiences/underwater-world v2/scene";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let clock = new THREE.Clock();
let state: UnderwaterWorldState;
const _playerPos = new THREE.Vector3();
const _playerRot = new THREE.Euler();

onMount(async () => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(0x0a2a4a);

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 600);

	state = (await setup({ scene, camera, renderer })) as UnderwaterWorldState;

	window.addEventListener("resize", () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	});

	renderer.setAnimationLoop(() => {
		const delta = clock.getDelta();
		_playerPos.copy(state.camera.position);
		_playerRot.copy(state.camera.rotation);
		const result = tick(state, {
			delta,
			elapsed: clock.elapsedTime,
			camera: state.camera,
			playerPosition: _playerPos,
			playerRotation: _playerRot,
		});
		state = result.state as UnderwaterWorldState;
		renderer.render(scene, state.camera);
	});
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (state) dispose(state, scene);
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Welt Test — ICAROS VR</title>
</svelte:head>

<div class="ui">
	<div class="panel">
		<h2>🌊 Unterwasser-Welt</h2>
		<div class="keys">
			<div><kbd>W</kbd><kbd>S</kbd> Auf/Ab</div>
			<div><kbd>A</kbd><kbd>D</kbd> Yaw</div>
			<div><kbd>R</kbd><kbd>F</kbd> Pitch</div>
			<div><kbd>Space</kbd> Boost</div>
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
		border: 1px solid rgba(0,229,255,0.25);
		border-radius: 12px;
		padding: 12px 16px;
		color: #ccf;
		min-width: 160px;
	}
	h2 {
		font-size: 13px; text-transform: uppercase; letter-spacing: 1px;
		color: #00e5ff; margin: 0 0 8px;
	}
	.keys {
		display: flex; flex-direction: column; gap: 3px;
		font-size: 11px; color: #889;
	}
	kbd {
		display: inline-block;
		background: rgba(255,255,255,0.08);
		border: 1px solid rgba(255,255,255,0.12);
		border-radius: 3px;
		padding: 1px 5px;
		font-size: 10px;
		color: #aac;
		margin-right: 2px;
	}
</style>
