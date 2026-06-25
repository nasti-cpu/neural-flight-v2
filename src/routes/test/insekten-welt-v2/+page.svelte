/**
 * Testseite für insect-world-v2.
 * Zeigt die vollständige Szene: Himmel, Wiese, Blumen und Bienen
 * die von Blüte zu Blüte fliegen.
 *
 * OrbitControls zum Navigieren.
 */
<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

	import { createSky } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
	import { createMeadow, MEADOW_PRESETS } from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";
	import { createFlowers } from "$lib/experiences/insect-world-v2/Objekte/Blumen/blumen";
	import { createBees } from "$lib/experiences/insect-world-v2/Objekte/Bienen/bienen";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let animationId: number;
	let loading = $state(true);

	// Das von dir in Objekte/Bienen/ abgelegte 3D-Modell
	import beeGlbUrl from "$lib/experiences/insect-world-v2/Objekte/Bienen/Bee.glb?url";

	onMount(async () => {
		scene = new THREE.Scene();

		const w = canvas.clientWidth;
		const h = canvas.clientHeight;

		camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
		camera.position.set(10, 6, 14);

		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(w, h);
		renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.0;

		controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 1.5, 0);
		controls.minDistance = 2;
		controls.maxDistance = 60;
		controls.maxPolarAngle = Math.PI / 2.1;
		controls.update();

		// Licht
		const ambient = new THREE.AmbientLight(0x8899bb, 0.5);
		scene.add(ambient);
		const sun = new THREE.DirectionalLight(0xfff4e0, 2.5);
		sun.position.set(50, 80, 30);
		scene.add(sun);

		// 1. Himmel
		const sky = createSky("klassisch");
		scene.add(sky);

		// 2. Wiese
		const meadow = createMeadow(MEADOW_PRESETS["Frühlingswiese"], 0, 0);
		scene.add(meadow.group);

		// 3. Blumen (Warte auf Promise)
		const flowers = await createFlowers(0, 0, undefined, meadow.getHeightAt);
		scene.add(flowers.group);

		// Blüten-Positionen aus den InstancedMeshes extrahieren
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

		// 4. Bienen (fliegen von Blüte zu Blüte)
		const bees = await createBees(beeGlbUrl, {
			count: 10,
			scale: 0.04,
			fieldRadius: 25,
			flyRadiusMin: 1,
			flyRadiusMax: 3,
			speedMin: 2,
			speedMax: 5,
			heightBaseMin: 0.3,
			heightBaseMax: 0.8,
			heightRange: 0.2,
			flowerTargets: flowerPositions,
			hoverDuration: 1.0,
		});
		scene.add(bees.group);

		loading = false;

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

		// Resize
		const ro = new ResizeObserver(() => {
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			renderer.setSize(w, h);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
		});
		ro.observe(canvas);
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
		{#if loading}
			<p class="loading">Lade Modelle …</p>
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

	.loading {
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.85rem;
		margin: 8px 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}

	.hint {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.75rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
</style>
