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
	let statusText = $state("Lade …");

	function loadGLB(url: string): Promise<THREE.Group> {
		return new Promise((resolve, reject) => {
			new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), () => {}, reject);
		});
	}

	function countTris(obj: THREE.Object3D): number {
		let total = 0;
		obj.traverse((child) => {
			if (child instanceof THREE.Mesh && child.geometry.index) {
				total += child.geometry.index.count / 3;
			} else if (child instanceof THREE.Mesh) {
				total += child.geometry.attributes.position.count / 3;
			}
		});
		return Math.round(total);
	}

	type InsectInfo = { name: string; model: string; tris: number; size: string };

	async function setup() {
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0x87ceeb);

		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
		camera.position.set(6, 4, 8);

		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(w, h);
		renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.2;

		controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 0.5, 0);
		controls.minDistance = 2;
		controls.maxDistance = 25;
		controls.update();

		const ambient = new THREE.AmbientLight(0x8899bb, 0.6);
		scene.add(ambient);
		const sun = new THREE.DirectionalLight(0xffeedd, 1.8);
		sun.position.set(10, 15, 5);
		scene.add(sun);
		const fill = new THREE.DirectionalLight(0x99bbff, 0.3);
		fill.position.set(-5, 5, -5);
		scene.add(fill);

		const groundGeo = new THREE.PlaneGeometry(20, 10);
		groundGeo.rotateX(-Math.PI / 2);
		const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x8abb6a, roughness: 1 }));
		ground.position.y = -0.5;
		scene.add(ground);

		statusText = "Lade Modelle …";

		const beeModels = [
			{ file: "/models/bienen/Meshy_AI_Honeybee_0604154325_texture.glb", label: "Original", pct: "100%" },
			{ file: "/models/bienen/Meshy_AI_Honeybee_low20.glb", label: "20%", pct: "80% weniger" },
			{ file: "/models/bienen/Meshy_AI_Honeybee_low10.glb", label: "10%", pct: "90% weniger" },
			{ file: "/models/bienen/Meshy_AI_Honeybee_low.glb", label: "2%", pct: "98% weniger" },
		];

		const butterflyModels = [
			{ file: "/models/schmetterlinge/Meshy_AI_Blue_Ulysses_Butterfl_0604160804_texture.glb", label: "Original", pct: "100%" },
			{ file: "/models/schmetterlinge/Meshy_AI_Blue_Ulysses_Butterfl_low20.glb", label: "20%", pct: "80% weniger" },
			{ file: "/models/schmetterlinge/Meshy_AI_Blue_Ulysses_Butterfl_low10.glb", label: "10%", pct: "90% weniger" },
			{ file: "/models/schmetterlinge/Meshy_AI_Blue_Ulysses_Butterfl_low.glb", label: "2%", pct: "98% weniger" },
		];

		const beeInfos: InsectInfo[] = [];
		const butterflyInfos: InsectInfo[] = [];

		const allLoads = [
			...beeModels.map((m) =>
				loadGLB(m.file).then((g) => {
					const t = countTris(g);
					beeInfos.push({ name: m.label, model: m.file, tris: t, size: m.pct });
					return { group: g, idx: beeInfos.length - 1, label: m.label };
				})
			),
			...butterflyModels.map((m) =>
				loadGLB(m.file).then((g) => {
					const t = countTris(g);
					butterflyInfos.push({ name: m.label, model: m.file, tris: t, size: m.pct });
					return { group: g, idx: butterflyInfos.length - 1, label: m.label };
				})
			),
		];

		const results = await Promise.allSettled(allLoads);

		const SPACING = 2.2;
		const Y_OFFSETS = [0.6, -1.0];
		const X_OFFSET = (beeModels.length - 1) * SPACING / 2;

		for (let i = 0; i < beeModels.length; i++) {
			const r = results[i];
			if (r.status !== "fulfilled") continue;
			const { group } = r.value;
			const box = new THREE.Box3().setFromObject(group);
			const size = box.getSize(new THREE.Vector3());
			const scale = 0.7 / Math.max(size.x, size.y, size.z);
			group.scale.setScalar(scale * 1.5);
			group.position.set(-X_OFFSET + i * SPACING, Y_OFFSETS[0], 0);
			group.rotation.y = 0.4;
			group.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.castShadow = true;
					child.receiveShadow = true;
				}
			});
			scene.add(group);
		}

		for (let i = 0; i < butterflyModels.length; i++) {
			const r = results[beeModels.length + i];
			if (r.status !== "fulfilled") continue;
			const { group } = r.value;
			const box = new THREE.Box3().setFromObject(group);
			const size = box.getSize(new THREE.Vector3());
			const scale = 0.7 / Math.max(size.x, size.y, size.z);
			group.scale.setScalar(scale * 1.5);
			group.position.set(-X_OFFSET + i * SPACING, Y_OFFSETS[1], 0);
			group.rotation.y = 0.4;
			group.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.castShadow = true;
					child.receiveShadow = true;
				}
			});
			scene.add(group);
		}

		const lines: string[] = [];
		if (beeInfos.length > 0) {
			lines.push("Biene: " + beeInfos.map((b) => `${b.name} ${b.tris.toLocaleString()} Tris (${b.size})`).join("  |  "));
		}
		if (butterflyInfos.length > 0) {
			lines.push("Falter: " + butterflyInfos.map((b) => `${b.name} ${b.tris.toLocaleString()} Tris (${b.size})`).join("  |  "));
		}
		statusText = lines.join("<br>");

		loading = false;

		function animate() {
			controls.update();
			renderer.render(scene, camera);
			animationId = requestAnimationFrame(animate);
		}
		animationId = requestAnimationFrame(animate);
	}

	onMount(() => {
		setup().catch(console.error);

		const ro = new ResizeObserver(() => {
			if (!renderer || !camera) return;
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

	<div class="overlay">
		<div class="header">
			<h1>Insekten Qualitätsvergleich</h1>
			{#if loading}
				<p class="status">{statusText}</p>
			{:else}
				<p class="status">{@html statusText}</p>
			{/if}
		</div>

		<div class="row-labels top-labels">
			{#each ["Original", "20%", "10%", "2%"] as label, i}
				<span class="col-label" style="left: {15 + i * 24}%">{label}</span>
			{/each}
		</div>

		<div class="row-labels side-labels">
			<span class="row-label" style="top: 30%">Biene</span>
			<span class="row-label" style="top: 62%">Falter</span>
		</div>

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

	.overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.header {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		text-align: center;
		color: white;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
		z-index: 1;
		max-width: 90%;
	}

	.header h1 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 4px;
	}

	.status {
		font-size: 0.65rem;
		margin: 0;
		opacity: 0.95;
		line-height: 1.5;
	}

	.row-labels {
		position: absolute;
		pointer-events: none;
	}

	.top-labels {
		top: 76px;
		left: 0;
		right: 0;
		display: flex;
		justify-content: center;
		gap: 0;
	}

	.col-label {
		position: absolute;
		font-size: 0.75rem;
		font-weight: 700;
		color: rgba(255, 255, 255, 0.85);
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
		transform: translateX(-50%);
	}

	.side-labels {
		left: 10px;
		top: 0;
		right: 0;
		bottom: 0;
	}

	.row-label {
		position: absolute;
		font-size: 0.8rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.85);
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
		transform: translateY(-50%);
	}

	.hint {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.65rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
</style>
