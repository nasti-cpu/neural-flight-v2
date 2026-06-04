import * as THREE from "three";

const GRASS_COUNT = 5000;
const FIELD_SIZE = 45;
const CURVATURE = 0.0025;
const GROUND_RADIUS = (FIELD_SIZE + 20) / 2;

function groundHeight(x: number, z: number): number {
	const dist = Math.sqrt(x * x + z * z);
	return -CURVATURE * dist * dist;
}

interface SwayData {
	baseX: number;
	baseZ: number;
	baseY: number;
	baseRotY: number;
	phase: number;
	speed: number;
	height: number;
	scaleX: number;
	scaleZ: number;
}

export class GrassMeadow {
	private scene: THREE.Scene;
	private grassMesh: THREE.InstancedMesh | null = null;
	private grassMat: THREE.MeshStandardMaterial | null = null;
	private grassGeo: THREE.BufferGeometry | null = null;
	private swayData: SwayData[] = [];
	private dummy = new THREE.Object3D();

	constructor(scene: THREE.Scene) {
		this.scene = scene;
	}

	build(): void {
		const grassColor = "#6aaf4c";

		const groundSegs = 40;
		const groundGeo = new THREE.PlaneGeometry(GROUND_RADIUS * 2, GROUND_RADIUS * 2, groundSegs, groundSegs);
		groundGeo.rotateX(-Math.PI / 2);
		const gPos = groundGeo.attributes.position as THREE.Float32BufferAttribute;
		for (let i = 0; i < gPos.count; i++) {
			const x = gPos.getX(i);
			const z = gPos.getZ(i);
			const dist = Math.sqrt(x * x + z * z);
			if (dist > GROUND_RADIUS) {
				const edge = GROUND_RADIUS;
				const fade = 1 - (dist - edge) / (GROUND_RADIUS * 0.3);
				gPos.setY(i, groundHeight(x, z) * Math.max(0, fade));
			} else {
				gPos.setY(i, groundHeight(x, z));
			}
		}
		gPos.needsUpdate = true;
		groundGeo.computeVertexNormals();

		const groundMat = new THREE.MeshStandardMaterial({ color: grassColor, roughness: 1 });
		const ground = new THREE.Mesh(groundGeo, groundMat);
		ground.receiveShadow = true;
		this.scene.add(ground);

		const bumpGeo = new THREE.PlaneGeometry(3, 2, 6, 4);
		const bumpMat = new THREE.MeshStandardMaterial({ color: grassColor, roughness: 1 });
		for (let i = 0; i < 12; i++) {
			const bump = new THREE.Mesh(bumpGeo, bumpMat);
			const angle = Math.random() * Math.PI * 2;
			const dist = 3 + Math.random() * 14;
			bump.rotation.x = -Math.PI / 2;
			const bx = Math.cos(angle) * dist;
			const bz = Math.sin(angle) * dist;
			bump.position.set(bx, groundHeight(bx, bz) + 0.03, bz);
			bump.scale.set(1, 1, 0.4 + Math.random() * 0.8);
			this.scene.add(bump);
		}

		this.grassGeo = new THREE.ConeGeometry(0.06, 1, 4);
		this.grassMat = new THREE.MeshStandardMaterial({
			color: grassColor,
			roughness: 0.9,
			flatShading: true,
		});

		this.grassMesh = new THREE.InstancedMesh(this.grassGeo, this.grassMat, GRASS_COUNT);
		this.grassMesh.castShadow = true;
		this.grassMesh.receiveShadow = true;

		for (let i = 0; i < GRASS_COUNT; i++) {
			const x = (Math.random() - 0.5) * FIELD_SIZE;
			const z = (Math.random() - 0.5) * FIELD_SIZE;
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

			this.swayData.push({
				baseX: x,
				baseZ: z,
				baseY,
				baseRotY,
				phase: Math.random() * Math.PI * 2,
				speed: 0.5 + Math.random() * 1.5,
				height,
				scaleX: sx,
				scaleZ: sz,
			});
		}
		this.grassMesh.instanceMatrix.needsUpdate = true;
		this.scene.add(this.grassMesh);
	}

	tick(elapsed: number): void {
		const windDir = Math.sin(elapsed * 0.04) * 0.3;

		if (!this.grassMesh) return;

		for (let i = 0; i < GRASS_COUNT; i++) {
			const d = this.swayData[i];
			if (!d) continue;

			const swayX = Math.sin(elapsed * d.speed + d.phase + d.baseX * 0.5) * 0.06;
			const swayZ = Math.sin(elapsed * d.speed * 0.7 + d.phase + d.baseZ * 0.5) * 0.04;

			this.dummy.position.set(d.baseX, d.baseY + d.height / 2, d.baseZ);
			this.dummy.scale.set(d.scaleX, d.height, d.scaleZ);
			this.dummy.rotation.set(swayZ * 0.5, d.baseRotY, swayX + windDir * 0.08);
			this.dummy.updateMatrix();
			this.grassMesh.setMatrixAt(i, this.dummy.matrix);
		}
		this.grassMesh.instanceMatrix.needsUpdate = true;
	}

	clearArea(cx: number, cz: number, radius: number): void {
		if (!this.grassMesh) return;
		const dummy = new THREE.Object3D();
		for (let i = 0; i < this.swayData.length; i++) {
			const d = this.swayData[i];
			const dx = d.baseX - cx;
			const dz = d.baseZ - cz;
			if (dx * dx + dz * dz < radius * radius) {
				dummy.position.set(d.baseX, -100, d.baseZ);
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
		for (let i = 0; i < this.swayData.length; i++) {
			const d = this.swayData[i];
			const dx = d.baseX - cx;
			const dz = d.baseZ - cz;
			const localX = dx * cos + dz * sin;
			const localZ = -dx * sin + dz * cos;
			if (Math.abs(localX) < bw && Math.abs(localZ) < bd) {
				dummy.position.set(d.baseX, -100, d.baseZ);
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
		this.swayData = [];
	}
}
