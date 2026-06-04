import * as THREE from "three";

export interface SkyVariant {
	name: string;
	skyTop: string;
	skyBottom: string;
	sunColor: string;
	sunIntensity: number;
	sunPosition: [number, number, number];
	ambientColor: string;
	ambientIntensity: number;
	hemiColor: string;
	hemiGround: string;
	hemiIntensity: number;
	cloudCount: number;
	cloudHeightMin: number;
	cloudHeightMax: number;
}

export const SKY_VARIANTS: SkyVariant[] = [
	{
		name: "Sonnig & klar",
		skyTop: "#3a80c9",
		skyBottom: "#a8c8e8",
		sunColor: "#fff5e0",
		sunIntensity: 2.5,
		sunPosition: [10, 18, 5],
		ambientColor: "#8aadcc",
		ambientIntensity: 0.4,
		hemiColor: "#87ceeb",
		hemiGround: "#5a7a4a",
		hemiIntensity: 0.3,
		cloudCount: 14,
		cloudHeightMin: 12,
		cloudHeightMax: 20,
	},
	{
		name: "Leicht bewölkt",
		skyTop: "#4a8ac5",
		skyBottom: "#b8cce0",
		sunColor: "#ffe8c8",
		sunIntensity: 1.8,
		sunPosition: [8, 14, 12],
		ambientColor: "#99bbcc",
		ambientIntensity: 0.5,
		hemiColor: "#99ccee",
		hemiGround: "#5a7a4a",
		hemiIntensity: 0.4,
		cloudCount: 28,
		cloudHeightMin: 10,
		cloudHeightMax: 18,
	},
	{
		name: "Warme Morgensonne",
		skyTop: "#e09050",
		skyBottom: "#f5d8b8",
		sunColor: "#ffcc77",
		sunIntensity: 2.0,
		sunPosition: [-5, 6, 15],
		ambientColor: "#ccaa88",
		ambientIntensity: 0.35,
		hemiColor: "#ffcc88",
		hemiGround: "#7a6a4a",
		hemiIntensity: 0.3,
		cloudCount: 18,
		cloudHeightMin: 10,
		cloudHeightMax: 18,
	},
	{
		name: "Strahlend blau",
		skyTop: "#2060a0",
		skyBottom: "#90bae8",
		sunColor: "#fff8ee",
		sunIntensity: 3.0,
		sunPosition: [12, 22, 2],
		ambientColor: "#7799bb",
		ambientIntensity: 0.3,
		hemiColor: "#77aaee",
		hemiGround: "#4a6a3a",
		hemiIntensity: 0.25,
		cloudCount: 8,
		cloudHeightMin: 14,
		cloudHeightMax: 22,
	},
];

function hash3(ix: number, iy: number, iz: number): number {
	let h = ix * 374761393 + iy * 668265263 + iz * 1274126177;
	h = (h ^ (h >> 13)) * 1274126177;
	h = h ^ (h >> 16);
	return (h & 0x7fffffff) / 0x7fffffff;
}

function smoothstep(t: number): number {
	return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function valueNoise3D(x: number, y: number, z: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const iz = Math.floor(z);
	const fx = x - ix;
	const fy = y - iy;
	const fz = z - iz;
	const sx = smoothstep(fx);
	const sy = smoothstep(fy);
	const sz = smoothstep(fz);

	const n000 = hash3(ix, iy, iz);
	const n100 = hash3(ix + 1, iy, iz);
	const n010 = hash3(ix, iy + 1, iz);
	const n110 = hash3(ix + 1, iy + 1, iz);
	const n001 = hash3(ix, iy, iz + 1);
	const n101 = hash3(ix + 1, iy, iz + 1);
	const n011 = hash3(ix, iy + 1, iz + 1);
	const n111 = hash3(ix + 1, iy + 1, iz + 1);

	return lerp(
		lerp(lerp(n000, n100, sx), lerp(n010, n110, sx), sy),
		lerp(lerp(n001, n101, sx), lerp(n011, n111, sx), sy),
		sz,
	);
}

function fbm(x: number, y: number, z: number, octaves: number = 4): number {
	let value = 0;
	let amplitude = 1;
	let frequency = 1;
	let maxVal = 0;
	for (let i = 0; i < octaves; i++) {
		value += amplitude * valueNoise3D(x * frequency, y * frequency, z * frequency);
		maxVal += amplitude;
		amplitude *= 0.5;
		frequency *= 2;
	}
	return value / maxVal;
}

const CLOUD_SEEDS = [137, 421, 733, 991, 1193, 1559, 1787, 2011];

function createCloudGeometry(seed: number): THREE.BufferGeometry {
	const widthSegs = 36;
	const heightSegs = 26;
	const geo = new THREE.SphereGeometry(1, widthSegs, heightSegs);
	const pos = geo.attributes.position as THREE.Float32BufferAttribute;
	const colors = new Float32Array(pos.count * 3);

	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const z = pos.getZ(i);

		const len = Math.sqrt(x * x + y * y + z * z);
		const nx = x / len;
		const ny = y / len;
		const nz = z / len;

		const noiseVal = fbm(
			nx * 2.5 + seed * 0.01,
			ny * 2.5 + seed * 0.013,
			nz * 2.5 + seed * 0.017,
			4,
		);

		const baseRadius = 0.5 + noiseVal * 0.5;
		const bottom = Math.max(0, Math.min(1, (ny + 1) * 1.8));
		const flattenBottom = 0.3 + bottom * 0.7;
		const radius = baseRadius * flattenBottom;

		pos.setXYZ(i, nx * radius, ny * radius, nz * radius);

		const grayTone = 0.6 + Math.max(0, ny) * 0.4;
		colors[i * 3] = grayTone;
		colors[i * 3 + 1] = grayTone;
		colors[i * 3 + 2] = grayTone;
	}

	pos.needsUpdate = true;
	geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
	geo.computeVertexNormals();
	return geo;
}

const cloudGeometries: THREE.BufferGeometry[] = CLOUD_SEEDS.map(createCloudGeometry);

function pickCloudGeometry(): THREE.BufferGeometry {
	const idx = Math.floor(Math.random() * cloudGeometries.length);
	return cloudGeometries[idx].clone();
}

export class SkyScene {
	private scene: THREE.Scene;
	private skyDome: THREE.Mesh | null = null;
	private sunLight: THREE.DirectionalLight | null = null;
	private ambientLight: THREE.AmbientLight | null = null;
	private hemiLight: THREE.HemisphereLight | null = null;
	private sunSphere: THREE.Mesh | null = null;
	private cloudMeshes: THREE.Mesh[] = [];
	private isSetup = false;

	constructor(scene: THREE.Scene) {
		this.scene = scene;
	}

	build(variantIndex: number = 0): void {
		if (this.isSetup) this.reset();
		this.isSetup = true;

		const variant = SKY_VARIANTS[variantIndex] ?? SKY_VARIANTS[0];

		this.ambientLight = new THREE.AmbientLight(
			new THREE.Color(variant.ambientColor),
			variant.ambientIntensity,
		);
		this.scene.add(this.ambientLight);

		this.hemiLight = new THREE.HemisphereLight(
			new THREE.Color(variant.hemiColor),
			new THREE.Color(variant.hemiGround),
			variant.hemiIntensity,
		);
		this.scene.add(this.hemiLight);

		this.sunLight = new THREE.DirectionalLight(
			new THREE.Color(variant.sunColor),
			variant.sunIntensity,
		);
		this.sunLight.position.set(...variant.sunPosition);
		this.sunLight.castShadow = true;
		this.sunLight.shadow.mapSize.set(1024, 1024);
		this.sunLight.shadow.camera.left = -20;
		this.sunLight.shadow.camera.right = 20;
		this.sunLight.shadow.camera.top = 20;
		this.sunLight.shadow.camera.bottom = -20;
		this.sunLight.shadow.camera.near = 0.5;
		this.sunLight.shadow.camera.far = 40;
		this.scene.add(this.sunLight);

		const canvas = document.createElement("canvas");
		canvas.width = 2;
		canvas.height = 256;
		const ctx = canvas.getContext("2d")!;
		const topColor = new THREE.Color(variant.skyTop);
		const bottomColor = new THREE.Color(variant.skyBottom);
		const grad = ctx.createLinearGradient(0, 0, 0, 256);
		grad.addColorStop(0, `#${topColor.getHexString()}`);
		grad.addColorStop(1, `#${bottomColor.getHexString()}`);
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 2, 256);

		const tex = new THREE.CanvasTexture(canvas);
		tex.magFilter = THREE.LinearFilter;
		tex.minFilter = THREE.LinearMipmapLinearFilter;

		const domeGeo = new THREE.SphereGeometry(80, 32, 32);
		const domeMat = new THREE.ShaderMaterial({
			side: THREE.BackSide,
			uniforms: {
				uGradient: { value: tex },
			},
			vertexShader: `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: `
				uniform sampler2D uGradient;
				varying vec2 vUv;
				void main() {
					gl_FragColor = texture2D(uGradient, vec2(0.5, vUv.y));
				}
			`,
		});
		this.skyDome = new THREE.Mesh(domeGeo, domeMat);
		this.scene.add(this.skyDome);

		const sunGeo = new THREE.SphereGeometry(0.5, 16, 16);
		const sunMat = new THREE.MeshBasicMaterial({ color: variant.sunColor });
		this.sunSphere = new THREE.Mesh(sunGeo, sunMat);
		const sunPos = variant.sunPosition;
		const sunDir = new THREE.Vector3(...sunPos).normalize();
		this.sunSphere.position.copy(sunDir.multiplyScalar(50));
		this.scene.add(this.sunSphere);

		const count = variant.cloudCount;
		const clusterCount = Math.max(3, Math.round(count / 2.5));

		const clusterPositions: { angle: number; dist: number; height: number }[] = [];
		for (let c = 0; c < clusterCount; c++) {
			const angle = (c / clusterCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
			const dist = 14 + Math.random() * 38;
			const height = variant.cloudHeightMin + Math.random() * (variant.cloudHeightMax - variant.cloudHeightMin) + (Math.random() - 0.5) * 3;
			clusterPositions.push({ angle, dist, height });
		}

		for (let i = 0; i < count; i++) {
			const geo = pickCloudGeometry();
			const cluster = clusterPositions[i % clusterCount];

			const offsetAngle = (Math.random() - 0.5) * 0.35;
			const offsetDist = (Math.random() - 0.5) * 6;
			const angle = cluster.angle + offsetAngle;
			const dist = Math.max(2, cluster.dist + offsetDist);
			const height = cluster.height + (Math.random() - 0.5) * 2;

			const isSoft = Math.random() < 0.4;
			const opacity = isSoft ? 0.25 + Math.random() * 0.2 : 0.55 + Math.random() * 0.35;
			const roughness = isSoft ? 0.98 : 0.85 + Math.random() * 0.1;
			const mat = new THREE.MeshStandardMaterial({
				color: 0xffffff,
				roughness,
				metalness: 0,
				transparent: true,
				opacity,
				depthWrite: false,
				vertexColors: true,
			});
			const mesh = new THREE.Mesh(geo, mat);

			const scale = 1.5 + Math.random() * 3.5;

			mesh.position.set(Math.cos(angle) * dist, height, Math.sin(angle) * dist);
			mesh.scale.set(scale, scale * (0.35 + Math.random() * 0.3), scale);
			mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
			mesh.castShadow = false;
			mesh.receiveShadow = false;

			this.cloudMeshes.push(mesh);
			this.scene.add(mesh);
		}

		this.scene.background = new THREE.Color(variant.skyBottom);
		this.scene.fog = new THREE.Fog(variant.skyBottom, 30, 80);
	}

	switchVariant(index: number): void {
		this.reset();
		this.build(index);
	}

	tick(_elapsed: number): void {
		// clouds could drift slowly here
	}

	private reset(): void {
		for (const mesh of this.cloudMeshes) {
			this.scene.remove(mesh);
			mesh.geometry.dispose();
			if (mesh.material instanceof THREE.Material) mesh.material.dispose();
		}
		this.cloudMeshes = [];

		if (this.skyDome) {
			this.scene.remove(this.skyDome);
			this.skyDome.geometry.dispose();
			if (this.skyDome.material instanceof THREE.Material) this.skyDome.material.dispose();
			this.skyDome = null;
		}
		if (this.sunSphere) {
			this.scene.remove(this.sunSphere);
			this.sunSphere.geometry.dispose();
			if (this.sunSphere.material instanceof THREE.Material) this.sunSphere.material.dispose();
			this.sunSphere = null;
		}
		if (this.sunLight) {
			this.scene.remove(this.sunLight);
			this.sunLight = null;
		}
		if (this.ambientLight) {
			this.scene.remove(this.ambientLight);
			this.ambientLight = null;
		}
		if (this.hemiLight) {
			this.scene.remove(this.hemiLight);
			this.hemiLight = null;
		}
		this.scene.fog = null;
		this.scene.background = null;
		this.isSetup = false;
	}

	dispose(): void {
		this.reset();
	}
}
