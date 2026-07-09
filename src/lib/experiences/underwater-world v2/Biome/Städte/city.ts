import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type CityVariant = "altstadt" | "zentrum" | "vorort" | "kolonie";

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
	// Variant-specific look
	layout: "tight" | "cluster" | "spread" | "ring";
	landmark: "church" | "skyscraper" | "villageSquare" | "habitatColony" | "none";
	bodyRoughness: number;
	bodyMetalness: number;
	roofType: "flat" | "pitched" | "dome";
	anchorHeight: number;
	supertallChance: number;
	supertallRange: [number, number];
	minBuildingGap: number;
}

const DOME_RADIUS = 65;

// ── Variant configs (based on real architectural research) ──


const CONFIG: Record<CityVariant, CityConfig> = {
	altstadt: {
		label: "Altstadt",
		buildingCount: 110,
		heightRange: [6, 22],
		widthRange: [2.4, 4.2],
		spread: DOME_RADIUS - 4,
		buildingColors: [
			0xcc9977, 0xddbb88, 0xbb6644, // sandstone
			0xccaa77, 0xddcc99, 0xaa7755, // ochre
			0xbb8866, 0xcc8866, 0x997755, // terracotta
			0xd4b48a, 0xc8a978, // light sandstone
		],
		windowColor: 0xffcc44,
		domeColor: 0x886644,
		domeEmissive: 0x553311,
		lightColor: 0xffcc44,
		lightIntensity: 25,
		glowColor: 0xff8844,
		layout: "tight",
		landmark: "church",
		bodyRoughness: 0.95,
		bodyMetalness: 0.0,
		roofType: "flat",
		anchorHeight: 55,
		supertallChance: 0.04,
		supertallRange: [28, 38],
		minBuildingGap: 0.6,
	},
	zentrum: {
		label: "Zentrum",
		buildingCount: 55,
		heightRange: [50, 130],
		widthRange: [6, 12],
		spread: DOME_RADIUS - 6,
		buildingColors: [
			0x667788, 0x7788aa, 0x99aabb, 0x556677, 0x8899aa,
			0x445566, 0x88aacc,
		],
		windowColor: 0xaaccff,
		domeColor: 0x336688,
		domeEmissive: 0x224466,
		lightColor: 0xaaccff,
		lightIntensity: 35,
		glowColor: 0x4488ff,
		layout: "cluster",
		landmark: "skyscraper",
		bodyRoughness: 0.25,
		bodyMetalness: 0.7,
		roofType: "flat",
		anchorHeight: 200,
		supertallChance: 0.12,
		supertallRange: [150, 200],
		minBuildingGap: 1.2,
	},
	vorort: {
		label: "Vorort",
		buildingCount: 55,
		heightRange: [3.5, 8],
		widthRange: [4, 8],
		spread: DOME_RADIUS - 4,
		buildingColors: [
			0xddccaa, 0xccbb99, 0xeeddcc, 0xddbb99, 0xddccbb,
			0xccaa88, 0xddccaa, 0xe8d4b8,
		],
		windowColor: 0xffee99,
		domeColor: 0x88aa88,
		domeEmissive: 0x446644,
		lightColor: 0xffdd66,
		lightIntensity: 20,
		glowColor: 0xddaa44,
		layout: "spread",
		landmark: "villageSquare",
		bodyRoughness: 0.85,
		bodyMetalness: 0.0,
		roofType: "pitched",
		anchorHeight: 14,
		supertallChance: 0.05,
		supertallRange: [10, 14],
		minBuildingGap: 3.0,
	},
	kolonie: {
		label: "Kolonie",
		buildingCount: 0,
		heightRange: [0, 0],
		widthRange: [0, 0],
		spread: DOME_RADIUS - 2,
		buildingColors: [],
		windowColor: 0x66ddff,
		domeColor: 0x335566,
		domeEmissive: 0x113355,
		lightColor: 0x66ddff,
		lightIntensity: 40,
		glowColor: 0x00ccff,
		layout: "ring",
		landmark: "habitatColony",
		bodyRoughness: 0.35,
		bodyMetalness: 0.25,
		roofType: "dome",
		anchorHeight: 0,
		supertallChance: 0,
		supertallRange: [0, 0],
		minBuildingGap: 0,
	},
};

// ── Interface ──

export interface CityResult {
	group: THREE.Group;
	structureGroup: THREE.Group;
	domeMat: THREE.MeshStandardMaterial;
	glowHaloMat: THREE.MeshBasicMaterial;
	pointLight: THREE.PointLight;
}

// ── Shared scratch objects (avoid per-call allocations) ──

const _dummy = new THREE.Object3D();
const _scratchCol = new THREE.Color();

// ── Helpers ──

function poissonOnRing(
	count: number,
	innerR: number,
	outerR: number,
	minGap: number,
	layout: "tight" | "cluster" | "spread" | "ring",
	rng: () => number = Math.random,
): { x: number; z: number; rot: number }[] {
	const out: { x: number; z: number; rot: number }[] = [];
	const maxAttempts = count * 30;
	let attempts = 0;
	while (out.length < count && attempts++ < maxAttempts) {
		let r: number;
		if (layout === "cluster") {
			r = innerR + Math.pow(rng(), 2) * (outerR - innerR);
		} else if (layout === "tight") {
			r = innerR + rng() * (outerR - innerR);
		} else if (layout === "ring") {
			// Tight ring: bias to the middle of the annulus
			r = innerR + (0.35 + rng() * 0.3) * (outerR - innerR);
		} else {
			r = innerR + Math.sqrt(rng()) * (outerR - innerR);
		}
		const angle = rng() * Math.PI * 2;
		const x = Math.cos(angle) * r;
		const z = Math.sin(angle) * r;
		let ok = true;
		for (let i = 0; i < out.length; i++) {
			const dx = out[i].x - x;
			const dz = out[i].z - z;
			if (dx * dx + dz * dz < minGap * minGap) {
				ok = false;
				break;
			}
		}
		if (ok) out.push({ x, z, rot: rng() * Math.PI * 2 });
	}
	return out;
}

// ── Landmarks ──

function createChurch(width: number, height: number): THREE.Group {
	const church = new THREE.Group();
	const stoneMat = new THREE.MeshStandardMaterial({
		color: 0xddccaa,
		roughness: 0.9,
		flatShading: true,
	});
	const spireMat = new THREE.MeshStandardMaterial({
		color: 0x6a8a6a,
		roughness: 0.45,
		metalness: 0.35,
		flatShading: true,
	});

	const naveW = width * 0.9;
	const naveH = height * 0.6;
	const naveD = width * 1.2;
	const nave = new THREE.Mesh(
		new THREE.BoxGeometry(naveW, naveH, naveD),
		stoneMat,
	);
	nave.position.y = naveH / 2;
	church.add(nave);

	const chapelW = naveW * 0.5;
	const chapelH = naveH * 0.7;
	const chapel = new THREE.Mesh(
		new THREE.BoxGeometry(chapelW, chapelH, naveD * 0.7),
		stoneMat,
	);
	chapel.position.set(naveW * 0.7, chapelH / 2, 0);
	church.add(chapel);

	const towerW = width * 0.55;
	const towerH = height;
	const tower = new THREE.Mesh(
		new THREE.BoxGeometry(towerW, towerH, towerW),
		stoneMat,
	);
	tower.position.set(-naveW * 0.55, towerH / 2, 0);
	church.add(tower);

	const spireH = towerH * 0.55;
	const spire = new THREE.Mesh(
		new THREE.ConeGeometry(towerW * 0.65, spireH, 8),
		spireMat,
	);
	spire.position.set(-naveW * 0.55, towerH + spireH / 2, 0);
	church.add(spire);

	const crossMat = new THREE.MeshStandardMaterial({
		color: 0xddcc88,
		roughness: 0.4,
		metalness: 0.6,
	});
	const crossH = 1.2;
	const crossArm = new THREE.Mesh(
		new THREE.BoxGeometry(0.08, crossH, 0.08),
		crossMat,
	);
	crossArm.position.set(-naveW * 0.55, towerH + spireH + crossH / 2, 0);
	church.add(crossArm);
	const crossBar = new THREE.Mesh(
		new THREE.BoxGeometry(0.5, 0.08, 0.08),
		crossMat,
	);
	crossBar.position.set(-naveW * 0.55, towerH + spireH + crossH - 0.3, 0);
	church.add(crossBar);

	return church;
}

function createSkyscraperAnchor(width: number, height: number): THREE.Group {
	const tower = new THREE.Group();
	const shaftGeo = new THREE.BoxGeometry(width, height, width);
	const shaftMat = new THREE.MeshStandardMaterial({
		color: 0x4a5a72,
		roughness: 0.18,
		metalness: 0.8,
	});
	const shaft = new THREE.Mesh(shaftGeo, shaftMat);
	shaft.position.y = height / 2;
	tower.add(shaft);

	const antH = height * 0.12;
	const ant = new THREE.Mesh(
		new THREE.CylinderGeometry(0.25, 0.25, antH, 6),
		new THREE.MeshStandardMaterial({
			color: 0x888888,
			roughness: 0.3,
			metalness: 0.9,
		}),
	);
	ant.position.y = height + antH / 2;
	tower.add(ant);

	const warn = new THREE.Mesh(
		new THREE.SphereGeometry(0.35, 8, 8),
		new THREE.MeshBasicMaterial({ color: 0xff3322 }),
	);
	warn.position.y = height + antH + 0.4;
	tower.add(warn);

	const sb1H = height * 0.3;
	const sb1 = new THREE.Mesh(
		new THREE.BoxGeometry(width * 1.25, sb1H, width * 1.25),
		shaftMat,
	);
	sb1.position.y = sb1H / 2;
	tower.add(sb1);

	return tower;
}

function createVillageSquare(): THREE.Group {
	const square = new THREE.Group();

	const clearingGeo = new THREE.CylinderGeometry(8, 8, 0.3, 24);
	const clearingMat = new THREE.MeshStandardMaterial({
		color: 0xb8a888,
		roughness: 0.95,
		flatShading: true,
	});
	const clearing = new THREE.Mesh(clearingGeo, clearingMat);
	clearing.position.y = 0.15;
	square.add(clearing);

	const wellMat = new THREE.MeshStandardMaterial({
		color: 0x8a7a6a,
		roughness: 0.9,
		flatShading: true,
	});
	const wellBase = new THREE.Mesh(
		new THREE.CylinderGeometry(0.7, 0.8, 1.0, 12),
		wellMat,
	);
	wellBase.position.y = 0.8;
	square.add(wellBase);
	const wellRoof = new THREE.Mesh(
		new THREE.ConeGeometry(1.1, 0.7, 8),
		new THREE.MeshStandardMaterial({
			color: 0x7a5a3a,
			roughness: 0.7,
			flatShading: true,
		}),
	);
	wellRoof.position.y = 1.65;
	square.add(wellRoof);

	const treeMat = new THREE.MeshStandardMaterial({
		color: 0x3a6a3a,
		roughness: 0.9,
		flatShading: true,
	});
	const trunkMat = new THREE.MeshStandardMaterial({
		color: 0x5a3a22,
		roughness: 0.95,
	});
	for (let i = 0; i < 4; i++) {
		const a = (i / 4) * Math.PI * 2 + 0.3;
		const r = 6.2;
		const x = Math.cos(a) * r;
		const z = Math.sin(a) * r;
		const trunk = new THREE.Mesh(
			new THREE.CylinderGeometry(0.18, 0.22, 1.4, 6),
			trunkMat,
		);
		trunk.position.set(x, 0.7, z);
		square.add(trunk);
		const crown = new THREE.Mesh(
			new THREE.ConeGeometry(1.2, 2.8, 7),
			treeMat,
		);
		crown.position.set(x, 2.8, z);
		square.add(crown);
	}

	return square;
}

// ── Underwater habitat colony (biomorphic, speculative) ──
// Layout:
//   1. Central main hull: large horizontal cylinder + dome top (Conshelf/Aquarius)
//   2. 5-6 satellite pods: small spheres/cylinders in a ring around the main hull
//   3. Connecting tunnels: thin cylinders between main and pods
//   4. Anchor pylons: 3-4 thin legs going into the seabed
//   5. Sensor mast on top
//   6. Glowing cyan porthole rows along the cylinder body

function createHabitatColony(): THREE.Group {
	const colony = new THREE.Group();

	// Shared materials
	const hullMat = new THREE.MeshStandardMaterial({
		color: 0xe8e0d4,        // off-white bioplastic
		roughness: 0.45,
		metalness: 0.3,
		flatShading: false,
	});
	const trimMat = new THREE.MeshStandardMaterial({
		color: 0x556677,        // gunmetal ring frames
		roughness: 0.4,
		metalness: 0.85,
	});
	const portholeMat = new THREE.MeshStandardMaterial({
		color: 0x88ffff,        // glowing porthole glass
		emissive: 0x66ddff,
		emissiveIntensity: 0.8,
		roughness: 0.1,
		metalness: 0.0,
	});
	const pylonMat = new THREE.MeshStandardMaterial({
		color: 0x3a4452,
		roughness: 0.6,
		metalness: 0.7,
	});
	const tunnelMat = new THREE.MeshStandardMaterial({
		color: 0xc8c0b4,
		roughness: 0.5,
		metalness: 0.4,
	});

	// ── 1. Main hull: horizontal cylinder with dome top ──
	const mainR = 9;
	const mainL = 32;
	const mainY = 14;
	const mainHull = new THREE.Mesh(
		new THREE.CylinderGeometry(mainR, mainR, mainL, 24, 1, false),
		hullMat,
	);
	mainHull.rotation.z = Math.PI / 2; // lie horizontally
	mainHull.position.y = mainY;
	colony.add(mainHull);

	// End caps (rounded hemispheres)
	for (const xOff of [-mainL / 2, mainL / 2]) {
		const cap = new THREE.Mesh(
			new THREE.SphereGeometry(mainR, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
			hullMat,
		);
		cap.position.set(xOff, mainY, 0);
		if (xOff > 0) cap.rotation.z = -Math.PI / 2;
		else cap.rotation.z = Math.PI / 2;
		colony.add(cap);
	}

	// Observation dome on top (transparent)
	const obsDomeMat = new THREE.MeshStandardMaterial({
		color: 0xaaddff,
		emissive: 0x66ddff,
		emissiveIntensity: 0.4,
		transparent: true,
		opacity: 0.45,
		roughness: 0.05,
		metalness: 0.2,
		depthWrite: false,
	});
	const obsDome = new THREE.Mesh(
		new THREE.SphereGeometry(7, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
		obsDomeMat,
	);
	obsDome.position.set(0, mainY + mainR, 0);
	colony.add(obsDome);

	// Hull trim rings (gunmetal bands)
	for (const xOff of [-mainL / 2 + 4, -mainL / 4, 0, mainL / 4, mainL / 2 - 4]) {
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(mainR + 0.15, 0.4, 8, 24),
			trimMat,
		);
		ring.rotation.y = Math.PI / 2;
		ring.position.set(xOff, mainY, 0);
		colony.add(ring);
	}

	// Porthole rows (3 rows along the hull: top, middle, bottom)
	for (let side = -1; side <= 1; side += 2) {
		const yPos = mainY + side * 3;
		for (let xi = -6; xi <= 6; xi += 2) {
			if (Math.abs(xi) > 5.5) continue;
			const p = new THREE.Mesh(
				new THREE.SphereGeometry(0.5, 10, 8),
				portholeMat,
			);
			p.position.set(xi, yPos, side === 1 ? mainR + 0.1 : -(mainR + 0.1));
			if (side === -1) p.rotation.x = Math.PI;
			colony.add(p);
		}
	}

	// ── 2. Sensor mast on top of the dome ──
	const mastH = 12;
	const mast = new THREE.Mesh(
		new THREE.CylinderGeometry(0.35, 0.5, mastH, 8),
		trimMat,
	);
	mast.position.y = mainY + mainR + 7 + mastH / 2;
	colony.add(mast);

	// Radar dish (half-sphere)
	const dish = new THREE.Mesh(
		new THREE.SphereGeometry(2.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
		new THREE.MeshStandardMaterial({
			color: 0xaabbcc,
			roughness: 0.3,
			metalness: 0.7,
			side: THREE.DoubleSide,
		}),
	);
	dish.position.y = mainY + mainR + 7 + mastH + 0.4;
	dish.rotation.x = Math.PI;
	colony.add(dish);

	// Blinking warning light at very top
	const beacon = new THREE.Mesh(
		new THREE.SphereGeometry(0.4, 8, 8),
		new THREE.MeshBasicMaterial({ color: 0xff3322 }),
	);
	beacon.position.y = mainY + mainR + 7 + mastH + 5;
	colony.add(beacon);

	// ── 3. Satellite pods in a ring ──
	const podCount = 6;
	const podRingR = 22;
	for (let i = 0; i < podCount; i++) {
		const a = (i / podCount) * Math.PI * 2;
		const px = Math.cos(a) * podRingR;
		const pz = Math.sin(a) * podRingR;

		// Pod body: short cylinder (sphere works too)
		const podR = 3.5;
		const podL = 5;
		const pod = new THREE.Mesh(
			new THREE.CylinderGeometry(podR, podR, podL, 14, 1, false),
			hullMat,
		);
		pod.rotation.z = Math.PI / 2;
		pod.position.set(px, 7, pz);
		// orient pod towards the centre
		pod.rotation.y = -a;
		colony.add(pod);

		// Pod dome end caps
		for (const xOff of [-podL / 2, podL / 2]) {
			const cap = new THREE.Mesh(
				new THREE.SphereGeometry(podR, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
				hullMat,
			);
			cap.position.set(px, 7, pz);
			cap.rotation.z = xOff > 0 ? -Math.PI / 2 : Math.PI / 2;
			cap.rotation.y = -a;
			colony.add(cap);
		}

		// 2-3 portholes on each pod (outward facing)
		for (let pi = 0; pi < 3; pi++) {
			const pph = new THREE.Mesh(
				new THREE.SphereGeometry(0.35, 8, 6),
				portholeMat,
			);
			// place on the outward-facing side of the pod (perpendicular to pod axis)
			const localY = -1 + pi * 1;
			const localR = podR + 0.1;
			// outward normal in world: (cos(a), 0, sin(a)) rotated 90 around y is (-sin(a), 0, cos(a))
			const nx = -Math.sin(a) * localR;
			const nz = Math.cos(a) * localR;
			pph.position.set(px, 7 + localY, pz);
			pph.position.x += nx;
			pph.position.z += nz;
			colony.add(pph);
		}

		// Connecting tunnel from pod to main hull
		// Compute length + position so it joins the two cylinders cleanly
		const tunnelLen = podRingR - mainR - podR;
		const tunnelMidX = (Math.cos(a) * (podRingR - podR - tunnelLen / 2));
		const tunnelMidZ = (Math.sin(a) * (podRingR - podR - tunnelLen / 2));
		const tunnel = new THREE.Mesh(
			new THREE.CylinderGeometry(1.0, 1.0, tunnelLen, 10),
			tunnelMat,
		);
		tunnel.position.set(tunnelMidX, 10, tunnelMidZ);
		// Orient tunnel along the radial direction
		tunnel.rotation.z = Math.PI / 2;
		tunnel.rotation.y = -a;
		colony.add(tunnel);
	}

	// ── 4. Anchor pylons (4 legs into the seabed) ──
	const pylonCount = 4;
	for (let i = 0; i < pylonCount; i++) {
		const a = (i / pylonCount) * Math.PI * 2 + Math.PI / 4;
		const r = mainL / 2 + 1.5;
		const px = Math.cos(a) * r;
		const pz = Math.sin(a) * r;
		const pylonH = 14;
		const pylon = new THREE.Mesh(
			new THREE.CylinderGeometry(0.5, 0.7, pylonH, 8),
			pylonMat,
		);
		pylon.position.set(px, 7 - pylonH / 2, pz);
		// Slight tilt outward for visual stability
		pylon.rotation.z = Math.cos(a) * 0.08;
		pylon.rotation.x = -Math.sin(a) * 0.08;
		colony.add(pylon);

		// Foot pad on the seabed
		const pad = new THREE.Mesh(
			new THREE.CylinderGeometry(1.5, 1.8, 0.6, 10),
			pylonMat,
		);
		pad.position.set(px, 0, pz);
		colony.add(pad);
	}

	// ── 5. Umbilical cable spiral (decorative) ──
	// A simple spiraling thin cylinder from the bottom of the main hull to the floor
	const cableH = 6;
	const cable = new THREE.Mesh(
		new THREE.CylinderGeometry(0.15, 0.15, cableH, 6),
		pylonMat,
	);
	cable.position.set(0, 7 - cableH / 2, mainR + 1);
	colony.add(cable);

	return colony;
}

// ── Create ──

export function createCity(variant: CityVariant): CityResult {
	const cfg = CONFIG[variant];
	const group = new THREE.Group();
	const structureGroup = new THREE.Group();

	// ── Base platform ──
	const platGeo = new THREE.CylinderGeometry(
		DOME_RADIUS + 3,
		DOME_RADIUS + 4,
		1.5,
		48,
	);
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

	// ── Geodesic dome (MeshStandardMaterial, no clearcoat) ──
	const domeMat = new THREE.MeshStandardMaterial({
		color: cfg.domeColor,
		emissive: cfg.domeEmissive,
		emissiveIntensity: 0.15,
		transparent: true,
		opacity: 0.3,
		roughness: 0.1,
		metalness: 0.0,
		side: THREE.DoubleSide,
		depthWrite: false,
	});
	const domeGeo = new THREE.SphereGeometry(
		DOME_RADIUS, 48, 28, 0, Math.PI * 2, 0, Math.PI / 2,
	);
	const dome = new THREE.Mesh(domeGeo, domeMat);
	dome.position.y = 0;
	structureGroup.add(dome);

	// ── Generate building positions with layout-aware placement ──
	// (skipped for kolonie — no InstancedMesh buildings, only the colony landmark)
	let positions: { x: number; z: number; rot: number }[] = [];
	if (cfg.buildingCount > 0) {
		let innerR: number;
		let outerR: number;
		if (cfg.layout === "cluster") {
			innerR = 0;
			outerR = cfg.spread;
		} else if (cfg.layout === "tight") {
			innerR = 8;
			outerR = cfg.spread;
		} else if (cfg.layout === "ring") {
			// Kolonie fallback — shouldn't reach here
			innerR = 5;
			outerR = cfg.spread;
		} else {
			innerR = 10;
			outerR = cfg.spread;
		}

		positions = poissonOnRing(
			cfg.buildingCount,
			innerR,
			outerR,
			cfg.minBuildingGap,
			cfg.layout,
		);
	}

	// ── Buildings: InstancedMesh (skipped for kolonie) ──
	interface Placed { x: number; z: number; w: number; d: number; h: number; rot: number; color: number }
	const placed: Placed[] = [];
	if (positions.length > 0) {
		const unitBox = new THREE.BoxGeometry(1, 1, 1);
		const bldgMat = new THREE.MeshStandardMaterial({
			roughness: cfg.bodyRoughness,
			metalness: cfg.bodyMetalness,
			flatShading: true,
		});
		const bldgMesh = new THREE.InstancedMesh(unitBox, bldgMat, positions.length);
		bldgMesh.frustumCulled = true;
		const colArr = new Float32Array(positions.length * 3);

		for (let i = 0; i < positions.length; i++) {
			const p = positions[i];
			const w = cfg.widthRange[0] + Math.random() * (cfg.widthRange[1] - cfg.widthRange[0]);
			let d: number;
			if (variant === "altstadt") {
				d = w * (0.7 + Math.random() * 0.4);
			} else if (variant === "zentrum") {
				d = w * (0.85 + Math.random() * 0.3);
			} else {
				d = w * (1.0 + Math.random() * 0.3);
			}
			let h: number;
			if (cfg.supertallChance > 0 && Math.random() < cfg.supertallChance) {
				h = cfg.supertallRange[0] + Math.random() * (cfg.supertallRange[1] - cfg.supertallRange[0]);
			} else {
				h = cfg.heightRange[0] + Math.random() * (cfg.heightRange[1] - cfg.heightRange[0]);
			}
			const color = cfg.buildingColors[Math.floor(Math.random() * cfg.buildingColors.length)];

			_dummy.position.set(p.x, h / 2, p.z);
			_dummy.scale.set(w, h, d);
			_dummy.rotation.set(0, p.rot, 0);
			_dummy.updateMatrix();
			bldgMesh.setMatrixAt(i, _dummy.matrix);

			_scratchCol.setHex(color);
			colArr[i * 3] = _scratchCol.r;
			colArr[i * 3 + 1] = _scratchCol.g;
			colArr[i * 3 + 2] = _scratchCol.b;

			placed.push({ x: p.x, z: p.z, w, d, h, rot: p.rot, color });
		}
		bldgMesh.instanceMatrix.needsUpdate = true;
		bldgMesh.instanceColor = new THREE.InstancedBufferAttribute(colArr, 3);
		structureGroup.add(bldgMesh);
	}

	// ── Pitched roofs (vorort only) ──
	if (cfg.roofType === "pitched" && placed.length > 0) {
		const roofGeo = new THREE.ConeGeometry(1, 1, 4);
		roofGeo.rotateY(Math.PI / 4);
		const roofMat = new THREE.MeshStandardMaterial({
			color: 0x8a4a28,
			roughness: 0.75,
			flatShading: true,
		});
		const roofMesh = new THREE.InstancedMesh(roofGeo, roofMat, placed.length);
		roofMesh.frustumCulled = true;
		const roofCols = new Float32Array(placed.length * 3);
		for (let i = 0; i < placed.length; i++) {
			const pl = placed[i];
			const roofBase = Math.max(pl.w, pl.d) * 0.78;
			const roofH = pl.h * 0.45;
			_dummy.position.set(pl.x, pl.h + roofH / 2, pl.z);
			_dummy.scale.set(roofBase, roofH, roofBase);
			_dummy.rotation.set(0, pl.rot, 0);
			_dummy.updateMatrix();
			roofMesh.setMatrixAt(i, _dummy.matrix);
			const tint = 0.85 + Math.random() * 0.3;
			roofCols[i * 3] = 0.54 * tint;
			roofCols[i * 3 + 1] = 0.29 * tint;
			roofCols[i * 3 + 2] = 0.16 * tint;
		}
		roofMesh.instanceMatrix.needsUpdate = true;
		roofMesh.instanceColor = new THREE.InstancedBufferAttribute(roofCols, 3);
		structureGroup.add(roofMesh);
	}

	// ── Windows (merged into a single mesh per city, skipped for kolonie) ──
	if (placed.length > 0) {
		const windowMat = new THREE.MeshBasicMaterial({
			color: cfg.windowColor,
			side: THREE.DoubleSide,
		});
		const windowGeos: THREE.BufferGeometry[] = [];

		for (const b of placed) {
			let cols: number;
			let rows: number;
			const ww = b.w * 0.16;
			const hh = 0.9;

			if (variant === "altstadt") {
				cols = 2 + Math.floor(Math.random() * 2);
				rows = Math.max(2, Math.floor(b.h / 4));
			} else if (variant === "zentrum") {
				cols = Math.max(2, Math.floor(b.w / 1.5));
				rows = Math.max(2, Math.floor(b.h / 2.5));
			} else {
				cols = 1 + Math.floor(Math.random() * 2);
				rows = 1 + (Math.random() < 0.5 ? 1 : 2);
			}

			const gapX = (b.w - ww * cols) / (cols + 1);
			const gapY = (b.h - hh * rows) / (rows + 1);
			const cosR = Math.cos(b.rot);
			const sinR = Math.sin(b.rot);

			for (let fi = 0; fi < 4; fi++) {
				let fnx = 0,
				fnz = 0,
				fRot = 0;
				if (fi === 0) {
					fnx = 1;
					fRot = Math.PI / 2;
				} else if (fi === 1) {
					fnx = -1;
					fRot = -Math.PI / 2;
				} else if (fi === 2) {
					fnz = 1;
					fRot = 0;
				} else {
					fnz = -1;
					fRot = Math.PI;
				}
				for (let r = 0; r < rows; r++) {
					for (let c = 0; c < cols; c++) {
						let ox: number, oz: number;
						if (fi < 2) {
							ox = (fnx * b.w) / 2;
							oz = gapX + c * (ww + gapX) - b.d / 2 + ww / 2;
						} else {
							ox = gapX + c * (ww + gapX) - b.w / 2 + ww / 2;
							oz = (fnz * b.d) / 2;
						}

						const wx = b.x + ox * cosR - oz * sinR;
						const wz = b.z + ox * sinR + oz * cosR;
						const wy = gapY + r * (hh + gapY);

						const quad = new THREE.PlaneGeometry(ww * 0.8, hh * 0.7);
						quad.rotateY(fRot);
						quad.rotateY(b.rot);
						quad.translate(wx, wy, wz);
						windowGeos.push(quad);
					}
				}
			}
		}

		if (windowGeos.length > 0) {
			const merged = mergeGeometries(windowGeos, false);
			const windowMesh = new THREE.Mesh(merged, windowMat);
			structureGroup.add(windowMesh);
		}
	}

	// ── Landmark ──
	if (cfg.landmark === "church") {
		const church = createChurch(11, cfg.anchorHeight);
		church.rotation.y = Math.random() * Math.PI;
		structureGroup.add(church);
	} else if (cfg.landmark === "skyscraper") {
		const tower = createSkyscraperAnchor(13, cfg.anchorHeight);
		structureGroup.add(tower);
	} else if (cfg.landmark === "villageSquare") {
		const square = createVillageSquare();
		structureGroup.add(square);
	} else if (cfg.landmark === "habitatColony") {
		const colony = createHabitatColony();
		structureGroup.add(colony);
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

	// Dome glow pulse
	result.domeMat.emissiveIntensity = 0.6 + Math.sin(elapsed * 0.4) * 0.3;
	result.domeMat.opacity = 0.3 + Math.sin(elapsed * 0.4) * 0.06;

	// Halo pulse
	const haloScale = 1 + Math.sin(elapsed * 0.5) * 0.08;
	result.glowHaloMat.opacity = 0.3 + Math.sin(elapsed * 0.6) * 0.1;
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
