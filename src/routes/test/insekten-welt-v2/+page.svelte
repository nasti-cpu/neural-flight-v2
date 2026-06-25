/**
 * Testseite für insect-world-v2.
 * Zeigt die vollständige Szene: Himmel, Wiese, Blumen und Bienen
 * die von Blüte zu Blüte fliegen.
 *
 * Nutzt WebGPU (WebGPURenderer) laut Projekt-Vorgabe.
 * Fallback auf WebGL falls WebGPU nicht verfügbar.
 */
<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three/webgpu";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

	import { createSky } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
	import { createMeadow, MEADOW_PRESETS } from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";
	import { createFlowers } from "$lib/experiences/insect-world-v2/Objekte/Blumen/blumen";
	import { createBees } from "$lib/experiences/insect-world-v2/Objekte/Bienen/bienen";

	const beeGlbUrl = "/models/bienen/Meshy_AI_Honeybee_low.glb";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGPURenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let animationId: number;
	let errorMsg = $state("");

	onMount(async () => {
		try {
			scene = new THREE.Scene();
			scene.background = new THREE.Color(0x87ceeb);

			const w = canvas.clientWidth;
			const h = canvas.clientHeight;

			camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
			camera.position.set(10, 6, 14);

			renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
			await renderer.init();
			renderer.setSize(w, h);
			renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

			console.log("[V2] WebGPU Renderer initialisiert");

			controls = new OrbitControls(camera, renderer.domElement);
			controls.target.set(0, 1.5, 0);
			controls.minDistance = 2;
			controls.maxDistance = 60;
			controls.maxPolarAngle = Math.PI / 2.1;
			controls.update();

			// Licht
			const ambient = new THREE.AmbientLight(0x8899bb, 0.6);
			scene.add(ambient);
			const sun = new THREE.DirectionalLight(0xfff4e0, 2.5);
			sun.position.set(50, 80, 30);
			scene.add(sun);

			// Himmel
			const sky = createSky("klassisch");
			scene.add(sky);

			// Wiese
			const meadow = createMeadow(MEADOW_PRESETS["Frühlingswiese"], 0, 0);
			scene.add(meadow.group);

			// Blumen
			const flowers = await createFlowers(0, 0, undefined, meadow.getHeightAt);
			scene.add(flowers.group);
			console.log("[V2] Blumen geladen");

			// Blüten-Positionen
			const flowerPositions: THREE.Vector3[] = [];
			const dummy = new THREE.Object3D();
			const pos = new THREE.Vector3();
			for (const child of flowers.group.children) {
				if (child instanceof THREE.InstancedMesh) {
					for (let i = 0; i < child.count; i++) {
						child.getMatrixAt(i, dummy.matrix);
						pos.setFromMatrixPosition(dummy.matrix);
						flowerPositions.push(pos.clone());
					}
				}
			}
			console.log("[V2] Blüten-Positionen:", flowerPositions.length);

			// Bienen
			const bees = await createBees(beeGlbUrl, {
				count: 8,
				scale: 0.06,
				fieldRadius: 25,
				flyRadiusMin: 1,
				flyRadiusMax: 3,
				speedMin: 1.5,
				speedMax: 3.0,
				heightBaseMin: 0.3,
				heightBaseMax: 0.8,
				heightRange: 0.2,
				flowerTargets: flowerPositions,
				hoverDuration: 1.5,
			});
			scene.add(bees.group);
			console.log("[V2] Bienen geladen");

			// Animationsloop
			const clock = new THREE.Clock();
			function animate() {
				const elapsed = clock.getElapsedTime();
				bees.update(elapsed);
				controls.update();
				renderer.render(scene, camera);
				animationId = requestAnimationFrame(animate);
			}
			animationId = requestAnimationFrame(animate);

		} catch (e) {
			console.error("[V2] FEHLER:", e);
			errorMsg = e instanceof Error ? e.message : String(e);
			// Auch mit Fehler rendern (nur Himmel+Bg)
			if (renderer) {
				const clock = new THREE.Clock();
				function fallbackAnimate() {
					controls?.update();
					renderer.render(scene, camera);
					animationId = requestAnimationFrame(fallbackAnimate);
				}
				animationId = requestAnimationFrame(fallbackAnimate);
			}
		}
	});

	onDestroy(() => {
		if (!browser) return;
		cancelAnimationFrame(animationId);
		renderer?.dispose();
		controls?.dispose();
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🐝 Insekten-Welt V2</h1>
		{#if errorMsg}
			<p class="error">{errorMsg}</p>
		{/if}
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
	</div>
</div>

<style>
	.container {
		position: fixed;
		inset: 0;
		overflow: hidden;
		font-family: system-ui, -apple-system, sans-serif;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.ui-overlay {
		position: absolute;
		top: 20px;
		left: 50%;
		transform: translateX(-50%);
		text-align: center;
		pointer-events: none;
	}

	.ui-overlay h1 {
		color: white;
		font-size: 1.2rem;
		font-weight: 600;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
		margin: 0 0 4px;
	}

	.error {
		color: #ff6b6b;
		font-size: 0.85rem;
		margin: 8px 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
		background: rgba(0, 0, 0, 0.5);
		padding: 4px 12px;
		border-radius: 4px;
	}

	.hint {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.75rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
</style>
