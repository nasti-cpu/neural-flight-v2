<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;

	let animationId: number;
	let grassMesh: THREE.InstancedMesh | null = null;
	let grassMat: THREE.MeshStandardMaterial | null = null;
	let grassGeo: THREE.BufferGeometry | null = null;

	const dummy = new THREE.Object3D();
	const GRASS_COUNT = 5000;
	const FIELD_SIZE = 45;

	const swayData: {
		baseX: number;
		baseZ: number;
		baseRotY: number;
		phase: number;
		speed: number;
		height: number;
		scaleX: number;
		scaleZ: number;
	}[] = [];

	function buildMeadow() {
		const grassColor = "#6aaf4c";

		const groundGeo = new THREE.PlaneGeometry(FIELD_SIZE + 20, FIELD_SIZE + 20);
		const groundMat = new THREE.MeshStandardMaterial({ color: grassColor, roughness: 1 });
		const ground = new THREE.Mesh(groundGeo, groundMat);
		ground.rotation.x = -Math.PI / 2;
		ground.position.y = -0.05;
		ground.receiveShadow = true;
		scene.add(ground);

		const bumpGeo = new THREE.PlaneGeometry(3, 2, 6, 4);
		const bumpMat = new THREE.MeshStandardMaterial({ color: grassColor, roughness: 1 });
		for (let i = 0; i < 12; i++) {
			const bump = new THREE.Mesh(bumpGeo, bumpMat);
			const angle = Math.random() * Math.PI * 2;
			const dist = 3 + Math.random() * 14;
			bump.rotation.x = -Math.PI / 2;
			bump.position.set(Math.cos(angle) * dist, -0.02, Math.sin(angle) * dist);
			bump.scale.set(1, 1, 0.4 + Math.random() * 0.8);
			scene.add(bump);
		}

		grassGeo = new THREE.ConeGeometry(0.06, 1, 4);
		grassMat = new THREE.MeshStandardMaterial({
			color: grassColor,
			roughness: 0.9,
			flatShading: true,
		});

		grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
		grassMesh.castShadow = true;
		grassMesh.receiveShadow = true;

		for (let i = 0; i < GRASS_COUNT; i++) {
			const x = (Math.random() - 0.5) * FIELD_SIZE;
			const z = (Math.random() - 0.5) * FIELD_SIZE;
			const height = 0.8 + Math.random() * 2.0;
			const baseRotY = Math.random() * Math.PI * 2;
			const sx = 0.5 + Math.random() * 0.8;
			const sz = 0.5 + Math.random() * 0.8;

			dummy.position.set(x, height / 2, z);
			dummy.scale.set(sx, height, sz);
			dummy.rotation.set(0, baseRotY, 0);
			dummy.updateMatrix();
			grassMesh.setMatrixAt(i, dummy.matrix);

			swayData.push({
				baseX: x,
				baseZ: z,
				baseRotY,
				phase: Math.random() * Math.PI * 2,
				speed: 0.5 + Math.random() * 1.5,
				height,
				scaleX: sx,
				scaleZ: sz,
			});
		}
		grassMesh.instanceMatrix.needsUpdate = true;
		scene.add(grassMesh);
	}

	function disposeMeadow() {
		if (grassMesh) {
			scene.remove(grassMesh);
			if (grassGeo) grassGeo.dispose();
			if (grassMat) grassMat.dispose();
			grassMesh = null;
			grassGeo = null;
			grassMat = null;
		}
		swayData.length = 0;

		const toRemove: THREE.Object3D[] = [];
		scene.traverse((child) => {
			if (child instanceof THREE.Mesh && child !== scene) {
				toRemove.push(child);
			}
		});
		for (const obj of toRemove) {
			scene.remove(obj);
			if (obj instanceof THREE.Mesh) {
				obj.geometry.dispose();
				if (obj.material instanceof THREE.Material) obj.material.dispose();
			}
		}
	}

	onMount(() => {
		scene = new THREE.Scene();
		scene.background = new THREE.Color("#a8d8ea");
		scene.fog = new THREE.Fog("#a8d8ea", 25, 60);

		camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
		camera.position.set(8, 6, 12);
		camera.lookAt(0, 0, 0);

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

		buildMeadow();

		function animate(time: number) {
			const elapsed = time * 0.001;
			const windDir = Math.sin(elapsed * 0.04) * 0.3;

			if (grassMesh) {
				for (let i = 0; i < GRASS_COUNT; i++) {
					const d = swayData[i];
					if (!d) continue;

					const swayX = Math.sin(elapsed * d.speed + d.phase + d.baseX * 0.5) * 0.06;
					const swayZ = Math.sin(elapsed * d.speed * 0.7 + d.phase + d.baseZ * 0.5) * 0.04;

					dummy.position.set(d.baseX, d.height / 2, d.baseZ);
					dummy.scale.set(d.scaleX, d.height, d.scaleZ);
					dummy.rotation.set(swayZ * 0.5, d.baseRotY, swayX + windDir * 0.08);
					dummy.updateMatrix();
					grassMesh.setMatrixAt(i, dummy.matrix);
				}
				grassMesh.instanceMatrix.needsUpdate = true;
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
		disposeMeadow();
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🌿 Wiese — hohes Gras im Wind</h1>
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
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

	.hint {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.75rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
</style>
