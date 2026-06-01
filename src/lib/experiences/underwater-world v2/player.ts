import type { ExperienceState } from "../types";
import type { UnderwaterWorldState } from "./scene";

export function updatePlayer(
	orientation: { pitch: number; roll: number },
	_speed: { accelerate: boolean; brake: boolean },
	state: ExperienceState,
	delta: number,
): void {
	const s = state as UnderwaterWorldState;
	const moveZ = -orientation.pitch * s.wasdSpeed * delta;
	const moveX = orientation.roll * s.wasdSpeed * delta;
	s.camera.position.x += moveX;
	s.camera.position.z += moveZ;
}
