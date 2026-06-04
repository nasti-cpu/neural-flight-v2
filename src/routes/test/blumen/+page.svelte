<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
	import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
	import { GrassMeadow } from "$lib/experiences/insect-world/Biome/Wiese/grass-test";
	import { SkyScene, SKY_VARIANTS } from "$lib/experiences/insect-world/Biome/blauer Himmel/sky-test";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let sky: SkyScene;
	let meadow: GrassMeadow;
	let animationId: number;
	let loading = $state(true);

	const FLOWER_COUNT = 30;

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

		const loader = new GLTFLoader();
		const meshes: { geo: THREE.BufferGeometry; mat: THREE.Material; pos: THREE.Vector3 }[] = [];

		loader.load(
			"/models/blumen/glb_Alba_Armeria_Spring_Pink.glb",
			(gltf) => {
				gltf.scene.traverse((child) => {
					if (child instanceof THREE.Mesh) {
						meshes.push({
							geo: child.geometry,
							mat: child.material,
							pos: child.position.clone(),
						});
					}
				});

				const GROUP_SCALE = 0.015;
				const dummy = new THREE.Object3D();

				for (const { geo: geometry, mat: material, pos: offset } of meshes) {
					const mesh = new THREE.InstancedMesh(geometry, material, FLOWER_COUNT);
					mesh.castShadow = true;
					mesh.receiveShadow = true;

					for (let i = 0; i < FLOWER_COUNT; i++) {
						const angle = Math.random() * Math.PI * 2;
						const dist = 2 + Math.random() * 18;
						const x = Math.cos(angle) * dist;
						const z = Math.sin(angle) * dist;
						const y = 0.05;
						const s = 0.5 + Math.random() * 1.0;

						dummy.position.set(
							x + offset.x * GROUP_SCALE * s,
							y + offset.y * GROUP_SCALE * s,
							z + offset.z * GROUP_SCALE * s,
						);
						dummy.scale.setScalar(GROUP_SCALE * s);
						dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
						dummy.updateMatrix();
						mesh.setMatrixAt(i, dummy.matrix);
					}

					mesh.instanceMatrix.needsUpdate = true;
					scene.add(mesh);
				}

				loading = false;
			},
			() => {},
			(error) => {
				console.error("Fehler beim Laden des Blumen-Modells:", error);
				loading = false;
			},
		);

		function animate(time: number) {
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
		meadow?.dispose();
		sky?.dispose();
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🌸 Wiese mit Blumen</h1>
		{#if loading}
			<p class="loading">Lade Blumen-Modell …</p>
		{/if}
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
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
