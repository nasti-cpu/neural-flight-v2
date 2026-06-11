<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
	import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
	import { GrassMeadow } from "$lib/experiences/insect-world/Biome/Wiese/grass-test";
	import { SkyScene, SKY_VARIANTS } from "$lib/experiences/insect-world/Biome/blauer Himmel/sky-test";
	import { BLUMEN, type FlowerTypeDef } from "$lib/experiences/insect-world/Objekte/Blumen/blumen";
	import {
		PheromoneSystem,
		VARIANTS as PHEROMON_VARIANTS,
	} from "$lib/experiences/insect-world/Sinne/Pheromonspuren/pheromonspuren";
	import type { FlowerTarget } from "$lib/experiences/insect-world/Sinne/Pheromonspuren/pheromonspuren";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let sky: SkyScene;
	let meadow: GrassMeadow;
	let animationId: number;
	let loading = $state(true);
	let pheromones: PheromoneSystem;
	let currentVariant = $state(3);
	let flowerTargets: FlowerTarget[] = [];

	const dummy = new THREE.Object3D();

	function loadGLB(url: string): Promise<THREE.Group> {
		return new Promise((resolve, reject) => {
			new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), () => {}, reject);
		});
	}

	function prevVariant() {
		currentVariant = (currentVariant - 1 + PHEROMON_VARIANTS.length) % PHEROMON_VARIANTS.length;
		pheromones.setVariant(currentVariant);
		pheromones.rebuild(flowerTargets);
	}

	function nextVariant() {
		currentVariant = (currentVariant + 1) % PHEROMON_VARIANTS.length;
		pheromones.setVariant(currentVariant);
		pheromones.rebuild(flowerTargets);
	}

	onMount(() => {
		scene = new THREE.Scene();

		camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 120);
		camera.position.set(8, 6, 12);

		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(canvas.clientWidth, canvas.clientHeight);
		renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 1, 0);
		controls.maxPolarAngle = Math.PI / 2.05;
		controls.minDistance = 2;
		controls.maxDistance = 40;
		controls.update();

		sky = new SkyScene(scene);
		sky.build(0);
		meadow = new GrassMeadow(scene);
		meadow.build();

		const variant = SKY_VARIANTS[0];
		scene.fog = new THREE.Fog(variant.skyBottom, 25, 60);

		async function loadAll() {
			const promises = BLUMEN.map((b) => loadGLB(b.model));
			const scenes = await Promise.all(promises);

			for (let fi = 0; fi < BLUMEN.length; fi++) {
				const def = BLUMEN[fi];
				const gltfScene = scenes[fi];
				const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];

				const isSpider = def.name === "Spider Lily";
				if (isSpider) {
					gltfScene.updateWorldMatrix(true, false);
				}
				gltfScene.traverse((child) => {
					if (child instanceof THREE.Mesh) {
						let geo = child.geometry;
						if (isSpider) {
							child.updateWorldMatrix(true, false);
							geo = child.geometry.clone();
							geo.applyMatrix4(child.matrixWorld);
						}
						parts.push({ geo, mat: child.material });
					}
				});

				for (const { geo, mat } of parts) {
					const mesh = new THREE.InstancedMesh(geo, mat, def.count);
					mesh.castShadow = true;
					mesh.receiveShadow = true;
					for (let i = 0; i < def.count; i++) {
						const angle = Math.random() * Math.PI * 2;
						const dist = 2 + Math.random() * 18;
						const s = def.scaleRange[0] + Math.random() * (def.scaleRange[1] - def.scaleRange[0]);
						dummy.position.set(Math.cos(angle) * dist, 0.05, Math.sin(angle) * dist);
						dummy.scale.setScalar(def.baseScale * s);
						dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
						dummy.updateMatrix();
						mesh.setMatrixAt(i, dummy.matrix);

						const color = new THREE.Color(def.color);
						flowerTargets.push({
							position: dummy.position.clone(),
							color,
						});
					}
					mesh.instanceMatrix.needsUpdate = true;
					scene.add(mesh);
				}
			}

			pheromones = new PheromoneSystem();
			pheromones.setVariant(3);
			pheromones.addTrails(flowerTargets);
			scene.add(pheromones.group);

			loading = false;
		}

		loadAll().catch((err) => {
			console.error("Fehler:", err);
			loading = false;
		});

		addEventListener("keydown", (e) => {
			if (e.code === "ArrowLeft") prevVariant();
			if (e.code === "ArrowRight") nextVariant();
		});

		const clock = new THREE.Clock();

		function animate() {
			clock.getDelta();
			const elapsed = clock.getElapsedTime();

			if (pheromones) pheromones.update(elapsed);

			controls.update();
			renderer.render(scene, camera);
			animationId = requestAnimationFrame(animate);
		}

		animationId = requestAnimationFrame(animate);

		const resizeObserver = new ResizeObserver(() => {
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			renderer.setSize(w, h);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
		});
		resizeObserver.observe(canvas);
	});

	onDestroy(() => {
		if (!browser) return;
		cancelAnimationFrame(animationId);
		renderer?.dispose();
		controls?.dispose();
		pheromones?.dispose();
		meadow?.dispose();
		sky?.dispose();
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🐝 Pheromonspuren — {PHEROMON_VARIANTS[currentVariant].name}</h1>
		<p class="desc">{PHEROMON_VARIANTS[currentVariant].desc}</p>
		{#if loading}
			<p class="loading">Lade Blumen-Modelle …</p>
		{/if}
		<div class="controls">
			<button onclick={prevVariant}>◀ Vorherige</button>
			<span class="counter">{currentVariant + 1} / {PHEROMON_VARIANTS.length}</span>
			<button onclick={nextVariant}>Nächste ▶</button>
		</div>
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen • ← → für Varianten</p>
	</div>
</div>

<style>
	.container {
		position: fixed;
		inset: 0;
		overflow: hidden;
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
		font-family: system-ui, -apple-system, sans-serif;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}

	.ui-overlay h1 {
		color: white;
		font-size: 1.2rem;
		font-weight: 600;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
		margin: 0;
	}

	.desc {
		color: rgba(255, 255, 255, 0.85);
		font-size: 0.85rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}

	.loading {
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.85rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 12px;
		pointer-events: auto;
		margin-top: 4px;
	}

	.controls button {
		background: rgba(255, 255, 255, 0.15);
		color: white;
		border: 1px solid rgba(255, 255, 255, 0.3);
		padding: 6px 16px;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.85rem;
		backdrop-filter: blur(4px);
	}

	.controls button:hover {
		background: rgba(255, 255, 255, 0.25);
	}

	.counter {
		color: white;
		font-size: 0.8rem;
		font-weight: 500;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
		min-width: 40px;
	}

	.hint {
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.7rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
</style>
