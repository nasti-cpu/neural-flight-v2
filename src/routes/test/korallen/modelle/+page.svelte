<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createDuneSand, disposeDuneSand } from "$lib/experiences/underwater-world v2/Biome/Sand/sand";
import { createFishSchool, updateFishSchool, disposeFishSchool, loadFishGeometry } from "$lib/experiences/underwater-world v2/Objekte/Fische/fish";

const GARDEN_PATH = "/models/Meshy_AI_Coral_Reef_Garden_0604160957_texture.glb";
const KALEIDO_PATH = "/models/Meshy_AI_Kaleidoscope_Coral_Re_0604163348_texture.glb";

const GARDEN_COUNT = 8;
const KALEIDO_COUNT = 8;
const SPREAD = 20;

const FISH_CONFIGS = [
	{ count: 60, spread: 12, heightRange: 8, swimMode: "schooling" as const },
	{ count: 40, spread: 14, heightRange: 10, swimMode: "scattered" as const },
	{ count: 25, spread: 10, heightRange: 6, swimMode: "schooling" as const },
];

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let dune: ReturnType<typeof createDuneSand>;
let schools: ReturnType<typeof createFishSchool>[] = [];
let modelGroups: THREE.Group[] = [];
let clock = new THREE.Clock();
let coralScale = 1.2;

onMount(async () => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.setClearColor(0x001828);

	scene = new THREE.Scene();
	scene.fog = new THREE.Fog(0x001828, 30, 80);

	camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
	camera.position.set(0, 16, 35);
	camera.lookAt(0, 0, 0);

	const ambient = new THREE.AmbientLight(0xffffff, 0.6);
	scene.add(ambient);
	const sun = new THREE.DirectionalLight(0xffffff, 2.0);
	sun.position.set(20, 30, 20);
	sun.castShadow = true;
	sun.shadow.mapSize.set(1024, 1024);
	sun.shadow.camera.near = 1;
	sun.shadow.camera.far = 80;
	sun.shadow.camera.left = -30;
	sun.shadow.camera.right = 30;
	sun.shadow.camera.top = 30;
	sun.shadow.camera.bottom = -30;
	scene.add(sun);

	const fill = new THREE.DirectionalLight(0x4488ff, 0.5);
	fill.position.set(-20, 10, -20);
	scene.add(fill);

	const rim = new THREE.DirectionalLight(0xff8844, 0.3);
	rim.position.set(0, -5, -30);
	scene.add(rim);

	// Sand terrain
	dune = createDuneSand();
	scene.add(dune.terrain);

	// Fish — tight center area only
	const fishGeo = await loadFishGeometry();
	for (const cfg of FISH_CONFIGS) {
		const school = createFishSchool(cfg.count, fishGeo ?? undefined, cfg.spread, cfg.heightRange);
		school.mesh.position.set(0, 0, 0);
		scene.add(school.mesh);
		schools.push(school);
	}

	// Load both coral models
	const loader = new GLTFLoader();
	const [gardenGltf, kaleidoGltf] = await Promise.all([
		loader.loadAsync(GARDEN_PATH),
		loader.loadAsync(KALEIDO_PATH),
	]);

	const gardenSrc = gardenGltf.scene;
	const kaleidoSrc = kaleidoGltf.scene;
	gardenSrc.updateWorldMatrix(true, false);
	kaleidoSrc.updateWorldMatrix(true, false);

	// Compute Y-offset for garden model (bottom at Y=0)
	const gBox = new THREE.Box3().setFromObject(gardenSrc);
	const gMinY = gBox.min.y;

	// Compute Y-offset for kaleido model (bottom at Y=0)
	const kBox = new THREE.Box3().setFromObject(kaleidoSrc);
	const kMinY = kBox.min.y;

	const sandY = 0;

	// Place garden models randomly
	for (let i = 0; i < GARDEN_COUNT; i++) {
		const angle = Math.random() * Math.PI * 2;
		const dist = 4 + Math.random() * (SPREAD - 4);
		const x = Math.cos(angle) * dist;
		const z = Math.sin(angle) * dist;

		const clone = gardenSrc.clone(true);
		clone.position.set(x, sandY - gMinY, z);
		clone.rotation.y = Math.random() * Math.PI * 2;
		const baseScale = 0.8 + Math.random() * 0.7;
		clone.scale.setScalar(baseScale);
		clone.userData._baseScale = baseScale;
		scene.add(clone);
		modelGroups.push(clone);
	}

	// Place kaleido models randomly
	for (let i = 0; i < KALEIDO_COUNT; i++) {
		const angle = Math.random() * Math.PI * 2;
		const dist = 4 + Math.random() * (SPREAD - 4);
		const x = Math.cos(angle) * dist;
		const z = Math.sin(angle) * dist;

		const clone = kaleidoSrc.clone(true);
		clone.position.set(x, sandY - kMinY, z);
		clone.rotation.y = Math.random() * Math.PI * 2;
		const baseScale = 0.8 + Math.random() * 0.7;
		clone.scale.setScalar(baseScale);
		clone.userData._baseScale = baseScale;
		scene.add(clone);
		modelGroups.push(clone);
	}

	renderer.setAnimationLoop(() => {
		const delta = Math.min(clock.getDelta(), 0.05);
		const elapsed = clock.elapsedTime;
		const playerPos = new THREE.Vector3(0, 0, 0);

		for (let fi = 0; fi < schools.length; fi++) {
			const s = schools[fi];
			updateFishSchool(s, delta, elapsed, FISH_CONFIGS[fi].swimMode, playerPos);
			s.material.emissiveIntensity = 0.3 + Math.sin(elapsed * 0.5 + fi) * 0.2;
		}

		// Apply global coral scale
		for (const g of modelGroups) {
			const base = g.userData._baseScale ?? 1;
			g.scale.setScalar(base * coralScale);
		}

		camera.position.set(0, 16, 35);
		camera.lookAt(0, 0, 0);
		renderer.render(scene, camera);
	});
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	for (const s of schools) disposeFishSchool(s, scene!);
	if (dune) disposeDuneSand(dune, scene);
	for (const g of modelGroups) {
		g.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
				if (child.material instanceof THREE.Material) child.material.dispose();
			}
		});
		scene?.remove(g);
	}
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Korallen Modelle — ICAROS VR</title>
</svelte:head>

<div class="legend">
	<div class="item"><span class="dot garden"></span> Coral Reef Garden</div>
	<div class="item"><span class="dot kaleido"></span> Kaleidoscope Coral</div>
	<div class="item" style="display:flex;align-items:center;gap:8px">
		<label for="coralScale" style="font-size:12px;color:#88ccff">Größe:</label>
		<input type="range" id="coralScale" min="0.3" max="3.0" step="0.05" bind:value={coralScale} style="width:120px;accent-color:#00e5ff">
		<span style="font-size:12px;color:#88ccff;min-width:2.5em">{coralScale.toFixed(2)}×</span>
	</div>
</div>

<canvas bind:this={canvas} class="canvas"></canvas>

<style>
	:global(body) { margin: 0; overflow: hidden; background: #001828; font-family: system-ui, sans-serif; }
	.canvas { display: block; width: 100vw; height: 100vh; }
	.legend {
		position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
		z-index: 10; display: flex; gap: 20px;
		background: rgba(0,0,0,0.7);
		border: 1px solid rgba(0,170,255,0.3);
		border-radius: 10px;
		padding: 8px 18px;
		color: #ccf;
		font-size: 13px;
		align-items: center;
		flex-wrap: wrap;
		justify-content: center;
	}
	.item { display: flex; align-items: center; gap: 6px; }
	.dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
	.dot.garden { background: #ff6688; }
	.dot.kaleido { background: #44ddff; }
</style>
