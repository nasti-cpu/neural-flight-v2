/**
 * portalTunnel.ts – Portal-Innensicht als Ladeanimation.
 *
 * Fullscreen-Quad mit TSL-Shader: rendert einen 3D-Perspektiv-Tunnel
 * mit echten Tiefeneindruck. Keine Texturen, keine extra Assets.
 *
 * So entsteht der 3D-Effekt:
 * - `depth = 15 / radius`: Mitte = unendlich fern, Rand = nah am Betrachter
 * - Ringe (Querstreben) scrollen entlang depth → Vorwärtsflug
 * - Speed-Lines: helle radiale Streifen schiessen nach aussen
 * - Ausgangslicht: helle Kugel im Zentrum (Exit)
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
	fract,
	abs,
} from "three/tsl";

export interface PortalTunnel {
	mesh: THREE.Mesh;
	dispose: () => void;
}

export function createPortalTunnel(): PortalTunnel {
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
	mesh.renderOrder = 998;
	mesh.frustumCulled = false;

	function dispose(): void {
		geo.dispose();
		mat.dispose();
	}

	return { mesh, dispose };
}

function _buildTunnelColor() {
	const centerUV = uv().mul(2).sub(1);
	const radius = length(centerUV);

	// Polarkoordinaten
	const angle = atan(centerUV.y, centerUV.x);

	// ── 3D-Perspektive ──
	// Division durch radius: Mitte (radius→0) = unendlich weit
	// Rand (radius→1) = nah. Erzeugt automatische Tiefenstaffelung.
	const depth = float(15).div(radius.add(0.001));
	const scroll = depth.add(time.mul(2.5)); // scrollt nach vorne

	// ── Tunnel-Ringe (Querstreben im Tiefenraum) ──
	const ribs = sin(scroll.mul(1.5)).mul(0.5).add(0.5);
	const ribs2 = sin(scroll.mul(3).add(1.2)).mul(0.3).add(0.3);

	// ── Speed-Lines ──
	// Zufalls-basierte helle Streifen radial entlang des Tunnels
	const seed = sin(angle.mul(24).add(depth.mul(0.2))).mul(43758.5453);
	const streakRaw = fract(seed);
	const streak = streakRaw.sub(0.97).max(0).mul(30);

	// ── Spirale (rotierend, tiefer im Tunnel) ──
	const spiral = sin(angle.mul(4).add(scroll.mul(2))).mul(0.5).add(0.5);
	const spiralMask = float(1).sub(radius.mul(1.5)).max(0);

	// ── Ausgangslicht (Exit-Glow) ──
	const exitRaw = float(1).sub(radius.mul(1.5)).max(0);
	const exitGlow = exitRaw.mul(exitRaw).mul(2.5);

	// ── Tunnel-Wand-Fläche (leichte Rillen in der Tiefe) ──
	const wallRipple = sin(angle.mul(8).add(depth.mul(4))).mul(0.1);

	// ── Farben (Cyan/Weiß – Portal-Theme Konsistenz) ──
	const tunnelColor = vec3(
		ribs.mul(0.15).add(ribs2.mul(0.1)).add(wallRipple.mul(0.5)),
		ribs.mul(0.25).add(ribs2.mul(0.15)).add(wallRipple.mul(0.5)),
		ribs.mul(0.4).add(ribs2.mul(0.25)).add(wallRipple.mul(0.5)),
	);

	const streakColor = vec3(
		streak.mul(0.3),
		streak.mul(0.5),
		streak.mul(0.8),
	);

	const spiralColor = vec3(
		spiral.mul(0.15).mul(spiralMask),
		spiral.mul(0.2).mul(spiralMask),
		spiral.mul(0.35).mul(spiralMask),
	);

	const exitColor = vec3(
		exitGlow.mul(0.3),
		exitGlow.mul(0.55),
		exitGlow.mul(1.0),
	);

	const result = vec3(0, 0, 0)
		.add(tunnelColor)
		.add(streakColor)
		.add(spiralColor)
		.add(exitColor);

	return result;
}
