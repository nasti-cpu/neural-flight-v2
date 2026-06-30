/**
 * insect-world-v2 — Alpine Horizon Mountains (Bergpanorama).
 *
 * Ein Ring aus Bergen, der immer am Horizont bleibt.
 * Die Berge folgen der XZ-Position des Spielers,
 * sodass sie nie erreichbar sind und immer gleich weit entfernt wirken.
 * Rein dekorative Hintergrundkulisse — keine Kollision, keine Physik.
 *
 * Optimiert für VR:
 * - 128 × 4 Segmente (geringe Polygonanzahl)
 * - TSL-Shader für Farbverlauf (Grün → Fels → Schnee)
 * - fog: false (keine Überblendung mit Sichtnebel)
 * - frustumCulled: false (bewegt sich relativ zum Spieler)
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import * as THREE from "three/webgpu";
import { attribute, clamp, float, mix, smoothstep, vec3 } from "three/tsl";

// ── Konstanten ──
// Diese Werte bestimmen, wie weit weg die Berge sind und wie sie aussehen.

const INNER_RADIUS = 350;     // Innenradius des Bergrings (Einheit: Meter)
const OUTER_RADIUS = 450;     // Außenradius des Bergrings
const ANGULAR_SEGMENTS = 128; // Anzahl der Unterteilungen im Kreis (je mehr, desto feiner)
const RADIAL_SEGMENTS = 4;    // Unterteilungen von innen nach außen
const MAX_HEIGHT = 35;        // Maximale Höhe der Berggipfel
const Y_CENTER = 2;           // Y-Position des Rings (Horizonthöhe)

// ── Hilfsfunktionen ──

/**
 * Berechnet die Berghöhe an einem bestimmten Winkel (theta) und radialem Abstand.
 * Nutzt überlagerte Sinuswellen für natürliche, zufällig wirkende Bergkonturen.
 *
 * @param theta - Winkel im Kreis (0 bis 2π)
 * @param radialFrac - Anteil von innen (0) nach außen (1)
 */
function mountainHeight(theta: number, radialFrac: number): number {
	// Überlagerte Wellen mit unterschiedlichen Frequenzen erzeugen
	// realistische Bergsilhouetten (oben/unten, links/rechts).
	const n = Math.sin(theta * 2 + 1.2) * 0.5 +
		Math.sin(theta * 5 + 3.4) * 0.35 +
		Math.sin(theta * 11 + 5.6) * 0.18 +
		Math.cos(theta * 17 + 0.8) * 0.08 +
		Math.sin(theta * 23 + 2.1) * 0.04;

	// Nur positive Werte = Berge, negative = Täler
	const peak = Math.max(0, n * 1.5);

	// Außenkante etwas flacher für sanfteren Übergang zum Himmel
	const falloff = 1 - radialFrac * 0.3;
	return peak * MAX_HEIGHT * falloff;
}

/**
 * Baut die komplette Ring-Geometrie auf.
 * Ein Ring besteht aus vielen kleinen Vierecken (2 Dreiecke pro Viereck).
 * Jeder Vertex bekommt zusätzlich seine Höhe als Attribut für den Shader.
 */
function buildRingGeometry(): THREE.BufferGeometry {
	// 1. Positionen und Höhen berechnen
	const positions: number[] = [];
	const heights: number[] = [];
	const rows = ANGULAR_SEGMENTS + 1; // +1 weil letzter = erster (Kreisschluss)
	const cols = RADIAL_SEGMENTS + 1;

	for (let i = 0; i < rows; i++) {
		const theta = (i / ANGULAR_SEGMENTS) * Math.PI * 2;
		const cos = Math.cos(theta);
		const sin = Math.sin(theta);

		for (let j = 0; j < cols; j++) {
			const frac = j / RADIAL_SEGMENTS;
			const radius = INNER_RADIUS + frac * (OUTER_RADIUS - INNER_RADIUS);
			const h = mountainHeight(theta, frac) + Y_CENTER;

			positions.push(radius * cos, h, radius * sin);
			heights.push(h);
		}
	}

	// 2. Indizes für die Dreiecke (2 Dreiecke pro Viereck)
	const indices: number[] = [];
	for (let i = 0; i < ANGULAR_SEGMENTS; i++) {
		for (let j = 0; j < RADIAL_SEGMENTS; j++) {
			const a = i * cols + j;
			const b = a + 1;
			const c = (i + 1) * cols + j;
			const d = c + 1;
			// Zwei Dreiecke: (oben-links, unten-links, oben-rechts) + (oben-rechts, unten-links, unten-rechts)
			indices.push(a, c, b, b, c, d);
		}
	}

	// 3. Geometrie erstellen
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("height", new THREE.Float32BufferAttribute(heights, 1));
	geo.setIndex(indices);
	geo.computeVertexNormals();
	return geo;
}

// ── Öffentliche API ──

/**
 * Erzeugt einen Bergring, der immer am Horizont sichtbar ist.
 * Der Ring wird initial im Ursprung platziert und später
 * mit updateMountainsPosition() dem Spieler nachgeführt.
 */
export function createAlpineRing(): THREE.Mesh {
	// Geometrie einmalig erstellen (teuer) — danach nur noch Position updaten (günstig)
	const geo = buildRingGeometry();

	// ── TSL-Shader: Höhe bestimmt die Farbe ──
	// Je höher der Berg, desto mehr geht die Farbe von Grün über Grau zu Weiß (Schnee).
	const h = attribute("height", "float");
	const t = clamp(h.sub(Y_CENTER).div(MAX_HEIGHT), float(0), float(1));

	// Unterer Bereich: dunkles Grün (bewachsene Täler)
	const base = mix(
		vec3(0.25, 0.40, 0.18),
		vec3(0.55, 0.50, 0.42),
		smoothstep(float(0), float(0.35), t),
	);

	// Oberer Bereich: Übergang zu Schnee
	const color = mix(
		base,
		vec3(0.95, 0.95, 1.0),
		smoothstep(float(0.45), float(0.75), t),
	);

	// Material: BasicNodeMaterial (kein Licht nötig, nur Farbe)
	const mat = new THREE.MeshBasicNodeMaterial({ colorNode: color });
	mat.side = THREE.DoubleSide; // Von beiden Seiten sichtbar (für VR wichtig)
	mat.fog = false; // Kein Sichtnebel — Berge bleiben immer sichtbar

	const mesh = new THREE.Mesh(geo, mat);
	mesh.frustumCulled = false; // Kein Culling, da Ring sich relativ zum Spieler bewegt
	mesh.renderOrder = -1; // Vor anderen Objekten zeichnen (Hintergrund)

	return mesh;
}

/**
 * Bewegt den Bergring mit dem Spieler mit.
 * So bleiben die Berge immer gleich weit entfernt am Horizont.
 * Nur XZ wird angepasst — die Höhe (Y) bleibt fix.
 *
 * Aufruf in der tick()-Funktion jeder Frame:
 *   updateMountainsPosition(state.mountains, ctx.camera.position);
 */
export function updateMountainsPosition(
	mesh: THREE.Mesh,
	playerPosition: THREE.Vector3,
): void {
	mesh.position.x = playerPosition.x;
	mesh.position.z = playerPosition.z;
	// Y bleibt auf Horizonthöhe — die Berge schweben nicht mit der Kamera
	mesh.position.y = 0;
}
