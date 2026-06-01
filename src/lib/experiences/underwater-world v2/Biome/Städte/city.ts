import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type CityVariant = "altstadt" | "zentrum" | "vorort";

// ── Config per variant ──

interface CityConfig {
	label: string;
	buildingCount: number;
	heightRange: [number, number];
	widthRange: [number, number];
	spread: number;
	buildingColors: number[];
	windowColor: number;
	domeColor: number;
	domeEmissive: number;
	lightColor: number;
	lightIntensity: number;
	glowColor: number;
}

const DOME_RADIUS = 65;

const CONFIG: Record<CityVariant, CityConfig> = {
	altstadt: {
		label: "Altstadt",
		buildingCount: 70,
		heightRange: [8, 28],
		widthRange: [4, 8],
		spread: DOME_RADIUS - 6,
		buildingColors: [0xcc9977, 0xddbb88, 0xbb8866, 0xccaa77, 0xddcc99],
		windowColor: 0xffcc44,
		domeColor: 0x886644,
		domeEmissive: 0x553311,
		lightColor: 0xffcc44,
		lightIntensity: 6,
		glowColor: 0xff8844,
	},
	zentrum: {
		label: "Zentrum",
		buildingCount: 90,
		heightRange: [30, 90],
		widthRange: [5, 10],
		spread: DOME_RADIUS - 4,
		buildingColors: [0x8899aa, 0x7788aa, 0x99aabb, 0x667788, 0xaaaacc],
		windowColor: 0x88ddff,
		domeColor: 0x336688,
		domeEmissive: 0x224466,
		lightColor: 0xaaccff,
		lightIntensity: 10,
		glowColor: 0x4488ff,
	},
	vorort: {
		label: "Vorort",
		buildingCount: 55,
		heightRange: [5, 18],
		widthRange: [6, 12],
		spread: DOME_RADIUS - 2,
		buildingColors: [0xddccaa, 0xccbb99, 0xeeddcc, 0xbbaa88, 0xddddaa],
		windowColor: 0xffee66,
		domeColor: 0x88aa88,
		domeEmissive: 0x446644,
		lightColor: 0xffdd66,
		lightIntensity: 4,
		glowColor: 0xddaa44,
	},
};

// ── Interface ──

export interface CityResult {
	group: THREE.Group;
	structureGroup: THREE.Group;
	domeMat: THREE.MeshPhysicalMaterial;
	glowHaloMat: THREE.MeshBasicMaterial;
	pointLight: THREE.PointLight;
}

// ── Create ──

export function createCity(variant: CityVariant): CityResult {
	const cfg = CONFIG[variant];
	const group = new THREE.Group();
	const structureGroup = new THREE.Group();
	const tmpCol = new THREE.Color();

	// ── Base platform ──
	const platGeo = new THREE.CylinderGeometry(DOME_RADIUS + 3, DOME_RADIUS + 4, 1.5, 48);
	const platMat = new THREE.MeshStandardMaterial({
		color: 0x2a3a4a,
		roughness: 0.9,
		flatShading: true,
	});
	const platform = new THREE.Mesh(platGeo, platMat);
	platform.position.y = -0.75;
	group.add(platform);

	// ── Point light ──
	const light = new THREE.PointLight(cfg.lightColor, cfg.lightIntensity, 800);
	light.position.set(0, 30, 0);
	light.userData.baseIntensity = cfg.lightIntensity;
	group.add(light);

	// ── Glow halo (BackSide additive sphere) ──
	const haloGeo = new THREE.SphereGeometry(110, 48, 30);
	const haloMat = new THREE.MeshBasicMaterial({
		color: cfg.glowColor,
		transparent: true,
		opacity: 0.15,
		blending: THREE.AdditiveBlending,
		side: THREE.BackSide,
		depthWrite: false,
	});
	const halo = new THREE.Mesh(haloGeo, haloMat);
	group.add(halo);

	// ── Geodesic dome ──
	const domeMat = new THREE.MeshPhysicalMaterial({
		color: cfg.domeColor,
		emissive: cfg.domeEmissive,
		emissiveIntensity: 0.15,
		transparent: true,
		opacity: 0.3,
		roughness: 0.1,
		metalness: 0.0,
		clearcoat: 0.8,
		side: THREE.DoubleSide,
		depthWrite: false,
	});
	const domeGeo = new THREE.SphereGeometry(DOME_RADIUS, 48, 28, 0, Math.PI * 2, 0, Math.PI / 2);
	const dome = new THREE.Mesh(domeGeo, domeMat);
	dome.position.y = 0;
	structureGroup.add(dome);

	// ── Buildings: InstancedMesh ──
	const unitBox = new THREE.BoxGeometry(1, 1, 1);
	const bldgMat = new THREE.MeshStandardMaterial({
		vertexColors: false,
		roughness: 0.7,
		flatShading: true,
	});
	const bldgMesh = new THREE.InstancedMesh(unitBox, bldgMat, cfg.buildingCount);
	bldgMesh.frustumCulled = true;
	const colArr = new Float32Array(cfg.buildingCount * 3);
	const dummy = new THREE.Object3D();

	for (let i = 0; i < cfg.buildingCount; i++) {
		const angle = Math.random() * Math.PI * 2;
		const dist = 3 + Math.random() * (cfg.spread - 3);
		const bx = Math.cos(angle) * dist;
		const bz = Math.sin(angle) * dist;
		const bw = cfg.widthRange[0] + Math.random() * (cfg.widthRange[1] - cfg.widthRange[0]);
		const bd = cfg.widthRange[0] + Math.random() * (cfg.widthRange[1] - cfg.widthRange[0]);
		const bh = cfg.heightRange[0] + Math.random() * (cfg.heightRange[1] - cfg.heightRange[0]);

		dummy.position.set(bx, bh / 2, bz);
		dummy.scale.set(bw, bh, bd);
		dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
		dummy.updateMatrix();
		bldgMesh.setMatrixAt(i, dummy.matrix);

		// Per-instance color
		const ci = Math.floor(Math.random() * cfg.buildingColors.length);
		tmpCol.setHex(cfg.buildingColors[ci]);
		colArr[i * 3] = tmpCol.r;
		colArr[i * 3 + 1] = tmpCol.g;
		colArr[i * 3 + 2] = tmpCol.b;
	}
	bldgMesh.instanceMatrix.needsUpdate = true;
	bldgMesh.instanceColor = new THREE.InstancedBufferAttribute(colArr, 3);
	structureGroup.add(bldgMesh);

	// ── Windows: merged quads on all 4 building faces ──
	const windowMat = new THREE.MeshBasicMaterial({
		color: cfg.windowColor,
		transparent: true,
		opacity: 0.9,
	});
	const windowGeos: THREE.BufferGeometry[] = [];
	const tmpPos = new THREE.Vector3();

	for (let i = 0; i < cfg.buildingCount; i++) {
		const angle = Math.random() * Math.PI * 2;
		const dist = 3 + Math.random() * (cfg.spread - 3);
		const bx = Math.cos(angle) * dist;
		const bz = Math.sin(angle) * dist;
		const bw = cfg.widthRange[0] + Math.random() * (cfg.widthRange[1] - cfg.widthRange[0]);
		const bd = cfg.widthRange[0] + Math.random() * (cfg.widthRange[1] - cfg.widthRange[0]);
		const bh = cfg.heightRange[0] + Math.random() * (cfg.heightRange[1] - cfg.heightRange[0]);
		const rot = Math.random() * Math.PI * 2;

		// 2-3 columns per face
		const cols = 2 + Math.floor(Math.random() * 2);
		// rows based on height
		const rows = Math.max(2, Math.floor(bh / 5));
		const wWin = bw * 0.12;
		const hWin = 1.2;
		const gapX = (bw - wWin * cols) / (cols + 1);
		const gapY = (bh - hWin * rows) / (rows + 1);

		// Face normals: +X, -X, +Z, -Z
		const faces: { nx: number; nz: number }[] = [
			{ nx: 1, nz: 0 }, { nx: -1, nz: 0 },
			{ nx: 0, nz: 1 }, { nx: 0, nz: -1 },
		];

		for (const f of faces) {
			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					const wx = (f.nx !== 0)
						? bx + f.nx * bw / 2
						: bx + gapX + c * (wWin + gapX) - bw / 2 + wWin / 2;
					const wz = (f.nz !== 0)
						? bz + f.nz * bd / 2
						: bz + gapX + c * (wWin + gapX) - bd / 2 + wWin / 2;
					const wy = gapY + r * (hWin + gapY);

					const winGeo = new THREE.PlaneGeometry(wWin * 0.8, hWin * 0.7);
					// Orient face
					if (f.nx !== 0) {
						winGeo.rotateY(Math.PI / 2);
					}
					winGeo.translate(wx, wy, wz);
					windowGeos.push(winGeo);
				}
			}
		}
	}

	if (windowGeos.length > 0) {
		const merged = mergeGeometries(windowGeos);
		const windowMesh = new THREE.Mesh(merged, windowMat);
		windowMesh.position.set(0, 0, 0);
		structureGroup.add(windowMesh);
	}

	group.add(structureGroup);
	group.visible = false;

	return {
		group,
		structureGroup,
		domeMat,
		glowHaloMat: haloMat,
		pointLight: light,
	};
}

// ── Pulse animation per frame ──

export function updateCityPulse(
	result: CityResult,
	elapsed: number,
	active: boolean,
	worldY: number,
): void {
	if (!active) {
		result.group.visible = false;
		return;
	}
	result.group.visible = true;
	result.group.position.y = worldY;

	// Dome opacity pulse
	result.domeMat.opacity = 0.3 + Math.sin(elapsed * 0.4) * 0.06;

	// Halo pulse
	const haloScale = 1 + Math.sin(elapsed * 0.5) * 0.08;
	result.glowHaloMat.opacity = 0.12 + Math.sin(elapsed * 0.6) * 0.04;
	result.group.children.forEach((child) => {
		if (child instanceof THREE.Mesh && child.material === result.glowHaloMat) {
			child.scale.setScalar(haloScale);
		}
	});

	// Light pulse
	const baseIntensity = (result.pointLight.userData.baseIntensity as number) ?? 6;
	result.pointLight.intensity = result.pointLight.intensity * 0.98 + (
		baseIntensity * (0.8 + Math.sin(elapsed * 0.7) * 0.2)
	) * 0.02;
}

// ── Dispose ──

export function disposeCity(result: CityResult, scene: THREE.Scene): void {
	scene.remove(result.group);
	result.group.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			child.geometry.dispose();
			if (child.material instanceof THREE.Material) child.material.dispose();
		}
	});
}
