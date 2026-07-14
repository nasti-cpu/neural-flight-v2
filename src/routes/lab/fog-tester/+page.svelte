<script lang="ts">
/**
 * LAB EXPERIMENT — Fog Tester (Nebel-Varianten für insect-world-v2, WebGPU)
 *
 * Zeigt 6 identische Wiesenstücke mit unterschiedlichen Nebeleinstellungen im Kreis.
 * Ziel: Die beste Nebel-Distanz finden, damit das Chunk-Nachladen unsichtbar bleibt.
 *
 * Jede Variante hat:
 *   - Eine kleine Wiese (5m) mit Grashalmen
 *   - Einen eigenen Fog (near/far)
 *   - Ein Label mit den Fog-Werten
 *
 * Steuerung nach dem Umschalten: Free-Look mit OrbitControls.
 */
import { onDestroy, onMount } from "svelte";
import { browser } from "$app/environment";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createMeadow, type MeadowPatch } from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let patches: MeadowPatch[] = [];
let animationId: number;

/** Hilfsfunktion: Text-Label als Sprite */
function makeLabel(text: string, color: string): THREE.Sprite {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 80;
	const ctx = canvas.getContext("2d")!;

	ctx.fillStyle = "rgba(0,0,0,0.5)";
	ctx.beginPath();
	ctx.roundRect(0, 0, 512, 80, 12);
	ctx.fill();

	ctx.fillStyle = color;
	ctx.font = "bold 28px system-ui, sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(text, 256, 40);

	const texture = new THREE.CanvasTexture(canvas);
	texture.minFilter = THREE.LinearFilter;
	const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
	const sprite = new THREE.Sprite(mat);
	sprite.scale.set(5, 0.8, 1);
	return sprite;
}

// ── Fog-Varianten ──

interface FogVariant {
	label: string;
	description: string;
	fogNear: number;
	fogFar: number;
	fogColor: string;
}

const FOG_VARIANTS: FogVariant[] = [
	{
		label: "A: Aktuell",
		description: "Nah 20m / Fern 200m",
		fogNear: 20,
		fogFar: 200,
		fogColor: "#4a90d9",
	},
	{
		label: "B: Nah (klein)",
		description: "Nah 10m / Fern 60m",
		fogNear: 10,
		fogFar: 60,
		fogColor: "#4a90d9",
	},
	{
		label: "C: Nah (mittel)",
		description: "Nah 15m / Fern 80m",
		fogNear: 15,
		fogFar: 80,
		fogColor: "#4a90d9",
	},
	{
		label: "D: Mittel",
		description: "Nah 30m / Fern 130m",
		fogNear: 30,
		fogFar: 130,
		fogColor: "#4a90d9",
	},
	{
		label: "E: Weit",
		description: "Nah 50m / Fern 250m",
		fogNear: 50,
		fogFar: 250,
		fogColor: "#4a90d9",
	},
	{
		label: "F: Extrem nah",
		description: "Nah 5m / Fern 40m",
		fogNear: 5,
		fogFar: 40,
		fogColor: "#4a90d9",
	},
];

// ── Szene bauen ──

onMount(async () => {
	renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);
	await renderer.init();

	scene = new THREE.Scene();
	scene.background = new THREE.Color("#4a90d9");

	camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
	camera.position.set(0, 30, 40);
	camera.lookAt(0, 0, 0);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.target.set(0, 0, 0);
	controls.maxPolarAngle = Math.PI / 2.2;
	controls.minDistance = 10;
	controls.maxDistance = 100;
	controls.update();

	// Wiesenstücke bauen (6 Varianten im Kreis)
	buildScene();

	renderer.setAnimationLoop(() => {
		const elapsed = performance.now() / 1000;
		for (const p of patches) {
			p.tick(elapsed);
		}
		controls.update();
		renderer.render(scene, camera);
	});

	const onResize = () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	};
	window.addEventListener("resize", onResize);
});

function buildScene() {
	for (const p of patches) p.dispose();
	patches = [];

	const radius = 15;
	for (let i = 0; i < FOG_VARIANTS.length; i++) {
		const variant = FOG_VARIANTS[i];
		const angle = -Math.PI / 2 + (i / FOG_VARIANTS.length) * Math.PI * 2;
		const cx = Math.cos(angle) * radius;
		const cz = Math.sin(angle) * radius;

		// Wiese mit angepasster Konfiguration (kleiner, damit alle sichtbar)
		const config = {
			fieldSize: 6,
			grassCount: 2000,
			curvature: 0.0001,
			color: "#6aaf4c",
			groundColor: "#6aaf4c",
			minHeight: 0.6,
			maxHeight: 1.8,
			windStrength: 0.04,
			windSpeedMultiplier: 0.5,
		};

		const patch = createMeadow(config, cx, cz, variant.description);
		patches.push(patch);
		scene.add(patch.group);

		// Farbiger Indikator-Ring um die Wiese
		const ringGeo = new THREE.RingGeometry(3.8, 4.2, 64);
		ringGeo.rotateX(-Math.PI / 2);
		const ringMat = new THREE.MeshBasicMaterial({
			color: new THREE.Color(variant.fogColor),
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.6,
		});
		const ring = new THREE.Mesh(ringGeo, ringMat);
		ring.position.set(cx, 0.05, cz);
		ring.name = `ring-${i}`;
		scene.add(ring);

		// Beschriftungs-Sprite
		const sprite = makeLabel(variant.label, "#ffffff");
		sprite.position.set(cx, 3.5, cz);
		sprite.name = `label-${i}`;
		scene.add(sprite);
	}
}

/** Ändert den Nebel für ALLE Teile — zwei Modi:
 *  - "global": Ein globaler Fog für die ganze Szene (echter Fog-Effekt).
 *  - "perPatch": Jeder Patch hat keinen lokalen Fog, der globale regelt es.
 *
 * Bei WebGPU/TSL wird Fog über scene.fog gesteuert. Da wir hier MeshBasicNodeMaterial
 * mit fog=true nutzen, reicht scene.fog. Wir zeigen jedes Preset einzeln per Klick.
 */
let selectedVariant = $state<FogVariant | null>(null);

function selectVariant(variant: FogVariant) {
	selectedVariant = variant;
	const fogColor = new THREE.Color(variant.fogColor);
	scene.fog = new THREE.Fog(fogColor, variant.fogNear, variant.fogFar);
	scene.background = fogColor;

	// Alte Ringe/Labels aktualisieren oder zurücksetzen
	scene.children.forEach((child) => {
		if (child.name.startsWith("ring-")) {
			const idx = parseInt(child.name.split("-")[1], 10);
			if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
				if (idx === FOG_VARIANTS.indexOf(variant)) {
					child.material.opacity = 1.0;
				} else {
					child.material.opacity = 0.15;
				}
			}
		}
	});
}

onDestroy(() => {
	if (!browser) return;
	renderer?.setAnimationLoop(null);
	for (const p of patches) p.dispose();
	controls?.dispose();
	renderer?.dispose();
});
</script>

<canvas bind:this={canvas}></canvas>

<div class="overlay">
	<div class="title">🌫️ Fog Tester — insect-world-v2</div>
	<div class="variants">
		{#each FOG_VARIANTS as variant, i}
			<button
				class="variant-btn"
				class:active={selectedVariant === variant}
				onclick={() => selectVariant(variant)}
				style="border-color: {variant.fogColor}"
			>
				<span class="variant-label">{variant.label}</span>
				<span class="variant-desc">{variant.description}</span>
			</button>
		{/each}
	</div>
	<p class="hint">
		{selectedVariant
			? `Aktiv: ${selectedVariant.label} — Fog near=${selectedVariant.fogNear}m, far=${selectedVariant.fogFar}m`
			: "Klicke auf eine Variante, um den Nebel zu testen"}
	</p>
</div>

<style>
	canvas { display: block; width: 100vw; height: 100vh; }
	:global(body) { margin: 0; overflow: hidden; background: #000; }

	.overlay {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		z-index: 10;
		user-select: none;
	}

	.title {
		background: rgba(0,0,0,0.6);
		backdrop-filter: blur(10px);
		padding: 0.5rem 1.5rem;
		border-radius: 12px;
		font-family: system-ui, sans-serif;
		color: #fff;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.variants {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	.variant-btn {
		background: rgba(0,0,0,0.5);
		backdrop-filter: blur(8px);
		border: 2px solid rgba(255,255,255,0.15);
		color: #fff;
		font-family: system-ui, sans-serif;
		font-size: 0.75rem;
		padding: 0.4rem 0.8rem;
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
	}

	.variant-btn:hover {
		background: rgba(255,255,255,0.15);
		transform: translateY(-2px);
	}

	.variant-btn.active {
		background: rgba(255,255,255,0.2);
		border-width: 3px;
		box-shadow: 0 0 12px rgba(255,255,255,0.2);
	}

	.variant-label {
		font-weight: 600;
		font-size: 0.8rem;
	}

	.variant-desc {
		color: rgba(255,255,255,0.6);
		font-size: 0.65rem;
	}

	.hint {
		color: rgba(255,255,255,0.5);
		font-family: system-ui, sans-serif;
		font-size: 0.7rem;
		margin: 0;
		text-align: center;
		background: rgba(0,0,0,0.4);
		padding: 0.3rem 0.8rem;
		border-radius: 8px;
	}
</style>
