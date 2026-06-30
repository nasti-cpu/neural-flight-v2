/**
 * insect-world-v2 — Alpen-Panorama.
 * Ein Ring aus Bergen, der immer in der Ferne bleibt
 * und sich mit dem Spieler mitbewegt.
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import * as THREE from "three/webgpu";
import { attribute, clamp, float, mix, smoothstep, vec3 } from "three/tsl";

/** Erzeugt eine Bergkette als Ring um den Spieler. */
export function createAlpineRing(): THREE.Mesh {
	const innerRadius = 80;
	const outerRadius = 110;
	const angularSegs = 200;
	const radialSegs = 6;

	const positions: number[] = [];
	const heights: number[] = [];

	// Knoten-Positionen + Höhen berechnen
	for (let i = 0; i <= angularSegs; i++) {
		const theta = (i / angularSegs) * Math.PI * 2;
		const cos = Math.cos(theta);
		const sin = Math.sin(theta);

		for (let j = 0; j <= radialSegs; j++) {
			const rad = innerRadius + (j / radialSegs) * (outerRadius - innerRadius);
			const radialFrac = j / radialSegs;

			const height = mountainHeight(theta, radialFrac);

			positions.push(rad * cos, height, rad * sin);
			heights.push(height);
		}
	}

	// Indizes (2 Dreiecke pro Quad)
	const indices: number[] = [];
	for (let i = 0; i < angularSegs; i++) {
		for (let j = 0; j < radialSegs; j++) {
			const a = i * (radialSegs + 1) + j;
			const b = a + 1;
			const c = (i + 1) * (radialSegs + 1) + j;
			const d = c + 1;
			indices.push(a, c, b, b, c, d);
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("height", new THREE.Float32BufferAttribute(heights, 1));
	geo.setIndex(indices);
	geo.computeVertexNormals();

	// TSL-Material: Höhe → Farbe (Grün → Grau → Weiß)
	const h = attribute("height", "float");
	const t = clamp(h.div(25), float(0), float(1));
	const base = mix(vec3(0.35, 0.55, 0.2), vec3(0.55, 0.55, 0.5), smoothstep(float(0), float(0.3), t));
	const color = mix(base, vec3(1, 1, 1), smoothstep(float(0.4), float(0.7), t));

	const mat = new THREE.MeshBasicNodeMaterial();
	mat.colorNode = color;
	mat.side = THREE.DoubleSide;
	mat.fog = false;

	const mesh = new THREE.Mesh(geo, mat);
	mesh.frustumCulled = false;

	return mesh;
}

/** Einfaches Rauschen aus überlagerten Sinuswellen. */
function mountainHeight(theta: number, radialFrac: number): number {
	const n = Math.sin(theta * 3 + 1.2) * 0.5
		+ Math.sin(theta * 7 + 3.4) * 0.3
		+ Math.sin(theta * 13 + 5.6) * 0.15
		+ Math.cos(theta * 19 + 0.8) * 0.08
		+ Math.sin(theta * 27 + 2.1) * 0.04;
	const peak = Math.max(0, n * 1.5);
	const falloff = 1 - radialFrac * 0.3;
	return peak * 22 * falloff;
}
