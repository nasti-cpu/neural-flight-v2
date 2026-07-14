/**
 * player.ts – Delegiert ICAROS-Steuerung an die aktive Welt.
 *
 *   world: 0 = Underwater World
 *   world: 1 = Insect World
 *   Roll wird für Insect negiert (siehe Roll-Vorzeichen)
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
	const world = s.world as number;
	const stage = s.stage as number;

	// Während Stage 2 (Transition) keine Steuerung
	if (stage === 2) return;

	if (world === 0 && s.underwaterState) {
		return uwUpdatePlayer(
			orientation,
			speed,
			s.underwaterState as ExperienceState,
			delta,
		);
	}

	if (world === 1 && s.insectState) {
		// Roll-Vorzeichen angleichen (Underwater: heading -= roll)
		return insectUpdatePlayer(
			{ pitch: orientation.pitch, roll: -orientation.roll },
			speed,
			s.insectState as ExperienceState,
			delta,
		);
	}
}
