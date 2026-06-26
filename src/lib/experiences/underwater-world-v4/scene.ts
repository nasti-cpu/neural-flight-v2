import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";

export async function setup(_ctx: SetupContext): Promise<ExperienceState> {
  return {};
}

export function tick(state: ExperienceState, _ctx: TickContext): { state: ExperienceState } {
  return { state };
}

export function dispose(_state: ExperienceState, _scene: THREE.Scene): void {
}
