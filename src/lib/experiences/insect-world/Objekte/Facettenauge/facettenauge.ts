import * as THREE from "three";

export interface VariantDef {
	name: string;
	desc: string;
	cellSize: number;
	lineWidth: number;
	opacity: number;
}

export const VARIANTS: VariantDef[] = [
	{ name: "Sehr dicht", desc: "Viele kleine Waben", cellSize: 22, lineWidth: 0.02, opacity: 0.25 },
	{ name: "Dicht", desc: "Noch recht viele Waben", cellSize: 52, lineWidth: 0.03, opacity: 0.25 },
	{ name: "Mittel", desc: "Weniger Waben", cellSize: 68, lineWidth: 0.035, opacity: 0.25 },
	{ name: "Weit", desc: "Deutlich weniger Waben", cellSize: 88, lineWidth: 0.04, opacity: 0.25 },
	{ name: "Sehr weit", desc: "Wenige große Waben", cellSize: 115, lineWidth: 0.05, opacity: 0.25 },
];

const vertexShader = `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

const fragmentShader = `
	precision highp float;

	uniform vec2 uResolution;
	uniform float uCellSize;
	uniform float uLineWidth;
	uniform float uOpacity;

	varying vec2 vUv;

	const float SQRT3 = 1.73205080757;

	float sdHex(vec2 p) {
		p = abs(p);
		return max(p.x - 1.0, 0.5 * p.x + 0.8660254 * p.y - 1.0);
	}

	float hexGridSDF(vec2 p) {
		vec2 grid = vec2(2.0, SQRT3);
		vec2 id = floor(p / grid);
		vec2 bestId = id;
		float bestDsq = 1e10;

		for (int i = 0; i < 4; i++) {
			vec2 nid = id + vec2(float(i & 1), float(i >> 1));
			float no = mod(nid.y, 2.0) * 0.5;
			vec2 nc = (nid + vec2(no + 0.5, 0.5)) * grid;
			vec2 d = p - nc;
			float dsq = d.x * d.x + d.y * d.y;
			if (dsq < bestDsq) { bestDsq = dsq; bestId = nid; }
		}
		float no = mod(bestId.y, 2.0) * 0.5;
		vec2 center = (bestId + vec2(no + 0.5, 0.5)) * grid;
		return sdHex(p - center);
	}

	void main() {
		vec2 p = vUv * uResolution / uCellSize;
		float sdf = hexGridSDF(p);

		float line = 1.0 - smoothstep(0.0, uLineWidth, abs(sdf));
		float alpha = line * uOpacity;
		gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
	}
`;

export class CompoundEyeEffect {
	private renderer: THREE.WebGLRenderer;
	readonly material: THREE.ShaderMaterial;
	readonly quad: THREE.Mesh;
	private camera: THREE.OrthographicCamera;

	constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
		this.renderer = renderer;

		this.material = new THREE.ShaderMaterial({
			vertexShader,
			fragmentShader,
			uniforms: {
				uResolution: { value: new THREE.Vector2(width, height) },
				uCellSize: { value: VARIANTS[0].cellSize },
				uLineWidth: { value: VARIANTS[0].lineWidth },
				uOpacity: { value: VARIANTS[0].opacity },
				uTime: { value: 0 },
			},
			transparent: true,
			depthWrite: false,
			depthTest: false,
		});

		const geo = new THREE.PlaneGeometry(2, 2);
		this.quad = new THREE.Mesh(geo, this.material);
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	}

	setVariant(index: number): void {
		const v = VARIANTS[Math.max(0, Math.min(index, VARIANTS.length - 1))];
		this.material.uniforms.uCellSize.value = v.cellSize;
		this.material.uniforms.uLineWidth.value = v.lineWidth;
		this.material.uniforms.uOpacity.value = v.opacity;
	}

	setCellSize(size: number): void {
		this.material.uniforms.uCellSize.value = Math.max(8, size);
	}

	resize(width: number, height: number): void {
		this.material.uniforms.uResolution.value.set(width, height);
	}

	render(scene: THREE.Scene, camera: THREE.Camera, time?: number): void {
		const autoClear = this.renderer.autoClear;
		this.renderer.autoClear = true;
		this.renderer.render(scene, camera);

		this.renderer.autoClear = false;

		if (time !== undefined) {
			this.material.uniforms.uTime.value = time;
		}

		this.renderer.render(this.quad, this.camera);
		this.renderer.autoClear = autoClear;
	}

	dispose(): void {
		this.material.dispose();
		this.quad.geometry.dispose();
	}
}
