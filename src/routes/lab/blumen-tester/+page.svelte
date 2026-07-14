<script lang="ts">
/**
 * LAB EXPERIMENT — Blumen-Tester (WebGPU)
 *
 * Frühlingswiese mit den 3 Lowpoly-Blumen (pink, white, yellow).
 * WASD + Maus zum Laufen, Click zum Fokussieren.
 * Toggle zum Ein-/Ausblenden der Blumen.
 *
 * Wiese: MeshBasicNodeMaterial (TSL/WebGPU)
 * Himmel: MeshBasicNodeMaterial + TSL-Gradient
 * Blumen: GLTF + InstancedMesh (WebGPU-kompatibel)
 */
import { onDestroy, onMount } from "svelte";
import { browser } from "$app/environment";
import * as THREE from "three/webgpu";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { createMeadow, MEADOW_PRESETS } from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";
import { createSky, SKY_PRESETS } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
import { createFlowers } from "$lib/experiences/insect-world-v2/Objekte/Blumen/blumen";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: PointerLockControls;
let meadow: ReturnType<typeof createMeadow> | null = null;
let skyMesh: THREE.Mesh | null = null;
let flowers: Awaited<ReturnType<typeof createFlowers>> | null = null;
let showFlowers = $state(true);
let loading = $state(true);
let locked = $state(false);

const keys = { w: false, a: false, s: false, d: false };
const vel = new THREE.Vector3();

onMount(async () => {
	renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);
	await renderer.init();

	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 120);
	camera.position.set(0, 1.5, 8);

	controls = new PointerLockControls(camera, renderer.domElement);
	controls.addEventListener("lock", () => { locked = true; });
	controls.addEventListener("unlock", () => { locked = false; });

	const ambient = new THREE.AmbientLight(0x8899bb, 0.5);
	scene.add(ambient);

	const sun = new THREE.DirectionalLight(0xfff4e0, 2.5);
	sun.position.set(0.5, 0.8, 0.3).normalize();
	scene.add(sun);

	const cfg = MEADOW_PRESETS["Frühlingswiese"];
	meadow = createMeadow(cfg, 0, 0);
	scene.add(meadow.group);

	skyMesh = createSky("klassisch");
	scene.add(skyMesh);

	const fogColor = new THREE.Color((SKY_PRESETS.klassisch as unknown as number[])[2]);
	scene.background = fogColor;
	scene.fog = new THREE.Fog(fogColor, 30, 60);

	loadFlowers();

	const onKeyDown = (e: KeyboardEvent) => {
		const k = e.key.toLowerCase();
		if (k in keys) keys[k as keyof typeof keys] = true;
	};
	const onKeyUp = (e: KeyboardEvent) => {
		const k = e.key.toLowerCase();
		if (k in keys) keys[k as keyof typeof keys] = false;
	};
	document.addEventListener("keydown", onKeyDown);
	document.addEventListener("keyup", onKeyUp);

	const clock = new THREE.Clock();
	renderer.setAnimationLoop(() => {
		const delta = clock.getDelta();
		const elapsed = clock.elapsedTime;

		if (locked) {
			const speed = 4;
			vel.set(0, 0, 0);
			if (keys.w) vel.z -= speed * delta;
			if (keys.s) vel.z += speed * delta;
			if (keys.a) vel.x -= speed * delta;
			if (keys.d) vel.x += speed * delta;
			camera.position.add(vel.applyQuaternion(camera.quaternion));

			camera.position.y = 1.5;
		}

		if (meadow) meadow.tick(elapsed);
		renderer.render(scene, camera);
	});

	const onResize = () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	};
	window.addEventListener("resize", onResize);
});

async function loadFlowers() {
	const getHeightAt = meadow?.getHeightAt ?? undefined;
	flowers = await createFlowers(0, 0, { count: 120, fieldSize: 50 }, getHeightAt);
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

function clickToLock() {
	if (!locked) controls.lock();
}

onDestroy(() => {
	if (!browser) return;
	renderer?.setAnimationLoop(null);
	controls?.unlock();
	controls?.dispose();
	meadow?.dispose();
	if (skyMesh) {
		skyMesh.geometry.dispose();
		(skyMesh.material as THREE.Material).dispose();
	}
	flowers?.dispose();
	renderer?.dispose();
});
</script>

<canvas bind:this={canvas} onclick={clickToLock}></canvas>

<div class="overlay">
	<h1>🌾 Frühlingswiese mit Blumen</h1>
	<div class="controls">
		<button class="toggle-btn" onclick={toggleFlowers} disabled={loading}>
			{loading ? "🔄 Lade Blumen..." : showFlowers ? "🌸 Blumen aus" : "🌱 Blumen ein"}
		</button>
	</div>
	<p class="hint">{locked ? "WASD · ESC zum Lösen" : "Klick ins Bild zum Laufen"}</p>
</div>

<style>
	canvas { display: block; width: 100vw; height: 100vh; cursor: crosshair; }
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
		pointer-events: none;
	}

	h1 {
		color: #fff;
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0;
		text-shadow: 0 2px 8px rgba(0,0,0,0.5);
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
	}
</style>
