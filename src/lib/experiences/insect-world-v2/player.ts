/**
 * insect-world-v2 — Player / Steuerung.
 * Verarbeitet Orientation- und Speed-Inputs.
 * Pitch → leichte Temporegelung, Roll → Kurve, Accelerate/Brake → Tempo.
 * baseSpeed kann per Settings-Parameter angepasst werden.
 * WebGPU-konform (kein WebGL).
 */
import * as THREE from "three/webgpu";
import type { ExperienceState } from "../types";
import { getWorldHeight } from "./Biome/Wiese/grass-manager";

const DEFAULT_BASE_SPEED = 2;
const PITCH_SPEED_FACTOR = 0.03;
const YAW_FACTOR = 0.02;

export function updatePlayer(
  orientation: { pitch: number; roll: number },
  speed: { accelerate: boolean; brake: boolean },
  state: ExperienceState,
  delta: number,
): void {
  const s = state as Record<string, unknown>;
  const camera = s.camera as THREE.PerspectiveCamera;
  if (!camera) return;

  // baseSpeed aus State lesen (wird von applySettings gesetzt), sonst Default
  const baseSpeed = (s.baseSpeed as number) ?? DEFAULT_BASE_SPEED;

  // Geschwindigkeit: Basis + Pitch-Einfluss
  const pitchFactor = -orientation.pitch * PITCH_SPEED_FACTOR;
  let moveSpeed = baseSpeed + pitchFactor;
  if (speed.accelerate) moveSpeed *= 2;
  if (speed.brake) moveSpeed *= 0.3;

  // Roll → Gieren (Kurve)
  const yawSpeed = orientation.roll * YAW_FACTOR;
  camera.rotation.y += yawSpeed * delta;

  // Vorwärtsrichtung horizontal halten
  const forward = new THREE.Vector3(0, 0, -1);
  forward.applyQuaternion(camera.quaternion);
  forward.y = 0;
  forward.normalize();

  camera.position.addScaledVector(forward, moveSpeed * delta);

  // Höhe über Grund halten (~2m über dem Boden = Insekten-Perspektive)
  const groundY = getWorldHeight(camera.position.x, camera.position.z);
  const targetY = groundY + 2;
  camera.position.y += (targetY - camera.position.y) * 0.5 * delta;
  if (camera.position.y < groundY + 0.5) camera.position.y = groundY + 0.5;
}
