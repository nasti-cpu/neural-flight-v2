/**
 * portalRift.ts – Space-Time Rift Portal (für Übergänge).
 *
 * Erzeugt einen pulsierenden Riss im Raum mit neutral-weißem Glow
 * und einer rotierenden Spirale im Inneren.
 *
 * WebGPU + TSL.
 */

import * as THREE from "three/webgpu";
import { MeshBasicNodeMaterial, PointsNodeMaterial } from "three/webgpu";
import {
	uniform,
	vec2,
	vec3,
	vec4,
	float,
	positionLocal,
	sin,
	cos,
	time,
} from "three/tsl";

export interface RiftPortal {
	group: THREE.Group;
	dispose: () => void;
}

export interface RiftConfig {
	width?: number;
	height?: number;
	scale?: number;
}

function createRiftShape(w: number, h: number, jitter: number): THREE.Shape {
	const shape = new THREE.Shape();
	const pts = 50;
	for (let i = 0; i <= pts; i++) {
		const t = (i / pts) * Math.PI * 2;
		const jx = (Math.sin(t * 7 + 1.3) * 0.3 + Math.sin(t * 13 + 4.7) * 0.2) * jitter;
		const jy = (Math.cos(t * 5 + 2.1) * 0.3 + Math.cos(t * 11 + 0.5) * 0.2) * jitter;
		const x = Math.cos(t) * (w + jx);
		const y = Math.sin(t) * (h + jy);
		if (i === 0) shape.moveTo(x, y);
		else shape.lineTo(x, y);
	}
	return shape;
}

export function createRiftPortal(config?: RiftConfig): RiftPortal {
	const w = config?.width ?? 0.5;
	const h = config?.height ?? 1.2;
	const scale = config?.scale ?? 1;

	const group = new THREE.Group();

	// ── Riss-Hauptkörper ──
	const shape = createRiftShape(w, h, 0.12);
	const riftGeo = new THREE.ShapeGeometry(shape, 40);

	const posX = positionLocal.x;
	const posY = positionLocal.y;
	const pos2d = vec2(posX, posY);
	const dist = pos2d.length();
	const normX = posX.mul(0.8);
	const normY = posY.mul(0.8);
	const normDist = vec2(normX, normY).length();

	// Spirale innen
	const angle = normY.atan(normX);
	const spiralRaw = sin(angle.mul(3).add(normDist.mul(18)).sub(time.mul(1.5)));
	const swirlStrength = float(1).sub(normDist.mul(1.8)).max(0);
	const swirlBright = spiralRaw.mul(0.5).add(0.5).mul(swirlStrength);

	const bgColor = vec3(0, 0, 0);
	const swirlColor = vec3(
		swirlBright.mul(0.8),
		swirlBright.mul(0.9),
		swirlBright,
	);
	const interior = bgColor.add(swirlColor);

	// Rand-Glow
	const edgeGlow = float(1).sub(dist.mul(1.6)).max(0);
	const glowMask = edgeGlow.mul(edgeGlow);
	const glowColor = vec3(
		sin(time.mul(0.3)).mul(0.05).add(0.5),
		sin(time.mul(0.4).add(1)).mul(0.1).add(0.6),
		sin(time.mul(0.5).add(2)).mul(0.1).add(0.7),
	).mul(1.3);

	// Glitch
	const flashX = sin(posY.mul(30).add(time.mul(5))).abs();
	const flashY = sin(posX.mul(20).sub(time.mul(3))).abs();
	const flicker = flashX.mul(flashY).mul(0.1);
	const flickerColor = vec3(flicker.mul(0.5), flicker.mul(0.6), flicker.mul(0.8));

	const finalColor = interior.add(glowMask.mul(glowColor)).add(flickerColor);

	const riftMat = new MeshBasicNodeMaterial();
	riftMat.colorNode = finalColor;
	riftMat.transparent = true;
	riftMat.opacity = 0.95;
	riftMat.side = THREE.DoubleSide;
	riftMat.toneMapped = false;

	const riftMesh = new THREE.Mesh(riftGeo, riftMat);
	group.add(riftMesh);

	// ── Äußerer Rand-Glow ──
	const glowPulse = sin(time.mul(0.6)).mul(0.5).add(0.5);
	const glowShape = createRiftShape(w + 0.15, h + 0.15, 0.08);
	const glowGeo = new THREE.ShapeGeometry(glowShape, 40);
	const glowMat = new MeshBasicNodeMaterial();
	glowMat.colorNode = vec3(
		glowPulse.mul(0.25).add(0.15),
		glowPulse.mul(0.35).add(0.3),
		glowPulse.mul(0.5).add(0.4),
	);
	glowMat.transparent = true;
	glowMat.opacity = 0.5;
	glowMat.side = THREE.DoubleSide;
	glowMat.depthWrite = false;
	glowMat.toneMapped = false;
	const glowMesh = new THREE.Mesh(glowGeo, glowMat);
	glowMesh.position.z = -0.02;
	group.add(glowMesh);

	// ── Innerer Rand ──
	const edgeShape = createRiftShape(w + 0.03, h + 0.03, 0.06);
	const edgeGeo = new THREE.ShapeGeometry(edgeShape, 40);
	const edgeMat = new MeshBasicNodeMaterial();
	const fastPulse = sin(time.mul(1.2)).mul(0.3).add(0.7);
	edgeMat.colorNode = vec3(
		fastPulse.mul(0.15).add(0.2),
		fastPulse.mul(0.25).add(0.4),
		fastPulse.mul(0.4).add(0.6),
	);
	edgeMat.transparent = true;
	edgeMat.opacity = 0.7;
	edgeMat.side = THREE.DoubleSide;
	edgeMat.depthWrite = false;
	edgeMat.toneMapped = false;
	const edgeMesh = new THREE.Mesh(edgeGeo, edgeMat);
	edgeMesh.position.z = -0.01;
	group.add(edgeMesh);

	// ── Partikel ──
	const pCount = 150;
	const pPos = new Float32Array(pCount * 3);
	const pVel = new Float32Array(pCount * 3);
	for (let i = 0; i < pCount; i++) {
		const theta = (Math.random() - 0.5) * Math.PI * 1.2;
		const r = 0.05 + Math.random() * 0.3;
		pPos[i * 3] = Math.cos(theta) * r * w * 2;
		pPos[i * 3 + 1] = Math.sin(theta) * r * h * 2;
		pPos[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
		pVel[i * 3] = (Math.random() - 0.5) * 0.4;
		pVel[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
		pVel[i * 3 + 2] = 0.3 + Math.random() * 0.8;
	}
	const pGeo = new THREE.BufferGeometry();
	pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
	const pMat = new PointsNodeMaterial();
	pMat.transparent = true;
	pMat.blending = THREE.AdditiveBlending;
	pMat.depthWrite = false;
	pMat.sizeNode = float(0.03).add(sin(time.mul(3).add(positionLocal.x.mul(8))).mul(0.015));
	pMat.colorNode = vec4(
		vec3(
			float(0.5).add(sin(time.mul(0.5)).mul(0.1)),
			float(0.6).add(cos(time.mul(0.7)).mul(0.15)),
			float(0.8).add(sin(time.mul(0.4).add(1)).mul(0.1)),
		),
		float(0.5).add(sin(time.mul(2).add(positionLocal.z.mul(6))).mul(0.3)),
	);
	pMat.toneMapped = false;
	const ptMesh = new THREE.Points(pGeo, pMat);
	group.add(ptMesh);

	const _vel = pVel;
	const _count = pCount;
	const _geo = pGeo;
	let elapsed = 0;

	const _updateInterval = setInterval(() => {
		elapsed += 0.05;
		const posArr = _geo.getAttribute("position").array as Float32Array;
		for (let i = 0; i < _count; i++) {
			posArr[i * 3] += _vel[i * 3] * 0.05;
			posArr[i * 3 + 1] += _vel[i * 3 + 1] * 0.05;
			posArr[i * 3 + 2] += _vel[i * 3 + 2] * 0.05;
			if (posArr[i * 3 + 2] > 3.5) {
				const theta = (Math.random() - 0.5) * Math.PI * 1.2;
				posArr[i * 3] = Math.cos(theta) * (0.05 + Math.random() * 0.2);
				posArr[i * 3 + 1] = Math.sin(theta) * (0.05 + Math.random() * 0.2);
				posArr[i * 3 + 2] = -0.1;
				_vel[i * 3] = (Math.random() - 0.5) * 0.4;
				_vel[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
				_vel[i * 3 + 2] = 0.3 + Math.random() * 0.8;
			}
		}
		_geo.getAttribute("position").needsUpdate = true;
	}, 50);

	group.scale.set(scale, scale, scale);

	function dispose(): void {
		clearInterval(_updateInterval);
		riftGeo.dispose();
		riftMat.dispose();
		glowGeo.dispose();
		glowMat.dispose();
		edgeGeo.dispose();
		edgeMat.dispose();
		pGeo.dispose();
		pMat.dispose();
	}

	return { group, dispose };
}
