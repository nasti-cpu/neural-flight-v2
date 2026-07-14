import * as THREE from "three";

export interface PheromonVariant {
	name: string;
	desc: string;
	particlesPerTrail: number;
	particleSize: number;
	opacity: number;
	trailLengthMin: number;
	trailLengthMax: number;
	windAmplitude: number;
	windFrequency: number;
	scatterWidth: number;
	scatterHeight: number;
}

export const VARIANTS: PheromonVariant[] = [
	{
		name: "Feiner Nebel",
		desc: "Viele feine, weit verstreute Partikel als diffuse Wolke",
		particlesPerTrail: 100,
		particleSize: 0.08,
		opacity: 0.55,
		trailLengthMin: 2,
		trailLengthMax: 6,
		windAmplitude: 0.4,
		windFrequency: 4,
		scatterWidth: 1.2,
		scatterHeight: 0.5,
	},
	{
		name: "Leuchtpfad",
		desc: "Mittlere Partikel, schmaler heller Pfad",
		particlesPerTrail: 70,
		particleSize: 0.15,
		opacity: 0.8,
		trailLengthMin: 3,
		trailLengthMax: 7,
		windAmplitude: 0.3,
		windFrequency: 3,
		scatterWidth: 0.4,
		scatterHeight: 0.2,
	},
	{
		name: "Glühwürmchen",
		desc: "Große leuchtende Punkte, locker verstreut",
		particlesPerTrail: 40,
		particleSize: 0.28,
		opacity: 0.9,
		trailLengthMin: 2,
		trailLengthMax: 5,
		windAmplitude: 0.5,
		windFrequency: 5,
		scatterWidth: 0.7,
		scatterHeight: 0.35,
	},
	{
		name: "Staubspur",
		desc: "Sehr feiner Staub, breit verwischt",
		particlesPerTrail: 130,
		particleSize: 0.05,
		opacity: 0.4,
		trailLengthMin: 3,
		trailLengthMax: 8,
		windAmplitude: 0.6,
		windFrequency: 5,
		scatterWidth: 1.8,
		scatterHeight: 0.7,
	},
	{
		name: "Schweif",
		desc: "Dicht am Start, fein zur Blüte hin verjüngt",
		particlesPerTrail: 80,
		particleSize: 0.12,
		opacity: 0.7,
		trailLengthMin: 3,
		trailLengthMax: 7,
		windAmplitude: 0.35,
		windFrequency: 4,
		scatterWidth: 0.8,
		scatterHeight: 0.4,
	},
];

export const PHEROMON = {
	EVERY_NTH_FLOWER: 5,
	PULSE_SPEED: 1.2,
} as const;

export interface FlowerTarget {
	position: THREE.Vector3;
	color: THREE.Color;
}

function maxSaturate(color: THREE.Color, lightness: number): THREE.Color {
	const hsl = { h: 0, s: 0, l: 0 };
	color.getHSL(hsl);
	// Shift Lungwort's pink hue (308°) towards true purple (266°)
	if (hsl.h > 0.83 && hsl.h < 0.92) {
		hsl.h = 0.74;
	}
	return new THREE.Color().setHSL(hsl.h, 1, lightness);
}

function createGlowTexture(): THREE.CanvasTexture {
	const size = 64;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	gradient.addColorStop(0, "rgba(255,255,255,1)");
	gradient.addColorStop(0.08, "rgba(255,255,255,0.85)");
	gradient.addColorStop(0.25, "rgba(255,255,255,0.4)");
	gradient.addColorStop(0.5, "rgba(255,255,255,0.15)");
	gradient.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(canvas);
	tex.needsUpdate = true;
	return tex;
}

export class PheromoneSystem {
	readonly group = new THREE.Group();
	private trails: {
		points: THREE.Points;
		phase: number;
	}[] = [];
	private variantIndex = 0;
	private glowTexture: THREE.CanvasTexture;

	constructor() {
		this.glowTexture = createGlowTexture();
	}

	setVariant(index: number): void {
		this.variantIndex = Math.max(0, Math.min(index, VARIANTS.length - 1));
	}

	addTrails(flowers: FlowerTarget[]): void {
		this.clearTrails();
		const v = VARIANTS[this.variantIndex];
		for (let i = PHEROMON.EVERY_NTH_FLOWER - 1; i < flowers.length; i += PHEROMON.EVERY_NTH_FLOWER) {
			this.addTrail(flowers[i], v);
		}
	}

	rebuild(flowers: FlowerTarget[]): void {
		this.addTrails(flowers);
	}

	private addTrail(flower: FlowerTarget, v: PheromonVariant): void {
		const count = v.particlesPerTrail;
		const positions = new Float32Array(count * 3);

		const angle = Math.random() * Math.PI * 2;
		const dist = v.trailLengthMin + Math.random() * (v.trailLengthMax - v.trailLengthMin);
		const startX = flower.position.x + Math.cos(angle) * dist;
		const startZ = flower.position.z + Math.sin(angle) * dist;
		const startY = 0.2 + Math.random() * 0.8;

		const steps = 80;
		const curve: THREE.Vector3[] = [];
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			let x = startX * (1 - t) + flower.position.x * t;
			let z = startZ * (1 - t) + flower.position.z * t;
			let y = startY * (1 - t) + flower.position.y * t;

			const windPhase = angle + t * v.windFrequency;
			const wind = v.windAmplitude * t * (1 - t) * 4;
			x += Math.sin(windPhase) * wind;
			z += Math.cos(windPhase * 0.8) * wind;
			y += Math.sin(windPhase * 1.2) * wind * 0.3;

			curve.push(new THREE.Vector3(x, y, z));
		}

		for (let i = 0; i < count; i++) {
			const t = Math.random();
			const idx = Math.floor(t * steps);
			const frac = t * steps - idx;
			const nextIdx = Math.min(idx + 1, steps);

			const p = new THREE.Vector3().lerpVectors(curve[idx], curve[nextIdx], frac);

			const dir = new THREE.Vector3().subVectors(
				curve[Math.min(idx + 2, steps)],
				curve[Math.max(idx - 2, 0)],
			).normalize();

			const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
			const scatterFactor = t * (1 - t) * 4;

			const isTaper = this.variantIndex === 4;
			const taper = isTaper ? 1 - t * 0.8 : 1;
			const sw = v.scatterWidth * scatterFactor * taper;
			const sh = v.scatterHeight * scatterFactor * taper;

			const oh = (Math.random() - 0.5) * sw;
			const ov = (Math.random() - 0.5) * sh;

			positions[i * 3] = p.x + perp.x * oh;
			positions[i * 3 + 1] = p.y + ov;
			positions[i * 3 + 2] = p.z + perp.z * oh;
		}

		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

		const mat = new THREE.PointsMaterial({
			color: maxSaturate(flower.color, 0.55),
			map: this.glowTexture,
			size: v.particleSize,
			transparent: true,
			opacity: v.opacity,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			sizeAttenuation: true,
		});

		const points = new THREE.Points(geo, mat);
		this.group.add(points);

		this.trails.push({
			points,
			phase: Math.random() * Math.PI * 2,
		});
	}

	update(elapsed: number): void {
		const v = VARIANTS[this.variantIndex];
		for (const trail of this.trails) {
			const pulse = 0.7 + 0.3 * Math.sin(elapsed * PHEROMON.PULSE_SPEED + trail.phase);
			const mat = trail.points.material as THREE.PointsMaterial;
			mat.opacity = v.opacity * pulse;
		}
	}

	private clearTrails(): void {
		for (const trail of this.trails) {
			trail.points.geometry.dispose();
			(trail.points.material as THREE.PointsMaterial).dispose();
			this.group.remove(trail.points);
		}
		this.trails = [];
	}

	dispose(): void {
		this.clearTrails();
		this.glowTexture.dispose();
	}
}
