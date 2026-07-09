import * as THREE from "three";

export type EchoVariant = "scan" | "puls" | "welle" | "reflex" | "faecher" | "impuls";

export interface EchoConfig {
	color: number;
	expandSpeed: number;
	lifetime: number;
	poolSize: number;
	burstCount: number;
	burstDelay: number;
	maxOpacity: number;
	initialScale: number;
	ringInner: number;
	ringOuter: number;
	wavy: boolean;
	soundGain: number;
	label: string;
	description: string;
}

export const ECHO_VARIANT_KEYS: EchoVariant[] = ["scan", "puls", "welle", "reflex", "faecher", "impuls"];

export const ECHO_VARIANTS: Record<EchoVariant, EchoConfig> = {
	scan: {
		color: 0x00e5ff,
		expandSpeed: 10,
		lifetime: 1.2,
		poolSize: 30,
		burstCount: 1,
		burstDelay: 0,
		maxOpacity: 0.8,
		initialScale: 0.2,
		ringInner: 0.96,
		ringOuter: 1.0,
		wavy: false,
		soundGain: 0.7,
		label: "Scan-Ring",
		description: "Ein einzelner dünner Ring — schneller Ping, kurz & klar",
	},
	puls: {
		color: 0xffaa44,
		expandSpeed: 5,
		lifetime: 2.0,
		poolSize: 40,
		burstCount: 3,
		burstDelay: 0.18,
		maxOpacity: 0.6,
		initialScale: 0.2,
		ringInner: 0.94,
		ringOuter: 1.0,
		wavy: false,
		soundGain: 0.7,
		label: "Puls-Ring",
		description: "3 konzentrische Ringe — mehrstufiger Puls zur Tiefenmessung",
	},
	welle: {
		color: 0xaa77ff,
		expandSpeed: 3,
		lifetime: 2.8,
		poolSize: 25,
		burstCount: 2,
		burstDelay: 0.4,
		maxOpacity: 0.35,
		initialScale: 0.25,
		ringInner: 0.95,
		ringOuter: 1.0,
		wavy: true,
		soundGain: 1.2,
		label: "Wellen-Ring",
		description: "2 gewellte Ringe — breitet sich langsam aus, flächige Erkundung",
	},
	reflex: {
		color: 0x00e5ff,
		expandSpeed: 12,
		lifetime: 1.5,
		poolSize: 20,
		burstCount: 1,
		burstDelay: 0,
		maxOpacity: 0.9,
		initialScale: 0.15,
		ringInner: 0.94,
		ringOuter: 1.0,
		wavy: false,
		soundGain: 0.8,
		label: "Reflex-Echo",
		description: "Hauptping + orangefarbener Reflex vom Objekt + Aufleuchten",
	},
	faecher: {
		color: 0x66ddff,
		expandSpeed: 8,
		lifetime: 1.8,
		poolSize: 30,
		burstCount: 5,
		burstDelay: 0.08,
		maxOpacity: 0.5,
		initialScale: 0.15,
		ringInner: 0.96,
		ringOuter: 1.0,
		wavy: false,
		soundGain: 0.6,
		label: "Fächer-Scan",
		description: "5 Ringe im Fächer — Delfin scannt mit Kopfdrehung die Umgebung",
	},
	impuls: {
		color: 0x88ddff,
		expandSpeed: 7,
		lifetime: 2.2,
		poolSize: 15,
		burstCount: 1,
		burstDelay: 0,
		maxOpacity: 0.7,
		initialScale: 0.2,
		ringInner: 0.92,
		ringOuter: 1.0,
		wavy: false,
		soundGain: 0.9,
		label: "Impuls-Ton",
		description: "Einzelring pulsiert beim Expandieren — Delfin hört auf Echo-Stärke",
	},
};

function createWavyRingGeometry(
	inner: number,
	outer: number,
	segments: number,
	waves: number,
	amp: number,
): THREE.BufferGeometry {
	const geo = new THREE.RingGeometry(inner, outer, segments);
	const pos = geo.attributes.position.array as Float32Array;
	for (let i = 0; i < pos.length; i += 3) {
		const x = pos[i];
		const y = pos[i + 1];
		const angle = Math.atan2(y, x);
		const r = Math.sqrt(x * x + y * y);
		const wave = 1 + Math.sin(angle * waves) * amp;
		pos[i] = x * wave;
		pos[i + 1] = y * wave;
	}
	geo.attributes.position.needsUpdate = true;
	geo.computeVertexNormals();
	return geo;
}

function createRingGeometry(config: EchoConfig): THREE.BufferGeometry {
	if (config.wavy) {
		return createWavyRingGeometry(config.ringInner, config.ringOuter, 64, 12, 0.03);
	}
	return new THREE.RingGeometry(config.ringInner, config.ringOuter, 48);
}

interface EchoRingData {
	mesh: THREE.Mesh;
	active: boolean;
	timer: number;
}

interface BurstJob {
	x: number;
	y: number;
	z: number;
	remaining: number;
	delay: number;
	timer: number;
}

export interface EchoVariantSystem {
	group: THREE.Group;
	config: EchoConfig;
	emit: (x: number, y: number, z: number) => void;
	update: (delta: number) => void;
	setAudio: (ctx: AudioContext, buffer: AudioBuffer) => void;
	dispose: () => void;
}

export function createEchoVariant(config: EchoConfig): EchoVariantSystem {
	const group = new THREE.Group();
	const pool: EchoRingData[] = [];
	const burstQueue: BurstJob[] = [];
	const baseGeo = createRingGeometry(config);

	let audioCtx: AudioContext | null = null;
	let audioBuffer: AudioBuffer | null = null;

	function playSound() {
		if (!audioCtx) { console.warn("playSound: no audioCtx"); return; }
		if (audioCtx.state === "suspended") audioCtx.resume();
		try {
			const now = audioCtx.currentTime;
			const gain = audioCtx.createGain();
			gain.gain.setValueAtTime(config.soundGain, now);
			gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
			gain.connect(audioCtx.destination);

			if (audioBuffer) {
				const src = audioCtx.createBufferSource();
				src.buffer = audioBuffer;
				src.playbackRate.value = 0.7 + Math.random() * 0.15;
				src.connect(gain);
				src.start(now);
			} else {
				const osc = audioCtx.createOscillator();
				osc.type = "sine";
				osc.frequency.value = 600;
				osc.connect(gain);
				osc.start(now);
				osc.stop(now + 0.08);
			}
		} catch (e) {
			console.warn("playSound error", e);
		}
	}

	for (let i = 0; i < config.poolSize; i++) {
		const geo = baseGeo.clone();
		const mat = new THREE.MeshBasicMaterial({
			color: config.color,
			transparent: true,
			opacity: 0,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		const mesh = new THREE.Mesh(geo, mat);
		mesh.rotation.x = -Math.PI / 2;
		mesh.visible = false;
		group.add(mesh);
		pool.push({ mesh, active: false, timer: 0 });
	}

	function acquireRing(): EchoRingData | null {
		for (const ring of pool) {
			if (!ring.active) return ring;
		}
		return null;
	}

	function activateRing(ring: EchoRingData, x: number, y: number, z: number) {
		ring.active = true;
		ring.timer = config.lifetime;
		ring.mesh.visible = true;
		ring.mesh.position.set(x, y, z);
		ring.mesh.scale.setScalar(config.initialScale);
		(ring.mesh.material as THREE.MeshBasicMaterial).opacity = config.maxOpacity;
	}

	function doEmit(x: number, y: number, z: number) {
		const ring = acquireRing();
		if (ring) {
			activateRing(ring, x, y, z);
			playSound();
		}
	}

	function queueBurst(x: number, y: number, z: number, count: number) {
		if (count <= 1) {
			doEmit(x, y, z);
			return;
		}
		doEmit(x, y, z);
		burstQueue.push({ x, y, z, remaining: count - 1, delay: config.burstDelay, timer: 0 });
	}

	return {
		group,
		config,
		emit(x, y, z) {
			queueBurst(x, y, z, config.burstCount);
		},
		setAudio(ctx: AudioContext, buf: AudioBuffer) {
			audioCtx = ctx;
			audioBuffer = buf;
		},
		update(delta: number) {
			for (let i = burstQueue.length - 1; i >= 0; i--) {
				const job = burstQueue[i];
				job.timer += delta;
				if (job.timer >= job.delay) {
					doEmit(job.x, job.y, job.z);
					job.remaining--;
					if (job.remaining <= 0) {
						burstQueue.splice(i, 1);
					} else {
						job.timer = 0;
					}
				}
			}

			for (const ring of pool) {
				if (!ring.active) continue;
				ring.timer -= delta;
				if (ring.timer <= 0) {
					ring.active = false;
					ring.mesh.visible = false;
					continue;
				}
				const age = config.lifetime - ring.timer;
				const scale = Math.max(0.3, age * config.expandSpeed);
				ring.mesh.scale.setScalar(scale + config.initialScale);
				const fade = ring.timer / config.lifetime;
			(ring.mesh.material as THREE.MeshBasicMaterial).opacity = fade * fade * config.maxOpacity;
			}
		},
		dispose() {
			baseGeo.dispose();
			for (const ring of pool) {
				ring.mesh.geometry.dispose();
				(ring.mesh.material as THREE.MeshBasicMaterial).dispose();
			}
		},
	};
}
