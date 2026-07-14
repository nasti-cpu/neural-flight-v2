/**
 * scene.ts – Zyklischer Sequencer für Beyond‑Limits.
 *
 * Wechselt alle ~5 min zwischen Underwater World und Insect World.
 * Während des asynchronen Ladens der nächsten Welt wird eine
 * Portal-Innensicht (Tunnel) eingeblendet.
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
import { createPortalTunnel, type PortalTunnel } from "$lib/portal/portalTunnel";

// ── Konstanten ──
const T_PORTAL_APPEAR = 290;     // s – aktive Zeit bevor Portal erscheint
const COLLISION_DIST = 3;        // Einheiten – Kollisionsradius
const FADE_RANGE = 10;           // Einheiten – Abstand ab dem Fade beginnt
const PORTAL_TIMEOUT = 40;       // s – Notfall‑Timeout nach Portal-Erscheinen
const FADE_DURATION = 3;         // s – Dauer Fade from Black
const FADE_IN_DELAY = 2;         // s – Verzögerung bevor Fade beginnt (erst fliegen, dann sehen)
const FADE_Z = 5;                // Einheiten – Abstand FadeSprite vor Kamera
const TUNNEL_FADE = 0.5;         // s – Ein-/Ausblendzeit des Tunnels

// ── State ──
interface BeyondState extends ExperienceState {
	world: number;          // 0=Underwater, 1=Insect
	stage: number;          // 0=active, 1=portal, 2=black+tunnel, 3=fadeIn
	stageStart: number;     // ctx.elapsed bei Stage-Beginn

	underwaterState: ExperienceState | null;
	insectState: ExperienceState | null;

	camera: THREE.PerspectiveCamera;
	dummyCamera: THREE.PerspectiveCamera;

	fadeSprite: THREE.Sprite;
	portal: RiftPortal;
	tunnel: PortalTunnel;

	insectLights: { ambient: THREE.AmbientLight; sun: THREE.DirectionalLight } | null;
	scene: THREE.Scene;

	/** Async-Setup der nächsten Welt fertig? */
	_ready: boolean;
	/** Aktuelle Tunnel-Opazität [0…0.95] */
	_tunnelOpacity: number;
	/** Tunnel hat volle Helligkeit erreicht */
	_tunnelFull: boolean;
	/** Tunnel blendet gerade aus */
	_tunnelFadeOut: boolean;

	/** Portal-Sounds */
	_portalJump: THREE.Audio | null;
	_portalAmbient: THREE.Audio | null;

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

	const tunnel = createPortalTunnel();
	tunnel.mesh.visible = false;
	ctx.scene.add(tunnel.mesh);

	// Portal-Sounds laden (THREE.Audio, 2D – keine Position)
	let portalJump: THREE.Audio | null = null;
	let portalAmbient: THREE.Audio | null = null;
	try {
		const listener = new THREE.AudioListener();
		ctx.camera.add(listener);

		const loader = new THREE.AudioLoader();
		const [jumpBuf, ambientBuf] = await Promise.all([
			loader.loadAsync("/sounds/portal%20jump.mp3"),
			loader.loadAsync("/sounds/portal%20sound.mp3"),
		]);

		portalJump = new THREE.Audio(listener);
		portalJump.setBuffer(jumpBuf);
		portalJump.setVolume(0.3);

		portalAmbient = new THREE.Audio(listener);
		portalAmbient.setBuffer(ambientBuf);
		portalAmbient.setLoop(true);
		portalAmbient.setVolume(0);
	} catch (err) {
		console.warn("[Beyond-limits] Portal-Sounds nicht geladen:", err);
	}

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
		tunnel,
		insectLights: null,
		scene: ctx.scene,
		_ready: false,
		_tunnelOpacity: 0,
		_tunnelFull: false,
		_tunnelFadeOut: false,
		_portalJump: portalJump,
		_portalAmbient: portalAmbient,
		_worldPos: new THREE.Vector3(),
		_fwd: new THREE.Vector3(),
		_worldQuat: new THREE.Quaternion(),
	};
}

// ── Helfer ──
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

	// ── FadeSprite immer vor die Kamera (Stage 1–3) ──
	if (s.stage >= 1) {
		ctx.camera.getWorldPosition(s._worldPos);
		ctx.camera.getWorldQuaternion(s._worldQuat);
		const fwd = s._fwd.set(0, 0, -1).applyQuaternion(s._worldQuat);
		s.fadeSprite.position.copy(s._worldPos).add(fwd.multiplyScalar(FADE_Z));
	}

	// ── Stage-Maschine ──
	switch (s.stage) {
		// ── Stage 0: Aktive Welt läuft ──
		case 0: {
			if (elapsed - s.stageStart >= T_PORTAL_APPEAR) {
				_setStage(s, 1, elapsed);
				_spawnPortal(s, ctx);
			}
			return _tickActiveWorld(s, ctx);
		}

		// ── Stage 1: Portal + distance-basierter Fade ──
		case 1: {
			ctx.camera.getWorldPosition(s._worldPos);
			const dist = s._worldPos.distanceTo(s.portal.group.position);

			const fp = 1 - Math.max(0, Math.min(1,
				(dist - COLLISION_DIST) / FADE_RANGE));
			s.fadeSprite.material.opacity = fp;

			if (dist < COLLISION_DIST || (elapsed - s.stageStart) > PORTAL_TIMEOUT) {
				s.fadeSprite.material.opacity = 1;
				_setStage(s, 2, elapsed);
				// Portal-Jump-Sound abspielen
				if (s._portalJump) {
					s._portalJump.stop();
					s._portalJump.play();
				}
			// Tunnel sofort sichtbar (kein Einfaden)
			s.tunnel.mesh.visible = true;
			s._tunnelOpacity = 0.95;
			s._tunnelFull = true;
			s._tunnelFadeOut = false;
			s.tunnel.mesh.material.opacity = 0.95;
				_startTransition(s);
			}
			return _tickActiveWorld(s, ctx);
		}

		// ── Stage 2: Tunnel sofort sichtbar (Ladebrücke) ──
		case 2: {
			// Ambient-Sound starten (bei erstem Frame der Stage)
			if (s._portalAmbient && !s._portalAmbient.isPlaying) {
				s._portalAmbient.play();
				s._portalAmbient.setVolume(0.4); // sofort volle Lautstärke
			}

			// Tunnel auf voller Opazität halten, solange nicht ausgeblendet wird
			if (!s._tunnelFadeOut) {
				s._tunnelOpacity = 0.95;
			}

			// Loading fertig → Tunnel ausblenden starten
			if (s._ready && !s._tunnelFadeOut) {
				s._tunnelFadeOut = true;
			}
			if (s._tunnelFadeOut) {
				s._tunnelOpacity = Math.max(0,
					s._tunnelOpacity - ctx.delta / (TUNNEL_FADE * 0.6));
				// Ambient-Lautstärke runter
				if (s._portalAmbient) {
					s._portalAmbient.setVolume(s._tunnelOpacity / 0.95 * 0.4);
				}
				if (s._tunnelOpacity <= 0) {
					s.tunnel.mesh.visible = false;
					if (s._portalAmbient) {
						s._portalAmbient.stop();
					}
					_setStage(s, 3, elapsed);
				}
			}

			s.tunnel.mesh.material.opacity = s._tunnelOpacity;
			return { state: s };
		}

		// ── Stage 3: Delay, dann Fade In in die neue Welt ──
		// Zuerst delay (schwarz, Welt läuft bereits im Hintergrund),
		// dann weiche Einblendung über FADE_DURATION.
		case 3: {
			const newWorld = inWorld === 0 ? 1 : 0;
			const stageElapsed = elapsed - s.stageStart;
			const fadeProgress = Math.max(0, stageElapsed - FADE_IN_DELAY);
			const t = Math.min(1, fadeProgress / FADE_DURATION);

			s.fadeSprite.material.opacity = 1 - t;

			// Audio erst nach dem Delay einblenden
			_setAudioVolume(s, newWorld, t * _getAudioTargetVolume(newWorld));

			if (t >= 1) {
				// Nächsten Zyklus starten
				s.world = newWorld;
				s.stage = 0;
				s.stageStart = elapsed;
				s.fadeSprite.material.opacity = 0;
				s.portal.group.visible = false;
				s._ready = false;
				s._tunnelFull = false;
				s._tunnelFadeOut = false;
			}
			// Welt läuft bereits – Spieler kann fliegen, bevor er sieht
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
	if (s.tunnel) {
		s.tunnel.dispose();
		scene.remove(s.tunnel.mesh);
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

	// Portal-Sounds aufräumen
	if (s._portalAmbient) {
		if (s._portalAmbient.isPlaying) s._portalAmbient.stop();
	}
	if (s._portalJump) {
		if (s._portalJump.isPlaying) s._portalJump.stop();
	}
	// AudioListener entfernen (ist an dummyCamera / ctx.camera)
	const listener = s._portalAmbient?.listener ?? s._portalJump?.listener;
	if (listener) {
		listener.parent?.remove(listener);
	}
}

// ── Audio-Volume setzen (beide Welten) ──
function _setAudioVolume(s: BeyondState, world: number, vol: number): void {
	if (world === 0 && s.underwaterState) {
		const a = (s.underwaterState as any).audio;
		if (a?.setVolume) a.setVolume(vol);
	}
	if (world === 1 && s.insectState) {
		const a = (s.insectState as any).bgAudio;
		if (a?.setVolume) a.setVolume(vol);
	}
}

function _getAudioTargetVolume(world: number): number {
	return world === 0 ? 0.35 : 0.3;
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

	// Audio der alten Welt sofort stumm
	_setAudioVolume(s, s.world, 0);

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

	s.portal.group.visible = false;

	s.dummyCamera.fov = 70;
	s.dummyCamera.near = 0.1;
	s.dummyCamera.far = 800;
	s.dummyCamera.updateProjectionMatrix();
	s.camera = s.dummyCamera;

	_setupWorldAsync(s, goingTo);
}

/** Welt asynchron aufbauen (underwater oder insect) */
async function _setupWorldAsync(s: BeyondState, targetWorld: number): Promise<void> {
	try {
		await new Promise((r) => requestAnimationFrame(r));

		if (targetWorld === 0) {
			s.scene.fog = null;
			s.scene.background = new THREE.Color(0x001020);
			const uwState = await underwaterSetup({
				scene: s.scene,
				camera: s.dummyCamera,
				renderer: null as any,
			});
			s.underwaterState = uwState;
		} else {
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

		// Neue Welt startet stumm – wird in Stage 3 eingeblendet
		_setAudioVolume(s, targetWorld, 0);

		s.fadeSprite.material.opacity = 1;
		s._ready = true;
	} catch (err) {
		console.error("[Beyond-limits] Setup fehlgeschlagen für world", targetWorld, err);
	}
}
