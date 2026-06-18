import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CAMERA } from "$lib/config/flight";
import { createClouds, disposeClouds, updateClouds } from "$lib/three/clouds";
import { createSky } from "$lib/three/sky";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { BLUMEN } from "$lib/experiences/insect-world/Objekte/Blumen/blumen";
import { CITY } from "$lib/experiences/insect-world/Objekte/Stadt/city";
import { BIENEN } from "$lib/experiences/insect-world/Objekte/Bienen/bienen";
import { SCHMETTERLINGE } from "$lib/experiences/insect-world/Objekte/Schmetterlinge/schmetterlinge";
import { PheromoneSystem } from "$lib/experiences/insect-world/Sinne/Pheromonspuren/pheromonspuren";
import { CompoundEyeEffect } from "$lib/experiences/insect-world/Objekte/Facettenauge/facettenauge";
import { GrassMeadow } from "$lib/experiences/insect-world/Biome/Wiese/grass-test";
import { FlightPlayer } from "$lib/three/player";

export interface InsectWorldState extends ExperienceState {
	player: FlightPlayer;
	camera: THREE.PerspectiveCamera;
	clouds: THREE.Group;
	meadow: GrassMeadow;
	skyMesh: THREE.Mesh;
	pheromones: PheromoneSystem;
	compoundEye: CompoundEyeEffect;
	butterflies: { group: THREE.Group; orbitCenter: THREE.Vector3; orbitRadius: number; speed: number; phase: number; heightBase: number; heightRange: number }[];
	bees: { group: THREE.Group; orbitCenter: THREE.Vector3; orbitRadius: number; speed: number; phase: number; heightBase: number; heightRange: number }[];
	flowerTargets: { position: THREE.Vector3; color: THREE.Color }[];
	cloudRebuildTimer: ReturnType<typeof setTimeout> | null;
	windSpeed: number;
}

function loadGLB(url: string): Promise<THREE.Group | null> {
	return new Promise((resolve) => {
		const loader = new GLTFLoader();
		loader.load(
			url,
			(gltf) => resolve(gltf.scene),
			undefined,
			() => {
				console.warn(`Failed to load GLB: ${url}`);
				resolve(null);
			},
		);
	});
}

export async function setup(ctx: SetupContext): Promise<InsectWorldState> {
	const player = new FlightPlayer({
		fov: CAMERA.FOV,
		near: CAMERA.NEAR,
		far: CAMERA.FAR,
		spawnPosition: { x: 0, y: 3, z: 0 },
		baseSpeed: 1.5,
		terrainSlowdown: 1,
	});
	player.minClearance = -1000;
	ctx.scene.add(player.rig);

	const meadow = new GrassMeadow(ctx.scene, { fieldSize: 200, grassCount: 25000, curvature: 0.0005 });
	meadow.build();

	const skyMesh = createSky({
		radius: 350,
		detail: 4,
		colorTop: 0x2060a0,
		colorHorizon: 0x87ceeb,
		colorBottom: 0xd0e8f8,
	});
	ctx.scene.add(skyMesh);

	const clouds = createClouds({
		count: 20,
		spread: 300,
		heightMin: 80,
		heightMax: 150,
		blobCount: [4, 8],
		blobRadius: [8, 18],
		color: 0xffffff,
		opacity: 0.8,
		driftSpeed: 2,
		driftDirection: { x: 1, z: 0.3 },
	});
	ctx.scene.add(clouds);

	let pheromones: PheromoneSystem;
	let bees: InsectWorldState["bees"] = [];
	let butterflies: InsectWorldState["butterflies"] = [];
	let flowerTargets: { position: THREE.Vector3; color: THREE.Color }[] = [];

	const results = await Promise.allSettled([
		loadGLB(BLUMEN[0].model),
		loadGLB(BLUMEN[1].model),
		loadGLB(BLUMEN[2].model),
		loadGLB(CITY.MODEL),
		loadGLB(BIENEN.MODEL),
		loadGLB(SCHMETTERLINGE.MODEL),
	]);

	const armeriaScene = results[0].status === "fulfilled" ? results[0].value : null;
	const spiderScene = results[1].status === "fulfilled" ? results[1].value : null;
	const lungwortScene = results[2].status === "fulfilled" ? results[2].value : null;
	const cityScene = results[3].status === "fulfilled" ? results[3].value : null;
	const beeScene = results[4].status === "fulfilled" ? results[4].value : null;
	const butterflyScene = results[5].status === "fulfilled" ? results[5].value : null;

	const dummy = new THREE.Object3D();
	const flowerMeshes: THREE.InstancedMesh[] = [];

	function getFlowerParts(scene: THREE.Group, applyWorldMatrix: boolean): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
		const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
		if (applyWorldMatrix) {
			scene.updateWorldMatrix(true, false);
		}
		scene.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				if (applyWorldMatrix) {
					child.updateWorldMatrix(true, false);
					const geo = child.geometry.clone();
					geo.applyMatrix4(child.matrixWorld);
					parts.push({ geo, mat: child.material });
				} else {
					parts.push({ geo: child.geometry, mat: child.material });
				}
			}
		});
		return parts;
	}

	function scatterFlowers(
		parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[],
		baseScale: number,
		scaleRange: [number, number],
		count: number,
		color: THREE.Color,
		minDist: number,
		maxDist: number,
	) {
		for (const { geo, mat } of parts) {
			const mesh = new THREE.InstancedMesh(geo, mat, count);
			for (let i = 0; i < count; i++) {
				const a = Math.random() * Math.PI * 2;
				const dist = minDist + Math.random() * (maxDist - minDist);
				const s = scaleRange[0] + Math.random() * (scaleRange[1] - scaleRange[0]);
				const x = Math.cos(a) * dist;
				const z = Math.sin(a) * dist;
				const groundY = meadow.getHeightAt(x, z);
				dummy.position.set(x, groundY + 0.05, z);
				dummy.scale.setScalar(baseScale * s);
				dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
				dummy.updateMatrix();
				flowerTargets.push({ position: dummy.position.clone(), color });
			}
			mesh.instanceMatrix.needsUpdate = true;
			ctx.scene.add(mesh);
			flowerMeshes.push(mesh);
		}
	}

	const armeriaParts = armeriaScene ? getFlowerParts(armeriaScene, false) : [];
	const spiderParts = spiderScene ? getFlowerParts(spiderScene, true) : [];
	const lungwortParts = lungwortScene ? getFlowerParts(lungwortScene, false) : [];

	for (const f of [
		{ parts: armeriaParts, baseScale: BLUMEN[0].baseScale, scaleRange: BLUMEN[0].scaleRange as [number, number], count: BLUMEN[0].count, color: new THREE.Color(BLUMEN[0].color) },
		{ parts: spiderParts, baseScale: BLUMEN[1].baseScale, scaleRange: BLUMEN[1].scaleRange as [number, number], count: BLUMEN[1].count, color: new THREE.Color(BLUMEN[1].color) },
		{ parts: lungwortParts, baseScale: BLUMEN[2].baseScale, scaleRange: BLUMEN[2].scaleRange as [number, number], count: BLUMEN[2].count, color: new THREE.Color(BLUMEN[2].color) },
	]) {
		if (f.parts.length === 0) continue;
		scatterFlowers(f.parts, f.baseScale, f.scaleRange, f.count, f.color, 2, 20);
		scatterFlowers(f.parts, f.baseScale, f.scaleRange, Math.round(f.count * 0.4), f.color, 20, 45);
	}

	if (cityScene) {
		cityScene.scale.setScalar(CITY.SCALE);
		cityScene.position.set(CITY.POSITION.x, CITY.POSITION.y, CITY.POSITION.z);
		cityScene.rotation.y = CITY.ROTATION_Y;
		ctx.scene.add(cityScene);

		function clearRect(
			meshes: THREE.InstancedMesh[],
			cx: number, cz: number,
			hw: number, hd: number,
			angle: number,
			border: number,
		) {
			const sin = Math.sin(angle);
			const cos = Math.cos(angle);
			const bw = hw + border;
			const bd = hd + border;
			const d = new THREE.Object3D();
			const pos = new THREE.Vector3();
			for (const mesh of meshes) {
				for (let i = 0; i < mesh.count; i++) {
					mesh.getMatrixAt(i, d.matrix);
					pos.setFromMatrixPosition(d.matrix);
					const dx = pos.x - cx;
					const dz = pos.z - cz;
					const localX = dx * cos - dz * sin;
					const localZ = dx * sin + dz * cos;
					if (Math.abs(localX) < bw && Math.abs(localZ) < bd) {
						d.position.set(pos.x, -100, pos.z);
						d.scale.setScalar(1);
						d.rotation.set(0, 0, 0);
						d.updateMatrix();
						mesh.setMatrixAt(i, d.matrix);
					}
				}
				mesh.instanceMatrix.needsUpdate = true;
			}
		}

		clearRect(flowerMeshes, CITY.CLEAR.CENTER.x, CITY.CLEAR.CENTER.z,
			CITY.CLEAR.RECT.hw, CITY.CLEAR.RECT.hd, CITY.CLEAR.RECT.angle, CITY.CLEAR.RECT.border);
		meadow.clearRotatedRect(CITY.CLEAR.CENTER.x, CITY.CLEAR.CENTER.z,
			CITY.CLEAR.RECT.hw, CITY.CLEAR.RECT.hd, CITY.CLEAR.RECT.angle, CITY.CLEAR.RECT.border);
	}

	pheromones = new PheromoneSystem();
	pheromones.setVariant(3);
	pheromones.addTrails(flowerTargets);
	ctx.scene.add(pheromones.group);

	if (beeScene) {
		const beeTemplate = new THREE.Group();
		beeScene.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				const clone = child.clone();
				beeTemplate.add(clone);
			}
		});
		for (let i = 0; i < BIENEN.COUNT; i++) {
			const group = new THREE.Group();
			group.add(beeTemplate.clone(true));
			const angle = Math.random() * Math.PI * 2;
			const dist = BIENEN.SPAWN_DIST_MIN + Math.random() * (BIENEN.SPAWN_DIST_MAX - BIENEN.SPAWN_DIST_MIN);
			const baseX = Math.cos(angle) * dist;
			const baseZ = Math.sin(angle) * dist;
			group.position.set(baseX, BIENEN.SPAWN_HEIGHT_MIN + Math.random() * (BIENEN.SPAWN_HEIGHT_MAX - BIENEN.SPAWN_HEIGHT_MIN), baseZ);
			group.scale.setScalar(BIENEN.SCALE);
			group.rotation.y = Math.random() * Math.PI * 2;
			ctx.scene.add(group);
			bees.push({
				group,
				orbitCenter: new THREE.Vector3(baseX, 0, baseZ),
				orbitRadius: BIENEN.FLY_RADIUS_MIN + Math.random() * (BIENEN.FLY_RADIUS_MAX - BIENEN.FLY_RADIUS_MIN),
				speed: BIENEN.SPEED_MIN + Math.random() * (BIENEN.SPEED_MAX - BIENEN.SPEED_MIN),
				phase: Math.random() * Math.PI * 2,
				heightBase: BIENEN.HEIGHT_BASE_MIN + Math.random() * (BIENEN.HEIGHT_BASE_MAX - BIENEN.HEIGHT_BASE_MIN),
				heightRange: BIENEN.HEIGHT_RANGE_MIN + Math.random() * (BIENEN.HEIGHT_RANGE_MAX - BIENEN.HEIGHT_RANGE_MIN),
			});
		}
	}

	if (butterflyScene) {
		const butterflyTemplate = new THREE.Group();
		butterflyScene.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				const clone = child.clone();
				butterflyTemplate.add(clone);
			}
		});
		for (let i = 0; i < SCHMETTERLINGE.COUNT; i++) {
			const group = new THREE.Group();
			group.add(butterflyTemplate.clone(true));
			const angle = Math.random() * Math.PI * 2;
			const dist = SCHMETTERLINGE.SPAWN_DIST_MIN + Math.random() * (SCHMETTERLINGE.SPAWN_DIST_MAX - SCHMETTERLINGE.SPAWN_DIST_MIN);
			const baseX = Math.cos(angle) * dist;
			const baseZ = Math.sin(angle) * dist;
			group.position.set(baseX, SCHMETTERLINGE.SPAWN_HEIGHT_MIN + Math.random() * (SCHMETTERLINGE.SPAWN_HEIGHT_MAX - SCHMETTERLINGE.SPAWN_HEIGHT_MIN), baseZ);
			group.scale.setScalar(SCHMETTERLINGE.SCALE);
			group.rotation.y = Math.random() * Math.PI * 2;
			ctx.scene.add(group);
			butterflies.push({
				group,
				orbitCenter: new THREE.Vector3(baseX, 0, baseZ),
				orbitRadius: SCHMETTERLINGE.FLY_RADIUS_MIN + Math.random() * (SCHMETTERLINGE.FLY_RADIUS_MAX - SCHMETTERLINGE.FLY_RADIUS_MIN),
				speed: SCHMETTERLINGE.SPEED_MIN + Math.random() * (SCHMETTERLINGE.SPEED_MAX - SCHMETTERLINGE.SPEED_MIN),
				phase: Math.random() * Math.PI * 2,
				heightBase: SCHMETTERLINGE.HEIGHT_BASE_MIN + Math.random() * (SCHMETTERLINGE.HEIGHT_BASE_MAX - SCHMETTERLINGE.HEIGHT_BASE_MIN),
				heightRange: SCHMETTERLINGE.HEIGHT_RANGE_MIN + Math.random() * (SCHMETTERLINGE.HEIGHT_RANGE_MAX - SCHMETTERLINGE.HEIGHT_RANGE_MIN),
			});
		}
	}

	const compoundEye = new CompoundEyeEffect(ctx.renderer, 1920, 1080);
	compoundEye.setVariant(0);
	const overlay = compoundEye.quad;
	overlay.renderOrder = Infinity;
	overlay.frustumCulled = false;
	overlay.position.set(0, 0, -2);
	overlay.scale.set(10, 10, 1);
	player.camera.add(overlay);

	return {
		player,
		camera: player.camera,
		clouds,
		meadow,
		skyMesh,
		pheromones,
		compoundEye,
		butterflies,
		bees,
		flowerTargets,
		cloudRebuildTimer: null,
		windSpeed: 2,
	};
}

export function tick(
	state: ExperienceState,
	ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
	const s = state as InsectWorldState;

	s.player.tick(ctx.delta);

	s.player.rig.position.y = 3;

	updateClouds(s.clouds, ctx.delta, ctx.playerPosition, s.windSpeed);

	s.meadow.tick(ctx.elapsed);

	for (const bee of s.bees) {
		const t = ctx.elapsed * bee.speed + bee.phase;
		const x = bee.orbitCenter.x + Math.cos(t) * bee.orbitRadius;
		const z = bee.orbitCenter.z + Math.sin(t) * bee.orbitRadius;
		const y = bee.orbitCenter.y + bee.heightBase + Math.sin(t * 2) * bee.heightRange;
		const dx = x - bee.group.position.x;
		const dz = z - bee.group.position.z;
		bee.group.position.set(x, y, z);
		if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
			bee.group.rotation.y = Math.atan2(dx, dz);
		}
		bee.group.rotation.z = Math.sin(t * 3) * 0.05;
		bee.group.rotation.x = Math.sin(t * 2 + 1) * 0.03;
	}

	for (const butterfly of s.butterflies) {
		const t = ctx.elapsed * butterfly.speed + butterfly.phase;
		const x = butterfly.orbitCenter.x + Math.cos(t * 0.7) * butterfly.orbitRadius;
		const z = butterfly.orbitCenter.z + Math.sin(t * 0.7) * butterfly.orbitRadius;
		const y = butterfly.orbitCenter.y + butterfly.heightBase + Math.sin(t * 1.5) * butterfly.heightRange;
		const dx = x - butterfly.group.position.x;
		const dz = z - butterfly.group.position.z;
		butterfly.group.position.set(x, y, z);
		if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
			butterfly.group.rotation.y = Math.atan2(dx, dz);
		}
		butterfly.group.rotation.z = Math.sin(t * 2) * 0.08;
		butterfly.group.rotation.x = Math.sin(t * 1.5 + 1) * 0.05;
	}

	s.pheromones.update(ctx.elapsed);

	return { state: s };
}

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
	const s = state as InsectWorldState;

	s.pheromones.dispose();

	if (s.compoundEye.quad.parent) s.compoundEye.quad.parent.remove(s.compoundEye.quad);
	s.compoundEye.dispose();

	for (const bee of s.bees) scene.remove(bee.group);
	for (const butterfly of s.butterflies) scene.remove(butterfly.group);

	s.meadow.dispose();

	disposeClouds(s.clouds);
	scene.remove(s.clouds);

	scene.remove(s.skyMesh);
	scene.remove(s.player.rig);
}
