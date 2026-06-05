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
		description: "Führt zu Städten und Siedlungen — Cyan, gleichmäßig, klar",
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
		description: "Führt zu Kreaturen & Objekten — Gold, organisch, warm",
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
		description: "Erkundungspfade — Violett, sanft, weitläufig",
	},
};

	const _v = new THREE.Vector3();
const PULSE_SPEED = 0.3;
const PULSE_WIDTH = 0.15;
const ARROW_TEX_SIZE = 64;

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

	// Right-pointing arrowhead (→)
	ctx.fillStyle = "white";
	// Triangle head
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
	// Stem line
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

	// Target sphere
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

	// Empty geometries — will be rebuilt in init
	const coreGeo = new THREE.BufferGeometry();
	const coreLine = new THREE.Line(coreGeo, coreMat);

	const tempCurve = new THREE.CatmullRomCurve3(baseControlPoints);
	const glowGeo = new THREE.TubeGeometry(tempCurve, config.curveSegments, config.tubeRadius, 6, false);
	const glowTube = new THREE.Mesh(glowGeo, glowMat);

	// Arrow particles
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

	let pulseProgress = 0;

	function setPulseColors(count: number, colAttr: THREE.BufferAttribute): void {
		const arr = colAttr.array as Float32Array;
		const bc = new THREE.Color(config.color);
		for (let i = 0; i < count; i++) {
			const t = i / (count - 1);
			const dist = Math.abs(t - pulseProgress);
			const distWrapped = Math.min(dist, 1 - dist);
			const intensity = distWrapped < PULSE_WIDTH
				? 1 - (distWrapped / PULSE_WIDTH) ** 2
				: 0;
			const bright = bc.clone().multiplyScalar(1 + intensity * 2);
			arr[i * 3] = bright.r;
			arr[i * 3 + 1] = bright.g;
			arr[i * 3 + 2] = bright.b;
		}
		colAttr.needsUpdate = true;
	}

	function rebuildGeometry(pts: THREE.Vector3[]): THREE.CatmullRomCurve3 {
		const c = new THREE.CatmullRomCurve3(pts);

		const linePts = c.getPoints(config.curveSegments);
		const count = linePts.length;
		const linePos = new Float32Array(count * 3);
		const lineCol = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			linePos[i * 3] = linePts[i].x;
			linePos[i * 3 + 1] = linePts[i].y;
			linePos[i * 3 + 2] = linePts[i].z;
		}
		setPulseColors(count, new THREE.BufferAttribute(lineCol, 3));
		coreLine.geometry.dispose();
		coreLine.geometry = new THREE.BufferGeometry();
		coreLine.geometry.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
		coreLine.geometry.setAttribute("color", new THREE.BufferAttribute(lineCol, 3));

		glowTube.geometry.dispose();
		glowTube.geometry = new THREE.TubeGeometry(c, config.curveSegments, config.tubeRadius, 6, false);

		return c;
	}

	// Initialize
	{
		const initCurve = new THREE.CatmullRomCurve3(baseControlPoints);
		const linePts = initCurve.getPoints(config.curveSegments);
		const count = linePts.length;
		const linePos = new Float32Array(count * 3);
		const lineCol = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			linePos[i * 3] = linePts[i].x;
			linePos[i * 3 + 1] = linePts[i].y;
			linePos[i * 3 + 2] = linePts[i].z;
		}
		setPulseColors(count, new THREE.BufferAttribute(lineCol, 3));
		coreLine.geometry.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
		coreLine.geometry.setAttribute("color", new THREE.BufferAttribute(lineCol, 3));

		for (let i = 0; i < pCount; i++) {
			const t = pProgress[i];
			const p = initCurve.getPoint(t);
			const tan = initCurve.getTangent(t);
			arrowMeshes[i].position.copy(p);
			if (tan.lengthSq() > 0.0001) {
				arrowMeshes[i].quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan.normalize());
			}
		}
	}

	return {
		group,
		coreLine,
		glowTube,
		particles,
		arrowMeshes,
		target: targetGroup,
		config,
		update(elapsed: number) {
			const wavedPts = baseControlPoints.map((p, i) => {
				const t = i / (baseControlPoints.length - 1);
				const wave = Math.sin(t * Math.PI * 4 + elapsed * config.waveFreq) * config.waveAmp;
				_v.copy(p);
				_v.y += wave;
				return _v.clone();
			});

			pulseProgress = (elapsed * PULSE_SPEED) % 1;
			const c = rebuildGeometry(wavedPts);

			const speed = config.particleSpeed * 0.008;
			const tangent = new THREE.Vector3();
			for (let i = 0; i < pCount; i++) {
				pProgress[i] += speed;
				if (pProgress[i] > 1) pProgress[i] -= 1;
				const t = pProgress[i];
				const p = c.getPoint(t);
				const tan = c.getTangent(t);
				arrowMeshes[i].position.copy(p);
				if (tan.lengthSq() > 0.0001) {
					arrowMeshes[i].quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan.normalize());
				}
			}

			const pulse = 0.6 + 0.4 * Math.sin(elapsed * 2);
			targetGroup.children[0].scale.setScalar(pulse);
			targetGroup.children[1].scale.setScalar(0.8 + 0.2 * Math.sin(elapsed * 3));
			glowMat.opacity = config.opacity * 0.25 * (0.6 + 0.4 * Math.sin(elapsed * 2));
		},
		dispose() {
			coreLine.geometry.dispose();
			coreMat.dispose();
			glowTube.geometry.dispose();
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
