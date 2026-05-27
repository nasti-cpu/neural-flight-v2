import * as THREE from "three";
import type { ExperienceState } from "../types";
import type { UnderwaterWorldState } from "./scene";


export function applySettings(
	id: string,
	value: number | boolean | string,
	state: ExperienceState,
	scene: THREE.Scene,
): void {
	const s = state as UnderwaterWorldState;

	switch (id) {
		case "driftSpeed":
			s.driftSpeed = value as number;
			break;

		case "wasdSpeed":
			s.wasdSpeed = value as number;
			break;

		case "echolocationEnabled":
			s.echolocationEnabled = value as boolean;
			break;

		case "echolocationRange":
			s.echolocationRange = value as number;
			break;

		case "fogDensity":
			break;

		case "lightIntensity":
			s.lightIntensity = value as number;
			break;

		case "fishCount":
			break;

		case "terrainAmplitude":
		case "terrainScale":
			break;

		case "terrainColor":
			break;

		default:
			break;
	}
}
