<script lang="ts">
/**
 * LAB EXPERIMENT — Blumen-Tester
 *
 * Frühlingswiese mit den 3 Lowpoly-Blumen (pink, white, yellow).
 * Toggle zum Ein-/Ausblenden der Blumen.
 */
import { onDestroy, onMount } from "svelte";
import { browser } from "$app/environment";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createMeadow, MEADOW_PRESETS } from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";
import { createSky, SKY_PRESETS } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
import { createFlowers } from "$lib/experiences/insect-world-v2/Objekte/Blumen/blumen";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let meadow: ReturnType<typeof createMeadow> | null = null;
let skyMesh: THREE.Mesh | null = null;
let flowers: Awaited<ReturnType<typeof createFlowers>> | null = null;
let animationId: number;
let showFlowers = $state(true);
let loading = $state(true);

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

	const cfg = MEADOW_PRESETS["Frühlingswiese"];
	meadow = createMeadow(cfg, 0, 0);
	scene.add(meadow.group);

	skyMesh = createSky("klassisch");
	scene.add(skyMesh);

	const fogColor = new THREE.Color((SKY_PRESETS.klassisch as unknown as number[])[2]);
	scene.background = fogColor;
	scene.fog = new THREE.Fog(fogColor, 30, 60);

	loadFlowers();

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

async function loadFlowers() {
	flowers = await createFlowers(0, 0, { count: 120, fieldSize: 50 });
	loading = false;
	if (showFlowers) {
		scene.add(flowers.group);
	}
}

function toggleFlowers() {
	showFlowers = !showFlowers;
	if (flowers) {
		if (showFlowers) {
			scene.add(flowers.group);
		} else {
			scene.remove(flowers.group);
		}
	}
}

onDestroy(() => {
	if (!browser) return;
	cancelAnimationFrame(animationId);
	meadow?.dispose();
	if (skyMesh) {
		skyMesh.geometry.dispose();
		(skyMesh.material as THREE.Material).dispose();
	}
	flowers?.dispose();
	controls?.dispose();
	renderer?.dispose();
});
</script>

<canvas bind:this={canvas}></canvas>

<div class="overlay">
	<h1>🌾 Frühlingswiese mit Blumen</h1>
	<div class="controls">
		<button class="toggle-btn" onclick={toggleFlowers} disabled={loading}>
			{loading ? "🔄 Lade Blumen..." : showFlowers ? "🌸 Blumen aus" : "🌱 Blumen ein"}
		</button>
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
		z-index: 10;
		font-family: system-ui, sans-serif;
	}

	h1 {
		color: #fff;
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0;
		text-shadow: 0 2px 8px rgba(0,0,0,0.5);
		pointer-events: none;
	}

	.controls { pointer-events: auto; }

	.toggle-btn {
		background: rgba(255,255,255,0.12);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255,255,255,0.2);
		color: #fff;
		padding: 0.5rem 1.2rem;
		border-radius: 20px;
		font-size: 0.85rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
	}
	.toggle-btn:hover:not(:disabled) { background: rgba(255,255,255,0.25); }
	.toggle-btn:disabled { opacity: 0.5; cursor: wait; }

	.hint {
		color: rgba(255,255,255,0.5);
		font-size: 0.7rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0,0,0,0.3);
		pointer-events: none;
	}
</style>
