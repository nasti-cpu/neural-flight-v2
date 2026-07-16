<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
	let currentVariant = $state(0);

	const COMBINED_VARIANTS = [
		{ name: "☀️ Sonnige Wiese", skyIdx: 0 },
		{ name: "⛅ Bewölkte Wiese", skyIdx: 1 },
		{ name: "🌅 Morgenwiese", skyIdx: 2 },
		{ name: "🔵 Strahlende Wiese", skyIdx: 3 },
	];

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
		meadow = new GrassMeadow(scene);
		buildCombined(currentVariant);

		function animate(time: number) {
			sky.tick(time * 0.001);
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

	function buildCombined(index: number) {
		meadow.build();
		sky.build(COMBINED_VARIANTS[index].skyIdx);

		const variant = SKY_VARIANTS[COMBINED_VARIANTS[index].skyIdx];
		scene.fog = new THREE.Fog(variant.skyBottom, 25, 60);
	}

	function switchVariant(index: number) {
		currentVariant = index;
		meadow.dispose();
		sky.switchVariant(COMBINED_VARIANTS[index].skyIdx);
		meadow.build();

		const variant = SKY_VARIANTS[COMBINED_VARIANTS[index].skyIdx];
		scene.fog = new THREE.Fog(variant.skyBottom, 25, 60);
	}

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
		<h1>🌾 Wiese & Himmel</h1>
		<div class="variants">
			{#each COMBINED_VARIANTS as variant, i}
				<button
					class="variant-btn"
					class:active={currentVariant === i}
					onclick={() => switchVariant(i)}
				>
					{variant.name}
				</button>
			{/each}
		</div>
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
	</div>
</div>
<TestNav currentSlug="wiese-himmel" />

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
		gap: 10px;
	}

	.ui-overlay h1 {
		color: white;
		font-size: 1.2rem;
		font-weight: 600;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
		margin: 0;
	}

	.variants {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
		pointer-events: auto;
	}

	.variant-btn {
		background: rgba(255, 255, 255, 0.15);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.3);
		color: white;
		padding: 6px 14px;
		border-radius: 20px;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.2s;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}

	.variant-btn:hover {
		background: rgba(255, 255, 255, 0.3);
	}

	.variant-btn.active {
		background: rgba(255, 255, 255, 0.35);
		border-color: white;
	}

	.hint {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.75rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
</style>
