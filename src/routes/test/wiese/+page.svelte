<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
	import { GrassMeadow } from "$lib/experiences/insect-world/Biome/Wiese/grass-test";
	import TestNav from "$lib/components/TestNav.svelte";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let meadow: GrassMeadow;
	let animationId: number;

	onMount(() => {
		scene = new THREE.Scene();
		scene.background = new THREE.Color("#a8d8ea");
		scene.fog = new THREE.Fog("#a8d8ea", 25, 60);

		camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
		camera.position.set(8, 6, 12);

		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(canvas.clientWidth, canvas.clientHeight);
		renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 1, 0);
		controls.maxPolarAngle = Math.PI / 2.1;
		controls.minDistance = 3;
		controls.maxDistance = 30;
		controls.update();

		const ambient = new THREE.AmbientLight(0x8899bb, 0.5);
		scene.add(ambient);

		const sun = new THREE.DirectionalLight(0xfff4e0, 2.5);
		sun.position.set(10, 15, 8);
		sun.castShadow = true;
		sun.shadow.mapSize.set(1024, 1024);
		sun.shadow.camera.left = -20;
		sun.shadow.camera.right = 20;
		sun.shadow.camera.top = 20;
		sun.shadow.camera.bottom = -20;
		sun.shadow.camera.near = 0.5;
		sun.shadow.camera.far = 40;
		scene.add(sun);

		const hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.4);
		scene.add(hemi);

		meadow = new GrassMeadow(scene);
		meadow.build();

		function animate(time: number) {
			meadow.tick(time * 0.001);
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
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🌿 Wiese — hohes Gras im Wind</h1>
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
	</div>
</div>
<TestNav currentSlug="wiese" />

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

	.hint {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.75rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
</style>
