/**
 * scene.ts – Haupt-Sequencer für Beyond‑Limits.
 *
 * Steuert den zeitgesteuerten Übergang von Underwater World V5
 * zu Insect World V2 über ein Space‑Time‑Rift‑Portal.
 *
 * Phasen:
 *   0 [0–290s]  Underwater World läuft normal
 *   1 [290–295s] Portal erscheint vor dem Spieler
 *   2 [295–300s] Spieler fliegt durchs Portal → Fade to Black
 *   3 [300–303s] Underwater dispose + Insect setup (async)
 *   4 [303–306s] Fade from Black → Insect World
 *   5 [306s+]    Insect World läuft normal
 */

import * as THREE from "three/webgpu";
import type { ExperienceState, SetupContext, TickContext } from "../types";

// Lifecycle-Funktionen der Sub-Experiences
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

// ---------------------------------------------------------------------------
// Zeit-Marken (Sekunden)
// ---------------------------------------------------------------------------
const T_PORTAL_APPEAR = 290;
const T_FADE_START = 295;
const T_TRANSITION = 300;
const T_FADE_END = 303;
const T_INSECT_START = 306;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
interface BeyondState extends ExperienceState {
	phase: number;

	/** Zustand der Underwater‑Welt (phase 0–2 aktiv) */
	underwaterState: ExperienceState | null;

	/** Zustand der Insekten‑Welt (phase 4–5 aktiv) */
	insectState: ExperienceState | null;

	/** Aktive Render-Kamera (wechselt bei Transition) */
	camera: THREE.PerspectiveCamera;
	/** Vom Loader übergebene Kamera (für Insekten‑Welt) */
	dummyCamera: THREE.PerspectiveCamera;

	/** Schwarzes Overlay für Fade-Effekte */
	fadeSprite: THREE.Sprite;
	/** Space-Time-Rift */
	portal: RiftPortal;

	/** Lichter für die Insekten‑Welt (nach Underwater-Cleanup) */
	insectLights: { ambient: THREE.AmbientLight; sun: THREE.DirectionalLight } | null;
	/** Referenz auf die Szene */
	scene: THREE.Scene;

	/** Asynchroner Insect‑Setup */
	_insectPromise: Promise<void> | null;
	_insectReady: boolean;
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------
export async function setup(ctx: SetupContext): Promise<BeyondState> {
	// 1. Fade-Overlay (schwarzes Sprite)
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

	// 2. Portal (unsichtbar)
	const portal = createRiftPortal({ scale: 3 });
	portal.group.visible = false;
	ctx.scene.add(portal.group);

	// 3. Underwater‑Welt starten
	const uwState = await underwaterSetup(ctx);

	// 4. Fade-Overlay zur Szene
	ctx.scene.add(fade);

	return {
		phase: 0,
		underwaterState: uwState,
		insectState: null,
		camera: (uwState as any).camera as THREE.PerspectiveCamera,
		dummyCamera: ctx.camera,
		fadeSprite: fade,
		portal,
		insectLights: null,
		scene: ctx.scene,
		_insectPromise: null,
		_insectReady: false,
	};
}

// ---------------------------------------------------------------------------
// tick
// ---------------------------------------------------------------------------
export function tick(
	state: ExperienceState,
	ctx: TickContext,
): { state: ExperienceState } {
	const s = state as BeyondState;
	const elapsed = ctx.elapsed;

	if (s.phase === 0 && elapsed >= T_PORTAL_APPEAR) {
		s.phase = 1;
		_spawnPortal(s, ctx);
	}

	// ── Phase 0, 1 – Underwater (inkl. Portal-Sichtbarkeit) ──
	if (s.phase <= 1) {
		return underwaterTick(s.underwaterState!, ctx);
	}

	// ── Phase 2 – Fade to Black ──
	if (s.phase === 2) {
		const t = Math.min(1, (elapsed - T_FADE_START) / (T_TRANSITION - T_FADE_START));
		s.fadeSprite.material.opacity = t;

		if (elapsed >= T_TRANSITION) {
			s.phase = 3;
			_startTransition(s);
			return { state: s };
		}
		return underwaterTick(s.underwaterState!, ctx);
	}

	// ── Phase 3 – Warte auf Insect-Setup (schwarzer Bildschirm) ──
	if (s.phase === 3) {
		return { state: s };
	}

	// ── Phase 4 – Fade from Black ──
	if (s.phase === 4) {
		if (!s._insectReady) return { state: s };

		const t = Math.min(1, (elapsed - T_FADE_END) / (T_INSECT_START - T_FADE_END));
		s.fadeSprite.material.opacity = 1 - t;

		if (elapsed >= T_INSECT_START) {
			s.phase = 5;
			s.portal.group.visible = false;
			s.fadeSprite.material.opacity = 0;
		}
		return insectTick(s.insectState!, ctx);
	}

	// ── Phase 5 – Insect World ──
	return insectTick(s.insectState!, ctx);
}

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------
export function dispose(state: ExperienceState, scene: THREE.Scene): void {
	const s = state as BeyondState;

	if (s.underwaterState) underwaterDispose(s.underwaterState, scene);
	if (s.insectState) insectDispose(s.insectState, scene);

	s.portal.dispose();
	scene.remove(s.portal.group);
	scene.remove(s.fadeSprite);

	if (s.insectLights) {
		scene.remove(s.insectLights.ambient);
		s.insectLights.ambient.dispose();
		scene.remove(s.insectLights.sun);
		s.insectLights.sun.dispose();
	}
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Portal 10m vor dem Spieler positionieren */
function _spawnPortal(s: BeyondState, ctx: TickContext): void {
	const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
	fwd.y = 0;
	fwd.normalize();
	s.portal.group.position.copy(ctx.camera.position).add(fwd.multiplyScalar(10));
	s.portal.group.position.y += 2;
	s.portal.group.lookAt(ctx.camera.position);
	s.portal.group.visible = true;
}

/** Underwater entsorgen und Insect-Setup asynchron starten */
function _startTransition(s: BeyondState): void {
	// 1. Underwater sofort disposen
	underwaterDispose(s.underwaterState!, s.scene);
	s.underwaterState = null;

	// 2. Auf Dummy-Kamera umschalten
	s.dummyCamera.fov = 70;
	s.dummyCamera.near = 0.1;
	s.dummyCamera.far = 800;
	s.dummyCamera.updateProjectionMatrix();
	s.camera = s.dummyCamera;

	// 3. Insect-Setup asynchron starten
	s._insectPromise = _setupInsectAsync(s);
}

/** Insect World asynchron aufbauen */
async function _setupInsectAsync(s: BeyondState): Promise<void> {
	// Einen Frame warten (dispose wurde gerade aufgerufen)
	await new Promise((r) => requestAnimationFrame(r));

	// Szene für Insect World vorbereiten
	s.scene.fog = null;
	s.scene.background = new THREE.Color(0x000000);

	// Lichter (Insect World nutzt Loader-Lichter)
	const ambient = new THREE.AmbientLight(0xffffff, 0.4);
	s.scene.add(ambient);
	const sun = new THREE.DirectionalLight(0xffffff, 1.5);
	sun.position.set(50, 80, 30);
	s.scene.add(sun);
	s.insectLights = { ambient, sun };

	// Fade-Sprite kurz entfernen (damit insect‑setup keine Nebeneffekte)
	s.scene.remove(s.fadeSprite);

	// Insect Setup aufrufen (async)
	const iState = await insectSetup({
		scene: s.scene,
		camera: s.dummyCamera,
		renderer: null as any,
	});
	s.insectState = iState;

	// Fade-Sprite wieder hinzufügen
	s.scene.add(s.fadeSprite);
	s.fadeSprite.material.opacity = 1;

	s._insectReady = true;
	// Phase wechseln (nächster tick)
	s.phase = 4;
}
