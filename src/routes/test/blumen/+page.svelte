<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
	import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
	import { GrassMeadow } from "$lib/experiences/insect-world/Biome/Wiese/grass-test";
	import { SkyScene, SKY_VARIANTS } from "$lib/experiences/insect-world/Biome/blauer Himmel/sky-test";
	import TestNav from "$lib/components/TestNav.svelte";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let sky: SkyScene;
	let meadow: GrassMeadow;
	let animationId: number;
	let loading = $state(true);

	const FLOWER_COUNT = 25;

	function loadGLB(url: string): Promise<THREE.Group> {
		return new Promise((resolve, reject) => {
			new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), () => {}, reject);
		});
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

		const dummy = new THREE.Object3D();

		async function loadFlowers() {
			const [armeriaScene, spiderScene, lungwortScene] = await Promise.all([
				loadGLB("/models/blumen/glb_Alba_Armeria_Spring_Pink.glb"),
				loadGLB("/models/blumen/spider_lily_lycoris_radiata.glb"),
				loadGLB("/models/blumen/Lungwort Spring.glb"),
			]);

			const spiderParts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
			spiderScene.updateWorldMatrix(true, false);
			spiderScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.updateWorldMatrix(true, false);
					const geo = child.geometry.clone();
					geo.applyMatrix4(child.matrixWorld);
					spiderParts.push({ geo, mat: child.material });
				}
			});

			const armeriaParts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
			armeriaScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					armeriaParts.push({ geo: child.geometry, mat: child.material });
				}
			});

			const lungwortParts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
			lungwortScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					lungwortParts.push({ geo: child.geometry, mat: child.material });
				}
			});

			function scatterFlower(
				parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[],
				baseScale: number,
				scaleRange: [number, number],
				count: number,
			) {
				for (const { geo, mat } of parts) {
					const mesh = new THREE.InstancedMesh(geo, mat, count);
					mesh.castShadow = true;
					mesh.receiveShadow = true;
					for (let i = 0; i < count; i++) {
						const angle = Math.random() * Math.PI * 2;
						const dist = 2 + Math.random() * 18;
						const s = scaleRange[0] + Math.random() * (scaleRange[1] - scaleRange[0]);
						dummy.position.set(Math.cos(angle) * dist, 0.05, Math.sin(angle) * dist);
						dummy.scale.setScalar(baseScale * s);
						dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
						dummy.updateMatrix();
						mesh.setMatrixAt(i, dummy.matrix);
					}
					mesh.instanceMatrix.needsUpdate = true;
					scene.add(mesh);
				}
			}

			scatterFlower(armeriaParts, 0.025, [0.5, 1.5], FLOWER_COUNT);
			scatterFlower(spiderParts, 1.7, [0.6, 1.6], FLOWER_COUNT);
			scatterFlower(lungwortParts, 0.025, [0.5, 1.5], FLOWER_COUNT);

			loading = false;
		}

		loadFlowers().catch((err) => {
			console.error("Fehler beim Laden der Blumen:", err);
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
			<p class="loading">Lade Blumen-Modelle …</p>
		{/if}
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
	</div>
</div>
<TestNav currentSlug="blumen" />

<style>
	.container {
		position: fixed;
		inset: 0;
		overflow: hidden;
		max-width: none;
		padding: 0;
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
