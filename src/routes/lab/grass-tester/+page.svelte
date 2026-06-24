<script lang="ts">
/**
 * LAB EXPERIMENT — Grass Tester (Wiesen-Varianten)
 *
 * Zeigt 6 Gras-Dichte-Varianten der Frühlingswiese im Kreis.
 * Per Knopfdruck umschaltbar auf die 6 Grund-Presets.
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
	createSpacingPatches,
	MEADOW_PRESETS,
	FRUEHLING_SPACING,
	type MeadowPatch,
} from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let patches: MeadowPatch[] = [];
let animationId: number;

let spacingMode = $state(true);

type LegendEntry = { name: string; color: string; count: string };
let legend: LegendEntry[] = $state([]);

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

	buildPatches();

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

function buildPatches() {
	for (const p of patches) p.dispose();
	patches = [];

	if (spacingMode) {
		patches = createSpacingPatches(8, -Math.PI / 2);
		legend = FRUEHLING_SPACING.map(v => ({
			name: v.name,
			color: v.config.color,
			count: String(v.config.grassCount),
		}));
	} else {
		patches = createAllMeadowPatches(8, -Math.PI / 2);
		legend = Object.entries(MEADOW_PRESETS).map(([name, cfg]) => ({
			name,
			color: cfg.color,
			count: String(cfg.grassCount),
		}));
	}

	for (const p of patches) {
		scene.add(p.group);
	}
}

function toggleMode() {
	spacingMode = !spacingMode;
	buildPatches();
}

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
		{#each legend as entry, i}
			<div class="entry">
				<span class="dot" style="background: {entry.color}"></span>
				<span class="num">{i + 1}.</span>
				<span>{entry.name}</span>
			</div>
		{/each}
	</div>
	<div class="controls">
		<button class="toggle-btn" onclick={toggleMode}>
			{spacingMode ? "🌿 Alle Wiesen" : "🌱 Frühlings-Dichte"}
		</button>
		<p class="hint">Ziehen zum Drehen · Scrollen zum Zoomen</p>
	</div>
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

	.controls {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.toggle-btn {
		background: rgba(255,255,255,0.12);
		border: 1px solid rgba(255,255,255,0.2);
		color: #fff;
		font-family: system-ui, sans-serif;
		font-size: 0.8rem;
		padding: 0.4rem 1rem;
		border-radius: 8px;
		cursor: pointer;
		pointer-events: all;
		transition: background 0.2s;
	}
	.toggle-btn:hover { background: rgba(255,255,255,0.25); }

	.hint {
		color: rgba(255,255,255,0.5);
		font-family: system-ui, sans-serif;
		font-size: 0.7rem;
		margin: 0;
	}
</style>
