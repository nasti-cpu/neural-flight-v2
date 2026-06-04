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
	cloudCoverage: number;
	cloudCount: number;
	cloudHeightMin: number;
	cloudHeightMax: number;
}

export const SKY_VARIANTS: SkyVariant[] = [
	{
		name: "Sonnig & klar",
		skyTop: "#4a90d9",
		skyBottom: "#b8d4f0",
		sunColor: "#fff5e0",
		sunIntensity: 2.5,
		sunPosition: [10, 18, 5],
		ambientColor: "#8aadcc",
		ambientIntensity: 0.4,
		hemiColor: "#87ceeb",
		hemiGround: "#5a7a4a",
		hemiIntensity: 0.3,
		cloudCoverage: 0.2,
		cloudCount: 12,
		cloudHeightMin: 6,
		cloudHeightMax: 14,
	},
	{
		name: "Leicht bewölkt",
		skyTop: "#5b9bd5",
		skyBottom: "#c9dde8",
		sunColor: "#ffe8c8",
		sunIntensity: 1.8,
		sunPosition: [8, 14, 12],
		ambientColor: "#99bbcc",
		ambientIntensity: 0.5,
		hemiColor: "#99ccee",
		hemiGround: "#5a7a4a",
		hemiIntensity: 0.4,
		cloudCoverage: 0.5,
		cloudCount: 28,
		cloudHeightMin: 5,
		cloudHeightMax: 13,
	},
	{
		name: "Warme Morgensonne",
		skyTop: "#f5a060",
		skyBottom: "#fde8c8",
		sunColor: "#ffcc77",
		sunIntensity: 2.0,
		sunPosition: [-5, 6, 15],
		ambientColor: "#ccaa88",
		ambientIntensity: 0.35,
		hemiColor: "#ffcc88",
		hemiGround: "#7a6a4a",
		hemiIntensity: 0.3,
		cloudCoverage: 0.3,
		cloudCount: 18,
		cloudHeightMin: 5,
		cloudHeightMax: 12,
	},
	{
		name: "Strahlend blau",
		skyTop: "#2a6bb0",
		skyBottom: "#a0c8ee",
		sunColor: "#fff8ee",
		sunIntensity: 3.0,
		sunPosition: [12, 22, 2],
		ambientColor: "#7799bb",
		ambientIntensity: 0.3,
		hemiColor: "#77aaee",
		hemiGround: "#4a6a3a",
		hemiIntensity: 0.25,
		cloudCoverage: 0.1,
		cloudCount: 6,
		cloudHeightMin: 7,
		cloudHeightMax: 16,
	},
];

interface PuffDef {
	puffs: [number, number, number, number][];
}

const PUFF_SEED_CONFIGS: PuffDef[] = [
	{ puffs: [[0, 0.4, 0, 1.0], [0.7, 0.6, 0.3, 0.7], [-0.6, 0.5, 0.4, 0.65], [0.3, 0.8, -0.5, 0.6], [-0.4, 0.7, -0.6, 0.55], [0.9, 0.3, -0.3, 0.5], [-0.8, 0.4, -0.2, 0.45]] },
	{ puffs: [[0, 0.3, 0, 0.9], [0.5, 0.5, -0.5, 0.7], [-0.6, 0.4, 0.5, 0.65], [0.8, 0.5, 0.4, 0.55], [-0.3, 0.7, -0.4, 0.5], [-0.7, 0.3, -0.7, 0.45], [0, 0.6, 0.8, 0.5], [0.3, 0.8, 0.2, 0.4]] },
	{ puffs: [[0, 0.5, 0, 1.2], [0.6, 0.7, -0.6, 0.8], [-0.7, 0.6, 0.6, 0.75], [0, 0.9, -0.3, 0.6], [-0.5, 0.8, -0.5, 0.5], [0.5, 0.4, 0.7, 0.5], [1.0, 0.5, 0.2, 0.45], [-0.9, 0.5, 0.1, 0.4], [0, 0.3, -0.9, 0.45]] },
	{ puffs: [[0, 0.3, 0, 0.8], [0.4, 0.5, 0.4, 0.6], [-0.5, 0.4, -0.3, 0.55], [0.7, 0.4, -0.5, 0.5], [-0.3, 0.6, 0.6, 0.45], [-0.7, 0.3, 0.3, 0.4], [0.2, 0.7, -0.6, 0.4], [0.5, 0.7, 0, 0.35]] },
	{ puffs: [[0, 0.4, 0, 1.1], [-0.8, 0.6, 0.2, 0.75], [0.7, 0.5, -0.4, 0.7], [-0.2, 0.8, 0.7, 0.55], [0.4, 0.7, -0.7, 0.5], [-0.6, 0.9, -0.3, 0.45], [0.9, 0.4, 0.5, 0.4], [-0.9, 0.3, -0.5, 0.35], [0.2, 0.5, 0.9, 0.4]] },
];

const SPHERE_SEGMENTS = 7;

function buildCloudGeometry(
	puffDefs: PuffDef,
): THREE.BufferGeometry {
	const tempSphere = new THREE.SphereGeometry(1, SPHERE_SEGMENTS, Math.ceil(SPHERE_SEGMENTS * 0.7));
	const posAttr = tempSphere.attributes.position;
	const norAttr = tempSphere.attributes.normal;
	const uvAttr = tempSphere.attributes.uv;

	const allPos: number[] = [];
	const allNor: number[] = [];
	const allUv: number[] = [];

	for (const [px, py, pz, r] of puffDefs.puffs) {
		for (let i = 0; i < posAttr.count; i++) {
			const x = posAttr.getX(i) * r + px;
			const y = posAttr.getY(i) * r + py;
			const z = posAttr.getZ(i) * r + pz;
			allPos.push(x, y, z);

			const nx = norAttr.getX(i);
			const ny = norAttr.getY(i);
			const nz = norAttr.getZ(i);
			allNor.push(nx, ny, nz);

			allUv.push(uvAttr.getX(i), uvAttr.getY(i));
		}
	}

	tempSphere.dispose();
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(allPos, 3));
	geo.setAttribute("normal", new THREE.Float32BufferAttribute(allNor, 3));
	geo.setAttribute("uv", new THREE.Float32BufferAttribute(allUv, 2));
	return geo;
}

const cloudGeometries: THREE.BufferGeometry[] = PUFF_SEED_CONFIGS.map(buildCloudGeometry);

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

		const sunGeo = new THREE.SphereGeometry(0.5, 12, 12);
		const sunMat = new THREE.MeshBasicMaterial({ color: variant.sunColor });
		this.sunSphere = new THREE.Mesh(sunGeo, sunMat);
		const sunPos = variant.sunPosition;
		const sunDir = new THREE.Vector3(...sunPos).normalize();
		this.sunSphere.position.copy(sunDir.multiplyScalar(50));
		this.scene.add(this.sunSphere);

		for (let i = 0; i < variant.cloudCount; i++) {
			const geo = pickCloudGeometry();
			const shade = 0.85 + Math.random() * 0.15;
			const mat = new THREE.MeshStandardMaterial({
				color: new THREE.Color(shade, shade, shade),
				roughness: 0.3,
				metalness: 0.0,
				flatShading: false,
			});
			const mesh = new THREE.Mesh(geo, mat);

			const angle = Math.random() * Math.PI * 2;
			const dist = 10 + Math.random() * 50;
			const height = variant.cloudHeightMin + Math.random() * (variant.cloudHeightMax - variant.cloudHeightMin);
			const scale = 0.6 + Math.random() * 2.5;

			mesh.position.set(Math.cos(angle) * dist, height, Math.sin(angle) * dist);
			mesh.scale.set(scale, scale * (0.5 + Math.random() * 0.4), scale);
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
