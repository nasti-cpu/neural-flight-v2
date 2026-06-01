import * as THREE from "three";

export type EchoVariant = "scan" | "puls" | "welle";

export interface EchoConfig {
	color: number;
	expandSpeed: number;
	lifetime: number;
	poolSize: number;
	burstCount: number;
	burstDelay: number;
	maxOpacity: number;
	initialScale: number;
	label: string;
	description: string;
}

export const ECHO_VARIANTS: Record<EchoVariant, EchoConfig> = {
	scan: {
		color: 0x00e5ff,
		expandSpeed: 14,
		lifetime: 2.5,
		poolSize: 30,
		burstCount: 1,
		burstDelay: 0,
		maxOpacity: 0.75,
		initialScale: 0.3,
		label: "Scan-Ring",
		description: "Ein einzelner dünner Ring — schneller Ping, kurz & klar",
	},
	puls: {
		color: 0xffaa44,
		expandSpeed: 7,
		lifetime: 3.5,
		poolSize: 40,
		burstCount: 4,
		burstDelay: 0.18,
		maxOpacity: 0.6,
		initialScale: 0.25,
		label: "Puls-Ring",
		description: "4 konzentrische Ringe — mehrstufiger Puls zur Tiefenmessung",
	},
	welle: {
		color: 0xaa77ff,
		expandSpeed: 4,
		lifetime: 5,
		poolSize: 25,
		burstCount: 1,
		burstDelay: 0,
		maxOpacity: 0.35,
		initialScale: 0.4,
		label: "Wellen-Ring",
		description: "Gewellter Ring — breitet sich langsam aus, flächige Erkundung",
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
	if (config.burstCount <= 1 && config.expandSpeed <= 5) {
		return createWavyRingGeometry(0.9, 1.0, 64, 12, 0.03);
	}
	return new THREE.RingGeometry(0.9, 1.0, 48);
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
	dispose: () => void;
}

export function createEchoVariant(config: EchoConfig): EchoVariantSystem {
	const group = new THREE.Group();
	const pool: EchoRingData[] = [];
	const burstQueue: BurstJob[] = [];
	const baseGeo = createRingGeometry(config);

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
		if (ring) activateRing(ring, x, y, z);
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
				(ring.mesh.material as THREE.MeshBasicMaterial).opacity = (ring.timer / config.lifetime) * config.maxOpacity;
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
