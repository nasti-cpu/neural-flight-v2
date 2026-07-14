/**
 * player.ts – Delegiert ICAROS-Steuerung an die aktive Sub-Experience.
 *
 * Phase 0–2 → updatePlayer aus der Underwater World
 * Phase 3   → keine Steuerung (Transition, schwarzer Bildschirm)
 * Phase 4–5 → updatePlayer aus der Insect World
 */

import type { ExperienceState } from "../types";
import { updatePlayer as uwUpdatePlayer } from "../underwater-world-v5/scene";
import { updatePlayer as insectUpdatePlayer } from "../insect-world-v2/player";

export function updatePlayer(
	orientation: { pitch: number; roll: number },
	speed: { accelerate: boolean; brake: boolean },
	state: ExperienceState,
	delta: number,
): void {
	const s = state as Record<string, unknown>;
	const phase = s.phase as number;

	if (phase <= 2 && s.underwaterState) {
		return uwUpdatePlayer(
			orientation,
			speed,
			s.underwaterState as ExperienceState,
			delta,
		);
	}

	if (phase >= 4 && s.insectState) {
		return insectUpdatePlayer(
			orientation,
			speed,
			s.insectState as ExperienceState,
			delta,
		);
	}
}
