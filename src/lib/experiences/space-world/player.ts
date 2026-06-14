import type { ExperienceState } from "../types";
import type { SpaceWorldState } from "./scene";

/**
 * Space World Player — Dual-input 6DOF flight controller
 *
 * Keyboard (handled in scene.ts tick):
 *   - W/S: Forward/Backward thrust
 *   - A/D: Yaw left/right
 *   - R/F: Pitch up/down
 *
 * ICAROS / Controller (handled here via WebSocket orientation):
 *   - pitch → pitch input
 *   - roll → yaw input
 */

export function updatePlayer(
  orientation: { pitch: number; roll: number },
  speed: { accelerate: boolean; brake: boolean },
  state: ExperienceState,
  delta: number,
): void {
  const s = state as SpaceWorldState;

  // ── Rotation from ICAROS/Controller orientation ──
  const pitchInput = orientation.pitch * s.rollYawMultiplier;
  const rollInput = orientation.roll * s.rollYawMultiplier;

  // Apply yaw (from roll)
  s.playerGroup.rotateY(-rollInput * delta * 2);

  // Apply pitch (clamped to ±80°)
  const currentPitch = s.playerGroup.rotation.x;
  const newPitch = currentPitch + pitchInput * delta * 2;
  s.playerGroup.rotation.x = Math.max(
    -Math.PI * 0.44,
    Math.min(Math.PI * 0.44, newPitch),
  );

  // ── Speed (ICAROS accelerate/brake overrides keyboard auto-drift) ──
  if (speed.accelerate) {
    s.targetSpeed = s.boostEnabled ? s.baseSpeed * 2 : s.baseSpeed;
  } else if (speed.brake) {
    s.targetSpeed = -s.baseSpeed * 0.5;
  }
  // If neither accelerate nor brake, keep whatever targetSpeed was set
  // (could be from keyboard W/S or auto-drift)
}
