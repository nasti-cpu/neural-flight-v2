import * as THREE from "three";

export interface GrassMeadowConfig {
	fieldSize?: number;
	grassCount?: number;
	curvature?: number;
}

const DEFAULTS: Required<GrassMeadowConfig> = {
	fieldSize: 45,
	grassCount: 5000,
	curvature: 0.0025,
};

const vertexShader = `
	attribute float aPhase;
	attribute float aSpeed;
	attribute float aBaseX;
	attribute float aBaseZ;
	attribute float aHeight;

	uniform float uTime;

	varying vec3 vNormal;

	void main() {
		float swayX = sin(uTime * aSpeed + aPhase + aBaseX * 0.5) * 0.06 * position.y;
		float swayZ = sin(uTime * aSpeed * 0.7 + aPhase + aBaseZ * 0.5) * 0.04 * position.y;
		vec3 pos = position + vec3(swayX, 0.0, swayZ);
		vec3 objectNormal = normalize(instanceMatrix * vec4(normal, 0.0)).xyz;

		vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
		vNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);

		gl_Position = projectionMatrix * viewMatrix * worldPos;
	}
`;

const fragmentShader = `
	uniform vec3 uColor;
	varying vec3 vNormal;

	void main() {
		vec3 lightDir = normalize(vec3(0.5, 0.8, 0.3));
		float diff = max(dot(vNormal, lightDir), 0.0);
		float ambient = 0.4;
		float light = ambient + diff * 0.6;
		gl_FragColor = vec4(uColor * light, 1.0);
	}
`;

export class GrassMeadow {
	private scene: THREE.Scene;
	private config: Required<GrassMeadowConfig>;
	private grassMesh: THREE.InstancedMesh | null = null;
	private grassMat: THREE.ShaderMaterial | null = null;
	private grassGeo: THREE.BufferGeometry | null = null;
	private dummy = new THREE.Object3D();
	private skipFrame = 0;

	constructor(scene: THREE.Scene, config?: GrassMeadowConfig) {
		this.scene = scene;
		this.config = { ...DEFAULTS, ...config };
	}

	build(): void {
		const c = this.config;
		const grassColor = "#6aaf4c";
		const groundRadius = (c.fieldSize + 20) / 2;

		function groundHeight(x: number, z: number): number {
			const dist = Math.sqrt(x * x + z * z);
			return -c.curvature * dist * dist;
		}

		const groundSegs = Math.max(20, Math.round(c.fieldSize / 2));
		const groundGeo = new THREE.PlaneGeometry(groundRadius * 2, groundRadius * 2, groundSegs, groundSegs);
		groundGeo.rotateX(-Math.PI / 2);
		const gPos = groundGeo.attributes.position as THREE.Float32BufferAttribute;
		for (let i = 0; i < gPos.count; i++) {
			const x = gPos.getX(i);
			const z = gPos.getZ(i);
			const dist = Math.sqrt(x * x + z * z);
			const gh = groundHeight(x, z);
			if (dist > groundRadius) {
				const fade = 1 - (dist - groundRadius) / (groundRadius * 0.3);
				gPos.setY(i, gh * Math.max(0, fade));
			} else {
				gPos.setY(i, gh);
			}
		}
		gPos.needsUpdate = true;
		groundGeo.computeVertexNormals();

		const groundMat = new THREE.MeshBasicMaterial({ color: grassColor });
		const ground = new THREE.Mesh(groundGeo, groundMat);
		ground.receiveShadow = false;
		this.scene.add(ground);

		const bumpGeo = new THREE.PlaneGeometry(3, 2, 6, 4);
		const bumpMat = new THREE.MeshBasicMaterial({ color: grassColor });
		const bumpCount = Math.max(6, Math.round(c.fieldSize / 4));
		for (let i = 0; i < bumpCount; i++) {
			const bump = new THREE.Mesh(bumpGeo, bumpMat);
			const angle = Math.random() * Math.PI * 2;
			const dist = 3 + Math.random() * (c.fieldSize * 0.35);
			bump.rotation.x = -Math.PI / 2;
			const bx = Math.cos(angle) * dist;
			const bz = Math.sin(angle) * dist;
			bump.position.set(bx, groundHeight(bx, bz) + 0.03, bz);
			bump.scale.set(1, 1, 0.4 + Math.random() * 0.8);
			this.scene.add(bump);
		}

		this.grassGeo = new THREE.ConeGeometry(0.06, 1, 4);
		this.grassMat = new THREE.ShaderMaterial({
			vertexShader,
			fragmentShader,
			uniforms: {
				uTime: { value: 0 },
				uColor: { value: new THREE.Color(grassColor) },
			},
		});

		this.grassMesh = new THREE.InstancedMesh(this.grassGeo, this.grassMat, c.grassCount);
		this.grassMesh.castShadow = false;
		this.grassMesh.receiveShadow = false;

		const phaseArr = new Float32Array(c.grassCount);
		const speedArr = new Float32Array(c.grassCount);
		const baseXArr = new Float32Array(c.grassCount);
		const baseZArr = new Float32Array(c.grassCount);
		const heightArr = new Float32Array(c.grassCount);

		for (let i = 0; i < c.grassCount; i++) {
			const x = (Math.random() - 0.5) * c.fieldSize;
			const z = (Math.random() - 0.5) * c.fieldSize;
			const height = 0.8 + Math.random() * 2.0;
			const baseRotY = Math.random() * Math.PI * 2;
			const sx = 0.5 + Math.random() * 0.8;
			const sz = 0.5 + Math.random() * 0.8;
			const baseY = groundHeight(x, z);

			this.dummy.position.set(x, baseY + height / 2, z);
			this.dummy.scale.set(sx, height, sz);
			this.dummy.rotation.set(0, baseRotY, 0);
			this.dummy.updateMatrix();
			this.grassMesh.setMatrixAt(i, this.dummy.matrix);

			phaseArr[i] = Math.random() * Math.PI * 2;
			speedArr[i] = 0.5 + Math.random() * 1.5;
			baseXArr[i] = x;
			baseZArr[i] = z;
			heightArr[i] = height;
		}
		this.grassMesh.instanceMatrix.needsUpdate = true;
		this.grassMesh.geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phaseArr, 1));
		this.grassMesh.geometry.setAttribute("aSpeed", new THREE.InstancedBufferAttribute(speedArr, 1));
		this.grassMesh.geometry.setAttribute("aBaseX", new THREE.InstancedBufferAttribute(baseXArr, 1));
		this.grassMesh.geometry.setAttribute("aBaseZ", new THREE.InstancedBufferAttribute(baseZArr, 1));
		this.grassMesh.geometry.setAttribute("aHeight", new THREE.InstancedBufferAttribute(heightArr, 1));
		this.scene.add(this.grassMesh);
	}

	tick(elapsed: number): void {
		this.skipFrame++;
		if (this.skipFrame % 2 !== 0) return;
		if (this.grassMat) {
			this.grassMat.uniforms.uTime.value = elapsed;
		}
	}

	clearArea(cx: number, cz: number, radius: number): void {
		if (!this.grassMesh) return;
		const dummy = new THREE.Object3D();
		const pos = this.grassMesh.geometry.attributes.aBaseX;
		const posZ = this.grassMesh.geometry.attributes.aBaseZ;
		if (!pos || !posZ) return;
		const bx = pos.array as Float32Array;
		const bz = posZ.array as Float32Array;
		for (let i = 0; i < bx.length; i++) {
			const dx = bx[i] - cx;
			const dz = bz[i] - cz;
			if (dx * dx + dz * dz < radius * radius) {
				dummy.position.set(bx[i], -100, bz[i]);
				dummy.scale.setScalar(1);
				dummy.rotation.set(0, 0, 0);
				dummy.updateMatrix();
				this.grassMesh.setMatrixAt(i, dummy.matrix);
			}
		}
		this.grassMesh.instanceMatrix.needsUpdate = true;
	}

	clearRotatedRect(cx: number, cz: number, hw: number, hd: number, angle: number, border: number): void {
		if (!this.grassMesh) return;
		const sin = Math.sin(angle);
		const cos = Math.cos(angle);
		const bw = hw + border;
		const bd = hd + border;
		const dummy = new THREE.Object3D();
		const pos = this.grassMesh.geometry.attributes.aBaseX;
		const posZ = this.grassMesh.geometry.attributes.aBaseZ;
		if (!pos || !posZ) return;
		const bx = pos.array as Float32Array;
		const bz = posZ.array as Float32Array;
		for (let i = 0; i < bx.length; i++) {
			const dx = bx[i] - cx;
			const dz = bz[i] - cz;
			const localX = dx * cos - dz * sin;
			const localZ = dx * sin + dz * cos;
			if (Math.abs(localX) < bw && Math.abs(localZ) < bd) {
				dummy.position.set(bx[i], -100, bz[i]);
				dummy.scale.setScalar(1);
				dummy.rotation.set(0, 0, 0);
				dummy.updateMatrix();
				this.grassMesh.setMatrixAt(i, dummy.matrix);
			}
		}
		this.grassMesh.instanceMatrix.needsUpdate = true;
	}

	dispose(): void {
		if (this.grassMesh) {
			this.scene.remove(this.grassMesh);
			if (this.grassGeo) this.grassGeo.dispose();
			if (this.grassMat) this.grassMat.dispose();
			this.grassMesh = null;
			this.grassGeo = null;
			this.grassMat = null;
		}
	}
}
