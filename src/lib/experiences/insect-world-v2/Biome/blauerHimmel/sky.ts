/**
 * insect-world-v2 — Himmel (Blauer Himmel).
 * TSL-Himmelskugel mit 3-Stop-Gradient (unten → Horizont → oben).
 * Nutzt MeshBasicNodeMaterial + nStopGradient für GPU-Gradient.
 * SphereGeometry + BackSide für Inside-Out-Rendering (VR-kompatibel).
 *
 * Presets: [unten (hell), Horizont, oben (dunkel)]
 * power: Exponent >1 = heller Bereich reicht höher, Übergang wird schärfer.
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

export function createSky(preset: SkyPresetName = "gletscher", power = 2): THREE.Mesh {
	const hexColors = SKY_PRESETS[preset] as unknown as number[];

	// SphereGeometry, KEIN scale(-1,1,1) — das zerstört WebGPU-Rendering
	const radius = 500;
	const geo = new THREE.SphereGeometry(radius, 32, 32);

	const colorNodes = hexColors.map((h) => {
		const c = new THREE.Color(h);
		return vec3(c.r, c.g, c.b);
	});

	// Gradient-Faktor: y von -1 (unten) → 0 (Horizont) → +1 (oben)
	const tRaw = positionWorld.normalize().y.mul(0.5).add(0.5);
	const t = power > 1 ? tRaw.pow(power) : tRaw;

	const mat = new THREE.MeshBasicNodeMaterial();
	mat.colorNode = nStopGradient(colorNodes, t);
	mat.side = THREE.BackSide;
	mat.fog = false;

	const mesh = new THREE.Mesh(geo, mat);
	mesh.frustumCulled = false;
	return mesh;
}
