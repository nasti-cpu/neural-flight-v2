import * as THREE from "three";

export const WATER_SURFACE_Y = 500;

export function createWaterSurface(scene: THREE.Scene): THREE.Mesh {
	const waterGeo = new THREE.CircleGeometry(2000, 64);
	waterGeo.rotateX(-Math.PI / 2);
	const waterMat = new THREE.MeshPhysicalMaterial({
		color: 0x1a6a9a,
		transparent: true,
		opacity: 0.35,
		roughness: 0.0,
		metalness: 0.0,
		side: THREE.DoubleSide,
	});
	const waterSurface = new THREE.Mesh(waterGeo, waterMat);
	waterSurface.position.y = WATER_SURFACE_Y;
	waterSurface.renderOrder = 1;
	scene.add(waterSurface);
	return waterSurface;
}

export function updateWaterSurface(water: THREE.Mesh, elapsed: number): void {
	water.position.y = WATER_SURFACE_Y + Math.sin(elapsed * 0.1) * 0.5;
	const mat = water.material as THREE.MeshPhysicalMaterial;
	mat.opacity = 0.3 + Math.sin(elapsed * 0.15) * 0.08;
}

export function disposeWaterSurface(water: THREE.Mesh, scene: THREE.Scene): void {
	water.geometry.dispose();
	(water.material as THREE.MeshPhysicalMaterial).dispose();
	scene.remove(water);
}
