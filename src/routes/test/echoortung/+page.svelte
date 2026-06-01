<script lang="ts">
import { onMount, onDestroy } from "svelte";
import * as THREE from "three";
import {
	createEchoVariant,
	ECHO_VARIANTS,
} from "$lib/experiences/underwater-world v2/Sinne/Echoortung/echoortung";
import type { EchoVariant, EchoVariantSystem } from "$lib/experiences/underwater-world v2/Sinne/Echoortung/echoortung";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let clock = new THREE.Clock();
let system: EchoVariantSystem | null = null;
let targetGroup: THREE.Group;

let currentVariant = $state<EchoVariant>("scan");
let autoRotate = $state(true);
let orbitTheta = 0;
let orbitPhi = 0.35;
let emitTimer = 0;
let lastMX = 0;
let lastMY = 0;

const EMIT_INTERVAL = 1.8;

const variantKeys: EchoVariant[] = ["scan", "puls", "welle"];
const variantColors: Record<EchoVariant, number> = {
	scan: 0x00e5ff,
	puls: 0xffaa44,
	welle: 0xaa77ff,
};

function rebuild(variant: EchoVariant) {
	if (system) {
		scene.remove(system.group);
		system.dispose();
	}
	const config = ECHO_VARIANTS[variant];
	system = createEchoVariant(config);
	scene.add(system.group);
	emitTimer = 0;
}

onMount(() => {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(0x001020);

	scene = new THREE.Scene();
	scene.fog = new THREE.FogExp2(0x001020, 0.006);

	camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
	camera.position.set(0, 3, 18);
	camera.lookAt(0, 0, 0);

	const ambient = new THREE.AmbientLight(0x404060, 0.4);
	scene.add(ambient);
	const sun = new THREE.DirectionalLight(0xffffff, 0.8);
	sun.position.set(10, 20, 10);
	scene.add(sun);

	// Ground grid
	const grid = new THREE.GridHelper(30, 15, 0x004466, 0x002244);
	grid.position.y = -2.5;
	grid.material.transparent = true;
	grid.material.opacity = 0.2;
	scene.add(grid);

	// Stars
	const starCount = 300;
	const starGeo = new THREE.BufferGeometry();
	const starPos = new Float32Array(starCount * 3);
	for (let i = 0; i < starCount * 3; i++) {
		starPos[i] = (Math.random() - 0.5) * 120;
	}
	starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
	const starMat = new THREE.PointsMaterial({
		color: 0x446688,
		size: 0.1,
		transparent: true,
		opacity: 0.3,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		sizeAttenuation: true,
	});
	const stars = new THREE.Points(starGeo, starMat);
	scene.add(stars);

	// Target object in center
	targetGroup = new THREE.Group();

	const ringGeo = new THREE.RingGeometry(1.0, 1.3, 32);
	const ringMat = new THREE.MeshBasicMaterial({
		color: 0x4488cc,
		transparent: true,
		opacity: 0.12,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	const ring = new THREE.Mesh(ringGeo, ringMat);
	ring.rotation.x = -Math.PI / 2;
	targetGroup.add(ring);

	const coreGeo = new THREE.IcosahedronGeometry(0.6, 1);
	const coreMat = new THREE.MeshStandardMaterial({
		color: 0x4488cc,
		emissive: 0x4488cc,
		emissiveIntensity: 0.2,
		metalness: 0.3,
		roughness: 0.4,
		transparent: true,
		opacity: 0.7,
	});
	const core = new THREE.Mesh(coreGeo, coreMat);
	targetGroup.add(core);

	const glowGeo = new THREE.SphereGeometry(0.2, 12, 12);
	const glowMat = new THREE.MeshBasicMaterial({
		color: 0x4488cc,
		transparent: true,
		opacity: 0.5,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	const glow = new THREE.Mesh(glowGeo, glowMat);
	targetGroup.add(glow);

	targetGroup.position.set(0, 0, 0);
	scene.add(targetGroup);

	rebuild(currentVariant);

	renderer.setAnimationLoop(tick);

	function tick() {
		const delta = Math.min(clock.getDelta(), 0.05);
		const elapsed = clock.elapsedTime;

		if (autoRotate) {
			orbitTheta += delta * 0.2;
		}
		const dist = 18;
		const x = Math.sin(orbitTheta) * dist * Math.cos(orbitPhi);
		const y = Math.sin(orbitPhi) * dist + 2;
		const z = Math.cos(orbitTheta) * dist * Math.cos(orbitPhi);
		camera.position.set(x, y, z);
		camera.lookAt(0, 0, 0);

		// Auto-emit rings at interval
		emitTimer += delta;
		if (emitTimer >= EMIT_INTERVAL && system) {
			emitTimer = 0;
			system.emit(0, 0, 0);
		}

		if (system) system.update(delta);

		// Animate target
		core.rotation.x = elapsed * 0.4;
		core.rotation.y = elapsed * 0.6;
		const r = targetGroup.children[0] as THREE.Mesh;
		r.scale.setScalar(0.8 + 0.2 * Math.sin(elapsed * 1.2));
		const g = targetGroup.children[2] as THREE.Mesh;
		g.scale.setScalar(0.8 + 0.2 * Math.sin(elapsed * 2));

		stars.rotation.y += delta * 0.008;

		renderer.render(scene, camera);
	}
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (system) system.dispose();
	renderer?.dispose();
});
</script>

<svelte:head>
	<title>Echoortung Test — ICAROS VR</title>
</svelte:head>

<div class="ui">
	<div class="panel">
		<h2>🔊 Echoortung</h2>
		<div class="buttons">
			{#each variantKeys as vk}
				{@const cfg = ECHO_VARIANTS[vk]}
				<button
					class:active={currentVariant === vk}
					style="border-color: #{cfg.color.toString(16).padStart(6, '0')}; {currentVariant === vk ? `background: rgba(${parseInt(cfg.color.toString(16).slice(0,2), 16)}, ${parseInt(cfg.color.toString(16).slice(2,4), 16)}, ${parseInt(cfg.color.toString(16).slice(4,6), 16)}, 0.2)` : ''}"
					onclick={() => {
						currentVariant = vk;
						rebuild(vk);
					}}
				>
					<span class="dot" style="background: #{cfg.color.toString(16).padStart(6, '0')}"></span>
					{cfg.label}
				</button>
			{/each}
		</div>
		<p class="desc">{ECHO_VARIANTS[currentVariant].description}</p>
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
	onpointerdown={(e) => {
		lastMX = e.clientX;
		lastMY = e.clientY;
	}}
	onpointermove={(e) => {
		if (e.buttons === 0) return;
		const dx = e.clientX - lastMX;
		const dy = e.clientY - lastMY;
		lastMX = e.clientX;
		lastMY = e.clientY;
		orbitTheta -= dx * 0.005;
		orbitPhi = Math.max(-0.2, Math.min(1.0, orbitPhi + dy * 0.005));
	}}
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
		min-width: 240px;
	}
	h2 {
		font-size: 14px;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: #00e5ff;
		margin: 0 0 10px;
	}
	.buttons {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-bottom: 10px;
	}
	button {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #aac;
		padding: 6px 14px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 13px;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	button:hover {
		background: rgba(255, 255, 255, 0.12);
		color: #eef;
	}
	button.active {
		color: #fff;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
	}
	.desc {
		font-size: 11px;
		color: #668;
		margin: 0 0 12px;
		line-height: 1.4;
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
