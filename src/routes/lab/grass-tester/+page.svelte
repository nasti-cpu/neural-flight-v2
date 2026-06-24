<script lang="ts">
/**
 * LAB EXPERIMENT — Grass Tester (Wiesen-Varianten)
 *
 * Zeigt 6 Wiesen-Presets nebeneinander im Kreis.
 * OrbitControls zum Drehen/Zoomen, jedes Patch hat
 * einen Label-Sprite mit dem Namen.
 *
 * Nutzt InstancedMesh + ShaderMaterial (WebGL).
 * Für VR-Produktion auf TSL/WebGPU portieren.
 */
import { onDestroy, onMount } from "svelte";
import { browser } from "$app/environment";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
	createAllMeadowPatches,
	MEADOW_PRESETS,
	type MeadowPatch,
} from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let patches: MeadowPatch[] = [];
let animationId: number;

const presetNames = Object.keys(MEADOW_PRESETS);

onMount(() => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);

	scene = new THREE.Scene();
	scene.background = new THREE.Color("#a5cce0");
	scene.fog = new THREE.Fog(0xa5cce0, 25, 45);

	camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
	camera.position.set(0, 10, 22);
	camera.lookAt(0, 0, 0);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.target.set(0, 1, 0);
	controls.maxPolarAngle = Math.PI / 2.1;
	controls.minDistance = 5;
	controls.maxDistance = 40;
	controls.update();

	// 6 Wiesen im Kreis (Radius 8)
	patches = createAllMeadowPatches(8, -Math.PI / 2);
	for (const p of patches) {
		scene.add(p.group);
	}

	const clock = new THREE.Clock();
	function animate() {
		const elapsed = clock.getElapsedTime();
		for (const p of patches) {
			p.tick(elapsed);
		}
		controls.update();
		renderer.render(scene, camera);
		animationId = requestAnimationFrame(animate);
	}
	animationId = requestAnimationFrame(animate);

	const onResize = () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	};
	window.addEventListener("resize", onResize);
});

onDestroy(() => {
	if (!browser) return;
	cancelAnimationFrame(animationId);
	for (const p of patches) p.dispose();
	controls?.dispose();
	renderer?.dispose();
});
</script>

<canvas bind:this={canvas}></canvas>

<div class="overlay">
	<div class="legend">
		{#each presetNames as name, i}
			<div class="entry">
				<span class="dot" style="background: {MEADOW_PRESETS[name].color}"></span>
				<span class="num">{i + 1}.</span>
				<span>{name}</span>
			</div>
		{/each}
	</div>
	<p class="hint">Ziehen zum Drehen · Scrollen zum Zoomen</p>
</div>

<style>
	canvas { display: block; width: 100vw; height: 100vh; }
	:global(body) { margin: 0; overflow: hidden; background: #000; }

	.overlay {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		pointer-events: none;
		z-index: 10;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem 1rem;
		background: rgba(0,0,0,0.55);
		backdrop-filter: blur(8px);
		padding: 0.6rem 1.2rem;
		border-radius: 12px;
		font-family: system-ui, sans-serif;
		color: #fff;
		font-size: 0.85rem;
		user-select: none;
	}

	.entry {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		display: inline-block;
		flex-shrink: 0;
	}

	.num {
		color: #999;
		font-weight: 600;
		font-size: 0.7rem;
	}

	.hint {
		color: rgba(255,255,255,0.5);
		font-family: system-ui, sans-serif;
		font-size: 0.7rem;
		margin: 0;
		pointer-events: none;
	}
</style>
