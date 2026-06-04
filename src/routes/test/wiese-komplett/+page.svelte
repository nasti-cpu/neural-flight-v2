<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
	import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
	import { GrassMeadow } from "$lib/experiences/insect-world/Biome/Wiese/grass-test";
	import { SkyScene, SKY_VARIANTS } from "$lib/experiences/insect-world/Biome/blauer Himmel/sky-test";
	import { CITY } from "$lib/experiences/insect-world/Objekte/Stadt/city";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let sky: SkyScene;
	let meadow: GrassMeadow;
	let animationId: number;
	let loading = $state(true);
	let bees: Bee[] = [];

	const dummy = new THREE.Object3D();
	const keys = { w: false, a: false, s: false, d: false };
	const SPEED = 5;

	const BEE_COUNT = 15;
	const BEE_SCALE = 0.03;

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
			const [armeriaScene, spiderScene, lungwortScene, cityScene, beeScene] = await Promise.all([
				loadGLB("/models/blumen/glb_Alba_Armeria_Spring_Pink.glb"),
				loadGLB("/models/blumen/spider_lily_lycoris_radiata.glb"),
				loadGLB("/models/blumen/Lungwort Spring.glb"),
				loadGLB(CITY.MODEL),
				loadGLB("/models/bienen/Meshy_AI_Honeybee_0604154325_texture.glb"),
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
					}
					mesh.instanceMatrix.needsUpdate = true;
					scene.add(mesh);
					flowerMeshes.push(mesh);
				}
			}

			scatterFlower(armeriaParts, 0.025, [0.5, 1.5], 25);
			scatterFlower(spiderParts, 1.7, [0.6, 1.6], 25);
			scatterFlower(lungwortParts, 0.025, [0.5, 1.5], 25);

			cityScene.scale.setScalar(CITY.SCALE);
			cityScene.position.set(CITY.POSITION.x, CITY.POSITION.y, CITY.POSITION.z);
			cityScene.rotation.y = CITY.ROTATION_Y;
			scene.add(cityScene);

			meadow.clearArea(CITY.CLEAR.CENTER.x, CITY.CLEAR.CENTER.z, CITY.CLEAR.RADIUS);
			clearInstancesInRect(flowerMeshes, CITY.CLEAR.CENTER.x, CITY.CLEAR.CENTER.z, CITY.CLEAR.RECT.hw,
				CITY.CLEAR.RECT.hd, CITY.CLEAR.RECT.angle, CITY.CLEAR.RECT.border);

			const beeTemplate = new THREE.Group();
			beeScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					const clone = child.clone();
					clone.castShadow = true;
					clone.receiveShadow = true;
					beeTemplate.add(clone);
				}
			});

			for (let i = 0; i < BEE_COUNT; i++) {
				const group = new THREE.Group();
				group.add(beeTemplate.clone(true));

				const angle = Math.random() * Math.PI * 2;
				const dist = 2 + Math.random() * 8;
				const baseX = Math.cos(angle) * dist;
				const baseZ = Math.sin(angle) * dist;

				group.position.set(baseX, 1 + Math.random() * 2, baseZ);
				group.scale.setScalar(BEE_SCALE);
				group.rotation.y = Math.random() * Math.PI * 2;

				scene.add(group);

				bees.push({
					group,
					orbitCenter: new THREE.Vector3(baseX, 0, baseZ),
					orbitRadius: 1 + Math.random() * 3,
					speed: 0.3 + Math.random() * 0.7,
					phase: Math.random() * Math.PI * 2,
					heightBase: 0.8 + Math.random() * 1.5,
					heightRange: 0.3 + Math.random() * 0.5,
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
		sky?.dispose();
		for (const bee of bees) {
			bee.group.parent?.remove(bee.group);
		}
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🌿 Komplette Wiese</h1>
		{#if loading}
			<p class="loading">Lade Blumen-Modelle …</p>
		{/if}
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen • WASD zum Bewegen</p>
	</div>
</div>

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

	.loading {
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.85rem;
		margin: 8px 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}

	.hint {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.75rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
</style>
