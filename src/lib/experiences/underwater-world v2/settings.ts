import * as THREE from "three";
import type { ExperienceState } from "../types";
import type { UnderwaterWorldState } from "./scene";

export function applySettings(
	id: string,
	value: number | boolean | string,
	state: ExperienceState,
	_scene: THREE.Scene,
): void {
	const s = state as UnderwaterWorldState;
	switch (id) {
		case "driftSpeed":
			s.driftSpeed = value as number;
			break;
		case "wasdSpeed":
			s.wasdSpeed = value as number;
			break;
		case "lightIntensity":
			s.lightIntensity = value as number;
			break;
		case "terrainAmplitude":
			s.terrainAmplitude = value as number;
			break;
		case "terrainScale":
			s.terrainScale = value as number;
			break;
		case "terrainColor":
			s.terrainColor = value as string;
			break;
		default:
			break;
	}
}
