import * as THREE from "three";
import type { ExperienceState } from "../types";
import type { UnderwaterWorldState } from "./scene";

const DEFAULT_LIGHT_INTENSITY = 1.5;
const MANIFEST_AMBIENT = 0.5;
const MANIFEST_SUN = 0.8;

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
		case "lightIntensity": {
			s.lightIntensity = value as number;
			const ratio = (value as number) / DEFAULT_LIGHT_INTENSITY;
			_scene.traverse((child) => {
				if (child instanceof THREE.AmbientLight) {
					child.intensity = MANIFEST_AMBIENT * ratio;
				} else if (child instanceof THREE.DirectionalLight) {
					child.intensity = MANIFEST_SUN * ratio;
				}
			});
			break;
		}
		case "terrainAmplitude":
			s.terrainAmplitude = value as number;
			break;
		case "terrainScale":
			s.terrainScale = value as number;
			break;
		case "terrainColor":
			s.terrainColor = value as string;
			s.terrainMat.color.set(value as string);
			break;
		case "echolocationEnabled":
			if (s.echoVR) s.echoVR.enabled = value as boolean;
			break;
		case "echolocationRange":
			if (s.echoVR) s.echoVR.range = value as number;
			break;
		case "echolocationInterval":
			if (s.echoVR) s.echoVR.interval = value as number;
			break;
		default:
			break;
	}
}
