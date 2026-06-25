/**
 * insect-world-v2 — Scene Lifecycle.
 * setup, tick, dispose — baut die vollständige Szene auf:
 * Himmel, Wiese, Blumen, Bienen, Schmetterlinge und Stadt.
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { createSky } from "./Biome/blauerHimmel/sky";
import { createMeadow, type MeadowPatch, MEADOW_PRESETS } from "./Biome/Wiese/grass";
import { createFlowers, type MeadowFlowers } from "./Objekte/Blumen/blumen";
import { createBees, type BeeSwarm } from "./Objekte/Bienen/bienen";
import { createButterflies, type ButterflySwarm } from "./Objekte/Schmetterlinge/schmetterlinge";
import { CITY } from "./Objekte/Stadt/city";
import { PheromoneSystem, type FlowerTarget } from "./Sinne/Pheromonspuren/pheromonspuren";
import beeGlbUrl from "./Objekte/Bienen/Bee.glb?url";
import butterflyGlbUrl from "./Objekte/Schmetterlinge/Beautiful Butterfly.glb?url";

/** Eigenes State-Interface für insect-world-v2 */
interface InsectWorldV2State extends ExperienceState {
	camera: THREE.PerspectiveCamera;
	meadow: MeadowPatch;
	flowers: MeadowFlowers;
	bees: BeeSwarm;
	butterflies: ButterflySwarm;
	pheromones: PheromoneSystem;
	sky: THREE.Mesh;
	city: THREE.Group | null;
}

function loadGLB(url: string): Promise<THREE.Group> {
	return new Promise((resolve, reject) => {
		new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject);
	});
}

/** Entfernt Blumen-Instanzen in einem rotierten Rechteck (y = -100) */
function clearFlowerRect(
	meshes: THREE.InstancedMesh[],
	cx: number, cz: number,
	hw: number, hd: number,
	angle: number,
	border: number,
): void {
	const sin = Math.sin(angle);
	const cos = Math.cos(angle);
	const bw = hw + border;
	const bd = hd + border;
	const d = new THREE.Object3D();
	const pos = new THREE.Vector3();
	for (const mesh of meshes) {
		for (let i = 0; i < mesh.count; i++) {
			mesh.getMatrixAt(i, d.matrix);
			pos.setFromMatrixPosition(d.matrix);
			const dx = pos.x - cx;
			const dz = pos.z - cz;
			const localX = dx * cos - dz * sin;
			const localZ = dx * sin + dz * cos;
			if (Math.abs(localX) < bw && Math.abs(localZ) < bd) {
				d.position.set(pos.x, -100, pos.z);
				d.scale.setScalar(1);
				d.rotation.set(0, 0, 0);
				d.updateMatrix();
				mesh.setMatrixAt(i, d.matrix);
			}
		}
		mesh.instanceMatrix.needsUpdate = true;
	}
}

export async function setup(ctx: SetupContext): Promise<InsectWorldV2State> {
	// 1. Himmel
	const sky = createSky("klassisch");
	ctx.scene.add(sky);

	// 2. Wiese (Frühlingswiese)
	const meadow = createMeadow(MEADOW_PRESETS["Frühlingswiese"], 0, 0);
	ctx.scene.add(meadow.group);

	// 3. Blumen
	const flowers = await createFlowers(0, 0, undefined, meadow.getHeightAt);
	ctx.scene.add(flowers.group);

	// 4. Stadt laden
	let city: THREE.Group | null = null;
	try {
		const cityScene = await loadGLB(CITY.MODEL);
		cityScene.scale.setScalar(CITY.SCALE);
		cityScene.position.set(CITY.POSITION.x, CITY.POSITION.y, CITY.POSITION.z);
		cityScene.rotation.y = CITY.ROTATION_Y;
		ctx.scene.add(cityScene);
		city = cityScene;

		// Gras im Stadt-Bereich entfernen
		meadow.clearRotatedRect(CITY.CLEAR.CENTER.x, CITY.CLEAR.CENTER.z,
			CITY.CLEAR.RECT.hw, CITY.CLEAR.RECT.hd, CITY.CLEAR.RECT.angle, CITY.CLEAR.RECT.border);

		// Blumen im Stadt-Bereich entfernen
		const flowerMeshes: THREE.InstancedMesh[] = [];
		flowers.group.children.forEach((child) => {
			if (child instanceof THREE.InstancedMesh) {
				flowerMeshes.push(child);
			}
		});
		clearFlowerRect(flowerMeshes, CITY.CLEAR.CENTER.x, CITY.CLEAR.CENTER.z,
			CITY.CLEAR.RECT.hw, CITY.CLEAR.RECT.hd, CITY.CLEAR.RECT.angle, CITY.CLEAR.RECT.border);
	} catch (e) {
		console.warn("[V2] Stadt konnte nicht geladen werden:", e);
	}

	// Blüten-Positionen aus flowers.targets (ohne Stadt-Bereich)
	const sin = Math.sin(CITY.CLEAR.RECT.angle);
	const cos = Math.cos(CITY.CLEAR.RECT.angle);
	const bw = CITY.CLEAR.RECT.hw + CITY.CLEAR.RECT.border;
	const bd = CITY.CLEAR.RECT.hd + CITY.CLEAR.RECT.border;
	const cx2 = CITY.CLEAR.CENTER.x;
	const cz2 = CITY.CLEAR.CENTER.z;
	const flowerPositions: THREE.Vector3[] = [];
	for (const t of flowers.targets) {
		const dx = t.position.x - cx2;
		const dz = t.position.z - cz2;
		const localX = dx * cos - dz * sin;
		const localZ = dx * sin + dz * cos;
		if (Math.abs(localX) >= bw || Math.abs(localZ) >= bd) {
			flowerPositions.push(t.position.clone());
		}
	}

	// 5. Bienen (fliegen von Blüte zu Blüte)
	const bees = await createBees(beeGlbUrl, {
		count: 10,
		scale: 0.04,
		fieldRadius: 25,
		flyRadiusMin: 1,
		flyRadiusMax: 3,
		speedMin: 2,
		speedMax: 4,
		heightBaseMin: 0.3,
		heightBaseMax: 0.8,
		heightRange: 0.2,
		flowerTargets: flowerPositions,
		hoverDuration: 1.0,
	});
	ctx.scene.add(bees.group);

	// 6. Schmetterlinge (fliegen von Blüte zu Blüte)
	const butterflies = await createButterflies(butterflyGlbUrl, {
		count: 6,
		scale: 0.036,
		fieldRadius: 40,
		flyRadiusMin: 1,
		flyRadiusMax: 4,
		speedMin: 1.0,
		speedMax: 2.5,
		heightBaseMin: 0.8,
		heightBaseMax: 1.5,
		heightRange: 0.4,
		flowerTargets: flowerPositions,
		hoverDuration: 2.0,
		heightAboveFlower: 2.0,
	});
	ctx.scene.add(butterflies.group);

	// 7. Pheromon-Spuren (Glühwürmchen-Variante)
	const flowerTargetsFiltered: FlowerTarget[] = [];
	for (const t of flowers.targets) {
		const dx = t.position.x - cx2;
		const dz = t.position.z - cz2;
		const localX = dx * cos - dz * sin;
		const localZ = dx * sin + dz * cos;
		if (Math.abs(localX) >= bw || Math.abs(localZ) >= bd) {
			flowerTargetsFiltered.push(t);
		}
	}
	const pheromones = new PheromoneSystem();
	pheromones.addTrails(flowerTargetsFiltered);
	ctx.scene.add(pheromones.group);

	// Kamera positionieren
	const camera = ctx.camera;
	camera.position.set(0, 2, 0);

	return { camera, meadow, flowers, bees, butterflies, pheromones, sky, city };
}

export function tick(
	state: ExperienceState,
	ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
	const s = state as InsectWorldV2State;

	// Bienen-Animation
	s.bees.update(ctx.elapsed);
	// Schmetterlings-Animation
	s.butterflies.update(ctx.elapsed);
	// Pheromon-Spuren-Animation
	s.pheromones.update(ctx.elapsed);

	return { state: s };
}

export function dispose(state: ExperienceState, _scene: THREE.Scene): void {
	const s = state as InsectWorldV2State;

	s.bees.dispose();
	s.butterflies.dispose();
	s.pheromones.dispose();
	s.flowers.dispose();
	s.meadow.dispose();
	if (s.city) {
		_scene.remove(s.city);
		s.city.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
				if (Array.isArray(child.material)) {
					child.material.forEach((m) => m.dispose());
				} else {
					child.material.dispose();
				}
			}
		});
	}
	_scene.remove(s.sky);
	(s.sky.geometry as THREE.BufferGeometry).dispose();
	(s.sky.material as THREE.Material).dispose();
	// Alle Gruppen aus der Szene entfernen
	_scene.remove(s.meadow.group);
	_scene.remove(s.flowers.group);
	_scene.remove(s.bees.group);
	_scene.remove(s.butterflies.group);
	_scene.remove(s.pheromones.group);
}
