import * as THREE from "three";
import { loadGLTF } from "$lib/three/loader";

const GARDEN_PATH = "/models/Meshy_AI_Coral_Reef_Garden_0604160957_texture.glb";
const KALEIDO_PATH = "/models/Meshy_AI_Kaleidoscope_Coral_Re_0604163348_texture.glb";

interface CoralModel {
	scene: THREE.Group;
	/** Offset to place bottom at Y=0 when scale = modelScale */
	offset: THREE.Vector3;
	/** Scale that maps targetSize onto model */
	modelScale: number;
	/** Original geometry min Y (unscaled) */
	bminY: number;
}
let _garden: CoralModel | null = null;
let _kaleido: CoralModel | null = null;
let _anyReady = false;
let _modelLoadFailed = false;
let _loadResolve: (() => void) | null = null;
let _loadPromise: Promise<void>;

const CORAL_COLORS = [
	0xff4466, 0xff8844, 0xffcc44, 0xee55aa, 0xff6644, 0xdd77aa,
	0x33ccaa, 0xffaa44, 0xee5599, 0x44aaff, 0x88ddff, 0xcc88ff,
	0xff6688, 0x66dd88, 0xaa66ff, 0xff9966,
];

// Defer loading to client-side only (SSR can't load relative URLs)
if (typeof window !== "undefined") {
	_loadPromise = new Promise((resolve) => { _loadResolve = resolve; });
	_loadBoth();
} else {
	_loadPromise = Promise.resolve();
	_modelLoadFailed = true;
}

async function _loadBoth(): Promise<void> {
	try {
		const [gardenGltf, kaleidoGltf] = await Promise.all([
			loadGLTF(GARDEN_PATH),
			loadGLTF(KALEIDO_PATH),
		]);
		_garden = _processModel(gardenGltf.scene);
		_kaleido = _processModel(kaleidoGltf.scene);
		_anyReady = true;
	} catch (e) {
		console.warn("ModelCoralReef: GLB load failed", e);
		_modelLoadFailed = true;
	} finally {
		_loadResolve?.();
	}
}

function _processModel(src: THREE.Group): CoralModel {
	src.updateWorldMatrix(true, false);
	const box = new THREE.Box3().setFromObject(src);
	const center = box.getCenter(new THREE.Vector3());
	const bmin = box.min;
	const size = box.getSize(new THREE.Vector3());
	const maxDim = Math.max(size.x, size.y, size.z);
	const targetSize = 30;
	const modelScale = targetSize / maxDim;
	const offset = new THREE.Vector3(
		-center.x * modelScale,
		-bmin.y * modelScale,
		-center.z * modelScale,
	);

	const tmpCol = new THREE.Color();
	let meshIdx = 0;
	src.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			const mat = child.material as THREE.MeshStandardMaterial;
			if (mat && !mat.map) {
				const ci = meshIdx % CORAL_COLORS.length;
				tmpCol.setHex(CORAL_COLORS[ci]);
				mat.color.copy(tmpCol);
				mat.roughness = 0.5;
				mat.metalness = 0.05;
			}
			meshIdx++;
		}
	});

	return { scene: src, offset, modelScale, bminY: bmin.y };
}

export function ensureModelLoaded(): Promise<void> {
	return _loadPromise;
}

export function isModelReady(): boolean {
	return _anyReady;
}

export function isModelFailed(): boolean {
	return _modelLoadFailed;
}

export interface ModelCoralReefResult {
	group: THREE.Group;
}

export function createModelCoralReefSync(): ModelCoralReefResult | null {
	if (!_anyReady && !_modelLoadFailed) return null;
	if (_modelLoadFailed) return null;

	const group = new THREE.Group();
	if (_garden) {
		const m = _garden.scene.clone();
		m.scale.setScalar(_garden.modelScale);
		m.position.copy(_garden.offset);
		group.add(m);
	}
	return { group };
}

// ── Scatter API ──

export interface ScatterConfig {
	/** Number of coral model clusters to place */
	count: number;
	/** Radius of the scatter area */
	radius: number;
	/** Center X (world coords) */
	cx: number;
	/** Center Z (world coords) */
	cz: number;
	/** Ground Y at center (all corals sit on this Y) */
	groundY: number;
	/** Min/max scale multiplier */
	scaleRange: [number, number];
	/** Chance of Garden vs Kaleidoscope (0 = all Garden, 1 = all Kaleidoscope) */
	kaleidoChance?: number;
}

export function scatterCoralModels(config: ScatterConfig): THREE.Group | null {
	if (!_anyReady) return null;

	const { count, radius, cx, cz, groundY, scaleRange, kaleidoChance = 0.5 } = config;
	const group = new THREE.Group();
	const tmpCol = new THREE.Color();

	for (let i = 0; i < count; i++) {
		const useKaleido = Math.random() < kaleidoChance;
		const src = useKaleido ? _kaleido : _garden;
		if (!src) continue;

		const angle = Math.random() * Math.PI * 2;
		const dist = Math.random() * radius;
		const x = cx + Math.cos(angle) * dist;
		const z = cz + Math.sin(angle) * dist;
		const clone = src.scene.clone(true);

		const s = scaleRange[0] + Math.random() * (scaleRange[1] - scaleRange[0]);
		clone.scale.setScalar(s);
		// Bottom of model sits at groundY: position.y + bminY * s = groundY → position.y = groundY - bminY * s
		clone.position.set(x, groundY - src.bminY * s, z);
		clone.rotation.y = Math.random() * Math.PI * 2;

		let meshIdx = 0;
		clone.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				const mat = child.material as THREE.MeshStandardMaterial;
				if (mat && !mat.map) {
					const ci = meshIdx % CORAL_COLORS.length;
					tmpCol.setHex(CORAL_COLORS[ci]);
					mat.color.copy(tmpCol);
					mat.roughness = 0.5;
					mat.metalness = 0.05;
				}
				meshIdx++;
			}
		});

		group.add(clone);
	}

	return group;
}

export function disposeModelCoralReef(result: ModelCoralReefResult, scene: THREE.Scene): void {
	scene.remove(result.group);
	result.group.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			child.geometry.dispose();
			if (child.material instanceof THREE.Material) child.material.dispose();
		}
	});
}

export function disposeScatterGroup(group: THREE.Group, scene: THREE.Scene): void {
	scene.remove(group);
	group.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			child.geometry.dispose();
			if (child.material instanceof THREE.Material) child.material.dispose();
		}
	});
}
