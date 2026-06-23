/**
 * insect-world-v2 — Himmel (Blauer Himmel).
 * Erzeugt eine Himmelskugel mit Vertex-Color-Gradient.
 * Verwendet scale(-1,1,1) + DoubleSide für Inside-Out-Rendering (VR).
 * Farben: Top, Horizon, Bottom.
 */
import * as THREE from "three";

export const SKY_PRESETS = {
	klassisch: [0x1a3a6e, 0x4a90d9, 0x87ceeb],
	warm: [0x2c3e6b, 0x5b9bd5, 0xb0d4f1],
	klar: [0x2e6da4, 0x7fb3d8, 0xd4e6f1],
	pastell: [0x6bb5d6, 0xa8d8ea, 0xffffff],
	tief: [0x1b2838, 0x2c3e50, 0x5dade2],
	morgen: [0x4a7fb5, 0xa8d8ea, 0xf0d9ff],
} as const;

export type SkyPresetName = keyof typeof SKY_PRESETS;

export function createSky(preset: SkyPresetName = "klassisch"): THREE.Mesh {
	const hexColors = SKY_PRESETS[preset] as unknown as number[];

	const radius = 500;
	const geo = new THREE.IcosahedronGeometry(radius, 4);
	geo.scale(-1, 1, 1);

	const pos = geo.attributes.position;
	const colorArray = new Float32Array(pos.count * 3);
	const cTop = new THREE.Color(hexColors[0]);
	const cHorizon = new THREE.Color(hexColors[1]);
	const cBottom = new THREE.Color(hexColors[2]);
	const temp = new THREE.Color();

	for (let i = 0; i < pos.count; i++) {
		const y = pos.getY(i);
		const t = (y / radius + 1) * 0.5;

		if (t > 0.5) {
			const u = (t - 0.5) * 2;
			temp.copy(cHorizon).lerp(cTop, u);
		} else {
			const u = t * 2;
			temp.copy(cBottom).lerp(cHorizon, u);
		}

		colorArray[i * 3] = temp.r;
		colorArray[i * 3 + 1] = temp.g;
		colorArray[i * 3 + 2] = temp.b;
	}

	geo.setAttribute("color", new THREE.BufferAttribute(colorArray, 3));

	const mat = new THREE.MeshBasicMaterial({
		vertexColors: true,
		side: THREE.DoubleSide,
		fog: false,
	});

	const mesh = new THREE.Mesh(geo, mat);
	mesh.frustumCulled = false;
	return mesh;
}
