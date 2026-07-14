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
 *   1 [290s–∞]     Portal sichtbar → distance-basierter Fade (10→3 m)
 *   2 [Kollision]  Voll schwarz (+ dispose Underwater + async Insect setup)
 *   3 [ready]      Fade from Black (3s)
 *   4 [∞]          Insect World läuft normal
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
const FADE_RANGE = 10;           // Einheiten – Abstand ab dem Fade beginnt (bei 13 → 3)
const PORTAL_TIMEOUT = 40;       // s – Notfall‑Timeout nach Portal-Erscheinen
const FADE_DURATION = 3;         // s – Dauer Fade from Black
const FADE_Z = 5;                // Einheiten – Abstand FadeSprite vor Kamera

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

	/** Wiederverwendbare Vektoren (keine Garbage pro Frame) */
	_worldPos: THREE.Vector3;
	_fwd: THREE.Vector3;
	_worldQuat: THREE.Quaternion;
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
	fade.renderOrder = 999; // immer ganz zuletzt rendern (über Partikel etc.)

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
		_worldPos: new THREE.Vector3(),
		_fwd: new THREE.Vector3(),
		_worldQuat: new THREE.Quaternion(),
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

	// 1 → 2: Distance-basierter Fade + Kollision
	if (s.phase === 1) {
		ctx.camera.getWorldPosition(s._worldPos);
		const dist = s._worldPos.distanceTo(s.portal.group.position);

		// Fade progress 0→1 je näher der Spieler kommt (13 → 3 Einheiten)
		const fadeProgress = 1 - Math.max(0, Math.min(1,
			(dist - COLLISION_DIST) / FADE_RANGE));
		s.fadeSprite.material.opacity = fadeProgress;

		if (dist < COLLISION_DIST || (elapsed - s._phaseChangedAt) > PORTAL_TIMEOUT) {
			s.fadeSprite.material.opacity = 1; // voll schwarz
			_setPhase(s, 2, elapsed);
			_startTransition(s);
		}
	}

	// 2 → 3: Insect-Setup fertig → Fade-In starten
	if (s.phase === 2 && s._insectReady) {
		_setPhase(s, 3, elapsed);
	}

	// 3 → 4: Fade-In abgeschlossen
	if (s.phase === 3 && (elapsed - s._phaseChangedAt) >= FADE_DURATION) {
		_setPhase(s, 4, elapsed);
		s.fadeSprite.material.opacity = 0;
	}

	// ── FadeSprite immer vor die aktuelle Kamera ──
	// ab Phase 1 (Portal-Annäherung) muss es der Kamera folgen,
	// sonst bleibt es an (0,0,-10) in der Welt und der Fade ist unsichtbar
	if (s.phase >= 1) {
		ctx.camera.getWorldPosition(s._worldPos);
		ctx.camera.getWorldQuaternion(s._worldQuat);
		const fwd = s._fwd.set(0, 0, -1).applyQuaternion(s._worldQuat);
		s.fadeSprite.position.copy(s._worldPos).add(fwd.multiplyScalar(FADE_Z));
	}

	// ── Per-Phase Update ──
	switch (s.phase) {
		case 0:
		case 1:
			return _tickUnderwater(s, ctx);

		// Phase 2: Transition läuft (black screen) – warte auf Insect-Setup
		case 2:
			return { state: s };

		// Phase 3: Insect ready → Fade In (3s)
		case 3: {
			if (!s.insectState) return { state: s };
			const t = Math.min(1, (elapsed - s._phaseChangedAt) / FADE_DURATION);
			s.fadeSprite.material.opacity = 1 - t;
			return _tickInsect(s, ctx);
		}

		// Phase 4: Insect World läuft normal
		case 4:
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

/** Portal 10 m vor dem Spieler (Weltkoordinaten + Weltquaternion) auf Augenhöhe platzieren */
function _spawnPortal(s: BeyondState, ctx: TickContext): void {
	const camWorld = s._worldPos;
	ctx.camera.getWorldPosition(camWorld);
	ctx.camera.getWorldQuaternion(s._worldQuat);

	// Forward aus Weltquaternion (lokales Quat ist relativ zum Rig → falsch)
	const fwd = s._fwd.set(0, 0, -1).applyQuaternion(s._worldQuat);
	fwd.y = 0;
	fwd.normalize();

	s.portal.group.position.copy(camWorld).add(fwd.multiplyScalar(10));
	s.portal.group.position.y = camWorld.y;
	s.portal.group.lookAt(camWorld);
	s.portal.group.visible = true;
}

/** Underwater entsorgen, Portal ausblenden und Insect-Setup asynchron starten */
function _startTransition(s: BeyondState): void {
	underwaterDispose(s.underwaterState!, s.scene);
	s.underwaterState = null;

	// Portal sofort unsichtbar – es soll NICHT in der Insect-World erscheinen
	s.portal.group.visible = false;

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

		const iState = await insectSetup({
			scene: s.scene,
			camera: s.dummyCamera,
			renderer: null as any,
		});
		s.insectState = iState;

		s.fadeSprite.material.opacity = 1;

		s._insectReady = true;
		// Nächster tick erkennt Phase 2→3
	} catch (err) {
		console.error("[Beyond-limits] Insect-Setup fehlgeschlagen:", err);
	}
}
