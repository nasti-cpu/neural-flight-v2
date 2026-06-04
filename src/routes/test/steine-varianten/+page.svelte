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

	let variantIndex = $state(0);

	interface StoneVariant {
		name: string;
		color: THREE.ColorRepresentation;
		colorVar: number;
		roughness: number;
		metalness: number;
		detail: number;
		noiseScale: number;
		noiseAmp: number;
		scaleRange: [number, number];
		count: number;
	}

	const VARIANTS: StoneVariant[] = [
		{
			name: "Flusskiesel",
			color: "#b8b0a8",
			colorVar: 0.08,
			roughness: 0.5,
			metalness: 0,
			detail: 3,
			noiseScale: 3.5,
			noiseAmp: 0.06,
			scaleRange: [0.15, 0.45],
			count: 25,
		},
		{
			name: "Granitbrocken",
			color: "#6a6a72",
			colorVar: 0.1,
			roughness: 0.6,
			metalness: 0.1,
			detail: 3,
			noiseScale: 3.5,
			noiseAmp: 0.06,
			scaleRange: [0.15, 0.45],
			count: 22,
		},
		{
			name: "Sandstein",
			color: "#c4b49c",
			colorVar: 0.05,
			roughness: 0.7,
			metalness: 0,
			detail: 3,
			noiseScale: 3.5,
			noiseAmp: 0.06,
			scaleRange: [0.15, 0.45],
			count: 22,
		},
		{
			name: "Basalt",
			color: "#383840",
			colorVar: 0.04,
			roughness: 0.55,
			metalness: 0.05,
			detail: 3,
			noiseScale: 3.5,
			noiseAmp: 0.06,
			scaleRange: [0.15, 0.45],
			count: 25,
		},
		{
			name: "Kalkstein",
			color: "#d4d0c8",
			colorVar: 0.05,
			roughness: 0.65,
			metalness: 0,
			detail: 3,
			noiseScale: 3.5,
			noiseAmp: 0.06,
			scaleRange: [0.15, 0.45],
			count: 22,
		},
		{
			name: "Marmor",
			color: "#e0dcd4",
			colorVar: 0.12,
			roughness: 0.25,
			metalness: 0.05,
			detail: 3,
			noiseScale: 3.5,
			noiseAmp: 0.06,
			scaleRange: [0.15, 0.45],
			count: 25,
		},
	];

	let stoneMeshes: THREE.InstancedMesh[] = [];

	function smoothNoise(p: THREE.Vector3): number {
		let v = 0;
		v += Math.sin(p.x * 1.3 + p.y * 2.7 + p.z * 3.1) * 0.5;
		v += Math.sin(p.x * 4.1 + p.y * 0.7 + p.z * 5.3) * 0.25;
		v += Math.sin(p.x * 7.5 + p.y * 9.2 + p.z * 2.9) * 0.125;
		v += Math.sin(p.x * 12.3 + p.y * 6.1 + p.z * 8.7) * 0.0625;
		return v;
	}

	function createProceduralStone(params: StoneVariant): THREE.BufferGeometry {
		const geo = new THREE.IcosahedronGeometry(1, params.detail);

		const pos = geo.attributes.position;
		const vertex = new THREE.Vector3();
		const noisePos = new THREE.Vector3();
		const colors: number[] = [];

		const baseColor = new THREE.Color(params.color);

		for (let i = 0; i < pos.count; i++) {
			vertex.fromBufferAttribute(pos, i).normalize();
			noisePos.copy(vertex).multiplyScalar(params.noiseScale);
			const n = smoothNoise(noisePos);
			const displace = n * params.noiseAmp;
			vertex.multiplyScalar(1 + displace);
			pos.setXYZ(i, vertex.x, vertex.y, vertex.z);

			const variation = 1 + (Math.random() - 0.5) * params.colorVar * 2;
			const c = baseColor.clone().multiplyScalar(variation);
			colors.push(c.r, c.g, c.b);
		}
		pos.needsUpdate = true;
		geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
		geo.computeVertexNormals();
		return geo;
	}

	function buildVariant(index: number) {
		for (const m of stoneMeshes) {
			scene.remove(m);
			m.geometry.dispose();
			if (Array.isArray(m.material)) {
				m.material.forEach((mat) => mat.dispose());
			} else {
				m.material.dispose();
			}
		}
		stoneMeshes = [];

		const variant = VARIANTS[index];
		const geo = createProceduralStone(variant);
		const mat = new THREE.MeshStandardMaterial({
			color: variant.color,
			roughness: variant.roughness,
			metalness: variant.metalness,
			vertexColors: true,
			flatShading: false,
		});

		const count = variant.count;
		const mesh = new THREE.InstancedMesh(geo, mat, count);
		mesh.castShadow = true;
		mesh.receiveShadow = true;

		const dummy = new THREE.Object3D();
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const dist = 2 + Math.random() * 16;
			const s = variant.scaleRange[0] + Math.random() * (variant.scaleRange[1] - variant.scaleRange[0]);
			dummy.position.set(Math.cos(angle) * dist, -0.02, Math.sin(angle) * dist);
			dummy.scale.set(s, s * (0.7 + Math.random() * 0.6), s * (0.7 + Math.random() * 0.6));
			dummy.rotation.set(
				(Math.random() - 0.5) * 0.4,
				Math.random() * Math.PI * 2,
				(Math.random() - 0.5) * 0.4,
			);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
		scene.add(mesh);
		stoneMeshes = [mesh];
	}

	onMount(() => {
		scene = new THREE.Scene();
		scene.background = new THREE.Color("#c8d8e8");

		camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 60);
		camera.position.set(8, 5, 12);

		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(canvas.clientWidth, canvas.clientHeight);
		renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 0.5, 0);
		controls.maxPolarAngle = Math.PI / 2.05;
		controls.minDistance = 2;
		controls.maxDistance = 30;
		controls.update();

		const groundGeo = new THREE.CircleGeometry(25, 64);
		const groundMat = new THREE.MeshStandardMaterial({
			color: "#7a8a6a",
			roughness: 0.9,
			metalness: 0,
		});
		const ground = new THREE.Mesh(groundGeo, groundMat);
		ground.rotation.x = -Math.PI / 2;
		ground.receiveShadow = true;
		scene.add(ground);

		const ambient = new THREE.AmbientLight(0x8899aa, 0.5);
		scene.add(ambient);

		const sun = new THREE.DirectionalLight(0xffeedd, 1.8);
		sun.position.set(10, 15, 8);
		sun.castShadow = true;
		sun.shadow.mapSize.set(1024, 1024);
		sun.shadow.camera.near = 0.1;
		sun.shadow.camera.far = 40;
		sun.shadow.camera.left = -15;
		sun.shadow.camera.right = 15;
		sun.shadow.camera.top = 15;
		sun.shadow.camera.bottom = -15;
		scene.add(sun);

		const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a5f3a, 0.6);
		scene.add(hemi);

		scene.fog = new THREE.Fog("#c8d8e8", 20, 40);

		buildVariant(0);

		function animate(time: number) {
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

	function selectVariant(index: number) {
		variantIndex = index;
		buildVariant(index);
	}

	onDestroy(() => {
		if (!browser) return;
		cancelAnimationFrame(animationId);
		for (const m of stoneMeshes) {
			m.geometry.dispose();
			if (Array.isArray(m.material)) {
				m.material.forEach((mat) => mat.dispose());
			} else {
				m.material.dispose();
			}
		}
		renderer?.dispose();
		controls?.dispose();
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🪨 Stein-Varianten</h1>
		<p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
	</div>

	<div class="toolbar">
		{#each VARIANTS as variant, i}
			<button
				class="variant-btn"
				class:active={variantIndex === i}
				onclick={() => selectVariant(i)}
			>
				<span class="swatch" style="background: {variant.color}"></span>
				<span class="label">{variant.name}</span>
			</button>
		{/each}
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
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		text-align: center;
		pointer-events: none;
		font-family: system-ui, -apple-system, sans-serif;
	}

	.ui-overlay h1 {
		color: white;
		font-size: 1.1rem;
		font-weight: 600;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
		margin: 0 0 2px;
	}

	.hint {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.7rem;
		margin: 0;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
	}

	.toolbar {
		position: absolute;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		justify-content: center;
		max-width: 90vw;
		pointer-events: auto;
	}

	.variant-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.4);
		color: rgba(255, 255, 255, 0.85);
		font-family: system-ui, -apple-system, sans-serif;
		font-size: 0.78rem;
		cursor: pointer;
		backdrop-filter: blur(6px);
		transition: all 0.15s;
	}

	.variant-btn:hover {
		border-color: rgba(255, 255, 255, 0.7);
		background: rgba(0, 0, 0, 0.55);
	}

	.variant-btn.active {
		border-color: #ffcc44;
		background: rgba(0, 0, 0, 0.65);
		box-shadow: 0 0 12px rgba(255, 204, 68, 0.3);
	}

	.swatch {
		display: inline-block;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.2);
		flex-shrink: 0;
	}

	.label {
		white-space: nowrap;
	}
</style>
