/**
 * scene.ts – Haupt-Sequencer für Beyond‑Limits.
 *
 * Steuert den Übergang von Underwater World V5 zu Insect World V2:
 * Nach 4:50 min erscheint ein Space‑Time‑Rift‑Portal direkt vor dem
 * Spieler. Sobald er hindurch schwimmt (Kollision), startet der
 * Fade‑Übergang in die Insekten‑Welt.
 *
 * Phasen:
 *   0 [0–290s]     Underwater World läuft normal
 *   1 [290s–∞]     Portal sichtbar → Spieler muss reinschwimmen
 *   2 [onCollide]  Fade to Black (2s)
 *   3 [fadeEnd]    Underwater dispose + Insect setup (async)
 *   4 [insectReady] Fade from Black (2s)
 *   5 [∞]          Insect World läuft normal
 */

import * as THREE from "three/webgpu";
import type { ExperienceState, SetupContext, TickContext } from "../types";

import {
	setup as underwaterSetup,
	tick as underwaterTick,
	dispose as underwaterDispose,
} from "../underwater-world-v5/scene";
import {
	setup as insectSetup,
	tick as insectTick,
	dispose as insectDispose,
} from "../insect-world-v2/scene";

import { createRiftPortal, type RiftPortal } from "$lib/portal/portalRift";

// ── Konstanten ──
const T_PORTAL_APPEAR = 290;     // s – Portal erscheint
const COLLISION_DIST = 3;        // Einheiten – Kollisionsradius
const PORTAL_TIMEOUT = 40;       // s – Notfall‑Timeout nach Portal-Erscheinen
const FADE_DURATION = 2;         // s – Dauer Fade to/from Black

// ── State ──
interface BeyondState extends ExperienceState {
	phase: number;
	_phaseChangedAt: number;   // ctx.elapsed beim letzten Phasenwechsel

	underwaterState: ExperienceState | null;
	insectState: ExperienceState | null;

	camera: THREE.PerspectiveCamera;
	dummyCamera: THREE.PerspectiveCamera;

	fadeSprite: THREE.Sprite;
	portal: RiftPortal;

	insectLights: { ambient: THREE.AmbientLight; sun: THREE.DirectionalLight } | null;
	scene: THREE.Scene;

	_insectReady: boolean;
}

// ── setup ──
export async function setup(ctx: SetupContext): Promise<BeyondState> {
	const fMat = new THREE.SpriteMaterial({
		color: 0x000000,
		transparent: true,
		opacity: 0,
		depthWrite: false,
		depthTest: false,
	});
	const fade = new THREE.Sprite(fMat);
	fade.scale.set(100, 100, 1);
	fade.position.set(0, 0, -10);

	const portal = createRiftPortal({ scale: 3 });
	portal.group.visible = false;
	ctx.scene.add(portal.group);

	const uwState = await underwaterSetup(ctx);
	ctx.scene.add(fade);

	return {
		phase: 0,
		_phaseChangedAt: 0,
		underwaterState: uwState,
		insectState: null,
		camera: (uwState as any).camera as THREE.PerspectiveCamera,
		dummyCamera: ctx.camera,
		fadeSprite: fade,
		portal,
		insectLights: null,
		scene: ctx.scene,
		_insectReady: false,
	};
}

// ── Phasenwechsel (zentral, damit _phaseChangedAt immer korrekt ist) ──
function _setPhase(s: BeyondState, phase: number, elapsed: number): void {
	s.phase = phase;
	s._phaseChangedAt = elapsed;
}

// ── tick ──
export function tick(
	state: ExperienceState,
	ctx: TickContext,
): { state: ExperienceState } {
	const s = state as BeyondState;
	const elapsed = ctx.elapsed;

	// ── Phasen-Übergänge ──

	// 0 → 1: Portal erscheint
	if (s.phase === 0 && elapsed >= T_PORTAL_APPEAR) {
		_setPhase(s, 1, elapsed);
		_spawnPortal(s, ctx);
	}

	// 1 → 2: Kollision oder Notfall-Timeout
	if (s.phase === 1) {
		const dist = ctx.camera.position.distanceTo(s.portal.group.position);
		if (dist < COLLISION_DIST || (elapsed - s._phaseChangedAt) > PORTAL_TIMEOUT) {
			_setPhase(s, 2, elapsed);
		}
	}

	// 2 → 3: Fade abgeschlossen
	if (s.phase === 2 && (elapsed - s._phaseChangedAt) >= FADE_DURATION) {
		_setPhase(s, 3, elapsed);
		_startTransition(s);
	}

	// 3 → 4: Insect-Setup fertig
	if (s.phase === 3 && s._insectReady) {
		_setPhase(s, 4, elapsed);
	}

	// 4 → 5: Fade-in abgeschlossen
	if (s.phase === 4 && (elapsed - s._phaseChangedAt) >= FADE_DURATION) {
		_setPhase(s, 5, elapsed);
		s.portal.group.visible = false;
		s.fadeSprite.material.opacity = 0;
	}

	// ── Per-Phase Update ──
	switch (s.phase) {
		case 0:
		case 1:
			return _tickUnderwater(s, ctx);

		case 2: {
			const t = Math.min(1, (elapsed - s._phaseChangedAt) / FADE_DURATION);
			s.fadeSprite.material.opacity = t;
			if (s.underwaterState) return _tickUnderwater(s, ctx);
			return { state: s };
		}

		case 3:
			return { state: s };

		case 4: {
			if (!s._insectReady || !s.insectState) return { state: s };
			const t = Math.min(1, (elapsed - s._phaseChangedAt) / FADE_DURATION);
			s.fadeSprite.material.opacity = 1 - t;
			return _tickInsect(s, ctx);
		}

		case 5:
			return _tickInsect(s, ctx);

		default:
			return { state: s };
	}
}

// ── Sub-Ticks (schreiben Ergebnis zurück in den State) ──
function _tickUnderwater(s: BeyondState, ctx: TickContext): { state: BeyondState } {
	const result = underwaterTick(s.underwaterState!, ctx);
	s.underwaterState = result.state;
	return { state: s };
}

function _tickInsect(s: BeyondState, ctx: TickContext): { state: BeyondState } {
	if (!s.insectState) return { state: s };
	const result = insectTick(s.insectState, ctx);
	s.insectState = result.state;
	return { state: s };
}

// ── dispose ──
export function dispose(state: ExperienceState, scene: THREE.Scene): void {
	const s = state as BeyondState;
	if (s.underwaterState) underwaterDispose(s.underwaterState, scene);
	if (s.insectState) insectDispose(s.insectState, scene);

	if (s.portal) {
		s.portal.dispose();
		scene.remove(s.portal.group);
	}
	if (s.fadeSprite) {
		scene.remove(s.fadeSprite);
		s.fadeSprite.material.dispose();
	}
	if (s.insectLights) {
		scene.remove(s.insectLights.ambient);
		s.insectLights.ambient.dispose();
		scene.remove(s.insectLights.sun);
		s.insectLights.sun.dispose();
	}
}

// ── Hilfsfunktionen ──

/** Portal 10 m vor dem Spieler auf Augenhöhe platzieren */
function _spawnPortal(s: BeyondState, ctx: TickContext): void {
	const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
	fwd.y = 0;
	fwd.normalize();
	s.portal.group.position
		.copy(ctx.camera.position)
		.add(fwd.multiplyScalar(10));
	// Portal auf Augenhöhe zentrieren
	s.portal.group.position.y = ctx.camera.position.y;
	s.portal.group.lookAt(ctx.camera.position);
	s.portal.group.visible = true;
}

/** Underwater entsorgen und Insect-Setup asynchron starten */
function _startTransition(s: BeyondState): void {
	underwaterDispose(s.underwaterState!, s.scene);
	s.underwaterState = null;

	s.dummyCamera.fov = 70;
	s.dummyCamera.near = 0.1;
	s.dummyCamera.far = 800;
	s.dummyCamera.updateProjectionMatrix();
	s.camera = s.dummyCamera;

	_setupInsectAsync(s);
}

/** Insect World asynchron aufbauen */
async function _setupInsectAsync(s: BeyondState): Promise<void> {
	try {
		// Einen Frame warten (dispose wurde gerade aufgerufen)
		await new Promise((r) => requestAnimationFrame(r));

		s.scene.fog = null;
		s.scene.background = new THREE.Color(0x000000);

		const ambient = new THREE.AmbientLight(0xffffff, 0.4);
		s.scene.add(ambient);
		const sun = new THREE.DirectionalLight(0xffffff, 1.5);
		sun.position.set(50, 80, 30);
		s.scene.add(sun);
		s.insectLights = { ambient, sun };

		s.scene.remove(s.fadeSprite);

		const iState = await insectSetup({
			scene: s.scene,
			camera: s.dummyCamera,
			renderer: null as any,
		});
		s.insectState = iState;

		s.scene.add(s.fadeSprite);
		s.fadeSprite.material.opacity = 1;

		s._insectReady = true;
		// Nächster tick wechselt zu Phase 4 über _setPhase
	} catch (err) {
		console.error("[Beyond-limits] Insect-Setup fehlgeschlagen:", err);
	}
}
