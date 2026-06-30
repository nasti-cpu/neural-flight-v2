<script lang="ts">
/**
 * Testseite: Vollständige insect-world-v2 Experience.
 * Alle Komponenten geladen: Himmel, Bergpanorama, Wiese, Blumen,
 * Bienen, Schmetterlinge, Pheromonspuren und Stadt.
 * Tastatur-Steuerung: WASD + Shift/Ctrl zum Fliegen.
 */
import { onDestroy, onMount } from "svelte";
import * as THREE from "three/webgpu";
import { manifest } from "$lib/experiences/insect-world-v2/manifest";
import type { SetupContext } from "$lib/experiences/types";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;

onMount(async () => {
	// ── Renderer ──
	renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
	await renderer.init();
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);

	// ── Scene mit Experience-Voreinstellungen ──
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(manifest.scene.background);
	if (manifest.scene.fogNear > 0) {
		scene.fog = new THREE.Fog(manifest.scene.fogColor, manifest.scene.fogNear, manifest.scene.fogFar);
	}

	// Licht
	const ambient = new THREE.AmbientLight(0xffffff, manifest.scene.ambientIntensity);
	scene.add(ambient);
	const sun = new THREE.DirectionalLight(manifest.scene.sunColor, manifest.scene.sunIntensity);
	sun.position.set(manifest.scene.sunPosition.x, manifest.scene.sunPosition.y, manifest.scene.sunPosition.z);
	scene.add(sun);

	// Kamera
	const camera = new THREE.PerspectiveCamera(manifest.camera.fov, 1, manifest.camera.near, manifest.camera.far);

	// ── Experience laden ──
	const ctx: SetupContext = { scene, camera, renderer };
	const state = await manifest.setup(ctx);

	// ── Tastatur-Steuerung ──
	const keys = { w: false, a: false, s: false, d: false, shift: false, ctrl: false };
	function onKey(e: KeyboardEvent, pressed: boolean) {
		switch (e.code) {
			case "KeyW": keys.w = pressed; break;
			case "KeyA": keys.a = pressed; break;
			case "KeyS": keys.s = pressed; break;
			case "KeyD": keys.d = pressed; break;
			case "ShiftLeft": case "ShiftRight": keys.shift = pressed; break;
			case "ControlLeft": case "ControlRight": keys.ctrl = pressed; break;
		}
	}
	addEventListener("keydown", (e) => onKey(e, true));
	addEventListener("keyup", (e) => onKey(e, false));

	// ── Animation ──
	const clock = new THREE.Clock();
	let lastOrientation = { pitch: 0, roll: 0 };
	let lastSpeed = { accelerate: false, brake: false };

	function animate() {
		const delta = clock.getDelta();

		// Tastatur → Orientation
		const kPitch = (keys.w ? -30 : 0) + (keys.s ? 30 : 0);
		const kRoll = (keys.a ? -30 : 0) + (keys.d ? 30 : 0);
		if (kPitch !== 0 || kRoll !== 0) {
			lastOrientation = { pitch: kPitch, roll: kRoll };
		}
		if (keys.shift) {
			lastSpeed = { accelerate: true, brake: false };
		} else if (keys.ctrl) {
			lastSpeed = { accelerate: false, brake: true };
		} else if (kPitch === 0 && kRoll === 0) {
			lastSpeed = { accelerate: false, brake: false };
		}

		// Player-Update
		manifest.updatePlayer(lastOrientation, lastSpeed, state, delta);

		// Tick
		manifest.tick(state, {
			delta,
			elapsed: clock.elapsedTime,
			camera,
			playerPosition: camera.position,
			playerRotation: camera.rotation,
		});

		renderer.render(scene, camera);
		requestAnimationFrame(animate);
	}
	animate();
});

onDestroy(() => {
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Insect World V2 – Test | ICAROS VR</title>
</svelte:head>

<canvas bind:this={canvas} style="display:block;width:100vw;height:100vh"></canvas>
