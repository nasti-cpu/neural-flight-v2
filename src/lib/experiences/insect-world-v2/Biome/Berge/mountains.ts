/**
 * insect-world-v2 — Alpine Horizon Mountains (Bergpanorama).
 *
 * Ein Ring aus Bergen, der immer am Horizont bleibt und
 * auf dem Boden steht (folgt der Geländehöhe).
 *
 * Die Berge folgen der XZ-Position des Spielers, sodass sie
 * nie erreichbar sind. Die Höhe (Y) wird dynamisch an die
 * Bodenhöhe am aktuellen Standort angepasst.
 *
 * Optimiert für VR:
 * - 128 × 6 Segmente
 * - TSL-Shader für Farbverlauf (Grün → Fels → Schnee)
 * - fog: false, frustumCulled: false
 * - renderOrder: -1 (Hintergrund)
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import * as THREE from "three/webgpu";
import { attribute, clamp, float, mix, smoothstep, vec3 } from "three/tsl";
import { getWorldHeight } from "../Wiese/grass-manager";

// ── Konstanten ──

const INNER_RADIUS = 250;     // Innenradius (näher am Spieler)
const OUTER_RADIUS = 450;     // Außenradius (weiter entfernt)
const ANGULAR_SEGMENTS = 96;  // Unterteilungen im Kreis
const RADIAL_SEGMENTS = 6;    // Unterteilungen von innen nach außen
const MAX_HEIGHT = 40;        // Maximale Berghöhe ab Boden

/**
 * Generiert die Berghöhe an einem bestimmten Winkel und radialem Abstand.
 * Die Höhe ist 0 an den Rändern und steigt zur Mitte hin an,
 * damit die Berge nahtlos in den Boden übergehen.
 */
function mountainHeight(theta: number, radialFrac: number): number {
	// Rausch-Wellen für die Bergsilhouette
	const n = Math.sin(theta * 2 + 1.2) * 0.5 +
		Math.sin(theta * 5 + 3.4) * 0.35 +
		Math.sin(theta * 11 + 5.6) * 0.18 +
		Math.cos(theta * 17 + 0.8) * 0.08 +
		Math.sin(theta * 23 + 2.1) * 0.04 +
		Math.cos(theta * 31 + 4.3) * 0.03;

	const peak = Math.max(0, n * 1.4);

	// Sanfte Auslauframpe an den Rändern → Verbindung zum Boden
	const edgeFade = 1 - Math.pow(Math.abs(radialFrac - 0.5) * 2, 3);
	return peak * MAX_HEIGHT * Math.max(0, edgeFade);
}

/**
 * Baut die Ring-Geometrie.
 * Die Höhenwerte sind relativ zum Boden (0 = Boden).
 */
function buildRingGeometry(): THREE.BufferGeometry {
	const positions: number[] = [];
	const heights: number[] = [];
	const rows = ANGULAR_SEGMENTS + 1;
	const cols = RADIAL_SEGMENTS + 1;

	for (let i = 0; i < rows; i++) {
		const theta = (i / ANGULAR_SEGMENTS) * Math.PI * 2;
		const cos = Math.cos(theta);
		const sin = Math.sin(theta);

		for (let j = 0; j < cols; j++) {
			const frac = j / RADIAL_SEGMENTS;
			const r = INNER_RADIUS + frac * (OUTER_RADIUS - INNER_RADIUS);
			const h = mountainHeight(theta, frac);

			positions.push(r * cos, h, r * sin);
			heights.push(h);
		}
	}

	const indices: number[] = [];
	for (let i = 0; i < ANGULAR_SEGMENTS; i++) {
		for (let j = 0; j < RADIAL_SEGMENTS; j++) {
			const a = i * cols + j;
			const b = a + 1;
			const c = (i + 1) * cols + j;
			const d = c + 1;
			indices.push(a, c, b, b, c, d);
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("height", new THREE.Float32BufferAttribute(heights, 1));
	geo.setIndex(indices);
	geo.computeVertexNormals();
	return geo;
}

// ── Öffentliche API ──

/**
 * Erzeugt den Bergring.
 * Die Y-Position wird später in updateMountainsPosition() gesetzt.
 */
export function createAlpineRing(): THREE.Mesh {
	const geo = buildRingGeometry();

	// TSL-Shader: relative Höhe → Farbe (Grün → Fels → Schnee)
	const h = attribute("height", "float");
	const t = clamp(h.div(MAX_HEIGHT), float(0), float(1));

	const base = mix(
		vec3(0.20, 0.35, 0.15),
		vec3(0.50, 0.48, 0.40),
		smoothstep(float(0), float(0.35), t),
	);

	const color = mix(
		base,
		vec3(0.95, 0.95, 1.0),
		smoothstep(float(0.40), float(0.70), t),
	);

	const mat = new THREE.MeshBasicNodeMaterial({ colorNode: color });
	mat.side = THREE.DoubleSide;
	mat.fog = false;

	const mesh = new THREE.Mesh(geo, mat);
	mesh.frustumCulled = false;
	mesh.renderOrder = -1;

	return mesh;
}

/**
 * Setzt die Position des Bergrings auf die Bodenhöhe am Spielerstandort.
 * Die Berge stehen auf dem Boden und folgen dem Spieler in XZ.
 */
export function updateMountainsPosition(
	mesh: THREE.Mesh,
	playerPosition: THREE.Vector3,
): void {
	mesh.position.x = playerPosition.x;
	mesh.position.z = playerPosition.z;
	// Y so setzen, dass der Bergfuß im Boden steckt
	// Die Berge ragen dann MAX_HEIGHT Meter nach oben
	mesh.position.y = getWorldHeight(playerPosition.x, playerPosition.z) - 2;
}
