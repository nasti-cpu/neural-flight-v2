/**
 * insect-world-v2 — Blumen.
 * Lädt die 3 Lowpoly-GLB-Blumen und verteilt sie in der Wiese.
 * Nutzt InstancedMesh für Performance.
 */

import * as THREE from "three";
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

function extractMesh(group: THREE.Group): THREE.Mesh | null {
	let result: THREE.Mesh | null = null;
	group.traverse((child) => {
		if (child instanceof THREE.Mesh && !result) {
			result = child;
		}
	});
	return result;
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

	const meshes: THREE.Mesh[] = [];
	for (const scene of scenes) {
		const m = extractMesh(scene);
		if (m) meshes.push(m);
	}

	if (meshes.length === 0) {
		console.warn("Blumen: Keine Meshes in den GLB-Dateien gefunden");
		return { group, dispose: () => {} };
	}

	for (let i = 0; i < meshes.length; i++) {
		const m = meshes[i];
		const name = FLOWER_FILES[i].url.split("/").pop();
		console.log(`Blume ${name}: ${m.geometry.attributes.position.count} Vertices`);
	}

	const perType = Math.max(1, Math.floor(config.count / meshes.length));

	for (let typeIdx = 0; typeIdx < meshes.length; typeIdx++) {
		const src = meshes[typeIdx];
		const scale = FLOWER_FILES[typeIdx].scale;

		const geo = src.geometry.clone();
		const mat = Array.isArray(src.material) ? src.material[0].clone() : src.material.clone();
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
