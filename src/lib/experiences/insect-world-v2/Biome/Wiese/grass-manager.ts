/**
 * insect-world-v2 — GrassManager (Chunk-basiert).
 *
 * Lädt Gras-Chunks dynamisch um den Spieler herum.
 * Sorgt für eine unendlich fortsetzbare Wiese ohne sichtbare Kanten.
 *
 * Funktionsweise:
 * - Die Welt wird in ein 80×80-Raster eingeteilt (Chunks).
 * - Nur Chunks in Sichtweite (5×5-Raster) sind aktiv.
 * - Entfernte Chunks werden entfernt, neue werden erzeugt.
 * - Geometrie und Material werden einmal erzeugt und wiederverwendet.
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import * as THREE from "three/webgpu";
import {
	attribute,
	clamp,
	dot,
	float,
	max,
	mix,
	normalize,
	normalWorld,
	positionLocal,
	sin,
	time,
	uniform,
	vec3,
} from "three/tsl";
import type { MeadowConfig } from "./grass";

// ── Konstanten ──

const CHUNK_SIZE = 80;       // Größe eines Chunks in Metern
const VIEW_RADIUS = 1;       // Wie viele Chunks um den Spieler herum geladen werden (1 = 3×3 = 9 Chunks)
const GRASS_PER_CHUNK = 6000; // Grashalme pro Chunk

// ── Hilfsfunktion: Welthöhe (sanfte Mulde um den Ursprung) ──

function worldGroundHeight(x: number, z: number): number {
	const dist = Math.sqrt(x * x + z * z);
	return -0.00008 * dist * dist;
}

// ── GrassChunk (intern) ──

interface GrassChunk {
	group: THREE.Group;
	mesh: THREE.InstancedMesh;
	ground: THREE.Mesh;
	gridX: number;
	gridZ: number;
}

// ── Welthöhen-Funktion (exportiert für Blumen/Pheromone) ──

/** Höhe des Bodens an einer beliebigen Weltposition (sanfte Mulde). */
export function getWorldHeight(x: number, z: number): number {
	return worldGroundHeight(x, z);
}

// ── GrassManager ──

export class GrassManager {
	readonly group = new THREE.Group();

	private active = new Map<string, GrassChunk>();
	private config: MeadowConfig;

	// Einmal erzeugte, gemeinsame Ressourcen (wiederverwendet)
	private bladeGeo: THREE.ConeGeometry;
	private bladeMat: THREE.MeshBasicNodeMaterial;
	private groundMat: THREE.MeshBasicNodeMaterial;

	constructor(config: MeadowConfig) {
		this.config = config;

		// ── Gemeinsame Geometrie für Grashalme ──
		// Ein Kegel pro Halm — wird per Instancing millionenfach gezeichnet.
		this.bladeGeo = new THREE.ConeGeometry(0.05, 1, 4);
		this.bladeGeo.translate(0, 0.5, 0); // Drehpunkt an die Basis

		// ── Gemeinsames TSL-Material für Grashalme ──
		this.bladeMat = this.createBladeMaterial();

		// ── Gemeinsames Material für den Boden ──
		this.groundMat = this.createGroundMaterial();
	}

	/**
	 * Wird jeden Frame aufgerufen.
	 * Berechnet, welche Chunks um den Spieler herum sichtbar sein müssen,
	 * erzeugt neue und entfernt alte.
	 */
	update(playerPosition: THREE.Vector3): void {
		// Aktuelle Chunk-Koordinaten des Spielers
		const cx = Math.floor(playerPosition.x / CHUNK_SIZE);
		const cz = Math.floor(playerPosition.z / CHUNK_SIZE);

		// Alle benötigten Chunk-Keys sammeln
		const needed = new Set<string>();

		for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
			for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
				const gx = cx + dx;
				const gz = cz + dz;
				const key = `${gx},${gz}`;
				needed.add(key);

				if (!this.active.has(key)) {
					this.createChunk(gx, gz);
				}
			}
		}

		// Nicht mehr benötigte Chunks entfernen
		for (const [key, chunk] of this.active) {
			if (!needed.has(key)) {
				this.group.remove(chunk.group);
				this.disposeChunk(chunk);
				this.active.delete(key);
			}
		}
	}

	/** Entfernt alle Chunks (z. B. beim Experience-Wechsel). */
	clear(): void {
		for (const [key, chunk] of this.active) {
			this.group.remove(chunk.group);
			this.disposeChunk(chunk);
		}
		this.active.clear();
	}

	/**
	 * Entfernt alle Grashalme in einem rotierten Rechteck (z. B. für Stadt).
	 * Funktioniert chunk-übergreifend: sucht in allen aktiven Chunks
	 * und versenkt Halme im Rechteck unter der Erde (y = -100).
	 */
	clearRect(cx: number, cz: number, hw: number, hd: number, angle: number, border: number): void {
		const sin = Math.sin(angle);
		const cos = Math.cos(angle);
		const bw = hw + border;
		const bd = hd + border;
		const dummy = new THREE.Object3D();
		const pos = new THREE.Vector3();

		for (const chunk of this.active.values()) {
			const mesh = chunk.mesh;
			const count = mesh.count;

			for (let i = 0; i < count; i++) {
				mesh.getMatrixAt(i, dummy.matrix);
				pos.setFromMatrixPosition(dummy.matrix);
				const dx = pos.x - cx;
				const dz = pos.z - cz;
				const localX = dx * cos - dz * sin;
				const localZ = dx * sin + dz * cos;

				if (Math.abs(localX) < bw && Math.abs(localZ) < bd) {
					dummy.position.set(pos.x, -100, pos.z);
					dummy.scale.setScalar(1);
					dummy.rotation.set(0, 0, 0);
					dummy.updateMatrix();
					mesh.setMatrixAt(i, dummy.matrix);
				}
			}
			mesh.instanceMatrix.needsUpdate = true;
		}
	}

	/** Gibt alle Ressourcen frei. */
	dispose(): void {
		this.clear();
		this.bladeGeo.dispose();
		this.bladeMat.dispose();
		this.groundMat.dispose();
	}

	// ── Private Hilfsfunktionen ──

	/** Erzeugt einen neuen Gras-Chunk an der angegebenen Raster-Position. */
	private createChunk(gx: number, gz: number): void {
		const worldX = gx * CHUNK_SIZE;
		const worldZ = gz * CHUNK_SIZE;

		const group = new THREE.Group();

		// ── Bodenplatte ──
		const ground = this.createGround(worldX, worldZ);
		group.add(ground);

		// ── Grashalme ──
		const mesh = this.createChunkGrass(gx, gz);
		group.add(mesh);

		this.group.add(group);
		this.active.set(`${gx},${gz}`, { group, mesh, ground, gridX: gx, gridZ: gz });
	}

	/** Erzeugt einen InstancedMesh mit Grashalmen für einen Chunk. */
	private createChunkGrass(gx: number, gz: number): THREE.InstancedMesh {
		const worldX = gx * CHUNK_SIZE;
		const worldZ = gz * CHUNK_SIZE;
		const halfSize = CHUNK_SIZE / 2;
		const count = GRASS_PER_CHUNK;

		const mesh = new THREE.InstancedMesh(this.bladeGeo, this.bladeMat, count);

		// Per-Instance-Attribute für Wind-Animation
		const phaseArr = new Float32Array(count);
		const speedArr = new Float32Array(count);
		const baseXArr = new Float32Array(count);
		const baseZArr = new Float32Array(count);

		const dummy = new THREE.Object3D();

		for (let i = 0; i < count; i++) {
			// Zufällige Position innerhalb des Chunks
			const x = worldX + (Math.random() - 0.5) * CHUNK_SIZE;
			const z = worldZ + (Math.random() - 0.5) * CHUNK_SIZE;

			// Zufällige Höhe und Rotation
			const h = this.config.minHeight + Math.random() * (this.config.maxHeight - this.config.minHeight);
			const rotY = Math.random() * Math.PI * 2;
			const sx = 0.5 + Math.random() * 0.8;
			const sz = 0.5 + Math.random() * 0.8;

			// Bodenniveau am Weltpunkt
			const baseY = worldGroundHeight(x, z);

			// Wind-Daten
			phaseArr[i] = Math.random() * Math.PI * 2;
			speedArr[i] = 0.5 + Math.random() * 1.5;
			baseXArr[i] = x;
			baseZArr[i] = z;

			// Instanz-Matrix setzen
			dummy.position.set(x, baseY + h / 2, z);
			dummy.scale.set(sx, h, sz);
			dummy.rotation.set(0, rotY, 0);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}

		mesh.instanceMatrix.needsUpdate = true;

		// Instanz-Attribute für den TSL-Shader
		mesh.geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phaseArr, 1));
		mesh.geometry.setAttribute("aSpeed", new THREE.InstancedBufferAttribute(speedArr, 1));
		mesh.geometry.setAttribute("aBaseX", new THREE.InstancedBufferAttribute(baseXArr, 1));
		mesh.geometry.setAttribute("aBaseZ", new THREE.InstancedBufferAttribute(baseZArr, 1));

		return mesh;
	}

	/** Erzeugt die Bodenplatte für einen Chunk mit leichter Wölbung. */
	private createGround(worldX: number, worldZ: number): THREE.Mesh {
		const segs = 8;
		const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, segs, segs);
		geo.rotateX(-Math.PI / 2);

		// Höhen anpassen (sanfte Mulde zum Ursprung hin)
		const pos = geo.attributes.position as THREE.Float32BufferAttribute;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i) + worldX;
			const z = pos.getZ(i) + worldZ;
			pos.setY(i, worldGroundHeight(x, z));
		}
		pos.needsUpdate = true;
		geo.computeVertexNormals();

		const mesh = new THREE.Mesh(geo, this.groundMat);
		mesh.position.set(worldX, 0, worldZ);
		return mesh;
	}

	/** Erzeugt das TSL-Material für die Grashalme. */
	private createBladeMaterial(): THREE.MeshBasicNodeMaterial {
		//── Uniforms ──
		const uWindStrength = uniform(this.config.windStrength);
		const uWindSpeed = uniform(this.config.windSpeedMultiplier);
		const uColor = uniform(new THREE.Color(this.config.color));
		const uGroundColor = uniform(new THREE.Color(this.config.groundColor));
		const uMinHeight = uniform(this.config.minHeight);
		const uMaxHeight = uniform(this.config.maxHeight);

		//── Instanz-Attribute ──
		const aPhase = attribute("aPhase", "float");
		const aSpeed = attribute("aSpeed", "float");
		const aBaseX = attribute("aBaseX", "float");
		const aBaseZ = attribute("aBaseZ", "float");

		//── positionNode: Wind ──
		const timeFactor = time.mul(uWindSpeed);
		const swayX = sin(timeFactor.mul(aSpeed).add(aPhase).add(aBaseX.mul(0.5)))
			.mul(uWindStrength).mul(positionLocal.y);
		const swayZ = sin(timeFactor.mul(aSpeed).mul(0.7).add(aPhase).add(aBaseZ.mul(0.5)))
			.mul(uWindStrength).mul(0.7).mul(positionLocal.y);

		//── colorNode: Höhenfärbung + Licht ──
		const heightT = clamp(
			positionLocal.y.sub(uMinHeight).div(uMaxHeight.sub(uMinHeight).add(0.001)),
			float(0), float(1),
		);
		const lightDir = normalize(vec3(0.5, 0.8, 0.3));
		const diff = max(dot(normalWorld, lightDir), float(0));
		const lightFactor = float(0.35).add(diff.mul(0.65));

		const mat = new THREE.MeshBasicNodeMaterial();
		mat.positionNode = positionLocal.add(vec3(swayX, float(0), swayZ));
		mat.colorNode = mix(uGroundColor, uColor, heightT).mul(lightFactor);
		mat.fog = true;

		return mat;
	}

	/** Erzeugt das TSL-Material für die Bodenplatte. */
	private createGroundMaterial(): THREE.MeshBasicNodeMaterial {
		const gc = new THREE.Color(this.config.groundColor);
		const mat = new THREE.MeshBasicNodeMaterial();
		mat.colorNode = vec3(gc.r, gc.g, gc.b);
		mat.fog = true;
		return mat;
	}

	/** Räumt einen Chunk auf (geht zurück in den Pool). */
	private disposeChunk(chunk: GrassChunk): void {
		// Instanz-Geometrie freigeben (die Instanz-Attribute werden jedes Mal neu erstellt)
		chunk.mesh.geometry.dispose();
		chunk.mesh.removeFromParent();

		// Boden-Geometrie freigeben
		chunk.ground.geometry.dispose();
		chunk.ground.removeFromParent();
	}
}
