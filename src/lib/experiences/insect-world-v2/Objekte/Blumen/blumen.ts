/**
 * insect-world-v2 — Blumen.
 * Lädt die 3 Lowpoly-GLB-Blumen und verteilt sie in der Wiese.
 * Nutzt InstancedMesh für Performance.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import pinkUrl from "./Flower pink.glb?url";
import whiteUrl from "./Flower white.glb?url";
import yellowUrl from "./Flower yellow.glb?url";

const FLOWER_FILES = [
	{ url: pinkUrl, scale: 1.0 },
	{ url: whiteUrl, scale: 1.0 },
	{ url: yellowUrl, scale: 1.0 },
];

export interface FlowerConfig {
	count: number;
	fieldSize: number;
}

const DEFAULT_CONFIG: FlowerConfig = {
	count: 120,
	fieldSize: 60,
};

export interface MeadowFlowers {
	group: THREE.Group;
	dispose: () => void;
}

function loadGLTF(url: string): Promise<THREE.Group> {
	return new Promise((resolve, reject) => {
		const loader = new GLTFLoader();
		loader.load(url, (gltf) => {
			resolve(gltf.scene);
		}, undefined, (err) => {
			console.error("Blumen GLB-Fehler:", url, err);
			reject(err);
		});
	});
}

function mergeSceneMeshes(group: THREE.Group): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
	const geos: THREE.BufferGeometry[] = [];
	let material: THREE.Material | null = null;

	group.traverse((child) => {
		if (!(child instanceof THREE.Mesh)) return;
		child.updateWorldMatrix(true, false);
		const geo = child.geometry.clone();
		geo.applyMatrix4(child.matrixWorld);
		geos.push(geo);

		const mat = Array.isArray(child.material) ? child.material[0] : child.material;
		if (!material) material = mat.clone();
	});

	if (geos.length === 0) return null;

	const merged = mergeGeometries(geos)!;
	if (!material) {
		material = new THREE.MeshBasicMaterial({ color: 0xffffff });
	}

	return { geometry: merged, material };
}

/**
 * Lädt alle 3 Blumenmodelle und platziert sie als InstancedMesh
 * in einem Feld um (cx, cz).
 *
 * @param getHeightAt  Optionale Funktion für Bodenanpassung
 */
export async function createFlowers(
	cx: number,
	cz: number,
	config: FlowerConfig = DEFAULT_CONFIG,
	getHeightAt?: (x: number, z: number) => number,
): Promise<MeadowFlowers> {
	const group = new THREE.Group();
	const dummy = new THREE.Object3D();

	const scenes = await Promise.all(
		FLOWER_FILES.map((f) => loadGLTF(f.url)),
	);

	const results: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
	for (let i = 0; i < scenes.length; i++) {
		const r = mergeSceneMeshes(scenes[i]);
		if (r) {
			results.push(r);
			const name = FLOWER_FILES[i].url.split("/").pop();
			console.log(`Blume ${name}: ${r.geometry.attributes.position.count} Vertices`);
		}
	}

	if (results.length === 0) {
		console.warn("Blumen: Keine Meshes in den GLB-Dateien gefunden");
		return { group, dispose: () => {} };
	}

	const perType = Math.max(1, Math.floor(config.count / results.length));

	for (let typeIdx = 0; typeIdx < results.length; typeIdx++) {
		const { geometry, material } = results[typeIdx];
		const scale = FLOWER_FILES[typeIdx].scale;

		const geo = geometry;
		const mat = material;
		mat.side = THREE.DoubleSide;
		mat.depthWrite = true;
		const mesh = new THREE.InstancedMesh(geo, mat, perType);

		for (let i = 0; i < perType; i++) {
			const x = cx + (Math.random() - 0.5) * config.fieldSize;
			const z = cz + (Math.random() - 0.5) * config.fieldSize;
			const y = (getHeightAt ? getHeightAt(x, z) : 0) + Math.random() * 0.05;
			const rotY = Math.random() * Math.PI * 2;
			const s = scale * (0.8 + Math.random() * 0.7);

			dummy.position.set(x, y, z);
			dummy.scale.setScalar(s);
			dummy.rotation.set(0, rotY, 0);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}

		mesh.instanceMatrix.needsUpdate = true;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		group.add(mesh);
	}

	function dispose() {
		group.children.forEach((child) => {
			if (child instanceof THREE.InstancedMesh) {
				child.geometry.dispose();
				if (Array.isArray(child.material)) {
					child.material.forEach((m) => m.dispose());
				} else {
					child.material.dispose();
				}
			}
		});
		group.clear();
	}

	return { group, dispose };
}
