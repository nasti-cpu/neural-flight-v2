<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
	import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
	import { GrassMeadow } from "$lib/experiences/insect-world/Biome/Wiese/grass-test";
	import { SkyScene, SKY_VARIANTS } from "$lib/experiences/insect-world/Biome/blauer Himmel/sky-test";
	import { CITY } from "$lib/experiences/insect-world/Objekte/Stadt/city";
	import { BIENEN } from "$lib/experiences/insect-world/Objekte/Bienen/bienen";
	import { SCHMETTERLINGE } from "$lib/experiences/insect-world/Objekte/Schmetterlinge/schmetterlinge";
	import { BLUMEN } from "$lib/experiences/insect-world/Objekte/Blumen/blumen";
	import { PheromoneSystem } from "$lib/experiences/insect-world/Sinne/Pheromonspuren/pheromonspuren";
	import type { FlowerTarget } from "$lib/experiences/insect-world/Sinne/Pheromonspuren/pheromonspuren";
	import TestNav from "$lib/components/TestNav.svelte";
	import { CompoundEyeEffect } from "$lib/experiences/insect-world/Objekte/Facettenauge/facettenauge";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let sky: SkyScene;
	let meadow: GrassMeadow;
	let animationId: number;
	let loading = $state(true);
	let effect: CompoundEyeEffect;
	let pheromones: PheromoneSystem;
	let bees: Bee[] = [];
	let butterflies: Bee[] = [];
	let flowerTargets: FlowerTarget[] = [];

	const dummy = new THREE.Object3D();
	const keys = { w: false, a: false, s: false, d: false };
	const SPEED = 5;

	interface Bee {
		group: THREE.Group;
		orbitCenter: THREE.Vector3;
		orbitRadius: number;
		speed: number;
		phase: number;
		heightBase: number;
		heightRange: number;
	}

	function loadGLB(url: string): Promise<THREE.Group> {
		return new Promise((resolve, reject) => {
			new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), () => {}, reject);
		});
	}

	function onKey(e: KeyboardEvent, pressed: boolean) {
		switch (e.code) {
			case "KeyW": keys.w = pressed; break;
			case "KeyA": keys.a = pressed; break;
			case "KeyS": keys.s = pressed; break;
			case "KeyD": keys.d = pressed; break;
		}
	}

	onMount(() => {
		scene = new THREE.Scene();

		camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 120);
		camera.position.set(8, 6, 12);

		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(canvas.clientWidth, canvas.clientHeight);
		renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		effect = new CompoundEyeEffect(renderer, canvas.clientWidth, canvas.clientHeight);

		controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 1, 0);
		controls.maxPolarAngle = Math.PI / 2.05;
		controls.minDistance = 2;
		controls.maxDistance = 40;
		controls.update();

		sky = new SkyScene(scene);
		sky.build(0);
		meadow = new GrassMeadow(scene);
		meadow.build();

		const variant = SKY_VARIANTS[0];
		scene.fog = new THREE.Fog(variant.skyBottom, 25, 60);

		const flowerMeshes: THREE.InstancedMesh[] = [];

		function clearInstancesInRect(
			meshes: THREE.InstancedMesh[],
			cx: number, cz: number,
			hw: number, hd: number,
			angle: number,
			border: number,
		) {
			const sin = Math.sin(angle);
			const cos = Math.cos(angle);
			const bw = hw + border;
			const bd = hd + border;
			const d = new THREE.Object3D();
			const pos = new THREE.Vector3();
			for (const mesh of meshes) {
				for (let i = 0; i < mesh.count; i++) {
					mesh.getMatrixAt(i, d.matrix);
					pos.setFromMatrixPosition(d.matrix);
					const dx = pos.x - cx;
					const dz = pos.z - cz;
					const localX = dx * cos - dz * sin;
					const localZ = dx * sin + dz * cos;
					if (Math.abs(localX) < bw && Math.abs(localZ) < bd) {
						d.position.set(pos.x, -100, pos.z);
						d.scale.setScalar(1);
						d.rotation.set(0, 0, 0);
						d.updateMatrix();
						mesh.setMatrixAt(i, d.matrix);
					}
				}
				mesh.instanceMatrix.needsUpdate = true;
			}
		}

		async function loadAll() {
			const [armeriaScene, spiderScene, lungwortScene, cityScene, beeScene, butterflyScene] = await Promise.all([
				loadGLB(BLUMEN[0].model),
				loadGLB(BLUMEN[1].model),
				loadGLB(BLUMEN[2].model),
				loadGLB(CITY.MODEL),
				loadGLB(BIENEN.MODEL),
				loadGLB(SCHMETTERLINGE.MODEL),
			]);

			const spiderParts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
			spiderScene.updateWorldMatrix(true, false);
			spiderScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.updateWorldMatrix(true, false);
					const geo = child.geometry.clone();
					geo.applyMatrix4(child.matrixWorld);
					spiderParts.push({ geo, mat: child.material });
				}
			});

			const armeriaParts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
			armeriaScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					armeriaParts.push({ geo: child.geometry, mat: child.material });
				}
			});

			const lungwortParts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
			lungwortScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					lungwortParts.push({ geo: child.geometry, mat: child.material });
				}
			});

			function scatterFlower(
				parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[],
				baseScale: number,
				scaleRange: [number, number],
				count: number,
				color: THREE.Color,
			) {
				for (const { geo, mat } of parts) {
					const mesh = new THREE.InstancedMesh(geo, mat, count);
					mesh.castShadow = true;
					mesh.receiveShadow = true;
					for (let i = 0; i < count; i++) {
						const angle = Math.random() * Math.PI * 2;
						const dist = 2 + Math.random() * 18;
						const s = scaleRange[0] + Math.random() * (scaleRange[1] - scaleRange[0]);
						dummy.position.set(Math.cos(angle) * dist, 0.05, Math.sin(angle) * dist);
						dummy.scale.setScalar(baseScale * s);
						dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
						dummy.updateMatrix();
						mesh.setMatrixAt(i, dummy.matrix);

						flowerTargets.push({
							position: dummy.position.clone(),
							color,
						});
					}
					mesh.instanceMatrix.needsUpdate = true;
					scene.add(mesh);
					flowerMeshes.push(mesh);
				}
			}

			scatterFlower(armeriaParts, BLUMEN[0].baseScale, BLUMEN[0].scaleRange, BLUMEN[0].count, new THREE.Color(BLUMEN[0].color));
			scatterFlower(spiderParts, BLUMEN[1].baseScale, BLUMEN[1].scaleRange, BLUMEN[1].count, new THREE.Color(BLUMEN[1].color));
			scatterFlower(lungwortParts, BLUMEN[2].baseScale, BLUMEN[2].scaleRange, BLUMEN[2].count, new THREE.Color(BLUMEN[2].color));

			cityScene.scale.setScalar(CITY.SCALE);
			cityScene.position.set(CITY.POSITION.x, CITY.POSITION.y, CITY.POSITION.z);
			cityScene.rotation.y = CITY.ROTATION_Y;
			scene.add(cityScene);

			meadow.clearArea(CITY.CLEAR.CENTER.x, CITY.CLEAR.CENTER.z, CITY.CLEAR.RADIUS);
			clearInstancesInRect(flowerMeshes, CITY.CLEAR.CENTER.x, CITY.CLEAR.CENTER.z, CITY.CLEAR.RECT.hw,
				CITY.CLEAR.RECT.hd, CITY.CLEAR.RECT.angle, CITY.CLEAR.RECT.border);

			pheromones = new PheromoneSystem();
			pheromones.setVariant(3);
			pheromones.addTrails(flowerTargets);
			scene.add(pheromones.group);

			const beeTemplate = new THREE.Group();
			beeScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					const clone = child.clone();
					clone.castShadow = true;
					clone.receiveShadow = true;
					beeTemplate.add(clone);
				}
			});

			for (let i = 0; i < BIENEN.COUNT; i++) {
				const group = new THREE.Group();
				group.add(beeTemplate.clone(true));

				const angle = Math.random() * Math.PI * 2;
				const dist = BIENEN.SPAWN_DIST_MIN + Math.random() * (BIENEN.SPAWN_DIST_MAX - BIENEN.SPAWN_DIST_MIN);
				const baseX = Math.cos(angle) * dist;
				const baseZ = Math.sin(angle) * dist;

				group.position.set(baseX, BIENEN.SPAWN_HEIGHT_MIN + Math.random() * (BIENEN.SPAWN_HEIGHT_MAX - BIENEN.SPAWN_HEIGHT_MIN), baseZ);
				group.scale.setScalar(BIENEN.SCALE);
				group.rotation.y = Math.random() * Math.PI * 2;

				scene.add(group);

				bees.push({
					group,
					orbitCenter: new THREE.Vector3(baseX, 0, baseZ),
					orbitRadius: BIENEN.FLY_RADIUS_MIN + Math.random() * (BIENEN.FLY_RADIUS_MAX - BIENEN.FLY_RADIUS_MIN),
					speed: BIENEN.SPEED_MIN + Math.random() * (BIENEN.SPEED_MAX - BIENEN.SPEED_MIN),
					phase: Math.random() * Math.PI * 2,
					heightBase: BIENEN.HEIGHT_BASE_MIN + Math.random() * (BIENEN.HEIGHT_BASE_MAX - BIENEN.HEIGHT_BASE_MIN),
					heightRange: BIENEN.HEIGHT_RANGE_MIN + Math.random() * (BIENEN.HEIGHT_RANGE_MAX - BIENEN.HEIGHT_RANGE_MIN),
				});
			}

			const butterflyTemplate = new THREE.Group();
			butterflyScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					const clone = child.clone();
					clone.castShadow = true;
					clone.receiveShadow = true;
					butterflyTemplate.add(clone);
				}
			});

			for (let i = 0; i < SCHMETTERLINGE.COUNT; i++) {
				const group = new THREE.Group();
				group.add(butterflyTemplate.clone(true));

				const angle = Math.random() * Math.PI * 2;
				const dist = SCHMETTERLINGE.SPAWN_DIST_MIN + Math.random() * (SCHMETTERLINGE.SPAWN_DIST_MAX - SCHMETTERLINGE.SPAWN_DIST_MIN);
				const baseX = Math.cos(angle) * dist;
				const baseZ = Math.sin(angle) * dist;

				group.position.set(baseX, SCHMETTERLINGE.SPAWN_HEIGHT_MIN + Math.random() * (SCHMETTERLINGE.SPAWN_HEIGHT_MAX - SCHMETTERLINGE.SPAWN_HEIGHT_MIN), baseZ);
				group.scale.setScalar(SCHMETTERLINGE.SCALE);
				group.rotation.y = Math.random() * Math.PI * 2;

				scene.add(group);

				butterflies.push({
					group,
					orbitCenter: new THREE.Vector3(baseX, 0, baseZ),
					orbitRadius: SCHMETTERLINGE.FLY_RADIUS_MIN + Math.random() * (SCHMETTERLINGE.FLY_RADIUS_MAX - SCHMETTERLINGE.FLY_RADIUS_MIN),
					speed: SCHMETTERLINGE.SPEED_MIN + Math.random() * (SCHMETTERLINGE.SPEED_MAX - SCHMETTERLINGE.SPEED_MIN),
					phase: Math.random() * Math.PI * 2,
					heightBase: SCHMETTERLINGE.HEIGHT_BASE_MIN + Math.random() * (SCHMETTERLINGE.HEIGHT_BASE_MAX - SCHMETTERLINGE.HEIGHT_BASE_MIN),
					heightRange: SCHMETTERLINGE.HEIGHT_RANGE_MIN + Math.random() * (SCHMETTERLINGE.HEIGHT_RANGE_MAX - SCHMETTERLINGE.HEIGHT_RANGE_MIN),
				});
			}

			loading = false;
		}

		loadAll().catch((err) => {
			console.error("Fehler:", err);
			loading = false;
		});

		addEventListener("keydown", (e) => onKey(e, true));
		addEventListener("keyup", (e) => onKey(e, false));

		const clock = new THREE.Clock();

		function animate(time: number) {
			const dt = clock.getDelta();
			const elapsed = clock.getElapsedTime();
			const forward = new THREE.Vector3();
			camera.getWorldDirection(forward);
			forward.y = 0;
			forward.normalize();
			const right = new THREE.Vector3();
			right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

			const move = new THREE.Vector3();
			if (keys.w) move.add(forward);
			if (keys.s) move.sub(forward);
			if (keys.d) move.add(right);
			if (keys.a) move.sub(right);
			if (move.length() > 0) {
				move.normalize().multiplyScalar(SPEED * dt);
				camera.position.add(move);
				controls.target.add(move);
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
			effect.render(scene, camera, elapsed);
			animationId = requestAnimationFrame(animate);
		}

		animationId = requestAnimationFrame(animate);

		const resizeObserver = new ResizeObserver(() => {
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			renderer.setSize(w, h);
			effect.resize(w, h);
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
		effect?.dispose();
		pheromones?.dispose();
		meadow?.dispose();
		sky?.dispose();
		for (const bee of bees) {
			bee.group.parent?.remove(bee.group);
		}
		for (const butterfly of butterflies) {
			butterfly.group.parent?.remove(butterfly.group);
		}
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>Insekten-Welt</h1>
		<p class="desc">Wiese · Blumen · Bienen · Schmetterlinge · Stadt · Pheromonspuren · Facettenauge</p>
		{#if loading}
			<p class="loading">Lade Modelle …</p>
		{/if}
		<div class="legend">
			<span class="legend-item" style="color: #ff6b9d">● Alba Armeria</span>
			<span class="legend-item" style="color: #e74c3c">● Spider Lily</span>
			<span class="legend-item" style="color: #bb86fc">● Lungwort</span>
		</div>
		<p class="hint">WASD = Bewegen</p>
	</div>
</div>
<TestNav currentSlug="erlebnis" />

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
		gap: 6px;
	}

	.ui-overlay h1 {
		color: white;
		font-size: 1.2rem;
		font-weight: 600;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
		margin: 0;
	}

	.desc {
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.75rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}

	.loading {
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.85rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}

	.legend {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.legend-item {
		font-size: 0.75rem;
		font-weight: 500;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
	}

	.hint {
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.65rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
</style>
