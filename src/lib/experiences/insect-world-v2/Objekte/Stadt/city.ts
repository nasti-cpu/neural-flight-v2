/**
 * insect-world-v2 — Stadt (Ameisen-Perspektive).
 * Konfiguration des 3D-Stadtmodells und Clear-Zone.
 *
 * WebGPU-konform.
 */
export const CITY = {
	MODEL: "/models/stadt/around_the_world_map_1.glb",
	SCALE: 0.00025,
	POSITION: { x: 18, y: 0, z: 0 },
	ROTATION_Y: -Math.PI / 4,

	CLEAR: {
		CENTER: { x: 6, z: 12 },
		RADIUS: 6.5,
		RECT: { hw: 4.5, hd: 5, angle: Math.PI / 4, border: 0.5 },
	},
} as const;
