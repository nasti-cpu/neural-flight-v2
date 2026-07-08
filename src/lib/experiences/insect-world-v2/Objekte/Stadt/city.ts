/**
 * insect-world-v2 — Stadt-Konfiguration.
 * Basis-Definition für das 3D-Stadtmodell und die kreisförmige Clear-Zone.
 * Wird vom CityManager für mehrere prozedurale Instanzen verwendet.
 *
 * WebGPU-konform.
 */
export const CITY_CONFIG = {
	MODEL: "/models/stadt/around_the_world_map_1.glb",
	SCALE: 0.00025,

	/** Kreisförmiger Radius ohne Gras/Pflanzen um jede Stadt (in Metern) */
	CLEAR_RADIUS: 8,
} as const;
