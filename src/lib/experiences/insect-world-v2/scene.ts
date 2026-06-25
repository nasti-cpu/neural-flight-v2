/**
 * insect-world-v2 — Scene Lifecycle.
 * setup, tick, dispose — baut die vollständige Szene auf:
 * Himmel, Wiese, Blumen, Bienen und Schmetterlinge (Blütenflug).
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import * as THREE from "three/webgpu";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { createSky } from "./Biome/blauerHimmel/sky";
import { createMeadow, type MeadowPatch, MEADOW_PRESETS } from "./Biome/Wiese/grass";
import { createFlowers, type MeadowFlowers } from "./Objekte/Blumen/blumen";
import { createBees, type BeeSwarm } from "./Objekte/Bienen/bienen";
import { createButterflies, type ButterflySwarm } from "./Objekte/Schmetterlinge/schmetterlinge";
import beeGlbUrl from "./Objekte/Bienen/Bee.glb?url";
import butterflyGlbUrl from "./Objekte/Schmetterlinge/Beautiful Butterfly.glb?url";

/** Eigenes State-Interface für insect-world-v2 */
interface InsectWorldV2State extends ExperienceState {
	meadow: MeadowPatch;
	flowers: MeadowFlowers;
	bees: BeeSwarm;
	butterflies: ButterflySwarm;
	sky: THREE.Mesh;
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

	// Blüten-Positionen aus den InstancedMeshes extrahieren
	const flowerPositions: THREE.Vector3[] = [];
	const dummy = new THREE.Object3D();
	const pos = new THREE.Vector3();
	flowers.group.children.forEach((child) => {
		if (child instanceof THREE.InstancedMesh) {
			for (let i = 0; i < child.count; i++) {
				child.getMatrixAt(i, dummy.matrix);
				pos.setFromMatrixPosition(dummy.matrix);
				flowerPositions.push(pos.clone());
			}
		}
	});

	// 4. Bienen (fliegen von Blüte zu Blüte)
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

	// 5. Schmetterlinge (fliegen von Blüte zu Blüte)
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

	return { meadow, flowers, bees, butterflies, sky };
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

	return { state: s };
}

export function dispose(state: ExperienceState, _scene: THREE.Scene): void {
	const s = state as InsectWorldV2State;

	s.bees.dispose();
	s.butterflies.dispose();
	s.flowers.dispose();
	s.meadow.dispose();
	_scene.remove(s.sky);
	(s.sky.geometry as THREE.BufferGeometry).dispose();
	(s.sky.material as THREE.Material).dispose();
}
