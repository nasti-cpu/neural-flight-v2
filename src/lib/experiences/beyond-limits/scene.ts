/**
 * scene.ts – Zyklischer Sequencer für Beyond‑Limits.
 *
 * Wechselt alle ~5 min zwischen Underwater World und Insect World:
 *   1. Portal erscheint vor dem Spieler
 *   2. Annäherung → distance-basierter Fade to Black
 *   3. Alte Welt disposen, neue Welt asynchron aufbauen
 *   4. Fade from Black in die neue Welt
 *   5. Repeat (Loop)
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
const T_PORTAL_APPEAR = 290;     // s – aktive Zeit bevor Portal erscheint
const COLLISION_DIST = 3;        // Einheiten – Kollisionsradius
const FADE_RANGE = 10;           // Einheiten – Abstand ab dem Fade beginnt
const PORTAL_TIMEOUT = 40;       // s – Notfall‑Timeout nach Portal-Erscheinen
const FADE_DURATION = 3;         // s – Dauer Fade from Black
const FADE_Z = 5;                // Einheiten – Abstand FadeSprite vor Kamera

// ── State ──
interface BeyondState extends ExperienceState {
	/** 0 = Underwater, 1 = Insect */
	world: number;
	/** 0=active, 1=portal+fade, 2=black+transition, 3=fadeIn */
	stage: number;
	/** ctx.elapsed beim Start der aktuellen stage */
	stageStart: number;

	/** Zustand der jeweils aktiven Welt */
	underwaterState: ExperienceState | null;
	insectState: ExperienceState | null;

	camera: THREE.PerspectiveCamera;
	dummyCamera: THREE.PerspectiveCamera;

	fadeSprite: THREE.Sprite;
	portal: RiftPortal;

	insectLights: { ambient: THREE.AmbientLight; sun: THREE.DirectionalLight } | null;
	scene: THREE.Scene;

	/** Asynchroner Setup der nächsten Welt fertig? */
	_ready: boolean;

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
	fade.renderOrder = 999;

	const portal = createRiftPortal({ scale: 3 });
	portal.group.visible = false;
	ctx.scene.add(portal.group);

	// Starte mit Underwater World
	const uwState = await underwaterSetup(ctx);
	ctx.scene.add(fade);

	return {
		world: 0,
		stage: 0,
		stageStart: 0,
		underwaterState: uwState,
		insectState: null,
		camera: (uwState as any).camera as THREE.PerspectiveCamera,
		dummyCamera: ctx.camera,
		fadeSprite: fade,
		portal,
		insectLights: null,
		scene: ctx.scene,
		_ready: false,
		_worldPos: new THREE.Vector3(),
		_fwd: new THREE.Vector3(),
		_worldQuat: new THREE.Quaternion(),
	};
}

// ── Helfer: Stage wechseln ──
function _setStage(s: BeyondState, stage: number, elapsed: number): void {
	s.stage = stage;
	s.stageStart = elapsed;
}

// ── tick ──
export function tick(
	state: ExperienceState,
	ctx: TickContext,
): { state: ExperienceState } {
	const s = state as BeyondState;
	const elapsed = ctx.elapsed;
	const inWorld = s.world;

	// ── Stage-Übergänge ──

	switch (s.stage) {
		// Stage 0: Aktive Welt läuft
		case 0: {
			if (elapsed - s.stageStart >= T_PORTAL_APPEAR) {
				_setStage(s, 1, elapsed);
				_spawnPortal(s, ctx);
			}
			break;
		}

		// Stage 1: Portal + distance-basierter Fade
		case 1: {
			ctx.camera.getWorldPosition(s._worldPos);
			const dist = s._worldPos.distanceTo(s.portal.group.position);

			const fadeProgress = 1 - Math.max(0, Math.min(1,
				(dist - COLLISION_DIST) / FADE_RANGE));
			s.fadeSprite.material.opacity = fadeProgress;

			if (dist < COLLISION_DIST || (elapsed - s.stageStart) > PORTAL_TIMEOUT) {
				s.fadeSprite.material.opacity = 1;
				_setStage(s, 2, elapsed);
				_startTransition(s);
			}
			break;
		}

		// Stage 2: Black Screen – warte auf async Setup der nächsten Welt
		case 2: {
			if (s._ready) {
				_setStage(s, 3, elapsed);
			}
			break;
		}

		// Stage 3: Fade In
		case 3: {
			if ((elapsed - s.stageStart) >= FADE_DURATION) {
				// Nächsten Zyklus starten
				s.world = inWorld === 0 ? 1 : 0;
				s.stage = 0;
				s.stageStart = elapsed;
				s.fadeSprite.material.opacity = 0;
				s.portal.group.visible = false;
				s._ready = false;
			}
			break;
		}
	}

	// ── FadeSprite immer vor die Kamera ──
	// Stage 1, 2, 3: Fade ist aktiv
	if (s.stage >= 1) {
		ctx.camera.getWorldPosition(s._worldPos);
		ctx.camera.getWorldQuaternion(s._worldQuat);
		const fwd = s._fwd.set(0, 0, -1).applyQuaternion(s._worldQuat);
		s.fadeSprite.position.copy(s._worldPos).add(fwd.multiplyScalar(FADE_Z));
	}

	// ── Per-Stage Update ──
	switch (s.stage) {
		// Stage 0, 1: Aktuelle Welt ticken
		case 0:
		case 1:
			return _tickActiveWorld(s, ctx);

		// Stage 2: Nichts (black screen)
		case 2:
			return { state: s };

		// Stage 3: Neue Welt ticken + Fade In
		case 3: {
			const t = Math.min(1, (elapsed - s.stageStart) / FADE_DURATION);
			s.fadeSprite.material.opacity = 1 - t;
			return _tickActiveWorld(s, ctx);
		}

		default:
			return { state: s };
	}
}

// ── Tick der aktuell aktiven Welt ──
function _tickActiveWorld(s: BeyondState, ctx: TickContext): { state: BeyondState } {
	if (s.world === 0 && s.underwaterState) {
		const r = underwaterTick(s.underwaterState, ctx);
		s.underwaterState = r.state;
		return { state: s };
	}
	if (s.world === 1 && s.insectState) {
		const r = insectTick(s.insectState, ctx);
		s.insectState = r.state;
		return { state: s };
	}
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

/** Portal 10 m vor dem Spieler platzieren */
function _spawnPortal(s: BeyondState, ctx: TickContext): void {
	ctx.camera.getWorldPosition(s._worldPos);
	ctx.camera.getWorldQuaternion(s._worldQuat);

	const fwd = s._fwd.set(0, 0, -1).applyQuaternion(s._worldQuat);
	fwd.y = 0;
	fwd.normalize();

	s.portal.group.position.copy(s._worldPos).add(fwd.multiplyScalar(10));
	s.portal.group.position.y = s._worldPos.y;
	s.portal.group.lookAt(s._worldPos);
	s.portal.group.visible = true;
}

/** Transition starten: alte Welt disposen, neue asynchron aufbauen */
function _startTransition(s: BeyondState): void {
	const goingTo = s.world === 0 ? 1 : 0;

	// Alte Welt disposen
	if (s.world === 0) {
		if (s.underwaterState) underwaterDispose(s.underwaterState, s.scene);
		s.underwaterState = null;
	} else {
		if (s.insectState) insectDispose(s.insectState, s.scene);
		s.insectState = null;
		if (s.insectLights) {
			s.scene.remove(s.insectLights.ambient);
			s.insectLights.ambient.dispose();
			s.scene.remove(s.insectLights.sun);
			s.insectLights.sun.dispose();
			s.insectLights = null;
		}
	}

	// Portal ausblenden
	s.portal.group.visible = false;

	// Auf Dummy-Kamera umschalten
	s.dummyCamera.fov = 70;
	s.dummyCamera.near = 0.1;
	s.dummyCamera.far = 800;
	s.dummyCamera.updateProjectionMatrix();
	s.camera = s.dummyCamera;

	// Nächste Welt asynchron aufbauen
	_setupWorldAsync(s, goingTo);
}

/** Welt asynchron aufbauen (underwater oder insect) */
async function _setupWorldAsync(s: BeyondState, targetWorld: number): Promise<void> {
	try {
		await new Promise((r) => requestAnimationFrame(r));

		if (targetWorld === 0) {
			// → Underwater
			s.scene.fog = null;
			s.scene.background = new THREE.Color(0x001020);
			const uwState = await underwaterSetup({
				scene: s.scene,
				camera: s.dummyCamera,
				renderer: null as any,
			});
			s.underwaterState = uwState;
		} else {
			// → Insect
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
		}

		s.fadeSprite.material.opacity = 1;
		s._ready = true;
	} catch (err) {
		console.error("[Beyond-limits] Setup fehlgeschlagen für world", targetWorld, err);
	}
}
