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
	cloudColor: string;
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
		cloudColor: "#ffffff",
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
		cloudColor: "#e8e8f0",
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
		cloudColor: "#f0dcc0",
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
		cloudColor: "#ffffff",
	},
];

function createCloudGeometry(
	segments: number = 3,
): THREE.BufferGeometry {
	const group = new THREE.Group();
	for (let i = 0; i < segments; i++) {
		const r = 0.3 + Math.random() * 0.5;
		const geo = new THREE.SphereGeometry(r, 6, 5);
		const pos = new THREE.Vector3(
			(Math.random() - 0.5) * 1.2,
			Math.random() * 0.15,
			(Math.random() - 0.5) * 0.6,
		);
		const mesh = new THREE.Mesh(geo);
		mesh.position.copy(pos);
		mesh.scale.y = 0.5 + Math.random() * 0.3;
		group.add(mesh);
	}
	group.updateMatrixWorld(true);

	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];

	group.traverse((child) => {
		if (!(child instanceof THREE.Mesh)) return;
		const geo = child.geometry;
		const pos = geo.attributes.position;
		const nor = geo.attributes.normal;
		const uv = geo.attributes.uv;
		const matrix = child.matrixWorld;

		for (let i = 0; i < pos.count; i++) {
			const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
			const n = new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i));
			p.applyMatrix4(matrix);
			n.applyMatrix4(matrix).normalize();
			positions.push(p.x, p.y, p.z);
			normals.push(n.x, n.y, n.z);
			const u = uv?.getX(i) ?? 0;
			const v = uv?.getY(i) ?? 0;
			uvs.push(u, v);
		}
	});

	const merged = new THREE.BufferGeometry();
	merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
	merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	return merged;
}

export class SkyScene {
	private scene: THREE.Scene;
	private skyDome: THREE.Mesh | null = null;
	private sunLight: THREE.DirectionalLight;
	private ambientLight: THREE.AmbientLight;
	private hemiLight: THREE.HemisphereLight;
	private clouds: THREE.InstancedMesh | null = null;
	private cloudGeo: THREE.BufferGeometry | null = null;
	private cloudMat: THREE.MeshStandardMaterial | null = null;
	private sunSphere: THREE.Mesh | null = null;
	private isSetup = false;

	constructor(scene: THREE.Scene) {
		this.scene = scene;
		this.ambientLight = new THREE.AmbientLight(0x8899bb, 0.4);
		this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.3);
		this.sunLight = new THREE.DirectionalLight(0xfff4e0, 2.5);
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

		this.cloudGeo = createCloudGeometry(4);
		const cloudCount = 20 + Math.round(variant.cloudCoverage * 80);
		this.cloudMat = new THREE.MeshStandardMaterial({
			color: variant.cloudColor,
			roughness: 0.8,
			flatShading: true,
			transparent: true,
			opacity: 0.85,
		});

		const dummy = new THREE.Object3D();
		this.clouds = new THREE.InstancedMesh(this.cloudGeo, this.cloudMat, cloudCount);

		for (let i = 0; i < cloudCount; i++) {
			const angle = Math.random() * Math.PI * 2;
			const dist = 15 + Math.random() * 35;
			const y = 5 + Math.random() * 12;
			const scale = 0.8 + Math.random() * 2.0;

			dummy.position.set(Math.cos(angle) * dist, y, Math.sin(angle) * dist);
			dummy.scale.set(scale, scale * 0.3, scale);
			dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
			dummy.updateMatrix();
			this.clouds.setMatrixAt(i, dummy.matrix);
		}
		this.clouds.instanceMatrix.needsUpdate = true;
		this.clouds.castShadow = false;
		this.scene.add(this.clouds);

		this.scene.background = new THREE.Color(variant.skyBottom);
		this.scene.fog = new THREE.Fog(variant.skyBottom, 30, 80);
	}

	switchVariant(index: number): void {
		this.reset();
		this.build(index);
	}

	tick(_elapsed: number): void {
		if (!this.clouds) return;
		// clouds could drift slowly here
	}

	private reset(): void {
		const toRemove: THREE.Object3D[] = [];
		this.scene.traverse((child) => {
			if (
				child instanceof THREE.Mesh ||
				child instanceof THREE.Light
			) {
				toRemove.push(child);
			}
		});
		for (const obj of toRemove) {
			this.scene.remove(obj);
			if (obj instanceof THREE.Mesh) {
				obj.geometry.dispose();
				if (obj.material instanceof THREE.Material) obj.material.dispose();
			}
		}
		this.scene.fog = null;
		this.scene.background = null;
		this.skyDome = null;
		this.sunSphere = null;
		this.clouds = null;
		this.isSetup = false;
	}

	dispose(): void {
		this.reset();
		if (this.cloudGeo) this.cloudGeo.dispose();
		if (this.cloudMat) this.cloudMat.dispose();
		this.cloudGeo = null;
		this.cloudMat = null;
	}
}
