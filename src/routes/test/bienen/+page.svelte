<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
	import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
	import { SkyScene, SKY_VARIANTS } from "$lib/experiences/insect-world/Biome/blauer Himmel/sky-test";
	import { BIENEN } from "$lib/experiences/insect-world/Objekte/Bienen/bienen";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let sky: SkyScene;
	let animationId: number;
	let loading = $state(true);

	const FLY_RADIUS = 12;
	const FLY_HEIGHT_RANGE = [0.5, 3.5];

	interface Bee {
		group: THREE.Group;
		orbitCenter: THREE.Vector3;
		orbitRadius: number;
		speed: number;
		phase: number;
		heightBase: number;
		heightRange: number;
	}

	function loadGLB(url: string): Promise<THREE.Group> {
		return new Promise((resolve, reject) => {
			new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), () => {}, reject);
		});
	}

	onMount(() => {
		scene = new THREE.Scene();

		camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 120);
		camera.position.set(8, 4, 12);

		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(canvas.clientWidth, canvas.clientHeight);
		renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 1.5, 0);
		controls.maxPolarAngle = Math.PI / 2.05;
		controls.minDistance = 2;
		controls.maxDistance = 40;
		controls.update();

		sky = new SkyScene(scene);
		sky.build(0);

		const variant = SKY_VARIANTS[0];
		scene.fog = new THREE.Fog(variant.skyBottom, 15, 40);

		const groundGeo = new THREE.PlaneGeometry(50, 50);
		groundGeo.rotateX(-Math.PI / 2);
		const groundMat = new THREE.MeshStandardMaterial({ color: "#6aaf4c", roughness: 1 });
		const ground = new THREE.Mesh(groundGeo, groundMat);
		ground.receiveShadow = true;
		scene.add(ground);

		const bees: Bee[] = [];

		async function loadBees() {
			const beeScene = await loadGLB(BIENEN.MODEL);

			const template = new THREE.Group();
			beeScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					const clone = child.clone();
					clone.castShadow = true;
					clone.receiveShadow = true;
					template.add(clone);
				}
			});

			for (let i = 0; i < BIENEN.COUNT; i++) {
				const group = new THREE.Group();
				group.add(template.clone(true));

				const angle = Math.random() * Math.PI * 2;
				const dist = BIENEN.SPAWN_DIST_MIN + Math.random() * (BIENEN.SPAWN_DIST_MAX - BIENEN.SPAWN_DIST_MIN);
				const baseX = Math.cos(angle) * dist;
				const baseZ = Math.sin(angle) * dist;

				group.position.set(baseX, BIENEN.SPAWN_HEIGHT_MIN + Math.random() * (BIENEN.SPAWN_HEIGHT_MAX - BIENEN.SPAWN_HEIGHT_MIN), baseZ);
				group.scale.setScalar(BIENEN.SCALE);
				group.rotation.y = Math.random() * Math.PI * 2;

				scene.add(group);

				bees.push({
					group,
					orbitCenter: new THREE.Vector3(baseX, 0, baseZ),
					orbitRadius: BIENEN.FLY_RADIUS_MIN + Math.random() * (BIENEN.FLY_RADIUS_MAX - BIENEN.FLY_RADIUS_MIN),
					speed: BIENEN.SPEED_MIN + Math.random() * (BIENEN.SPEED_MAX - BIENEN.SPEED_MIN),
					phase: Math.random() * Math.PI * 2,
					heightBase: BIENEN.HEIGHT_BASE_MIN + Math.random() * (BIENEN.HEIGHT_BASE_MAX - BIENEN.HEIGHT_BASE_MIN),
					heightRange: BIENEN.HEIGHT_RANGE_MIN + Math.random() * (BIENEN.HEIGHT_RANGE_MAX - BIENEN.HEIGHT_RANGE_MIN),
				});
			}

			loading = false;
		}

		loadBees().catch((err) => {
			console.error("Fehler beim Laden der Bienen:", err);
			loading = false;
		});

		const clock = new THREE.Clock();

		function animate(time: number) {
			const elapsed = clock.getElapsedTime();

			for (const bee of bees) {
				const t = elapsed * bee.speed + bee.phase;
				const x = bee.orbitCenter.x + Math.cos(t) * bee.orbitRadius;
				const z = bee.orbitCenter.z + Math.sin(t) * bee.orbitRadius;
				const y = bee.orbitCenter.y + bee.heightBase + Math.sin(t * 2) * bee.heightRange;

				const dx = x - bee.group.position.x;
				const dz = z - bee.group.position.z;

				bee.group.position.set(x, y, z);

				if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
					bee.group.rotation.y = Math.atan2(dx, dz);
				}

				bee.group.rotation.z = Math.sin(t * 3) * 0.05;
				bee.group.rotation.x = Math.sin(t * 2 + 1) * 0.03;
			}

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
		sky?.dispose();
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🐝 Bienenschwarm</h1>
		{#if loading}
			<p class="loading">Lade Bienen-Modell …</p>
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
