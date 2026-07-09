/**
 * scene.ts – Lifecycle für Experiment 12 (Tiefsee-Unterwasserwelt).
 *
 * setup:     Erstellt alle Weltobjekte via createWorldState().
 * tick:      Ruft updateWorld() pro Frame auf.
 * dispose:   Räumt via destroyWorld() auf (ohne Renderer/Canvas/Input).
 */

import * as THREE from "three/webgpu";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import type { UnderwaterWorldState } from "$lib/experiments/experiment-12/welt/underwaterWorld";
import {
  createWorldState,
  updatePlayer as uwUpdatePlayer,
  updateWorld,
  destroyWorld,
} from "$lib/experiments/experiment-12/welt/underwaterWorld";

export async function setup(ctx: SetupContext): Promise<ExperienceState> {
  // ctx.renderer ist als WebGLRenderer getypt, aber zur Laufzeit
  // ein WebGPURenderer (siehe VR-Route +page.svelte)
  const renderer = ctx.renderer as any;
  const state = await createWorldState(ctx.scene, ctx.camera, renderer);
  return state as unknown as ExperienceState;
}

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState } {
  const s = state as unknown as UnderwaterWorldState;
  updateWorld(s, ctx.delta, ctx.elapsed);
  return { state };
}

export function dispose(state: ExperienceState, _scene: THREE.Scene): void {
  const s = state as unknown as UnderwaterWorldState;
  destroyWorld(s);
}

export function updatePlayer(
  orientation: { pitch: number; roll: number },
  speed: { accelerate: boolean; brake: boolean },
  state: ExperienceState,
  delta: number,
): void {
  const s = state as unknown as UnderwaterWorldState;
  uwUpdatePlayer(orientation, speed, s, delta);
}
