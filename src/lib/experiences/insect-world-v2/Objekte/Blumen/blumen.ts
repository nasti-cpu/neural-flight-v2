/**
 * insect-world-v2 — Blumen.
 * Lädt die 3 Lowpoly-GLB-Blumen und verteilt sie in der Wiese.
 * Jede GLB kann mehrere Sub-Meshes mit eigenen Materialien haben
 * (z.B. grüner Stiel + bunte Blüte). Pro Material wird ein
 * separater InstancedMesh erzeugt.
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
		loader.load(url, (gltf) => resolve(gltf.scene), undefined, (err) => {
			console.error("Blumen GLB-Fehler:", url, err);
			reject(err);
		});
	});
}

/**
 * Sammelt alle Meshes aus einer GLB-Szene, gruppiert sie nach
 * Material-Identität merged die Geometrien einer Gruppe.
 * Gibt ein Array pro einzigartigem Material zurück.
 */
function groupMeshesByMaterial(
	group: THREE.Group,
): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
	const materialGroups = new Map<THREE.Material, THREE.BufferGeometry[]>();

	group.traverse((child) => {
		if (!(child instanceof THREE.Mesh)) return;
		child.updateWorldMatrix(true, false);
		const geo = child.geometry.clone();
		geo.applyMatrix4(child.matrixWorld);

		const mat = Array.isArray(child.material) ? child.material[0] : child.material;
		const list = materialGroups.get(mat);
		if (list) {
			list.push(geo);
		} else {
			materialGroups.set(mat, [geo]);
		}
	});

	const results: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
	for (const [material, geos] of materialGroups) {
		const merged = mergeGeometries(geos);
		if (merged) {
			const mat = material.clone();
			mat.side = THREE.DoubleSide;
			mat.depthWrite = true;
			results.push({ geometry: merged, material: mat });
		}
	}

	return results;
}

/**
 * Lädt alle 3 Blumenmodelle und platziert sie als InstancedMesh
 * in einem Feld um (cx, cz).
 *
 * Pro GLB können mehrere Sub-Meshes (z.B. Stiel + Blüte) mit
 * eigenen Materialien entstehen – jedes bekommt einen eigenen
 * InstancedMesh.
 *
 * @param getHeightAt Optionale Funktion für Bodenanpassung
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

	const perType = Math.max(1, Math.floor(config.count / scenes.length));

	for (let typeIdx = 0; typeIdx < scenes.length; typeIdx++) {
		const materialGroups = groupMeshesByMaterial(scenes[typeIdx]);
		const scale = FLOWER_FILES[typeIdx].scale;

		const name = FLOWER_FILES[typeIdx].url.split("/").pop();
		console.log(`Blume ${name}: ${materialGroups.length} Materialgruppe(n)`);

		// Positionen für alle Instanzen dieser Blumen-Art vorbereiten
		const positions: { x: number; y: number; z: number; rotY: number; s: number }[] = [];
		for (let i = 0; i < perType; i++) {
			const x = cx + (Math.random() - 0.5) * config.fieldSize;
			const z = cz + (Math.random() - 0.5) * config.fieldSize;
			const y = (getHeightAt ? getHeightAt(x, z) : 0) + Math.random() * 0.05;
			const rotY = Math.random() * Math.PI * 2;
			const s = scale * (0.8 + Math.random() * 0.7);
			positions.push({ x, y, z, rotY, s });
		}

		for (const { geometry, material } of materialGroups) {
			const mesh = new THREE.InstancedMesh(geometry, material, perType);

			for (let i = 0; i < perType; i++) {
				const p = positions[i];
				dummy.position.set(p.x, p.y, p.z);
				dummy.scale.setScalar(p.s);
				dummy.rotation.set(0, p.rotY, 0);
				dummy.updateMatrix();
				mesh.setMatrixAt(i, dummy.matrix);
			}

			mesh.instanceMatrix.needsUpdate = true;
			mesh.castShadow = false;
			mesh.receiveShadow = false;
			group.add(mesh);
		}
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
