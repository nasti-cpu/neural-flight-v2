<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import { createFishSchool, updateFishSchool, disposeFishSchool, loadFishGeometry, STANDARD_SCHOOL_CONFIGS } from "$lib/experiences/underwater-world v2/Objekte/Fische/fish";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let schools: ReturnType<typeof createFishSchool>[] = [];
let clock = new THREE.Clock();
let modelGeo: THREE.BufferGeometry | null = null;

onMount(async () => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(0x001020);

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
	camera.position.set(0, 3, 40);
	camera.lookAt(0, 0, 0);

	const ambient = new THREE.AmbientLight(0xffffff, 0.5);
	scene.add(ambient);
	const sun = new THREE.DirectionalLight(0xffffff, 1.5);
	sun.position.set(10, 20, 10);
	scene.add(sun);

	modelGeo = await loadFishGeometry();

	for (const cfg of STANDARD_SCHOOL_CONFIGS) {
		const school = createFishSchool(cfg.count, modelGeo ?? undefined, cfg.spread, cfg.heightRange);
		school.mesh.position.set(0, 0, 0);
		scene.add(school.mesh);
		schools.push(school);
	}

	renderer.setAnimationLoop(() => {
		const delta = Math.min(clock.getDelta(), 0.05);
		const elapsed = clock.elapsedTime;
		const playerPos = new THREE.Vector3(0, 0, 0);
		for (let fi = 0; fi < schools.length; fi++) {
			const s = schools[fi];
			updateFishSchool(s, delta, elapsed, STANDARD_SCHOOL_CONFIGS[fi].swimMode, playerPos);
			s.material.emissiveIntensity = 0.3 + Math.sin(elapsed * 0.5 + fi) * 0.2;
		}
		camera.position.set(0, 3, 40);
		camera.lookAt(0, 0, 0);
		renderer.render(scene, camera);
	});
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	for (const s of schools) disposeFishSchool(s, scene!);
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Fische Test — ICAROS VR</title>
</svelte:head>

<canvas bind:this={canvas} class="canvas"></canvas>

<style>
	:global(body) { margin: 0; overflow: hidden; background: #001020; font-family: system-ui, sans-serif; }
	.canvas { display: block; width: 100vw; height: 100vh; }
</style>
