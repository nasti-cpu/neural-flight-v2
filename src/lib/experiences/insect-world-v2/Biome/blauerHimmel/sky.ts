/**
 * insect-world-v2 — Himmel (Blauer Himmel).
 * TSL-Himmelskugel mit 3-Stop-Gradient (unten → Horizont → oben).
 * Nutzt MeshBasicNodeMaterial + nStopGradient für GPU-Gradient.
 * SphereGeometry + BackSide für Inside-Out-Rendering (VR-kompatibel).
 *
 * Presets: [unten (hell), Horizont, oben (dunkel)]
 * power: Exponent >1 = heller Bereich reicht höher, Übergang wird schärfer.
 *
 * Horizont-Fade: Der Himmel wird nahe der Horizontlinie (normal.y ≈ 0)
 * in die Nebelfarbe überblendet, damit der Horizont rund wirkt.
 */
import * as THREE from "three/webgpu";
import { vec3, positionWorld } from "three/tsl";
import { nStopGradient } from "$lib/tsl";

export const SKY_PRESETS = {
	klassisch: [0x1a3a6e, 0x4a90d9, 0x87ceeb],
	warm: [0x2c3e6b, 0x5b9bd5, 0xb0d4f1],
	klar: [0x2e6da4, 0x7fb3d8, 0xd4e6f1],
	pastell: [0x6bb5d6, 0xa8d8ea, 0xffffff],
	tief: [0x1b2838, 0x2c3e50, 0x5dade2],
	morgen: [0x4a7fb5, 0xa8d8ea, 0xf0d9ff],
	gletscher: [0xd4e6f1, 0x4a90d9, 0x0b1d3a],
} as const;

export type SkyPresetName = keyof typeof SKY_PRESETS;

// Nebelfarbe als Konstante (muss mit scene.ts übereinstimmen)
const FOG_COLOR = new THREE.Color("#4a90d9");

export function createSky(preset: SkyPresetName = "gletscher", power = 2, enableFade = true): THREE.Mesh {
	const hexColors = SKY_PRESETS[preset] as unknown as number[];

	const radius = 500;
	const geo = new THREE.SphereGeometry(radius, 32, 32);

	const colorNodes = hexColors.map((h) => {
		const c = new THREE.Color(h);
		return vec3(c.r, c.g, c.b);
	});

	// Gradient-Faktor: y von -1 (unten) → 0 (Horizont) → +1 (oben)
	const tRaw = positionWorld.normalize().y.mul(0.5).add(0.5);
	const t = power > 1 ? tRaw.pow(power) : tRaw;
	const skyColor = nStopGradient(colorNodes, t);

	// Horizont-Fade: Je flacher der Blickwinkel (normal.y ≈ 0),
	// desto mehr wird in Nebelfarbe überblendet.
	// Der Himmel "verschwindet" so am Horizont im Nebel → runder Horizont.
	// Kann mit enableFade=false abgeschaltet werden (für Tests).
	let finalColor = skyColor;
	if (enableFade) {
		const horizonFade = positionWorld.normalize().y.abs().oneMinus().pow(5);
		const fogNode = vec3(FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b);
		finalColor = skyColor.mix(fogNode, horizonFade);
	}

	const mat = new THREE.MeshBasicNodeMaterial();
	mat.colorNode = finalColor;
	mat.side = THREE.BackSide;
	mat.fog = false;

	const mesh = new THREE.Mesh(geo, mat);
	mesh.frustumCulled = false;
	return mesh;
}

/**
 * Aktualisiert die Nebelfarbe im Himmelshader.
 * Wird aufgerufen, wenn der Benutzer die Nebelfarbe im Manifest ändert.
 */
export function updateSkyFogColor(skyMesh: THREE.Mesh, color: THREE.Color): void {
	const mat = skyMesh.material as THREE.MeshBasicNodeMaterial;
	// Die Nebelfarbe ist als Uniform im TSL-Graphen eingebaut.
	// Da TSL-Knoten nicht einfach überschrieben werden können,
	// erstellen wir den Himmel neu.
	// (Das passiert nur bei Settings-Änderungen, nicht jeden Frame.)
	const preset = "gletscher"; // TODO: aus Settings lesen, wenn konfigurierbar
	const power = 2;
	const hexColors = SKY_PRESETS[preset] as unknown as number[];
	const colorNodes = hexColors.map((h) => {
		const c = new THREE.Color(h);
		return vec3(c.r, c.g, c.b);
	});
	const tRaw = positionWorld.normalize().y.mul(0.5).add(0.5);
	const t = power > 1 ? tRaw.pow(power) : tRaw;
	const skyColor = nStopGradient(colorNodes, t);
	const horizonFade = positionWorld.normalize().y.abs().oneMinus().pow(5);
	const fogNode = vec3(color.r, color.g, color.b);
	const finalColor = skyColor.mix(fogNode, horizonFade);
	mat.colorNode = finalColor;
	mat.needsUpdate = true;
}
