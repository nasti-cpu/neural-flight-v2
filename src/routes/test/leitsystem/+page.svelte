<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import {
	createGuidancePath,
	VARIANT_CONFIGS,
	GUIDANCE_VARIANTS,
} from "$lib/experiences/underwater-world v2/Sinne/Leitsystem/guidance";
import type { GuidancePath } from "$lib/experiences/underwater-world v2/Sinne/Leitsystem/guidance";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let clock = new THREE.Clock();
let paths: GuidancePath[] = [];
let autoRotate = $state(true);
let orbitTheta = 0;
let orbitPhi = 0.5;
let mouseDown = false;
let lastMX = 0;
let lastMY = 0;

const controlPointSets: Record<string, THREE.Vector3[]> = {
	city: [
		new THREE.Vector3(0, -1, 0),
		new THREE.Vector3(4, 1, 2),
		new THREE.Vector3(8, -0.5, 4),
		new THREE.Vector3(12, 2, 5),
		new THREE.Vector3(16, 0, 6),
		new THREE.Vector3(20, -1, 8),
	],
	target: [
		new THREE.Vector3(0, -1, 0),
		new THREE.Vector3(-3, 2, 2),
		new THREE.Vector3(-7, 0, 5),
		new THREE.Vector3(-11, 3, 6),
		new THREE.Vector3(-15, 1, 7),
		new THREE.Vector3(-18, -1, 10),
	],
	path: [
		new THREE.Vector3(0, -1, 0),
		new THREE.Vector3(0.5, 3, 4),
		new THREE.Vector3(-1, 0, 9),
		new THREE.Vector3(1.5, 4, 14),
		new THREE.Vector3(-0.5, 1, 19),
		new THREE.Vector3(0, 2, 24),
	],
};

onMount(() => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(0x001020);

	scene = new THREE.Scene();
	scene.fog = new THREE.FogExp2(0x001020, 0.008);

	camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
	updateCamera(0);

	const ambient = new THREE.AmbientLight(0x404060, 0.3);
	scene.add(ambient);

	// Ground grid for depth perception
	const gridHelper = new THREE.GridHelper(60, 30, 0x004466, 0x002244);
	gridHelper.position.y = -2;
	gridHelper.material.transparent = true;
	gridHelper.material.opacity = 0.3;
	scene.add(gridHelper);

	// Distant particles for atmosphere
	const starCount = 500;
	const starGeo = new THREE.BufferGeometry();
	const starPos = new Float32Array(starCount * 3);
	for (let i = 0; i < starCount * 3; i++) {
		starPos[i] = (Math.random() - 0.5) * 200;
		starPos[i] < 0 && i % 3 === 1 ? (starPos[i] = -Math.abs(starPos[i])) : null;
	}
	starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
	const starMat = new THREE.PointsMaterial({
		color: 0x446688,
		size: 0.15,
		transparent: true,
		opacity: 0.4,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		sizeAttenuation: true,
	});
	const stars = new THREE.Points(starGeo, starMat);
	scene.add(stars);

	// Origin glow point
	const originGlowGeo = new THREE.SphereGeometry(0.5, 16, 16);
	const originGlowMat = new THREE.MeshBasicMaterial({
		color: 0x4488cc,
		transparent: true,
		opacity: 0.3,
		blending: THREE.AdditiveBlending,
	});
	const originGlow = new THREE.Mesh(originGlowGeo, originGlowMat);
	originGlow.position.set(0, -1, 0);
	scene.add(originGlow);

	// Build 3 guidance paths
	for (const v of GUIDANCE_VARIANTS) {
		const config = VARIANT_CONFIGS[v];
		const pts = controlPointSets[v];
		const path = createGuidancePath(config, pts);
		scene.add(path.group);
		paths.push(path);
	}

	renderer.setAnimationLoop(tick);

	function tick() {
		const delta = Math.min(clock.getDelta(), 0.05);
		const elapsed = clock.elapsedTime;

		if (autoRotate && !mouseDown) {
			orbitTheta += delta * 0.2;
		}
		updateCamera(elapsed);

		for (const p of paths) {
			p.update(elapsed);
		}

		originGlow.scale.setScalar(0.9 + 0.1 * Math.sin(elapsed));
		stars.rotation.y += delta * 0.01;

		renderer.render(scene, camera);
	}
});

function updateCamera(elapsed: number) {
	const dist = 32;
	const x = Math.sin(orbitTheta) * dist * Math.cos(orbitPhi);
	const y = Math.sin(orbitPhi) * dist + 4;
	const z = Math.cos(orbitTheta) * dist * Math.cos(orbitPhi);
	camera.position.set(x, y, z);
	camera.lookAt(0, -1, 8);
}

function onPointerDown(e: PointerEvent) {
	mouseDown = true;
	lastMX = e.clientX;
	lastMY = e.clientY;
}

function onPointerMove(e: PointerEvent) {
	if (!mouseDown) return;
	const dx = e.clientX - lastMX;
	const dy = e.clientY - lastMY;
	lastMX = e.clientX;
	lastMY = e.clientY;
	orbitTheta -= dx * 0.005;
	orbitPhi = Math.max(-0.3, Math.min(1.2, orbitPhi + dy * 0.005));
}

function onPointerUp() {
	mouseDown = false;
}

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	for (const p of paths) p.dispose();
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Leitsystem Test — ICAROS VR</title>
</svelte:head>

<div class="ui">
	<div class="panel">
		<h2>🧭 Leitsystem — 3 Varianten</h2>
		<div class="legend">
			{#each GUIDANCE_VARIANTS as v}
				{@const cfg = VARIANT_CONFIGS[v]}
				<div class="entry">
					<div class="swatch" style="background: #{cfg.color.toString(16).padStart(6, '0')}"></div>
					<div class="info">
						<strong>{cfg.label}</strong>
						<span>{cfg.description}</span>
					</div>
				</div>
			{/each}
		</div>
		<div class="controls">
			<label>
				<input type="checkbox" checked={autoRotate} onchange={() => (autoRotate = !autoRotate)} />
				Auto-Rotate
			</label>
			<span class="hint">Ziehen zum Drehen</span>
		</div>
	</div>
</div>

<canvas
	bind:this={canvas}
	class="canvas"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointerleave={onPointerUp}
></canvas>

<style>
	:global(body) {
		margin: 0;
		overflow: hidden;
		background: #001020;
		font-family: system-ui, sans-serif;
	}
	.canvas {
		display: block;
		width: 100vw;
		height: 100vh;
	}
	.ui {
		position: fixed;
		top: 16px;
		left: 16px;
		z-index: 10;
		pointer-events: none;
	}
	.panel {
		background: rgba(0, 0, 0, 0.75);
		border: 1px solid rgba(0, 229, 255, 0.25);
		border-radius: 12px;
		padding: 16px 20px;
		color: #ccf;
		pointer-events: auto;
		min-width: 280px;
	}
	h2 {
		font-size: 14px;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: #00e5ff;
		margin: 0 0 12px;
	}
	.legend {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 14px;
	}
	.entry {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}
	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		margin-top: 3px;
		flex-shrink: 0;
		box-shadow: 0 0 8px currentColor;
	}
	.info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.info strong {
		font-size: 13px;
		color: #eef;
	}
	.info span {
		font-size: 11px;
		color: #8899bb;
	}
	.controls {
		display: flex;
		gap: 16px;
		align-items: center;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		padding-top: 10px;
		font-size: 12px;
	}
	.controls label {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		color: #aac;
	}
	.controls input {
		accent-color: #00e5ff;
	}
	.hint {
		color: #557;
		font-size: 11px;
	}
</style>
