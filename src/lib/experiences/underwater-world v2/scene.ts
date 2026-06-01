import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";

export type BiomeType = "sand" | "reef" | "city";

export interface UnderwaterWorldState extends ExperienceState {
	camera: THREE.PerspectiveCamera;
	driftSpeed: number;
	wasdSpeed: number;
	lightIntensity: number;
	terrainAmplitude: number;
	terrainScale: number;
	terrainColor: string;
	terrainMat: THREE.MeshStandardMaterial;
	waterSurface: THREE.Mesh;
}

export const TERRAIN_BASE_Y = -3;
const WATER_SURFACE_Y = 75;

export function getTerrainHeight(_x: number, _z: number, _amplitude: number, _scale: number): number {
	return TERRAIN_BASE_Y;
}

export function getBiome(_x: number, _z: number): number {
	return 0.5;
}

export async function setup(ctx: SetupContext): Promise<UnderwaterWorldState> {
	// Ground plane
	const groundMat = new THREE.MeshStandardMaterial({ color: 0x224466 });
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
	ground.rotation.x = -Math.PI / 2;
	ctx.scene.add(ground);

	// Water surface
	const waterMat = new THREE.MeshPhysicalMaterial({
		color: 0x1a6a9a,
		transparent: true,
		opacity: 0.35,
		roughness: 0.2,
		metalness: 0.1,
		side: THREE.DoubleSide,
	});
	const water = new THREE.Mesh(new THREE.CircleGeometry(600, 64), waterMat);
	water.rotation.x = -Math.PI / 2;
	water.position.y = WATER_SURFACE_Y;
	ctx.scene.add(water);

	return {
		camera: ctx.camera,
		driftSpeed: 2,
		wasdSpeed: 6,
		lightIntensity: 1.5,
		terrainAmplitude: 50,
		terrainScale: 0.012,
		terrainColor: "#ffffff",
		terrainMat: groundMat,
		waterSurface: water,
	};
}

export function tick(
	state: ExperienceState,
	ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
	const s = state as UnderwaterWorldState;

	s.waterSurface.position.y = WATER_SURFACE_Y + Math.sin(ctx.elapsed * 0.1) * 0.5;
	(s.waterSurface.material as THREE.MeshPhysicalMaterial).opacity = 0.3 + Math.sin(ctx.elapsed * 0.15) * 0.08;

	return { state: s };
}

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
	const s = state as UnderwaterWorldState;
	s.terrainMat.dispose();
	s.waterSurface.geometry.dispose();
	(s.waterSurface.material as THREE.MeshPhysicalMaterial).dispose();
	scene.remove(s.waterSurface);
}
