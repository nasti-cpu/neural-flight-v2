<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
	import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
	import { BLUMEN } from "$lib/experiences/insect-world/Objekte/Blumen/blumen";
	import { CITY } from "$lib/experiences/insect-world/Objekte/Stadt/city";
	import { BIENEN } from "$lib/experiences/insect-world/Objekte/Bienen/bienen";
	import { SCHMETTERLINGE } from "$lib/experiences/insect-world/Objekte/Schmetterlinge/schmetterlinge";
	import { PheromoneSystem } from "$lib/experiences/insect-world/Sinne/Pheromonspuren/pheromonspuren";
	import { GrassMeadow } from "$lib/experiences/insect-world/Biome/Wiese/grass-test";
	import { createSky } from "$lib/three/sky";
	import { createClouds } from "$lib/three/clouds";
	import TestNav from "$lib/components/TestNav.svelte";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let animationId: number;
	let loading = $state(true);
	let statusText = $state("Initialisiere …");
	let triangleCount = $state(0);
	let fps = $state(0);

	const BEE_MODEL_10 = "/models/bienen/Meshy_AI_Honeybee_low10.glb";
	const BUTTERFLY_MODEL_10 = "/models/schmetterlinge/Meshy_AI_Blue_Ulysses_Butterfl_low10.glb";

	const FLOWER_SCALES = {
		armeria: { baseScale: 0.004, scaleRange: [0.5, 1.5] as [number, number] },
		spider: { baseScale: 0.2, scaleRange: [0.6, 1.6] as [number, number] },
		lungwort: { baseScale: 0.004, scaleRange: [0.5, 1.5] as [number, number] },
	};

	interface Insect {
		group: THREE.Group;
		orbitCenter: THREE.Vector3;
		orbitRadius: number;
		speed: number;
		phase: number;
		heightBase: number;
		heightRange: number;
	}

	function loadGLB(url: string): Promise<THREE.Group | null> {
		return new Promise((resolve) => {
			new GLTFLoader().load(
				url,
				(gltf) => resolve(gltf.scene),
				undefined,
				() => { console.warn("GLB failed:", url); resolve(null); },
			);
		});
	}

	function countTris(obj: THREE.Object3D): number {
		let total = 0;
		obj.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				if (child.geometry.index) total += child.geometry.index.count / 3;
				else total += child.geometry.attributes.position.count / 3;
			}
		});
		return Math.round(total);
	}

	onMount(() => {
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0xd0e8f8);
		scene.fog = new THREE.Fog(0xd0e8f8, 25, 60);

		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
		camera.position.set(12, 8, 18);

		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(w, h);
		renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.0;

		controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 2, 0);
		controls.minDistance = 1;
		controls.maxDistance = 80;
		controls.maxPolarAngle = Math.PI / 2.1;
		controls.update();

		const ambient = new THREE.AmbientLight(0x8899bb, 0.4);
		scene.add(ambient);
		const sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
		sun.position.set(50, 80, 30);
		scene.add(sun);

		const sky = createSky({
			radius: 350, detail: 4,
			colorTop: 0x2060a0, colorHorizon: 0x87ceeb, colorBottom: 0xd0e8f8,
		});
		scene.add(sky);

		const meadow = new GrassMeadow(scene, { fieldSize: 200, grassCount: 25000, curvature: 0.0005 });
		meadow.build();

		const clouds = createClouds({
			count: 20, spread: 300, heightMin: 80, heightMax: 150,
			blobCount: [4, 8], blobRadius: [8, 18], color: 0xffffff,
			opacity: 0.8, driftSpeed: 2, driftDirection: { x: 1, z: 0.3 },
		});
		scene.add(clouds);

		let triTotal = 0;
		const bees: Insect[] = [];
		const butterflies: Insect[] = [];
		let pheromones: PheromoneSystem;

		async function loadAll() {
			statusText = "Lade Modelle …";

			const [armeriaG, spiderG, lungwortG, cityG, beeG, butterflyG] = await Promise.allSettled([
				loadGLB(BLUMEN[0].model), loadGLB(BLUMEN[1].model), loadGLB(BLUMEN[2].model),
				loadGLB(CITY.MODEL), loadGLB(BEE_MODEL_10), loadGLB(BUTTERFLY_MODEL_10),
			]);

			const armeria = armeriaG.status === "fulfilled" ? armeriaG.value : null;
			const spider = spiderG.status === "fulfilled" ? spiderG.value : null;
			const lungwort = lungwortG.status === "fulfilled" ? lungwortG.value : null;
			const city = cityG.status === "fulfilled" ? cityG.value : null;
			const beeModel = beeG.status === "fulfilled" ? beeG.value : null;
			const butterflyModel = butterflyG.status === "fulfilled" ? butterflyG.value : null;

			const dummy = new THREE.Object3D();
			const flowerMeshes: THREE.InstancedMesh[] = [];
			const flowerTargets: { position: THREE.Vector3; color: THREE.Color }[] = [];

			function getParts(group: THREE.Group, applyWorld: boolean) {
				const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
				if (applyWorld) group.updateWorldMatrix(true, false);
				group.traverse((child) => {
					if (child instanceof THREE.Mesh) {
						if (applyWorld) {
							child.updateWorldMatrix(true, false);
							const geo = child.geometry.clone();
							geo.applyMatrix4(child.matrixWorld);
							parts.push({ geo, mat: child.material });
						} else {
							parts.push({ geo: child.geometry, mat: child.material });
						}
					}
				});
				return parts;
			}

			function scatterFlowers(
				parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[],
				baseScale: number, scaleRange: [number, number],
				count: number, color: THREE.Color, minDist: number, maxDist: number,
			) {
				for (const { geo, mat } of parts) {
					const mesh = new THREE.InstancedMesh(geo, mat, count);
					for (let i = 0; i < count; i++) {
						const a = Math.random() * Math.PI * 2;
						const dist = minDist + Math.random() * (maxDist - minDist);
						const s = scaleRange[0] + Math.random() * (scaleRange[1] - scaleRange[0]);
						const x = Math.cos(a) * dist;
						const z = Math.sin(a) * dist;
						const groundY = meadow.getHeightAt(x, z);
						dummy.position.set(x, groundY + 0.05, z);
						dummy.scale.setScalar(baseScale * s);
						dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
						dummy.updateMatrix();
						flowerTargets.push({ position: dummy.position.clone(), color });
					}
					mesh.instanceMatrix.needsUpdate = true;
					scene.add(mesh);
					flowerMeshes.push(mesh);
				}
			}

			const armeriaParts = armeria ? getParts(armeria, false) : [];
			const spiderParts = spider ? getParts(spider, true) : [];
			const lungwortParts = lungwort ? getParts(lungwort, false) : [];

			for (const f of [
				{ parts: armeriaParts, ...FLOWER_SCALES.armeria, count: BLUMEN[0].count, color: new THREE.Color(BLUMEN[0].color) },
				{ parts: spiderParts, ...FLOWER_SCALES.spider, count: BLUMEN[1].count, color: new THREE.Color(BLUMEN[1].color) },
				{ parts: lungwortParts, ...FLOWER_SCALES.lungwort, count: BLUMEN[2].count, color: new THREE.Color(BLUMEN[2].color) },
			]) {
				if (f.parts.length === 0) continue;
				scatterFlowers(f.parts, f.baseScale, f.scaleRange, f.count, f.color, 2, 20);
				scatterFlowers(f.parts, f.baseScale, f.scaleRange, Math.round(f.count * 0.4), f.color, 20, 45);
			}

			if (city) {
				city.scale.setScalar(CITY.SCALE);
				city.position.set(CITY.POSITION.x, CITY.POSITION.y, CITY.POSITION.z);
				city.rotation.y = CITY.ROTATION_Y;
				scene.add(city);

				const sin = Math.sin(CITY.CLEAR.RECT.angle), cos = Math.cos(CITY.CLEAR.RECT.angle);
				const bw = CITY.CLEAR.RECT.hw + CITY.CLEAR.RECT.border, bd = CITY.CLEAR.RECT.hd + CITY.CLEAR.RECT.border;
				const d = new THREE.Object3D(), pos = new THREE.Vector3();
				for (const mesh of flowerMeshes) {
					for (let i = 0; i < mesh.count; i++) {
						mesh.getMatrixAt(i, d.matrix);
						pos.setFromMatrixPosition(d.matrix);
						const dx = pos.x - CITY.CLEAR.CENTER.x, dz = pos.z - CITY.CLEAR.CENTER.z;
						const localX = dx * cos - dz * sin, localZ = dx * sin + dz * cos;
						if (Math.abs(localX) < bw && Math.abs(localZ) < bd) {
							d.position.set(pos.x, -100, pos.z);
							d.scale.setScalar(1); d.rotation.set(0, 0, 0); d.updateMatrix();
							mesh.setMatrixAt(i, d.matrix);
						}
					}
					mesh.instanceMatrix.needsUpdate = true;
				}
				meadow.clearRotatedRect(CITY.CLEAR.CENTER.x, CITY.CLEAR.CENTER.z, CITY.CLEAR.RECT.hw, CITY.CLEAR.RECT.hd, CITY.CLEAR.RECT.angle, CITY.CLEAR.RECT.border);
			}

			pheromones = new PheromoneSystem();
			pheromones.setVariant(3);
			pheromones.addTrails(flowerTargets);
			scene.add(pheromones.group);

			for (const mesh of flowerMeshes) triTotal += countTris(mesh);

			if (beeModel) {
				const template = new THREE.Group();
				beeModel.traverse((child) => { if (child instanceof THREE.Mesh) template.add(child.clone()); });
				for (let i = 0; i < BIENEN.COUNT; i++) {
					const g = new THREE.Group();
					g.add(template.clone(true));
					const angle = Math.random() * Math.PI * 2;
					const dist = BIENEN.SPAWN_DIST_MIN + Math.random() * (BIENEN.SPAWN_DIST_MAX - BIENEN.SPAWN_DIST_MIN);
					const baseX = Math.cos(angle) * dist;
					const baseZ = Math.sin(angle) * dist;
					g.position.set(baseX, BIENEN.SPAWN_HEIGHT_MIN + Math.random() * (BIENEN.SPAWN_HEIGHT_MAX - BIENEN.SPAWN_HEIGHT_MIN), baseZ);
					g.scale.setScalar(BIENEN.SCALE);
					g.rotation.y = Math.random() * Math.PI * 2;
					scene.add(g);
					triTotal += countTris(g);
					bees.push({
						group: g,
						orbitCenter: new THREE.Vector3(baseX, 0, baseZ),
						orbitRadius: BIENEN.FLY_RADIUS_MIN + Math.random() * (BIENEN.FLY_RADIUS_MAX - BIENEN.FLY_RADIUS_MIN),
						speed: BIENEN.SPEED_MIN + Math.random() * (BIENEN.SPEED_MAX - BIENEN.SPEED_MIN),
						phase: Math.random() * Math.PI * 2,
						heightBase: BIENEN.HEIGHT_BASE_MIN + Math.random() * (BIENEN.HEIGHT_BASE_MAX - BIENEN.HEIGHT_BASE_MIN),
						heightRange: BIENEN.HEIGHT_RANGE_MIN + Math.random() * (BIENEN.HEIGHT_RANGE_MAX - BIENEN.HEIGHT_RANGE_MIN),
					});
				}
			}

			if (butterflyModel) {
				const template = new THREE.Group();
				butterflyModel.traverse((child) => { if (child instanceof THREE.Mesh) template.add(child.clone()); });
				for (let i = 0; i < SCHMETTERLINGE.COUNT; i++) {
					const g = new THREE.Group();
					g.add(template.clone(true));
					const angle = Math.random() * Math.PI * 2;
					const dist = SCHMETTERLINGE.SPAWN_DIST_MIN + Math.random() * (SCHMETTERLINGE.SPAWN_DIST_MAX - SCHMETTERLINGE.SPAWN_DIST_MIN);
					const baseX = Math.cos(angle) * dist;
					const baseZ = Math.sin(angle) * dist;
					g.position.set(baseX, SCHMETTERLINGE.SPAWN_HEIGHT_MIN + Math.random() * (SCHMETTERLINGE.SPAWN_HEIGHT_MAX - SCHMETTERLINGE.SPAWN_HEIGHT_MIN), baseZ);
					g.scale.setScalar(SCHMETTERLINGE.SCALE);
					g.rotation.y = Math.random() * Math.PI * 2;
					scene.add(g);
					triTotal += countTris(g);
					butterflies.push({
						group: g,
						orbitCenter: new THREE.Vector3(baseX, 0, baseZ),
						orbitRadius: SCHMETTERLINGE.FLY_RADIUS_MIN + Math.random() * (SCHMETTERLINGE.FLY_RADIUS_MAX - SCHMETTERLINGE.FLY_RADIUS_MIN),
						speed: SCHMETTERLINGE.SPEED_MIN + Math.random() * (SCHMETTERLINGE.SPEED_MAX - SCHMETTERLINGE.SPEED_MIN),
						phase: Math.random() * Math.PI * 2,
						heightBase: SCHMETTERLINGE.HEIGHT_BASE_MIN + Math.random() * (SCHMETTERLINGE.HEIGHT_BASE_MAX - SCHMETTERLINGE.HEIGHT_BASE_MIN),
						heightRange: SCHMETTERLINGE.HEIGHT_RANGE_MIN + Math.random() * (SCHMETTERLINGE.HEIGHT_RANGE_MAX - SCHMETTERLINGE.HEIGHT_RANGE_MIN),
					});
				}
			}

			const estOrig = triTotal + (BIENEN.COUNT * 1900000) + (SCHMETTERLINGE.COUNT * 346000);

			const diag: string[] = [];
			const dd = new THREE.Object3D();
			const bbox = new THREE.Box3();
			const seen = new Set<THREE.BufferGeometry>();
			for (const mesh of flowerMeshes) {
				if (seen.has(mesh.geometry)) continue;
				seen.add(mesh.geometry);
				mesh.getMatrixAt(0, dd.matrix);
				dd.matrix.decompose(dd.position, dd.quaternion, dd.scale);
				dd.updateMatrixWorld(true);
				bbox.setFromObject(mesh);
				const h = bbox.max.y - bbox.min.y;
				diag.push(`Teil #${seen.size}: Instanz 0 Höhe=${h.toFixed(3)}, mesh.scale=${dd.scale.toArray().map(v=>v.toFixed(4)).join(",")}`);
			}
			console.log("BLUMEN DIAGNOSE:");
			for (const line of diag) console.log(line);

			statusText = `${triTotal.toLocaleString()} Dreiecke — siehe Console (F12) für Blumen-Maße`;
			triangleCount = triTotal;
			loading = false;
		}

		loadAll().catch(console.error);

		const clock = new THREE.Clock();
		let frameCount = 0;
		let lastFpsUpdate = 0;

		function animate(time: number) {
			const dt = clock.getDelta();
			const elapsed = clock.getElapsedTime();

			frameCount++;
			if (time - lastFpsUpdate > 1000) {
				fps = Math.round(frameCount * 1000 / (time - lastFpsUpdate));
				frameCount = 0;
				lastFpsUpdate = time;
			}

			for (const bee of bees) {
				const t = elapsed * bee.speed + bee.phase;
				const x = bee.orbitCenter.x + Math.cos(t) * bee.orbitRadius;
				const z = bee.orbitCenter.z + Math.sin(t) * bee.orbitRadius;
				const y = bee.orbitCenter.y + bee.heightBase + Math.sin(t * 2) * bee.heightRange;
				const dx = x - bee.group.position.x;
				const dz = z - bee.group.position.z;
				bee.group.position.set(x, y, z);
				if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
					bee.group.rotation.y = Math.atan2(dx, dz);
				}
				bee.group.rotation.z = Math.sin(t * 3) * 0.05;
				bee.group.rotation.x = Math.sin(t * 2 + 1) * 0.03;
			}

			for (const butterfly of butterflies) {
				const t = elapsed * butterfly.speed + butterfly.phase;
				const x = butterfly.orbitCenter.x + Math.cos(t * 0.7) * butterfly.orbitRadius;
				const z = butterfly.orbitCenter.z + Math.sin(t * 0.7) * butterfly.orbitRadius;
				const y = butterfly.orbitCenter.y + butterfly.heightBase + Math.sin(t * 1.5) * butterfly.heightRange;
				const dx = x - butterfly.group.position.x;
				const dz = z - butterfly.group.position.z;
				butterfly.group.position.set(x, y, z);
				if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
					butterfly.group.rotation.y = Math.atan2(dx, dz);
				}
				butterfly.group.rotation.z = Math.sin(t * 2) * 0.08;
				butterfly.group.rotation.x = Math.sin(t * 1.5 + 1) * 0.05;
			}

			if (pheromones) pheromones.update(elapsed);
			controls.update();
			renderer.render(scene, camera);
			animationId = requestAnimationFrame(animate);
		}
		animationId = requestAnimationFrame(animate);

		const ro = new ResizeObserver(() => {
			if (!renderer || !camera) return;
			const w = canvas.clientWidth, h = canvas.clientHeight;
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
			<h1>🐝🦋 Erlebnis mit 10% Insekten</h1>
			{#if loading}
				<p class="status">{statusText}</p>
			{:else}
				<p class="status">{statusText}</p>
			{/if}
		</div>

		<div class="stats">
			<span class="stat">FPS: {fps}</span>
			<span class="stat">Dreiecke: {triangleCount.toLocaleString()}</span>
		</div>

		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
	</div>
</div>
<TestNav currentSlug="erlebnis-low" />

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
	}

	.header h1 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 4px;
	}

	.status {
		font-size: 0.7rem;
		margin: 0;
		opacity: 0.9;
	}

	.stats {
		position: absolute;
		bottom: 40px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 20px;
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.7rem;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
		background: rgba(0, 0, 0, 0.3);
		padding: 4px 12px;
		border-radius: 6px;
	}

	.hint {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		color: rgba(255, 255, 255, 0.4);
		font-size: 0.65rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
</style>
