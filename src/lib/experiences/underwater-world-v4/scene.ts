import * as THREE from "three";
import { FlightPlayer } from "$lib/three/player";
import type { ExperienceState, SetupContext, TickContext } from "../types";

export interface UnderwaterWorldV4State extends ExperienceState {
  player: FlightPlayer;
  camera: THREE.PerspectiveCamera;
}

export async function setup(
  ctx: SetupContext,
): Promise<UnderwaterWorldV4State> {
  const player = new FlightPlayer({
    fov: 75,
    near: 0.1,
    far: 600,
    spawnPosition: { x: 0, y: 4, z: 0 },
    baseSpeed: 2,
  });
  player.rollYawMultiplier = 0;
  ctx.scene.add(player.rig);

  return {
    player,
    camera: player.camera,
  };
}

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState } {
  const s = state as UnderwaterWorldV4State;
  s.player.tick(ctx.delta);
  return { state: s };
}

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as UnderwaterWorldV4State;
  scene.remove(s.player.rig);
}
