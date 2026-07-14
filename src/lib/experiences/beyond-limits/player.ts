/**
 * player.ts – Delegiert ICAROS-Steuerung an die aktive Sub-Experience.
 *
 * Phasen:
 *   0–1 → Underwater World (Pitch=Steigen/Sinken, Roll=Kurve)
 *   2   → Transition (keine Steuerung, schwarzer Bildschirm)
 *   3–4 → Insect World (genauso: Pitch=Steigen/Sinken, Roll=Kurve)
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

	// Phase 0–1: Underwater World
	if (phase <= 1 && s.underwaterState) {
		return uwUpdatePlayer(
			orientation,
			speed,
			s.underwaterState as ExperienceState,
			delta,
		);
	}

	// Phase 3–4: Insect World
	//   Roll muss negiert werden: Underwater  → heading -= roll
	//   Insect                    → rotation.y += roll  (gegensätzlich)
	if (phase >= 3 && s.insectState) {
		return insectUpdatePlayer(
			{ pitch: orientation.pitch, roll: -orientation.roll },
			speed,
			s.insectState as ExperienceState,
			delta,
		);
	}
	// Phase 2: keine Steuerung
}
