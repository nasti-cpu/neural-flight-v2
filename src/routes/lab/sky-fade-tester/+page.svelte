<script lang="ts">
/**
 * LAB EXPERIMENT — Sky Fade Tester
 *
 * Zeigt alle Himmels-Presets mit einstellbarem Horizont-Fade.
 * So findest Du den perfekten Zwischenweg:
 * - Fade = 0 → kein Fade (rein, alt)
 * - Fade = 1 → aktuell (pow 4, stark)
 * - Fade dazwischen → sanfter Übergang
 */
import { onDestroy, onMount } from "svelte";
import * as THREE from "three/webgpu";
import { vec3, positionWorld } from "three/tsl";
import { nStopGradient } from "$lib/tsl";
import { SKY_PRESETS, type SkyPresetName } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";

const presetEntries = Object.entries(SKY_PRESETS).map(([name]) => ({
	name: name as SkyPresetName,
}));

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let currentIndex = $state(0);
let fadePow = $state(4);    // 1-8, je höher desto stärker der Fade
let gradientPow = $state(2); // 1-4
let skyMesh: THREE.Mesh | null = null;

function getPreset(index: number) {
	return presetEntries[((index % presetEntries.length) + presetEntries.length) % presetEntries.length];
}

function next() {
	currentIndex = (currentIndex + 1) % presetEntries.length;
	rebuildSky();
}

function prev() {
	currentIndex = ((currentIndex - 1) % presetEntries.length + presetEntries.length) % presetEntries.length;
	rebuildSky();
}

function fadeLabel(p: number): string {
	if (p === 0) return "kein Fade";
	if (p <= 2) return "sanft";
	if (p <= 4) return "mittel (aktuell)";
	return "stark";
}

function rebuildSky() {
	if (!scene || !skyMesh) return;

	skyMesh.geometry.dispose();
	(skyMesh.material as THREE.Material).dispose();
	scene.remove(skyMesh);

	buildSky();
}

function buildSky() {
	const preset = getPreset(currentIndex).name;
	const hexColors = SKY_PRESETS[preset] as unknown as number[];

	const radius = 500;
	const geo = new THREE.SphereGeometry(radius, 32, 32);

	const colorNodes = hexColors.map((h) => {
		const c = new THREE.Color(h);
		return vec3(c.r, c.g, c.b);
	});

	const tRaw = positionWorld.normalize().y.mul(0.5).add(0.5);
	const t = gradientPow > 1 ? tRaw.pow(gradientPow) : tRaw;
	const skyColor = nStopGradient(colorNodes, t);

	// Sanfter Fade: fadePow=0 → kein Fade, fadePow=4 → wie aktuell
	const fogColor = new THREE.Color("#4a90d9");
	let finalColor = skyColor;
	if (fadePow > 0) {
		const horizonFade = positionWorld.normalize().y.abs().oneMinus().pow(fadePow);
		const fogNode = vec3(fogColor.r, fogColor.g, fogColor.b);
		finalColor = skyColor.mix(fogNode, horizonFade);
	}

	const mat = new THREE.MeshBasicNodeMaterial();
	mat.colorNode = finalColor;
	mat.side = THREE.BackSide;
	mat.fog = false;

	skyMesh = new THREE.Mesh(geo, mat);
	skyMesh.frustumCulled = false;
	scene!.add(skyMesh);
}

onMount(async () => {
	renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);
	await renderer.init();

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
	camera.position.set(0, 0, 0);

	buildSky();

	const clock = new THREE.Clock();
	renderer.setAnimationLoop(() => {
		const t = clock.getElapsedTime();
		skyMesh!.rotation.y = t * 0.03;
		renderer.render(scene, camera);
	});

	const onResize = () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	};
	window.addEventListener("resize", onResize);
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (skyMesh) {
		skyMesh.geometry.dispose();
		(skyMesh.material as THREE.Material).dispose();
	}
	renderer?.dispose();
});
</script>

<canvas bind:this={canvas}></canvas>

<div class="overlay">
	<button class="nav-btn" onclick={prev}>◀</button>
	<div class="info">
		<h2>{getPreset(currentIndex).name}</h2>
		<span class="counter">{currentIndex + 1} / {presetEntries.length}</span>
	</div>
	<button class="nav-btn" onclick={next}>▶</button>
</div>

<div class="controls">
	<div class="control-group">
		<span class="label">Fade-Stärke: <strong>{fadePow}</strong> ({fadeLabel(fadePow)})</span>
		<input type="range" min="0" max="8" step="1" bind:value={fadePow} oninput={rebuildSky} />
		<div class="range-labels">
			<span>0 (rein)</span>
			<span>2 (sanft)</span>
			<span>4 (aktuell)</span>
			<span>8 (max)</span>
		</div>
	</div>
	<div class="control-group">
		<span class="label">Gradient-Power: <strong>{gradientPow}</strong></span>
		<input type="range" min="1" max="4" step="0.5" bind:value={gradientPow} oninput={rebuildSky} />
		<div class="range-labels">
			<span>1 (gleichmäßig)</span>
			<span>2 (normal)</span>
			<span>4 (dunkel oben)</span>
		</div>
	</div>
	<div class="color-swatches">
		{#each SKY_PRESETS[getPreset(currentIndex).name] as hex}
			<div class="swatch" style="background:#{hex.toString(16).padStart(6, '0')}" title="Hex: #{hex.toString(16).padStart(6, '0')}"></div>
		{/each}
	</div>
</div>

<style>
	canvas { display: block; width: 100vw; height: 100vh; }
	:global(body) { margin: 0; overflow: hidden; background: #000; }
	.overlay {
		position: fixed; bottom: 8rem; left: 50%; transform: translateX(-50%);
		display: flex; align-items: center; gap: 1.5rem;
		background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
		padding: 0.75rem 1.5rem; border-radius: 12px; color: #fff;
		font-family: system-ui, sans-serif; user-select: none; z-index: 10;
	}
	.nav-btn {
		background: rgba(255,255,255,0.15); border: none; color: #fff;
		font-size: 1.25rem; width: 2.5rem; height: 2.5rem; border-radius: 50%;
		cursor: pointer;
	}
	.nav-btn:hover { background: rgba(255,255,255,0.3); }
	.info { text-align: center; min-width: 180px; }
	.info h2 { margin: 0; font-size: 1rem; font-weight: 600; text-transform: capitalize; }
	.counter { font-size: 0.7rem; color: #777; }
	.controls {
		position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%);
		display: flex; align-items: center; gap: 1.5rem;
		background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
		padding: 0.75rem 1.25rem; border-radius: 12px; z-index: 10;
		flex-wrap: wrap; justify-content: center;
	}
	.control-group {
		display: flex; flex-direction: column; gap: 2px;
		min-width: 200px;
	}
	.label { font-size: 0.75rem; color: #ccc; }
	.control-group input[type="range"] {
		width: 100%; height: 4px; cursor: pointer;
		accent-color: #69f;
	}
	.range-labels {
		display: flex; justify-content: space-between;
		font-size: 0.6rem; color: #666; margin-top: 1px;
	}
	.color-swatches { display: flex; gap: 4px; }
	.swatch {
		width: 28px; height: 28px; border-radius: 4px;
		border: 1px solid rgba(255,255,255,0.2); cursor: help;
	}
</style>
