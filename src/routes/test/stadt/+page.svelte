/**
 * Testseite für insect-world-v2 mit Stadt.
 * Zeigt die vollständige Szene: Himmel, Wiese, Blumen,
 * Bienen, Schmetterlinge und die Stadt (Ameisen-Perspektive).
 * Gras und Blumen sind im Stadt-Bereich entfernt.
 *
 * Nutzt WebGPU (WebGPURenderer) laut Projekt-Vorgabe.
 */
<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three/webgpu";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
	import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

	import { createSky } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
	import { createMeadow, MEADOW_PRESETS } from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";
	import { createFlowers } from "$lib/experiences/insect-world-v2/Objekte/Blumen/blumen";
	import { createBees } from "$lib/experiences/insect-world-v2/Objekte/Bienen/bienen";
	import { createButterflies } from "$lib/experiences/insect-world-v2/Objekte/Schmetterlinge/schmetterlinge";
	import { CITY_CONFIG as CITY } from "$lib/experiences/insect-world-v2/Objekte/Stadt/city";

	import beeGlbUrl from "$lib/experiences/insect-world-v2/Objekte/Bienen/Bee.glb?url";
	import TestNav from "$lib/components/TestNav.svelte";
	import butterflyGlbUrl from "$lib/experiences/insect-world-v2/Objekte/Schmetterlinge/Beautiful Butterfly.glb?url";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGPURenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let animationId: number;
	let errorMsg = $state("");
	let loading = $state(true);

	onMount(async () => {
		try {
			scene = new THREE.Scene();
			scene.background = new THREE.Color(0x87ceeb);

			const w = canvas.clientWidth;
			const h = canvas.clientHeight;

			camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
			camera.position.set(12, 8, 18);

			renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
			await renderer.init();
			renderer.setSize(w, h);
			renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

			console.log("[Stadt] WebGPU Renderer initialisiert");

			controls = new OrbitControls(camera, renderer.domElement);
			controls.target.set(6, 0, 6);
			controls.minDistance = 2;
			controls.maxDistance = 80;
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
			console.log("[Stadt] Blumen geladen");

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

			// Stadt laden (mehrere Instanzen mit CityManager-Stil)
			try {
				const cityScene = await new Promise<THREE.Group>((resolve, reject) => {
					new GLTFLoader().load(CITY.MODEL, (gltf) => resolve(gltf.scene), undefined, reject);
				});

				// Drei Städte in verschiedenen Richtungen platzieren
				const cityPositions = [
					{ x: 18, z: 0 },
					{ x: -50, z: -40 },
					{ x: 40, z: -60 },
				];

				for (const pos of cityPositions) {
					const clone = cityScene.clone(true);
					clone.scale.setScalar(CITY.SCALE);
					clone.position.set(pos.x, 0, pos.z);
					clone.rotation.y = Math.random() * Math.PI * 2;
					scene.add(clone);

					// Gras + Blumen im Kreis um die Stadt entfernen
					const radius = CITY.CLEAR_RADIUS;
					meadow.clearCircle(pos.x, pos.z, radius);
					// Blumen im Kreis entfernen
					const flowerMeshes: THREE.InstancedMesh[] = [];
					flowers.group.children.forEach((child) => {
						if (child instanceof THREE.InstancedMesh) {
							flowerMeshes.push(child);
						}
					});
					const d = new THREE.Object3D();
					const p = new THREE.Vector3();
					for (const mesh of flowerMeshes) {
						for (let i = 0; i < mesh.count; i++) {
							mesh.getMatrixAt(i, d.matrix);
							p.setFromMatrixPosition(d.matrix);
							const dx = p.x - pos.x;
							const dz = p.z - pos.z;
							if (Math.sqrt(dx * dx + dz * dz) < radius) {
								d.position.set(p.x, -100, p.z);
								d.scale.setScalar(1);
								d.rotation.set(0, 0, 0);
								d.updateMatrix();
								mesh.setMatrixAt(i, d.matrix);
							}
						}
						mesh.instanceMatrix.needsUpdate = true;
					}
				}
				console.log("[Stadt] Städte geladen:", cityPositions.length);
			} catch (e) {
				console.warn("[Stadt] Stadt-Fehler:", e);
			}

			// Blüten-Positionen filtern (nur sichtbare > -50)
			const visibleFlowerPositions = flowerPositions.filter((p) => p.y > -50);
			console.log("[Stadt] Sichtbare Blüten:", visibleFlowerPositions.length);

			// Bienen
			const bees = await createBees(beeGlbUrl, {
				count: 8,
				scale: 0.03,
				fieldRadius: 30,
				flyRadiusMin: 1,
				flyRadiusMax: 4,
				speedMin: 1.5,
				speedMax: 3.0,
				heightBaseMin: 0.3,
				heightBaseMax: 0.8,
				heightRange: 0.2,
				flowerTargets: visibleFlowerPositions,
				hoverDuration: 1.5,
				heightAboveFlower: 1.0,
			});
			scene.add(bees.group);

			// Schmetterlinge
			const butterflies = await createButterflies(butterflyGlbUrl, {
				count: 6,
				scale: 0.036,
				fieldRadius: 40,
				flyRadiusMin: 1,
				flyRadiusMax: 4,
				speedMin: 1.0,
				speedMax: 2.5,
				heightBaseMin: 0.8,
				heightBaseMax: 1.5,
				heightRange: 0.4,
				flowerTargets: visibleFlowerPositions,
				hoverDuration: 2.0,
				heightAboveFlower: 2.0,
			});
			scene.add(butterflies.group);

			loading = false;

			// Animationsloop
			const clock = new THREE.Clock();
			function animate() {
				const elapsed = clock.getElapsedTime();
				bees.update(elapsed);
				butterflies.update(elapsed);
				controls.update();
				renderer.render(scene, camera);
				animationId = requestAnimationFrame(animate);
			}
			animationId = requestAnimationFrame(animate);

		} catch (e) {
			console.error("[Stadt] FEHLER:", e);
			errorMsg = e instanceof Error ? e.message : String(e);
			loading = false;
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
		<h1>🏙️ Insekten-Welt V2 – mit Stadt</h1>
		{#if loading}
			<p class="loading">Lade Stadt &amp; Blumen …</p>
		{/if}
		{#if errorMsg}
			<p class="error">{errorMsg}</p>
		{/if}
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
	</div>
</div>
<TestNav currentSlug="stadt" />

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
