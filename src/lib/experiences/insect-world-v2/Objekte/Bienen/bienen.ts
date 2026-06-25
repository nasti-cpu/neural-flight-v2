/**
 * insect-world-v2 — Bienen.
 *
 * Lädt ein Bienen-GLB und erzeugt mehrere Bienen.
 *
 * Zwei Flugmodi:
 *   - **flowerTargets** gesetzt → Bienen fliegen von Blüte zu Blüte
 *     (gerade Strecken, kurzes Verweilen an jeder Blüte)
 *   - **flowerTargets** nicht gesetzt → organische Sinus-Bahnen
 *     (wie Version 1, als Fallback)
 *
 * WebGPU-konform (GLTFLoader + Instancing).
 */
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface BeeConfig {
	count: number;
	scale: number;
	fieldRadius: number;
	flyRadiusMin: number;
	flyRadiusMax: number;
	speedMin: number;
	speedMax: number;
	heightBaseMin: number;
	heightBaseMax: number;
	heightRange: number;
	/** Optionale Liste von Blüten-Positionen (x, y, z) */
	flowerTargets?: THREE.Vector3[];
	/** Zeit in Sekunden, die an jeder Blüte verweilt wird */
	hoverDuration?: number;
}

const DEFAULT_CONFIG: BeeConfig = {
	count: 12,
	scale: 0.04,
	fieldRadius: 20,
	flyRadiusMin: 1,
	flyRadiusMax: 5,
	speedMin: 0.3,
	speedMax: 0.8,
	heightBaseMin: 0.8,
	heightBaseMax: 2.0,
	heightRange: 0.6,
	hoverDuration: 1.5,
};

/** Interner Zustand einer Biene */
interface BeeState {
	group: THREE.Group;
	/** Für Sinus-Modus: Zentrum, Radius, Phase etc. */
	center: THREE.Vector3;
	flyRadius: number;
	speed: number;
	phase: number;
	phase2: number;
	freqY: number;
	heightBase: number;
	heightRange: number;
	tiltSpeed: number;
	/** Für Blüten-Modus */
	target?: THREE.Vector3;
	targetIndex?: number;
	progress?: number; // 0..1 wie weit zum nächsten Ziel
	hoverTimer?: number; // Rest-Verweilzeit
}

export interface BeeSwarm {
	group: THREE.Group;
	update: (time: number) => void;
	dispose: () => void;
}

/** Lädt ein GLB und gibt die Szene zurück */
function loadGLB(url: string): Promise<THREE.Group> {
	return new Promise((resolve, reject) => {
		new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject);
	});
}

/**
 * Hilfsfunktion: wählt einen zufälligen Ziel-Index (≠ aktueller)
 */
function pickNextTarget(
	current: number | undefined,
	count: number,
): number {
	if (count <= 1) return 0;
	let next: number;
	do {
		next = Math.floor(Math.random() * count);
	} while (next === current);
	return next;
}

/**
 * Erzeugt einen Bienenschwarm.
 * @param glbUrl  Pfad zur GLB-Datei
 * @param config  Konfiguration (optional)
 */
export async function createBees(
	glbUrl: string,
	config: BeeConfig = DEFAULT_CONFIG,
): Promise<BeeSwarm> {
	const group = new THREE.Group();
	const beeScene = await loadGLB(glbUrl);

	// Alle Meshes aus dem GLB als Template
	const template = new THREE.Group();
	beeScene.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			template.add(child.clone());
		}
	});

	const useFlowerMode = !!(
		config.flowerTargets && config.flowerTargets.length > 0
	);
	const flowers = config.flowerTargets ?? [];
	const hoverDuration = config.hoverDuration ?? 1.5;

	const bees: BeeState[] = [];

	for (let i = 0; i < config.count; i++) {
		const beeGroup = new THREE.Group();
		beeGroup.add(template.clone(true));
		beeGroup.scale.setScalar(config.scale);

		// Zufällige Startposition
		const angle = Math.random() * Math.PI * 2;
		const dist = Math.random() * config.fieldRadius;
		const cx = Math.cos(angle) * dist;
		const cz = Math.sin(angle) * dist;
		const cy =
			config.heightBaseMin +
			Math.random() * (config.heightBaseMax - config.heightBaseMin);

		beeGroup.position.set(cx, cy, cz);
		beeGroup.rotation.y = Math.random() * Math.PI * 2;

		group.add(beeGroup);

		const bee: BeeState = {
			group: beeGroup,
			center: new THREE.Vector3(cx, 0, cz),
			flyRadius:
				config.flyRadiusMin +
				Math.random() * (config.flyRadiusMax - config.flyRadiusMin),
			speed:
				config.speedMin + Math.random() * (config.speedMax - config.speedMin),
			phase: Math.random() * Math.PI * 2,
			phase2: Math.random() * Math.PI * 2,
			freqY: 1.5 + Math.random() * 1.5,
			heightBase:
				config.heightBaseMin +
				Math.random() * (config.heightBaseMax - config.heightBaseMin),
			heightRange: config.heightRange * (0.5 + Math.random() * 0.5),
			tiltSpeed: 2 + Math.random() * 2,
		};

		// Blüten-Modus: erstes Ziel setzen
		if (useFlowerMode) {
			const idx = pickNextTarget(undefined, flowers.length);
			bee.target = flowers[idx].clone();
			bee.targetIndex = idx;
			bee.progress = 0;
			bee.hoverTimer = 0;
		}

		bees.push(bee);
	}

	function update(time: number): void {
		if (useFlowerMode) {
			// ─── Blüten-Modus: geradlinig von Blüte zu Blüte ───
			for (const bee of bees) {
				// Verweilen
				if (bee.hoverTimer! > 0) {
					bee.hoverTimer! -= 0.016; // ~1 Frame
					// leichtes Wackeln in der Luft
					bee.group.rotation.z =
						Math.sin(time * bee.tiltSpeed + bee.phase) * 0.05;
					bee.group.rotation.x =
						Math.sin(time * 1.5 + bee.phase2) * 0.03;
					continue;
				}

				const start = bee.center;
				const end = bee.target!;
				const dist = start.distanceTo(end);

				if (dist < 0.001) {
					// Am Ziel angekommen → neues Ziel
					bee.hoverTimer = hoverDuration;
					bee.center.copy(end);
					const idx = pickNextTarget(bee.targetIndex, flowers.length);
					bee.target = flowers[idx].clone();
					bee.targetIndex = idx;
					bee.progress = 0;
					continue;
				}

				// Schrittgeschwindigkeit: dist in ~1s zurücklegen, begrenzt auf speed
				const step = Math.min(config.speedMax * 0.016 * 60, dist);
				const dir = new THREE.Vector3().copy(end).sub(start).normalize();

				// Neue Position = aktuell + Schritt in Richtung Ziel
				const newPos = bee.group.position.clone().add(dir.multiplyScalar(step));
				// Höhe: zur Blüten-Höhe + kleiner Offset
				const targetY = end.y + 0.3 + Math.sin(time * 2 + bee.phase) * 0.1;
				newPos.y += (targetY - newPos.y) * 0.1;

				// Bewegungsrichtung = Blickrichtung
				const dx = newPos.x - bee.group.position.x;
				const dz = newPos.z - bee.group.position.z;
				const dy = newPos.y - bee.group.position.y;

				bee.group.position.copy(newPos);
				bee.center.copy(newPos);

				if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
					bee.group.rotation.y = Math.atan2(dx, dz);
				}

				// Natürliches Kippen
				bee.group.rotation.z =
					Math.sin(time * bee.tiltSpeed + bee.phase) * 0.08;
				bee.group.rotation.x =
					Math.sin(time * 1.5 + bee.phase2) * 0.05 +
					Math.sin(time * 0.5 + bee.phase) * 0.03;
			}
		} else {
			// ─── Sinus-Modus (Original) ───
			for (const bee of bees) {
				const t = time * bee.speed;

				const cx1 = Math.cos(t + bee.phase) * bee.flyRadius;
				const cz1 = Math.sin(t + bee.phase) * bee.flyRadius;

				const cx2 =
					Math.cos(t * 0.7 + bee.phase2) * bee.flyRadius * 0.3;
				const cz2 =
					Math.sin(t * 0.5 + bee.phase2) * bee.flyRadius * 0.3;

				const x = bee.center.x + cx1 + cx2;
				const z = bee.center.z + cz1 + cz2;
				const y =
					bee.center.y +
					bee.heightBase +
					Math.sin(t * bee.freqY + bee.phase) * bee.heightRange;

				const dx = x - bee.group.position.x;
				const dz = z - bee.group.position.z;

				bee.group.position.set(x, y, z);

				if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
					bee.group.rotation.y = Math.atan2(dx, dz);
				}

				bee.group.rotation.z =
					Math.sin(t * bee.tiltSpeed + bee.phase) * 0.08;
				bee.group.rotation.x =
					Math.sin(t * 1.5 + bee.phase2) * 0.05 +
					Math.sin(t * 0.5 + bee.phase) * 0.03;
			}
		}
	}

	/** Räumt alle Geometrien und Materialien auf */
	function dispose(): void {
		for (const child of group.children) {
			if (child instanceof THREE.Group) {
				for (const mesh of child.children) {
					if (mesh instanceof THREE.Mesh) {
						mesh.geometry.dispose();
						if (Array.isArray(mesh.material)) {
							for (const m of mesh.material) m.dispose();
						} else {
							mesh.material.dispose();
						}
					}
				}
			}
		}
		group.clear();
	}

	return { group, update, dispose };
}
