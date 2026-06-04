import * as THREE from "three";
import { CAMERA, CLOUDS, FLIGHT, SKY } from "$lib/config/flight";
import { createClouds, disposeClouds, updateClouds } from "$lib/three/clouds";
import { createFloatingObjects, type FloatingObjectsHandle } from "$lib/three/floating-objects";
import { FlightPlayer } from "$lib/three/player";
import { createProceduralCity, type ProceduralCityHandle } from "$lib/three/procedural-city";
import { createSky } from "$lib/three/sky";
import { createWater } from "$lib/three/terrain/water";
import type { ExperienceState, SetupContext, TickContext } from "../types";

export interface InsectWorldState extends ExperienceState {
	player: FlightPlayer;
	skyMesh: THREE.Mesh;
	clouds: THREE.Group;
	water: THREE.Mesh;
	ground: THREE.Mesh;
	grassGroup: THREE.Group;
	flowerGroup: THREE.Group;
	butterflies: FloatingObjectsHandle;
	bees: FloatingObjectsHandle;
	city: ProceduralCityHandle;
	flowerMaterial: THREE.MeshStandardMaterial;
	grassMaterial: THREE.MeshStandardMaterial;
	score: number;
	cloudRebuildTimer: ReturnType<typeof setTimeout> | null;
	windSpeed: number;
}

function createGrassBlades(
	count: number,
	height: number,
	material: THREE.MeshStandardMaterial,
): THREE.Group {
	const group = new THREE.Group();
	const geo = new THREE.ConeGeometry(0.08, 1, 4);

	for (let i = 0; i < count; i++) {
		const mesh = new THREE.Mesh(geo, material);
		const scale = 0.8 + Math.random() * 0.4;
		mesh.scale.set(scale, height * scale, scale);
		mesh.position.set(
			(Math.random() - 0.5) * 160,
			0,
			(Math.random() - 0.5) * 160,
		);
		mesh.rotation.set(
			(Math.random() - 0.5) * 0.15,
			Math.random() * Math.PI * 2,
			(Math.random() - 0.5) * 0.15,
		);
		mesh.castShadow = true;
		mesh.userData.swingPhase = Math.random() * Math.PI * 2;
		mesh.userData.swingSpeed = 0.5 + Math.random() * 1.5;
		group.add(mesh);
	}

	geo.dispose();
	return group;
}

function createFlowers(
	count: number,
	color: string,
	material: THREE.MeshStandardMaterial,
): THREE.Group {
	const group = new THREE.Group();
	const stemGeo = new THREE.CylinderGeometry(0.03, 0.05, 1, 4);
	const headGeo = new THREE.SphereGeometry(0.2, 6, 6);
	const stemMat = new THREE.MeshStandardMaterial({ color: "#4a7c3f" });

	for (let i = 0; i < count; i++) {
		const stem = new THREE.Mesh(stemGeo, stemMat);
		const head = new THREE.Mesh(headGeo, material);
		const x = (Math.random() - 0.5) * 160;
		const z = (Math.random() - 0.5) * 160;
		const h = 0.5 + Math.random() * 1.5;

		stem.position.set(x, h / 2, z);
		stem.scale.y = h;
		stem.castShadow = true;

		head.position.set(x, h + 0.2, z);
		head.scale.setScalar(0.5 + Math.random() * 0.8);
		head.castShadow = true;

		group.add(stem);
		group.add(head);
	}

	stemGeo.dispose();
	headGeo.dispose();
	stemMat.dispose();
	return group;
}

export async function setup(ctx: SetupContext): Promise<InsectWorldState> {
	const player = new FlightPlayer({
		fov: CAMERA.FOV,
		near: CAMERA.NEAR,
		far: CAMERA.FAR,
		spawnPosition: { x: 0, y: 2, z: 0 },
		baseSpeed: 8,
		terrainSlowdown: 0.7,
	});
	ctx.scene.add(player.rig);

	const sun = ctx.scene.children.find(
		(c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight,
	);
	if (sun) {
		sun.castShadow = true;
		sun.shadow.mapSize.set(1024, 1024);
		sun.shadow.camera.left = -100;
		sun.shadow.camera.right = 100;
		sun.shadow.camera.top = 100;
		sun.shadow.camera.bottom = -100;
		sun.shadow.camera.near = 0.5;
		sun.shadow.camera.far = 300;
	}

	const groundGeo = new THREE.PlaneGeometry(300, 300);
	const groundMat = new THREE.MeshStandardMaterial({
		color: "#5a8f4c",
		roughness: 0.9,
	});
	const ground = new THREE.Mesh(groundGeo, groundMat);
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	ctx.scene.add(ground);

	const grassMat = new THREE.MeshStandardMaterial({
		color: "#6aaf4c",
		roughness: 0.8,
	});
	const grassGroup = createGrassBlades(800, 2, grassMat);
	ctx.scene.add(grassGroup);

	const flowerMat = new THREE.MeshStandardMaterial({
		color: "#ff6b9d",
		roughness: 0.6,
	});
	const flowerGroup = createFlowers(60, "#ff6b9d", flowerMat);
	ctx.scene.add(flowerGroup);

	const water = createWater({
		size: 40,
		color: 0x2980b9,
		opacity: 0.6,
		y: 0.1,
	});
	water.position.set(30, 0.1, -20);
	ctx.scene.add(water);

	const skyMesh = createSky({
		radius: SKY.RADIUS,
		detail: SKY.DETAIL,
		colorTop: 0x4a90d9,
		colorHorizon: 0x87ceeb,
		colorBottom: 0xe8f5e9,
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

	const butterflyGeo = new THREE.ConeGeometry(0.3, 0.05, 4);
	const butterflyMat = new THREE.MeshStandardMaterial({
		color: 0xff9f43,
		side: THREE.DoubleSide,
	});
	const butterflies = createFloatingObjects({
		geometry: butterflyGeo,
		material: butterflyMat,
		count: 15,
		spread: 60,
		heightRange: [0.5, 4],
		scaleRange: [0.3, 1.0],
		bobAmplitude: 0.6,
		bobFrequency: 2.5,
	});
	ctx.scene.add(butterflies.mesh);

	const beeGeo = new THREE.SphereGeometry(0.15, 6, 6);
	const beeMat = new THREE.MeshStandardMaterial({
		color: 0xf39c12,
		roughness: 0.7,
	});
	const bees = createFloatingObjects({
		geometry: beeGeo,
		material: beeMat,
		count: 10,
		spread: 50,
		heightRange: [0.3, 3],
		scaleRange: [0.4, 0.8],
		bobAmplitude: 0.3,
		bobFrequency: 4.0,
	});
	ctx.scene.add(bees.mesh);

	const city = createProceduralCity({
		gridSize: 15,
		cellSize: 3,
		density: 0.5,
		minHeight: 2,
		maxHeight: 15,
		color: 0x555566,
		seed: 42,
	});
	city.mesh.position.set(-80, 0, -60);
	ctx.scene.add(city.mesh);

	return {
		player,
		skyMesh,
		clouds,
		water,
		ground,
		grassGroup,
		flowerGroup,
		butterflies,
		bees,
		city,
		flowerMaterial: flowerMat,
		grassMaterial: grassMat,
		score: 0,
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

	updateClouds(s.clouds, ctx.delta, s.player.rig.position, s.windSpeed);

	s.butterflies.update(ctx.elapsed);
	s.bees.update(ctx.elapsed);

	for (const child of s.grassGroup.children) {
		if (child instanceof THREE.Mesh) {
			const phase = (child.userData.swingPhase as number) ?? 0;
			const speed = (child.userData.swingSpeed as number) ?? 1;
			const sway = Math.sin(ctx.elapsed * speed + phase) * 0.02;
			child.rotation.z = sway;
		}
	}

	return { state: s };
}

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
	const s = state as InsectWorldState;

	if (s.cloudRebuildTimer) clearTimeout(s.cloudRebuildTimer);

	s.butterflies.dispose();
	s.bees.dispose();
	s.city.dispose();
	disposeClouds(s.clouds);

	for (const child of s.grassGroup.children) {
		if (child instanceof THREE.Mesh) {
			child.geometry.dispose();
		}
	}
	s.grassMaterial.dispose();

	for (const child of s.flowerGroup.children) {
		if (child instanceof THREE.Mesh) {
			child.geometry.dispose();
		}
	}
	s.flowerMaterial.dispose();

	scene.remove(s.grassGroup);
	scene.remove(s.flowerGroup);

	if (s.ground.geometry) s.ground.geometry.dispose();
	if (s.ground.material instanceof THREE.Material) s.ground.material.dispose();
	scene.remove(s.ground);

	scene.remove(s.water);
	scene.remove(s.skyMesh);
	scene.remove(s.clouds);
	scene.remove(s.player.rig);
	scene.remove(s.butterflies.mesh);
	scene.remove(s.bees.mesh);
	scene.remove(s.city.mesh);
}
