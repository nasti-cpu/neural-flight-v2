/**
 * portalTunnel.ts – Portal-Innensicht als Ladeanimation.
 *
 * Fullscreen-Quad mit TSL-Shader: rendert einen 3D-Tunnel-Effekt
 * (konzentrische Ringe + Spirale + Glow), der sich nach vorne
 * durch die Zeit animiert. Keine Texturen, keine extra Assets.
 *
 * WebGPU + TSL.
 */

import * as THREE from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
	uv,
	vec2,
	vec3,
	float,
	sin,
	cos,
	time,
	atan,
	length,
	mix,
} from "three/tsl";

export interface PortalTunnel {
	mesh: THREE.Mesh;
	dispose: () => void;
}

export function createPortalTunnel(): PortalTunnel {
	// Fullscreen-Quad (2×2, Camera-unabhängig)
	const geo = new THREE.PlaneGeometry(2, 2);

	const colorNode = _buildTunnelColor();

	const mat = new MeshBasicNodeMaterial();
	mat.colorNode = colorNode;
	mat.transparent = true;
	mat.opacity = 0;
	mat.depthWrite = false;
	mat.depthTest = false;
	mat.toneMapped = false;

	const mesh = new THREE.Mesh(geo, mat);
	mesh.renderOrder = 998; // unter fadeSprite (999), über allem anderen
	mesh.frustumCulled = false;

	function dispose(): void {
		geo.dispose();
		mat.dispose();
	}

	return { mesh, dispose };
}

function _buildTunnelColor() {
	// Zentrierte UVs [-1 … 1]
	const centerUV = uv().mul(2).sub(1);
	const radius = length(centerUV);

	// Polarkoordinaten (für Spirale)
	const angle = atan(centerUV.y, centerUV.x);

	// ── Konzentrische Ringe (scrollen nach außen → Vorwärtsflug) ──
	const rings = sin(radius.mul(50).add(time.mul(3))).mul(0.5).add(0.5);

	// Frequenz-Mix für Tiefenstaffelung
	const rings2 = sin(radius.mul(30).add(time.mul(2.2))).mul(0.3).add(0.3);

	// ── Spirale ──
	const spiral = sin(angle.mul(6).add(radius.mul(20)).add(time.mul(2)));

	// ── Center Glow (hell in der Mitte) ──
	const glowRaw = float(1).sub(radius.mul(1.2)).max(0);
	const glow = glowRaw.mul(glowRaw); // quadratisch abfallend

	// ── Farben ──
	const tunnelColor = vec3(
		rings.mul(0.25).add(rings2.mul(0.15)),     // R
		rings.mul(0.35).add(rings2.mul(0.2)),       // G
		rings.mul(0.5).add(rings2.mul(0.25)),        // B
	);

	const spiralColor = vec3(
		spiral.mul(0.15).add(0.15),
		spiral.mul(0.2).add(0.2),
		spiral.mul(0.3).add(0.3),
	);

	const glowColor = vec3(
		glow.mul(0.4),
		glow.mul(0.6),
		glow.mul(0.9),
	);

	// ── Combine ──
	// Hintergrund schwarz, Tunnel + Spirale + Glow addieren
	const result = vec3(0, 0, 0)
		.add(tunnelColor)
		.add(spiralColor)
		.add(glowColor);

	return result;
}
