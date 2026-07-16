/**
 * Testseite: GuidePath A/B-Vergleich.
 *
 * Zwei Varianten der Leuchtspur zur Stadt:
 *   A – Aktuell (spritesPerDash: 2, spriteSize 1.0–1.8)
 *   B – Vorschlag (spritesPerDash: 1, spriteSize 1.4–2.2)
 *
 * Nutzt die echte CityGuidePath-Klasse aus der Hauptszene.
 * WebGPU + OrbitControls.
 */
<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three/webgpu";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

	import { createSky } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
	import TestNav from "$lib/components/TestNav.svelte";
	import { CityGuidePath } from "$lib/experiences/insect-world-v2/Objekte/Stadt/city-guide-path";
	import { getWorldHeight } from "$lib/experiences/insect-world-v2/Biome/Wiese/grass-manager";

	// ── Zwei Modi ──

	const MODE_A = {
		key: "A" as const,
		label: "A – Aktuelle Spur",
		desc: "spritesPerDash=2, spriteSize 1.0–1.8",
		config: {
			neonColor: 0x44ffff,
			dashLength: 0.5,
			gapLength: 0.3,
			spriteSizeMin: 1.0,
			spriteSizeMax: 1.8,
			spritesPerDash: 2,
			maxDist: 200,
		},
	};

	const MODE_B = {
		key: "B" as const,
		label: "B – Optimierte Spur",
		desc: "spritesPerDash=1, spriteSize 1.4–2.2",
		config: {
			neonColor: 0x44ffff,
			dashLength: 0.5,
			gapLength: 0.3,
			spriteSizeMin: 1.4,
			spriteSizeMax: 2.2,
			spritesPerDash: 1,
			maxDist: 200,
		},
	};

	const MODES = [MODE_A, MODE_B];

	// ── Szene ──

	const CITY_POS = new THREE.Vector3(0, 0, -120);
	const PLAYER_POS = new THREE.Vector3(0, 2, 0);

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGPURenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let animationId: number;
	let loading = $state(true);
	let errorMsg = $state("");
	let activeMode = $state("A");
	let fpsValue = $state(0);
	let guidePath: CityGuidePath;
	let frameCount = 0;
	let lastFpsTime = 0;

	// ── Pfad-Modi wechseln ──
	function switchMode(mode: string) {
		activeMode = mode;
		const modCfg = mode === "A" ? MODE_A.config : MODE_B.config;
		guidePath.setConfig(modCfg);
		guidePath.setTarget(PLAYER_POS, CITY_POS);
	}

	onMount(async () => {
		try {
			scene = new THREE.Scene();
			scene.background = new THREE.Color(0x0a1520);

			const w = canvas.clientWidth;
			const h = canvas.clientHeight;

			camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 500);
			camera.position.set(10, 25, 35);
			camera.lookAt(0, 0, -40);

			renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
			await renderer.init();
			renderer.setSize(w, h);
			renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

			controls = new OrbitControls(camera, renderer.domElement);
			controls.target.set(0, 0, -40);
			controls.update();

			// Licht
			const ambient = new THREE.AmbientLight(0x445566, 0.4);
			scene.add(ambient);
			const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
			sun.position.set(30, 50, 20);
			scene.add(sun);

			// Himmel (wie Hauptszene)
			const sky = createSky("tief");
			scene.add(sky);

			// Boden (größere Fläche mit Höhenfunktion)
			const groundGeo = new THREE.PlaneGeometry(400, 400, 40, 40);
			groundGeo.rotateX(-Math.PI / 2);
			const posAttr = groundGeo.attributes.position as THREE.Float32BufferAttribute;
			for (let i = 0; i < posAttr.count; i++) {
				const x = posAttr.getX(i);
				const z = posAttr.getZ(i);
				posAttr.setY(i, getWorldHeight(x, z));
			}
			posAttr.needsUpdate = true;
			groundGeo.computeVertexNormals();
			const groundMat = new THREE.MeshBasicMaterial({
				color: 0x1a2a1a,
				side: THREE.DoubleSide,
			});
			const ground = new THREE.Mesh(groundGeo, groundMat);
			scene.add(ground);

			// Raster
			const grid = new THREE.GridHelper(300, 40, 0x333366, 0x222244);
			grid.position.y = 0.02;
			scene.add(grid);

			// Nebel (wie Hauptszene: FogExp2 density 0.04)
			scene.fog = new THREE.FogExp2(new THREE.Color("#4a90d9"), 0.04);

			// Player-Markierung
			const playerDot = new THREE.Mesh(
				new THREE.SphereGeometry(0.6, 12, 12),
				new THREE.MeshBasicMaterial({ color: 0xff4444 }),
			);
			playerDot.position.copy(PLAYER_POS);
			scene.add(playerDot);

			// City-Markierung
			const cityGroup = new THREE.Group();
			const buildMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.8 });
			for (let i = 0; i < 8; i++) {
				const h = 1 + Math.random() * 3;
				const w = 0.3 + Math.random() * 0.5;
				const b = new THREE.Mesh(new THREE.CylinderGeometry(w, w, h, 6), buildMat);
				const angle = Math.random() * Math.PI * 2;
				const d = 0.5 + Math.random() * 1.5;
				b.position.set(
					Math.cos(angle) * d,
					h / 2 + getWorldHeight(CITY_POS.x + Math.cos(angle) * d, CITY_POS.z + Math.sin(angle) * d),
					Math.sin(angle) * d,
				);
				cityGroup.add(b);
			}
			const ringMat = new THREE.MeshBasicMaterial({
				color: 0x4488ff, transparent: true, opacity: 0.2,
				blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
			});
			const ring = new THREE.Mesh(new THREE.RingGeometry(4, 6, 32), ringMat);
			ring.rotation.x = -Math.PI / 2;
			ring.position.y = getWorldHeight(CITY_POS.x, CITY_POS.z) + 0.05;
			cityGroup.add(ring);
			cityGroup.position.set(CITY_POS.x, 0, CITY_POS.z);
			scene.add(cityGroup);

			// GuidePath (startet mit Modus A)
			guidePath = new CityGuidePath(MODE_A.config);
			guidePath.setTarget(PLAYER_POS, CITY_POS);
			scene.add(guidePath.group);

			loading = false;

			// Animation
			const clock = new THREE.Clock();
			function animate(time: number) {
				const elapsed = clock.getElapsedTime();

				// FPS zählen
				frameCount++;
				if (time - lastFpsTime > 1000) {
					fpsValue = frameCount;
					frameCount = 0;
					lastFpsTime = time;
				}

				guidePath.update(elapsed);
				controls.update();
				renderer.render(scene, camera);
				animationId = requestAnimationFrame(animate);
			}
			animationId = requestAnimationFrame(animate);
		} catch (e) {
			console.error("[GuidePathAB] FEHLER:", e);
			errorMsg = e instanceof Error ? e.message : String(e);
			loading = false;
		}
	});

	onDestroy(() => {
		if (!browser) return;
		cancelAnimationFrame(animationId);
		guidePath?.dispose();
		renderer?.dispose();
		controls?.dispose();
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🧪 GuidePath – A/B Vergleich</h1>
		{#if loading}
			<p class="loading">Lade …</p>
		{/if}
		{#if errorMsg}
			<p class="error">{errorMsg}</p>
		{/if}
	</div>

	<div class="controls">
		<p class="fps">FPS: {fpsValue}</p>
		<p class="mode-label">
			Modus: <strong class="mode-{activeMode.toLowerCase()}">{MODES.find((m) => m.key === activeMode)?.label}</strong>
		</p>
		<p class="mode-desc">{MODES.find((m) => m.key === activeMode)?.desc}</p>
		<div class="buttons">
			{#each MODES as mode}
				<button
					class="mode-btn mode-{mode.key.toLowerCase()}"
					class:active={activeMode === mode.key}
					onclick={() => switchMode(mode.key)}
				>
					{mode.label}
				</button>
			{/each}
		</div>
		<p class="hint">🖱️ Ziehen zum Drehen • Scrollen zum Zoomen • Stadt 120m entfernt</p>
	</div>
</div>
<TestNav currentSlug="guidepath-ab" />

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

	.ui-overlay {
		position: absolute;
		top: 20px;
		left: 50%;
		transform: translateX(-50%);
		text-align: center;
		pointer-events: none;
		z-index: 10;
	}
	.ui-overlay h1 {
		color: white;
		font-size: 1.1rem;
		font-weight: 600;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
		margin: 0 0 4px;
	}
	.loading {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.85rem;
	}
	.error {
		color: #ff6b6b;
		font-size: 0.85rem;
		background: rgba(0, 0, 0, 0.5);
		padding: 4px 12px;
		border-radius: 4px;
	}

	.controls {
		position: absolute;
		bottom: 30px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.75);
		backdrop-filter: blur(10px);
		border-radius: 12px;
		padding: 14px 20px;
		text-align: center;
		z-index: 10;
		min-width: 400px;
		border: 1px solid rgba(255, 255, 255, 0.1);
	}
	.fps {
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.7rem;
		margin: 0 0 6px;
		font-variant-numeric: tabular-nums;
	}
	.mode-label {
		color: white;
		font-size: 0.95rem;
		margin: 0 0 2px;
	}
	.mode-desc {
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.7rem;
		margin: 0 0 10px;
	}
	.mode-a { color: #44ffff; }
	.mode-b { color: #ffcc44; }
	.buttons {
		display: flex;
		gap: 8px;
		justify-content: center;
	}
	.mode-btn {
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: rgba(255, 255, 255, 0.7);
		padding: 8px 18px;
		border-radius: 8px;
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}
	.mode-btn:hover {
		background: rgba(255, 255, 255, 0.18);
	}
	.mode-btn.mode-a.active {
		background: rgba(68, 255, 255, 0.2);
		border-color: #44ffff;
		color: #44ffff;
		font-weight: 700;
		box-shadow: 0 0 16px rgba(68, 255, 255, 0.25);
	}
	.mode-btn.mode-b.active {
		background: rgba(255, 204, 68, 0.2);
		border-color: #ffcc44;
		color: #ffcc44;
		font-weight: 700;
		box-shadow: 0 0 16px rgba(255, 204, 68, 0.25);
	}
	.hint {
		color: rgba(255, 255, 255, 0.3);
		font-size: 0.65rem;
		margin: 10px 0 0;
	}
</style>
