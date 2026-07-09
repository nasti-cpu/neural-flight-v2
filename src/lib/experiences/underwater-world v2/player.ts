import type { ExperienceState } from "../types";
import type { UnderwaterWorldState } from "./scene";

export function updatePlayer(
  orientation: { pitch: number; roll: number },
  speed: { accelerate: boolean; brake: boolean },
  state: ExperienceState,
  delta: number,
): void {
  const s = state as UnderwaterWorldState;
  const { pitch, roll } = orientation;
  const rig = s.rig;

  // 1. Roll -> Yaw (Horizontal Rotation)
  // Normalized roll (-90 to 90) maps to yaw speed.
  const yawSpeed = (roll / 90) * s.wasdSpeed * delta * 0.5;
  rig.rotation.y -= yawSpeed;

  // 2. Pitch -> Vertical Movement
  // Normalized pitch maps to vertical speed.
  const vertSpeed = (-pitch / 90) * s.wasdSpeed * delta;
  rig.position.y += vertSpeed;

  // 3. Speed Commands
  if (speed.accelerate) {
    s.driftSpeed = Math.min(30, s.driftSpeed + delta * 25);
  } else if (speed.brake) {
    s.driftSpeed = Math.max(4, s.driftSpeed - delta * 5);
  }
}
