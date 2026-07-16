/**
 * insect-world-v2 — Player / Steuerung.
 * Verarbeitet Orientation- und Speed-Inputs.
 * Pitch → leichte Temporegelung, Roll → Kurve, Accelerate/Brake → Tempo.
 * baseSpeed kann per Settings-Parameter angepasst werden.
 * Bewegt den FlightPlayer-Rig (wie Underwater World).
 */
import * as THREE from "three/webgpu";
import type { ExperienceState } from "../types";
import { getWorldHeight } from "./Biome/Wiese/grass-manager";
import type { FlightPlayer } from "../../three/player";

const DEFAULT_BASE_SPEED = 0.98;
const PITCH_SPEED_FACTOR = 0.03;
const YAW_FACTOR = 0.02;
const _FORWARD = new THREE.Vector3();

export function updatePlayer(
  orientation: { pitch: number; roll: number },
  speed: { accelerate: boolean; brake: boolean },
  state: ExperienceState,
  delta: number,
): void {
  const s = state as Record<string, unknown>;
  const player = s.player as FlightPlayer;
  if (!player) return;

  const rig = player.rig;

  const baseSpeed = (s.baseSpeed as number) ?? DEFAULT_BASE_SPEED;

  const pitchFactor = -orientation.pitch * PITCH_SPEED_FACTOR;
  let moveSpeed = baseSpeed + pitchFactor;
  if (speed.accelerate) moveSpeed *= 2;
  if (speed.brake) moveSpeed *= 0.3;

  const yawSpeed = orientation.roll * YAW_FACTOR;
  rig.rotation.y += yawSpeed * delta;

  _FORWARD.set(0, 0, -1).applyQuaternion(rig.quaternion);
  _FORWARD.y = 0;
  _FORWARD.normalize();

  rig.position.addScaledVector(_FORWARD, moveSpeed * delta);

  const groundY = getWorldHeight(rig.position.x, rig.position.z);
  const targetY = groundY + 2;
  rig.position.y += (targetY - rig.position.y) * 0.5 * delta;
  if (rig.position.y < groundY + 0.5) rig.position.y = groundY + 0.5;
}
