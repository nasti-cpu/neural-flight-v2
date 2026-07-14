export const CITY = {
	MODEL: "/models/stadt/around_the_world_map_1.glb",
	SCALE: 0.00025,
	POSITION: { x: 18, y: -0.35, z: 0 },
	ROTATION_Y: -Math.PI / 4,

	// Model bounds in local space (after GLTF node hierarchy, at SCALE):
	// X: [-4.10, 3.93], Z: [12.69, 21.48]
	// World center after POSITION + ROTATION_Y + SCALE: ~(5.86, 12.02)

	CLEAR: {
		CENTER: { x: 6, z: 12 },
		RADIUS: 6.5,
		RECT: { hw: 4.5, hd: 5, angle: Math.PI / 4, border: 0.5 },
	},
} as const;
