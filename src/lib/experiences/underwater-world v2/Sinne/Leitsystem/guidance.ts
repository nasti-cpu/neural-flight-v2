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

export interface GuidancePath {
	group: THREE.Group;
	coreLine: THREE.Line;
	glowTube: THREE.Mesh;
	particles: THREE.Points;
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
	});

	const glowMat = new THREE.MeshBasicMaterial({
		color: config.color,
		transparent: true,
		opacity: config.opacity * 0.25,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
	});

	const pMat = new THREE.PointsMaterial({
		color: config.particleColor,
		size: 0.15,
		transparent: true,
		opacity: 0.95,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		sizeAttenuation: true,
	});

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

	// Particles
	const pCount = config.particleCount;
	const pPos = new Float32Array(pCount * 3);
	const pProgress = new Float32Array(pCount);
	for (let i = 0; i < pCount; i++) {
		pProgress[i] = i / pCount;
	}
	const pGeo = new THREE.BufferGeometry();
	pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
	const particles = new THREE.Points(pGeo, pMat);

	group.add(coreLine);
	group.add(glowTube);
	group.add(particles);
	group.add(targetGroup);

	function rebuildGeometry(pts: THREE.Vector3[]): THREE.CatmullRomCurve3 {
		const c = new THREE.CatmullRomCurve3(pts);

		const linePts = c.getPoints(config.curveSegments);
		const linePos = new Float32Array(linePts.length * 3);
		for (let i = 0; i < linePts.length; i++) {
			linePos[i * 3] = linePts[i].x;
			linePos[i * 3 + 1] = linePts[i].y;
			linePos[i * 3 + 2] = linePts[i].z;
		}
		coreLine.geometry.dispose();
		coreLine.geometry = new THREE.BufferGeometry();
		coreLine.geometry.setAttribute("position", new THREE.BufferAttribute(linePos, 3));

		glowTube.geometry.dispose();
		glowTube.geometry = new THREE.TubeGeometry(c, config.curveSegments, config.tubeRadius, 6, false);

		return c;
	}

	// Initialize
	{
		const initCurve = new THREE.CatmullRomCurve3(baseControlPoints);
		const linePts = initCurve.getPoints(config.curveSegments);
		const linePos = new Float32Array(linePts.length * 3);
		for (let i = 0; i < linePts.length; i++) {
			linePos[i * 3] = linePts[i].x;
			linePos[i * 3 + 1] = linePts[i].y;
			linePos[i * 3 + 2] = linePts[i].z;
		}
		coreLine.geometry.setAttribute("position", new THREE.BufferAttribute(linePos, 3));

		const pos = particles.geometry.attributes.position.array as Float32Array;
		for (let i = 0; i < pCount; i++) {
			const p = initCurve.getPoint(pProgress[i]);
			pos[i * 3] = p.x;
			pos[i * 3 + 1] = p.y;
			pos[i * 3 + 2] = p.z;
		}
		particles.geometry.attributes.position.needsUpdate = true;
	}

	return {
		group,
		coreLine,
		glowTube,
		particles,
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

			const c = rebuildGeometry(wavedPts);

			const speed = config.particleSpeed * 0.008;
			const pos = particles.geometry.attributes.position.array as Float32Array;
			for (let i = 0; i < pCount; i++) {
				pProgress[i] += speed;
				if (pProgress[i] > 1) pProgress[i] -= 1;
				const p = c.getPoint(pProgress[i]);
				pos[i * 3] = p.x;
				pos[i * 3 + 1] = p.y;
				pos[i * 3 + 2] = p.z;
			}
			particles.geometry.attributes.position.needsUpdate = true;

			const pulse = 0.6 + 0.4 * Math.sin(elapsed * 2);
			targetGroup.children[0].scale.setScalar(pulse);
			targetGroup.children[1].scale.setScalar(0.8 + 0.2 * Math.sin(elapsed * 3));
		},
		dispose() {
			coreLine.geometry.dispose();
			coreMat.dispose();
			glowTube.geometry.dispose();
			glowMat.dispose();
			particles.geometry.dispose();
			pMat.dispose();
			outerGeo.dispose();
			outerMat.dispose();
			innerGeo.dispose();
			innerMat.dispose();
		},
	};
}
