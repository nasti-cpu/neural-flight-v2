import * as THREE from "three";

export type GuidanceVariant = "city" | "target" | "path";

export interface GuidanceConfig {
	color: number;
	particleColor: number;
	particleCount: number;
	particleSpeed: number;
	waveAmp: number;
	waveFreq: number;
	opacity: number;
	tubeRadius: number;
	curveSegments: number;
	targetRadius: number;
	label: string;
	description: string;
}

export const GUIDANCE_VARIANTS: GuidanceVariant[] = ["city", "target", "path"];

export const VARIANT_CONFIGS: Record<GuidanceVariant, GuidanceConfig> = {
	city: {
		color: 0x00e5ff,
		particleColor: 0x88ffff,
		particleCount: 100,
		particleSpeed: 1.8,
		waveAmp: 1.2,
		waveFreq: 0.25,
		opacity: 0.85,
		tubeRadius: 0.05,
		curveSegments: 64,
		targetRadius: 2,
		label: "Stadt-Leitung",
		description: "Fuehrt zu Staedten und Siedlungen - Cyan, gleichmaessig, klar",
	},
	target: {
		color: 0xffaa44,
		particleColor: 0xffcc66,
		particleCount: 70,
		particleSpeed: 1.2,
		waveAmp: 2.0,
		waveFreq: 0.18,
		opacity: 0.65,
		tubeRadius: 0.04,
		curveSegments: 48,
		targetRadius: 1.5,
		label: "Ziel-Leitung",
		description: "Fuehrt zu Kreaturen & Objekten - Gold, organisch, warm",
	},
	path: {
		color: 0xaa77ff,
		particleColor: 0xccbbff,
		particleCount: 150,
		particleSpeed: 0.7,
		waveAmp: 2.8,
		waveFreq: 0.12,
		opacity: 0.45,
		tubeRadius: 0.03,
		curveSegments: 80,
		targetRadius: 1.0,
		label: "Pfad-Leitung",
		description: "Erkundungspfade - Violett, sanft, weitlaeufig",
	},
};

const PULSE_SPEED = 0.3;
const PULSE_WIDTH = 0.15;
const ARROW_TEX_SIZE = 64;
const TUBE_RADIAL_SEGMENTS = 6;

function createArrowTexture(): THREE.CanvasTexture {
	const c = document.createElement("canvas");
	c.width = ARROW_TEX_SIZE;
	c.height = ARROW_TEX_SIZE;
	const ctx = c.getContext("2d")!;
	const s = ARROW_TEX_SIZE;
	const cx = s / 2;
	const cy = s / 2;
	const r = s * 0.4;
	const hl = s * 0.08;

	ctx.clearRect(0, 0, s, s);

	// Right-pointing arrowhead
	ctx.fillStyle = "white";
	ctx.beginPath();
	ctx.moveTo(cx + r, cy);
	ctx.lineTo(cx - r * 0.5, cy - r * 0.65);
	ctx.lineTo(cx - r * 0.2, cy - hl);
	ctx.closePath();
	ctx.fill();
	ctx.beginPath();
	ctx.moveTo(cx + r, cy);
	ctx.lineTo(cx - r * 0.5, cy + r * 0.65);
	ctx.lineTo(cx - r * 0.2, cy + hl);
	ctx.closePath();
	ctx.fill();
	ctx.fillRect(cx - r * 0.5, cy - hl, r * 0.6, hl * 2);

	const tex = new THREE.CanvasTexture(c);
	tex.needsUpdate = true;
	return tex;
}

export interface GuidancePath {
	group: THREE.Group;
	coreLine: THREE.Line;
	glowTube: THREE.Mesh;
	particles: THREE.Group;
	arrowMeshes: THREE.Mesh[];
	target: THREE.Group;
	config: GuidanceConfig;
	update: (elapsed: number) => void;
	dispose: () => void;
}

export function createGuidancePath(
	config: GuidanceConfig,
	baseControlPoints: THREE.Vector3[],
): GuidancePath {
	const group = new THREE.Group();

	const coreMat = new THREE.LineBasicMaterial({
		color: config.color,
		transparent: true,
		opacity: config.opacity,
		vertexColors: true,
	});

	const glowMat = new THREE.MeshBasicMaterial({
		color: config.color,
		transparent: true,
		opacity: config.opacity * 0.25,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
	});

	const arrowTex = createArrowTexture();

	const targetGroup = new THREE.Group();
	const outerGeo = new THREE.SphereGeometry(config.targetRadius, 20, 20);
	const outerMat = new THREE.MeshBasicMaterial({
		color: config.color,
		transparent: true,
		opacity: 0.1,
		wireframe: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	const outer = new THREE.Mesh(outerGeo, outerMat);

	const innerGeo = new THREE.SphereGeometry(config.targetRadius * 0.2, 12, 12);
	const innerMat = new THREE.MeshBasicMaterial({
		color: config.color,
		transparent: true,
		opacity: 0.5,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	const innerMesh = new THREE.Mesh(innerGeo, innerMat);

	targetGroup.add(outer);
	targetGroup.add(innerMesh);
	const endPt = baseControlPoints[baseControlPoints.length - 1];
	targetGroup.position.copy(endPt);

	// Pre-allocate geometry buffers (allocation-free per frame)
	const lineSegCount = config.curveSegments;
	const lineVertexCount = lineSegCount + 1;
	const ringCount = lineSegCount + 1;
	const vertPerRing = TUBE_RADIAL_SEGMENTS + 1;
	const tubeVertexCount = ringCount * vertPerRing;

	const linePosArr = new Float32Array(lineVertexCount * 3);
	const lineColArr = new Float32Array(lineVertexCount * 3);
	const tubePosArr = new Float32Array(tubeVertexCount * 3);

	const lineIdxArr = new Uint16Array(lineVertexCount);
	for (let i = 0; i < lineVertexCount; i++) lineIdxArr[i] = i;

	const tubeIdxArr = new Uint16Array(lineSegCount * TUBE_RADIAL_SEGMENTS * 6);
	let idx = 0;
	for (let j = 1; j <= lineSegCount; j++) {
		for (let i = 1; i <= TUBE_RADIAL_SEGMENTS; i++) {
			const a = vertPerRing * (j - 1) + (i - 1);
			const b = vertPerRing * j + (i - 1);
			const c = vertPerRing * j + i;
			const d = vertPerRing * (j - 1) + i;
			tubeIdxArr[idx++] = a;
			tubeIdxArr[idx++] = b;
			tubeIdxArr[idx++] = d;
			tubeIdxArr[idx++] = b;
			tubeIdxArr[idx++] = c;
			tubeIdxArr[idx++] = d;
		}
	}

	const coreGeo = new THREE.BufferGeometry();
	coreGeo.setAttribute("position", new THREE.BufferAttribute(linePosArr, 3));
	coreGeo.setAttribute("color", new THREE.BufferAttribute(lineColArr, 3));
	coreGeo.setIndex(new THREE.BufferAttribute(lineIdxArr, 1));
	const coreLine = new THREE.Line(coreGeo, coreMat);

	const tubeGeo = new THREE.BufferGeometry();
	tubeGeo.setAttribute("position", new THREE.BufferAttribute(tubePosArr, 3));
	tubeGeo.setIndex(new THREE.BufferAttribute(tubeIdxArr, 1));
	const glowTube = new THREE.Mesh(tubeGeo, glowMat);

	const pCount = config.particleCount;
	const pProgress = new Float32Array(pCount);
	const arrowSize = 0.35;
	const arrowGeo = new THREE.PlaneGeometry(arrowSize, arrowSize);
	const arrowMat = new THREE.MeshBasicMaterial({
		map: arrowTex,
		transparent: true,
		opacity: 0.9,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
	});
	const arrowMeshes: THREE.Mesh[] = [];
	for (let i = 0; i < pCount; i++) {
		pProgress[i] = i / pCount;
		const m = new THREE.Mesh(arrowGeo, arrowMat);
		arrowMeshes.push(m);
	}
	const particles = new THREE.Group();
	for (const m of arrowMeshes) particles.add(m);

	group.add(coreLine);
	group.add(glowTube);
	group.add(particles);
	group.add(targetGroup);

	// Persistent state (no per-frame allocation)
	const baseColor = new THREE.Color(config.color);
	const origYArr = baseControlPoints.map((p) => p.y);
	const curve = new THREE.CatmullRomCurve3(baseControlPoints);

	const _pt = new THREE.Vector3();
	const _tan = new THREE.Vector3();
	const _normal = new THREE.Vector3();
	const _binormal = new THREE.Vector3();
	const _prevNormal = new THREE.Vector3(1, 0, 0);
	const _xAxis = new THREE.Vector3(1, 0, 0);

	function writeTubeRing(
		ringIdx: number,
		center: THREE.Vector3,
		normal: THREE.Vector3,
		binormal: THREE.Vector3,
	): void {
		const r = config.tubeRadius;
		const base = ringIdx * vertPerRing * 3;
		for (let j = 0; j < vertPerRing; j++) {
			const v = (j / TUBE_RADIAL_SEGMENTS) * Math.PI * 2;
			const s = Math.sin(v);
			const c = Math.cos(v);
			const idx3 = base + j * 3;
			tubePosArr[idx3] = center.x + (c * normal.x + s * binormal.x) * r;
			tubePosArr[idx3 + 1] = center.y + (c * normal.y + s * binormal.y) * r;
			tubePosArr[idx3 + 2] = center.z + (c * normal.z + s * binormal.z) * r;
		}
	}

	function setPulseColorsInPlace(
		pulseProgress: number,
		count: number,
		colArr: Float32Array,
		base: THREE.Color,
	): void {
		for (let i = 0; i < count; i++) {
			const t = i / (count - 1);
			const dist = Math.abs(t - pulseProgress);
			const distWrapped = Math.min(dist, 1 - dist);
			const intensity = distWrapped < PULSE_WIDTH
				? 1 - (distWrapped / PULSE_WIDTH) ** 2
				: 0;
			const boost = 1 + intensity * 2;
			colArr[i * 3] = base.r * boost;
			colArr[i * 3 + 1] = base.g * boost;
			colArr[i * 3 + 2] = base.b * boost;
		}
	}

	// Initialise geometry once so first frame does not show empty buffers
	{
		const initCurve = new THREE.CatmullRomCurve3(baseControlPoints);
		for (let i = 0; i < lineVertexCount; i++) {
			const t = i / lineSegCount;
			initCurve.getPoint(t, _pt);
			linePosArr[i * 3] = _pt.x;
			linePosArr[i * 3 + 1] = _pt.y;
			linePosArr[i * 3 + 2] = _pt.z;
		}
		setPulseColorsInPlace(0, lineVertexCount, lineColArr, baseColor);
		coreGeo.attributes.position.needsUpdate = true;
		coreGeo.attributes.color.needsUpdate = true;
		coreGeo.computeBoundingSphere();

		_prevNormal.set(1, 0, 0);
		for (let i = 0; i < ringCount; i++) {
			const t = i / lineSegCount;
			initCurve.getPoint(t, _pt);
			initCurve.getTangent(t, _tan);
			const d = _prevNormal.dot(_tan);
			_normal.copy(_prevNormal).addScaledVector(_tan, -d).normalize();
			_binormal.crossVectors(_tan, _normal).normalize();
			_prevNormal.copy(_normal);
			writeTubeRing(i, _pt, _normal, _binormal);
		}
		tubeGeo.attributes.position.needsUpdate = true;
		tubeGeo.computeBoundingSphere();

		for (let i = 0; i < pCount; i++) {
			const t = pProgress[i];
			initCurve.getPoint(t, _pt);
			initCurve.getTangent(t, _tan);
			arrowMeshes[i].position.copy(_pt);
			if (_tan.lengthSq() > 0.0001) {
				_tan.normalize();
				arrowMeshes[i].quaternion.setFromUnitVectors(_xAxis, _tan);
			}
		}
	}

	let pulseProgress = 0;

	return {
		group,
		coreLine,
		glowTube,
		particles,
		arrowMeshes,
		target: targetGroup,
		config,
		update(elapsed: number) {
			// 1. Mutate control points in place
			for (let i = 0; i < baseControlPoints.length; i++) {
				const t = i / (baseControlPoints.length - 1);
				const wave = Math.sin(t * Math.PI * 4 + elapsed * config.waveFreq) * config.waveAmp;
				baseControlPoints[i].y = origYArr[i] + wave;
			}

			// 2. Update line positions
			for (let i = 0; i < lineVertexCount; i++) {
				const t = i / lineSegCount;
				curve.getPoint(t, _pt);
				linePosArr[i * 3] = _pt.x;
				linePosArr[i * 3 + 1] = _pt.y;
				linePosArr[i * 3 + 2] = _pt.z;
			}
			coreGeo.attributes.position.needsUpdate = true;

			// 3. Pulse colours
			pulseProgress = (elapsed * PULSE_SPEED) % 1;
			setPulseColorsInPlace(pulseProgress, lineVertexCount, lineColArr, baseColor);
			coreGeo.attributes.color.needsUpdate = true;

			// 4. Update tube positions via parallel-transport frame
			_prevNormal.set(1, 0, 0);
			for (let i = 0; i < ringCount; i++) {
				const t = i / lineSegCount;
				curve.getPoint(t, _pt);
				curve.getTangent(t, _tan);
				const d = _prevNormal.dot(_tan);
				_normal.copy(_prevNormal).addScaledVector(_tan, -d).normalize();
				_binormal.crossVectors(_tan, _normal).normalize();
				_prevNormal.copy(_normal);
				writeTubeRing(i, _pt, _normal, _binormal);
			}
			tubeGeo.attributes.position.needsUpdate = true;

			// 5. Animate particles along the curve
			const speed = config.particleSpeed * 0.008;
			for (let i = 0; i < pCount; i++) {
				pProgress[i] += speed;
				if (pProgress[i] > 1) pProgress[i] -= 1;
				const t = pProgress[i];
				curve.getPoint(t, _pt);
				curve.getTangent(t, _tan);
				arrowMeshes[i].position.copy(_pt);
				if (_tan.lengthSq() > 0.0001) {
					_tan.normalize();
					arrowMeshes[i].quaternion.setFromUnitVectors(_xAxis, _tan);
				}
			}

			// 6. Pulse the target sphere + glow
			const pulse = 0.6 + 0.4 * Math.sin(elapsed * 2);
			targetGroup.children[0].scale.setScalar(pulse);
			targetGroup.children[1].scale.setScalar(0.8 + 0.2 * Math.sin(elapsed * 3));
			glowMat.opacity = config.opacity * 0.25 * (0.6 + 0.4 * Math.sin(elapsed * 2));
		},
		dispose() {
			coreGeo.dispose();
			coreMat.dispose();
			tubeGeo.dispose();
			glowMat.dispose();
			arrowGeo.dispose();
			arrowMat.dispose();
			arrowTex.dispose();
			outerGeo.dispose();
			outerMat.dispose();
			innerGeo.dispose();
			innerMat.dispose();
		},
	};
}
