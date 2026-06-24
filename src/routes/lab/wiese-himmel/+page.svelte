<script lang="ts">
/**
 * LAB EXPERIMENT — Wiese & Himmel
 *
 * Kombiniert die Frühlingswiese mit allen 6 Himmels-Varianten.
 * OrbitControls zum Erkunden, Kamera auf Augenhöhe (VR-Blick).
 *
 * Frühlingswiese: InstancedMesh + ShaderMaterial (WebGL)
 * Himmel: Vertex-Color-Icosahedron + MeshBasicMaterial
 */
import { onDestroy, onMount } from "svelte";
import { browser } from "$app/environment";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createMeadow, MEADOW_PRESETS } from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";
import { createSky, SKY_PRESETS, type SkyPresetName } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";

const SKY_NAMES = Object.keys(SKY_PRESETS) as SkyPresetName[];

type Combo = { name: string; sky: SkyPresetName };

const COMBOS: Combo[] = [
	{ name: "☀️ Klassisch", sky: "klassisch" },
	{ name: "🌤 Warm", sky: "warm" },
	{ name: "🔵 Klar", sky: "klar" },
	{ name: "🌸 Pastell", sky: "pastell" },
	{ name: "🌌 Tief", sky: "tief" },
	{ name: "🌅 Morgen", sky: "morgen" },
];

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let meadow: ReturnType<typeof createMeadow> | null = null;
let skyMesh: THREE.Mesh | null = null;
let animationId: number;
let currentIndex = $state(0);

function rebuildScene(index: number) {
	const combo = COMBOS[index];

	if (meadow) {
		meadow.dispose();
		scene.remove(meadow.group);
	}
	if (skyMesh) {
		skyMesh.geometry.dispose();
		(skyMesh.material as THREE.Material).dispose();
		scene.remove(skyMesh);
	}

	const cfg = MEADOW_PRESETS["Frühlingswiese"];
	meadow = createMeadow(cfg, 0, 0);
	scene.add(meadow.group);

	skyMesh = createSky(combo.sky);
	scene.add(skyMesh);

	const hexColors = SKY_PRESETS[combo.sky] as unknown as number[];
	const fogColor = new THREE.Color(hexColors[2]);
	scene.background = fogColor;
	scene.fog = new THREE.Fog(fogColor, 30, 60);
}

onMount(() => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);

	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 120);
	camera.position.set(0, 1.5, 8);
	camera.lookAt(0, 1, -10);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.target.set(0, 1, 0);
	controls.maxPolarAngle = Math.PI / 2.05;
	controls.minDistance = 0.5;
	controls.maxDistance = 40;
	controls.update();

	rebuildScene(0);

	const clock = new THREE.Clock();
	function animate() {
		const elapsed = clock.getElapsedTime();
		if (meadow) meadow.tick(elapsed);
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

function switchVariant(index: number) {
	currentIndex = index;
	rebuildScene(index);
}

onDestroy(() => {
	if (!browser) return;
	cancelAnimationFrame(animationId);
	if (meadow) { meadow.dispose(); scene.remove(meadow.group); }
	if (skyMesh) { skyMesh.geometry.dispose(); (skyMesh.material as THREE.Material).dispose(); scene.remove(skyMesh); }
	controls?.dispose();
	renderer?.dispose();
});
</script>

<canvas bind:this={canvas}></canvas>

<div class="overlay">
	<h1>🌾 Frühlingswiese</h1>
	<div class="variants">
		{#each COMBOS as combo, i}
			<button
				class="variant-btn"
				class:active={currentIndex === i}
				onclick={() => switchVariant(i)}
			>
				{combo.name}
			</button>
		{/each}
	</div>
	<p class="hint">Ziehen zum Drehen · Scrollen zum Zoomen</p>
</div>

<style>
	canvas { display: block; width: 100vw; height: 100vh; }
	:global(body) { margin: 0; overflow: hidden; background: #000; }

	.overlay {
		position: fixed;
		top: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		pointer-events: none;
		z-index: 10;
		font-family: system-ui, sans-serif;
	}

	h1 {
		color: #fff;
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0;
		text-shadow: 0 2px 8px rgba(0,0,0,0.5);
	}

	.variants {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: center;
		pointer-events: auto;
	}

	.variant-btn {
		background: rgba(255,255,255,0.12);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255,255,255,0.2);
		color: #fff;
		padding: 0.4rem 1rem;
		border-radius: 20px;
		font-size: 0.8rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
		text-shadow: 0 1px 4px rgba(0,0,0,0.3);
	}
	.variant-btn:hover { background: rgba(255,255,255,0.25); }
	.variant-btn.active {
		background: rgba(255,255,255,0.35);
		border-color: #fff;
	}

	.hint {
		color: rgba(255,255,255,0.5);
		font-size: 0.7rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0,0,0,0.3);
	}
</style>
