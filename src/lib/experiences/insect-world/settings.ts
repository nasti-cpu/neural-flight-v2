import * as THREE from "three";
import { createClouds, disposeClouds } from "$lib/three/clouds";
import { updateSkyColors } from "$lib/three/sky";
import type { ExperienceState } from "../types";
import type { InsectWorldState } from "./scene";

export function applySettings(
	id: string,
	value: number | boolean | string,
	state: ExperienceState,
	scene: THREE.Scene,
): void {
	const s = state as InsectWorldState;

	const sun = scene.children.find(
		(c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight,
	);

	switch (id) {
		case "baseSpeed":
			s.player.baseSpeed = value as number;
			break;

		case "rollYawMultiplier":
			s.player.rollYawMultiplier = value as number;
			break;

		case "lerpAlpha":
			s.player.lerpAlpha = value as number;
			break;

		case "sunIntensity":
			if (sun) sun.intensity = value as number;
			break;

		case "fogNear":
			if (scene.fog instanceof THREE.Fog) scene.fog.near = value as number;
			break;

		case "fogFar":
			if (scene.fog instanceof THREE.Fog) scene.fog.far = value as number;
			break;

		case "fogColor":
			if (scene.fog instanceof THREE.Fog) {
				scene.fog.color.set(value as string);
			}
			break;

		case "skyColorTop":
		case "skyColorHorizon":
		case "skyColorBottom": {
			const ud = s.skyMesh.userData;
			if (id === "skyColorTop") ud.skyColorTop = value;
			if (id === "skyColorHorizon") ud.skyColorHorizon = value;
			if (id === "skyColorBottom") ud.skyColorBottom = value;
			updateSkyColors(
				s.skyMesh,
				(ud.skyColorTop as string) ?? "#4a90d9",
				(ud.skyColorHorizon as string) ?? "#87ceeb",
				(ud.skyColorBottom as string) ?? "#e8f5e9",
			);
			break;
		}

		case "cloudCount":
		case "cloudOpacity": {
			if (id === "cloudCount") s.clouds.userData.count = value;
			if (id === "cloudOpacity") {
				s.clouds.traverse((child) => {
					if (
						child instanceof THREE.Mesh &&
						child.material instanceof THREE.MeshStandardMaterial
					) {
						child.material.opacity = value as number;
					}
				});
				return;
			}
			if (s.cloudRebuildTimer) clearTimeout(s.cloudRebuildTimer);
			s.cloudRebuildTimer = setTimeout(() => {
				const count = (s.clouds.userData.count as number) ?? 20;
				disposeClouds(s.clouds);
				scene.remove(s.clouds);
				s.clouds = createClouds({
					count,
					spread: 300,
					heightMin: 80,
					heightMax: 150,
					blobCount: [4, 8],
					blobRadius: [8, 18],
				});
				scene.add(s.clouds);
				s.cloudRebuildTimer = null;
			}, 500);
			break;
		}

		case "windSpeed":
			s.windSpeed = value as number;
			break;

		default:
			break;
	}
}
