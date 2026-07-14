/**
 * settings.ts – Delegiert Parameter-Änderungen an die aktive Sub-Experience.
 *
 * Parameter-ID bestimmt die Ziel-Experience:
 *   - "driftSpeed"             → Underwater World
 *   - "baseSpeed", "fog*"      → Insect World
 *   - alle anderen             → beide (wenn sie gerade aktiv sind)
 */

import * as THREE from "three";
import type { ExperienceState } from "../types";
import { applySettings as uwSettings } from "../underwater-world-v5/settings";
import { applySettings as insectSettings } from "../insect-world-v2/settings";

const UNDERWATER_IDS = new Set(["driftSpeed"]);
const INSECT_IDS = new Set(["baseSpeed", "fogDensity", "fogColor"]);

export function applySettings(
	id: string,
	value: number | boolean | string,
	state: ExperienceState,
	scene: THREE.Scene,
): void {
	const s = state as Record<string, unknown>;

	if (UNDERWATER_IDS.has(id) && s.underwaterState) {
		return uwSettings(id, value, s.underwaterState as ExperienceState, scene);
	}

	if (INSECT_IDS.has(id) && s.insectState) {
		return insectSettings(id, value, s.insectState as ExperienceState, scene);
	}
}
