/**
 * insect-world-v2 — Schmetterlinge.
 *
 * Lädt ein Schmetterlings-GLB und erzeugt mehrere Schmetterlinge.
 * Flugverhalten identisch zu den Bienen (zwei Modi: Blütenflug / Sinus).
 *
 * WebGPU-konform (GLTFLoader + Instancing).
 */
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface ButterflyConfig {
	count: number;
	scale: number;
	fieldRadius: number;
	flyRadiusMin: number;
	flyRadiusMax: number;
	speedMin: number;
	speedMax: number;
	heightBaseMin: number;
	heightBaseMax: number;
	heightRange: number;
	/** Optionale Liste von Blüten-Positionen (x, y, z) */
	flowerTargets?: THREE.Vector3[];
	/** Zeit in Sekunden, die an jeder Blüte verweilt wird */
	hoverDuration?: number;
	/** Flughöhe über den Blüten (Meter) */
	heightAboveFlower?: number;
}

const DEFAULT_CONFIG: ButterflyConfig = {
	count: 8,
	scale: 0.08,
	fieldRadius: 20,
	flyRadiusMin: 1.5,
	flyRadiusMax: 6,
	speedMin: 0.2,
	speedMax: 0.6,
	heightBaseMin: 0.5,
	heightBaseMax: 1.5,
	heightRange: 0.4,
	hoverDuration: 2.0,
	heightAboveFlower: 0.8,
};

/** Interner Zustand eines Schmetterlings */
interface ButterflyState {
	group: THREE.Group;
	center: THREE.Vector3;
	flyRadius: number;
	speed: number;
	phase: number;
	phase2: number;
	freqY: number;
	heightBase: number;
	heightRange: number;
	tiltSpeed: number;
	target?: THREE.Vector3;
	targetIndex?: number;
	progress?: number;
	hoverTimer?: number;
}

export interface ButterflySwarm {
	group: THREE.Group;
	update: (time: number) => void;
	dispose: () => void;
}

function loadGLB(url: string): Promise<THREE.Group> {
	return new Promise((resolve, reject) => {
		new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject);
	});
}

function pickNextTarget(current: number | undefined, count: number): number {
	if (count <= 1) return 0;
	let next: number;
	do {
		next = Math.floor(Math.random() * count);
	} while (next === current);
	return next;
}

export async function createButterflies(
	glbUrl: string,
	config: ButterflyConfig = DEFAULT_CONFIG,
): Promise<ButterflySwarm> {
	const group = new THREE.Group();
	const butterflyScene = await loadGLB(glbUrl);

	const template = new THREE.Group();
	butterflyScene.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			template.add(child.clone());
		}
	});

	const useFlowerMode = !!(
		config.flowerTargets && config.flowerTargets.length > 0
	);
	const flowers = config.flowerTargets ?? [];
	const hoverDuration = config.hoverDuration ?? 2.0;
	const heightAboveFlower = config.heightAboveFlower ?? 0.8;

	const butterflies: ButterflyState[] = [];

	for (let i = 0; i < config.count; i++) {
		const bGroup = new THREE.Group();
		bGroup.add(template.clone(true));
		bGroup.scale.setScalar(config.scale);

		const angle = Math.random() * Math.PI * 2;
		const dist = Math.random() * config.fieldRadius;
		const cx = Math.cos(angle) * dist;
		const cz = Math.sin(angle) * dist;
		const cy =
			config.heightBaseMin +
			Math.random() * (config.heightBaseMax - config.heightBaseMin);

		bGroup.position.set(cx, cy, cz);
		bGroup.rotation.y = Math.random() * Math.PI * 2;

		group.add(bGroup);

		const butterfly: ButterflyState = {
			group: bGroup,
			center: new THREE.Vector3(cx, 0, cz),
			flyRadius:
				config.flyRadiusMin +
				Math.random() * (config.flyRadiusMax - config.flyRadiusMin),
			speed:
				config.speedMin + Math.random() * (config.speedMax - config.speedMin),
			phase: Math.random() * Math.PI * 2,
			phase2: Math.random() * Math.PI * 2,
			freqY: 1.0 + Math.random() * 1.0,
			heightBase:
				config.heightBaseMin +
				Math.random() * (config.heightBaseMax - config.heightBaseMin),
			heightRange: config.heightRange * (0.5 + Math.random() * 0.5),
			tiltSpeed: 1.5 + Math.random() * 1.5,
		};

		if (useFlowerMode) {
			const idx = pickNextTarget(undefined, flowers.length);
			butterfly.target = flowers[idx].clone();
			butterfly.targetIndex = idx;
			butterfly.progress = 0;
			butterfly.hoverTimer = 0;
		}

		butterflies.push(butterfly);
	}

	function update(time: number): void {
		if (useFlowerMode) {
			for (const b of butterflies) {
				if (b.hoverTimer! > 0) {
					b.hoverTimer! -= 0.016;
					b.group.rotation.z =
						Math.sin(time * b.tiltSpeed + b.phase) * 0.05;
					b.group.rotation.x =
						Math.sin(time * 1.5 + b.phase2) * 0.03;
					continue;
				}

				const end = b.target!;
				const pos = b.group.position;
				const targetPos = new THREE.Vector3(end.x, end.y + heightAboveFlower, end.z);
				const dist = pos.distanceTo(targetPos);

				if (dist < 0.5) {
					b.hoverTimer = hoverDuration + Math.random() * 0.5;
					b.center.copy(pos);
					const idx = pickNextTarget(b.targetIndex, flowers.length);
					b.target = flowers[idx].clone();
					b.targetIndex = idx;
					b.progress = 0;
					continue;
				}

				const step = Math.min(2.5 * 0.016, dist);
				const dir = new THREE.Vector3().copy(targetPos).sub(pos).normalize();
				const newPos = pos.clone().add(dir.multiplyScalar(step));

				const dx = newPos.x - pos.x;
				const dz = newPos.z - pos.z;

				b.group.position.copy(newPos);
				b.center.copy(newPos);

				if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
					b.group.rotation.y = Math.atan2(dx, dz) + Math.PI;
				}

				b.group.rotation.z =
					Math.sin(time * b.tiltSpeed + b.phase) * 0.08;
				b.group.rotation.x =
					Math.sin(time * 1.5 + b.phase2) * 0.05 +
					Math.sin(time * 0.5 + b.phase) * 0.03;
			}
		} else {
			for (const b of butterflies) {
				const t = time * b.speed;

				const cx1 = Math.cos(t + b.phase) * b.flyRadius;
				const cz1 = Math.sin(t + b.phase) * b.flyRadius;

				const cx2 =
					Math.cos(t * 0.7 + b.phase2) * b.flyRadius * 0.3;
				const cz2 =
					Math.sin(t * 0.5 + b.phase2) * b.flyRadius * 0.3;

				const x = b.center.x + cx1 + cx2;
				const z = b.center.z + cz1 + cz2;
				const y =
					b.center.y +
					b.heightBase +
					Math.sin(t * b.freqY + b.phase) * b.heightRange;

				const dx = x - b.group.position.x;
				const dz = z - b.group.position.z;

				b.group.position.set(x, y, z);

				if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
					b.group.rotation.y = Math.atan2(dx, dz) + Math.PI;
				}

				b.group.rotation.z =
					Math.sin(t * b.tiltSpeed + b.phase) * 0.08;
				b.group.rotation.x =
					Math.sin(t * 1.5 + b.phase2) * 0.05 +
					Math.sin(t * 0.5 + b.phase) * 0.03;
			}
		}
	}

	function dispose(): void {
		for (const child of group.children) {
			if (child instanceof THREE.Group) {
				for (const mesh of child.children) {
					if (mesh instanceof THREE.Mesh) {
						mesh.geometry.dispose();
						if (Array.isArray(mesh.material)) {
							for (const m of mesh.material) m.dispose();
						} else {
							mesh.material.dispose();
						}
					}
				}
			}
		}
		group.clear();
	}

	return { group, update, dispose };
}
