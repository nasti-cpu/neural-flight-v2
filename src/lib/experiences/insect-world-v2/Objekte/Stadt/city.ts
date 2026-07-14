/**
 * insect-world-v2 — Stadt-Konfiguration.
 * Basis-Definition für das 3D-Stadtmodell, Abstände und Reichweiten.
 * Wird vom CityManager und der Scene-Tick-Logik verwendet.
 *
 * WebGPU-konform.
 */
export const CITY_CONFIG = {
	MODEL: "/models/stadt/around_the_world_map_1.glb",
	SCALE: 0.00025,

	/** Kreisförmiger Radius ohne Gras/Pflanzen um jede Stadt (in Metern) */
	CLEAR_RADIUS: 8,

	// ── Anzahl & Verteilung ──
	CITY_COUNT: 3,
	/** Minimaler Abstand zwischen zwei Städten (Meter) */
	MIN_DISTANCE: 120,
	/** Maximaler Abstand zwischen zwei Städten (Meter) */
	MAX_DISTANCE: 220,

	// ── Spieler-Reichweiten (in Metern) ──
	/** Bei diesem Abstand wird das Stadt-Modell eingeblendet (≈ Nebelgrenze) */
	VISIBILITY_RANGE: 40,
	/** Bei diesem Abstand gilt eine Stadt als "erreicht" */
	ARRIVAL_DISTANCE: 15,
	/**
	 * Sobald der Spieler diesen Abstand von der letzten besuchten Stadt
	 * entfernt ist, wird die Leitspur zur nächsten Stadt aktiviert.
	 * Verhindert den Sofort-Redirect und gibt Zeit zum Erkunden.
	 */
	ACTIVATION_DISTANCE: 30,
} as const;
