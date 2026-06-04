<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
	import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let animationId: number;
	let loading = $state(true);
	let variantIndex = $state(0);

	interface MaterialPreset {
		name: string;
		color: THREE.ColorRepresentation;
		roughness: number;
		metalness: number;
	}

	const PRESETS: MaterialPreset[] = [
		{ name: "Original (Textur)", color: "#ffffff", roughness: 0.8, metalness: 0 },
		{ name: "Heller Kiesel", color: "#c8c0b8", roughness: 0.5, metalness: 0 },
		{ name: "Dunkler Basalt", color: "#3a3a40", roughness: 0.6, metalness: 0.05 },
		{ name: "Warmgrau", color: "#9a9088", roughness: 0.55, metalness: 0 },
		{ name: "Sandstein", color: "#c4b49c", roughness: 0.7, metalness: 0 },
		{ name: "Schiefer", color: "#505058", roughness: 0.5, metalness: 0.1 },
		{ name: "Marmor", color: "#e0dcd4", roughness: 0.25, metalness: 0.05 },
	];

	const STONE_COUNT = 25;
	const dummy = new THREE.Object3D();
	let stoneParts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
	let stoneMeshes: THREE.InstancedMesh[] = [];

	function loadGLB(url: string): Promise<THREE.Group> {
		return new Promise((resolve, reject) => {
			new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), () => {}, reject);
		});
	}

	function buildVariant(presetIndex: number) {
		for (const m of stoneMeshes) {
			scene.remove(m);
			m.geometry.dispose();
			if (Array.isArray(m.material)) {
				m.material.forEach((mat) => mat.dispose());
			} else {
				m.material.dispose();
			}
		}
		stoneMeshes = [];

		const preset = PRESETS[presetIndex];

		for (const part of stoneParts) {
			const mat =
				presetIndex === 0
					? part.mat
					: new THREE.MeshStandardMaterial({
							color: preset.color,
							roughness: preset.roughness,
							metalness: preset.metalness,
						});

			const mesh = new THREE.InstancedMesh(part.geo, mat, STONE_COUNT);
			mesh.castShadow = true;
			mesh.receiveShadow = true;

			for (let i = 0; i < STONE_COUNT; i++) {
				const angle = Math.random() * Math.PI * 2;
				const dist = 2 + Math.random() * 16;
				const s = 0.03 + Math.random() * 0.04;
				dummy.position.set(Math.cos(angle) * dist, -0.02, Math.sin(angle) * dist);
				dummy.scale.setScalar(s);
				dummy.rotation.set(
					(Math.random() - 0.5) * 0.5,
					Math.random() * Math.PI * 2,
					(Math.random() - 0.5) * 0.5,
				);
				dummy.updateMatrix();
				mesh.setMatrixAt(i, dummy.matrix);
			}
			mesh.instanceMatrix.needsUpdate = true;
			scene.add(mesh);
			stoneMeshes.push(mesh);
		}
	}

	onMount(() => {
		scene = new THREE.Scene();
		scene.background = new THREE.Color("#c8d8e8");

		camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 60);
		camera.position.set(8, 5, 12);

		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(canvas.clientWidth, canvas.clientHeight);
		renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 0.5, 0);
		controls.maxPolarAngle = Math.PI / 2.05;
		controls.minDistance = 2;
		controls.maxDistance = 30;
		controls.update();

		const groundGeo = new THREE.CircleGeometry(25, 64);
		const groundMat = new THREE.MeshStandardMaterial({
			color: "#7a8a6a",
			roughness: 0.9,
			metalness: 0,
		});
		const ground = new THREE.Mesh(groundGeo, groundMat);
		ground.rotation.x = -Math.PI / 2;
		ground.receiveShadow = true;
		scene.add(ground);

		scene.add(new THREE.AmbientLight(0x8899aa, 0.5));

		const sun = new THREE.DirectionalLight(0xffeedd, 1.8);
		sun.position.set(10, 15, 8);
		sun.castShadow = true;
		sun.shadow.mapSize.set(1024, 1024);
		sun.shadow.camera.near = 0.1;
		sun.shadow.camera.far = 40;
		sun.shadow.camera.left = -15;
		sun.shadow.camera.right = 15;
		sun.shadow.camera.top = 15;
		sun.shadow.camera.bottom = -15;
		scene.add(sun);

		scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3a5f3a, 0.6));
		scene.fog = new THREE.Fog("#c8d8e8", 20, 40);

		async function init() {
			const gltfScene = await loadGLB("/models/steine/small_stones_pack_vcljbb1iw_raw.glb");
			gltfScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					stoneParts.push({ geo: child.geometry, mat: child.material });
				}
			});
			loading = false;
			buildVariant(0);
		}

		init().catch((err) => {
			console.error("Fehler:", err);
			loading = false;
		});

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

	function selectVariant(index: number) {
		variantIndex = index;
		buildVariant(index);
	}

	onDestroy(() => {
		if (!browser) return;
		cancelAnimationFrame(animationId);
		for (const m of stoneMeshes) {
			m.geometry.dispose();
			if (Array.isArray(m.material)) {
				m.material.forEach((mat) => mat.dispose());
			} else {
				m.material.dispose();
			}
		}
		renderer?.dispose();
		controls?.dispose();
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🪨 Stein-Varianten (Blender-Modelle)</h1>
		{#if loading}
			<p class="loading">Lade Stein-Modell (387 MB) …</p>
		{/if}
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
	</div>

	<div class="toolbar">
		{#each PRESETS as preset, i}
			<button
				class="variant-btn"
				class:active={variantIndex === i}
				onclick={() => selectVariant(i)}
			>
				<span class="swatch" style="background: {preset.color}"></span>
				<span class="label">{preset.name}</span>
			</button>
		{/each}
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
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		text-align: center;
		pointer-events: none;
		font-family: system-ui, -apple-system, sans-serif;
	}

	.ui-overlay h1 {
		color: white;
		font-size: 1.1rem;
		font-weight: 600;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
		margin: 0 0 2px;
	}

	.loading {
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.85rem;
		margin: 8px 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}

	.hint {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.7rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
	}

	.toolbar {
		position: absolute;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		justify-content: center;
		max-width: 90vw;
		pointer-events: auto;
	}

	.variant-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.4);
		color: rgba(255, 255, 255, 0.85);
		font-family: system-ui, -apple-system, sans-serif;
		font-size: 0.78rem;
		cursor: pointer;
		backdrop-filter: blur(6px);
		transition: all 0.15s;
	}

	.variant-btn:hover {
		border-color: rgba(255, 255, 255, 0.7);
		background: rgba(0, 0, 0, 0.55);
	}

	.variant-btn.active {
		border-color: #ffcc44;
		background: rgba(0, 0, 0, 0.65);
		box-shadow: 0 0 12px rgba(255, 204, 68, 0.3);
	}

	.swatch {
		display: inline-block;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.2);
		flex-shrink: 0;
	}

	.label {
		white-space: nowrap;
	}
</style>
