import * as THREE from "three";

export const VARIANTS = [
	{ name: "Wabengitter", desc: "Feines hexagonales Gitter — die Szene bleibt gestochen scharf" },
	{ name: "Facetten-Vignette", desc: "Jede Wabe leicht abgedunkelt zum Rand hin" },
	{ name: "Lichtbrechung", desc: "Prismatischer Farbsaum pro Facette" },
	{ name: "Glanzlichter", desc: "Lichtreflexe auf jeder Linse" },
	{ name: "Dämmerung", desc: "Helle Zentren, dunkle Ränder — angepasst an schwaches Licht" },
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

	uniform sampler2D tScene;
	uniform vec2 uResolution;
	uniform float uCellSize;
	uniform int uVariant;
	uniform float uTime;

	varying vec2 vUv;

	const float PI = 3.14159265359;
	const float SQRT3 = 1.73205080757;

	// ── Hex cell lookup (pointy-top) ─────────────────────────────
	// Returns the cell center (in grid units) and distance to it.

	struct HexCell {
		vec2 center;
		float dist;
	};

	HexCell getHexCell(vec2 p) {
		float w = 2.0;
		float h = SQRT3;
		vec2 grid = vec2(w, h);

		vec2 id = floor(p / grid);
		float off = mod(id.y, 2.0) * 0.5;
		vec2 c = (id + vec2(off, 0.5)) * grid;
		float bd = distance(p, c);
		vec2 bc = c;

		for (int dy = -1; dy <= 1; dy++) {
			for (int dx = -1; dx <= 1; dx++) {
				vec2 n = id + vec2(float(dx), float(dy));
				float no = mod(n.y, 2.0) * 0.5;
				vec2 nc = (n + vec2(no, 0.5)) * grid;
				float d = distance(p, nc);
				if (d < bd) { bd = d; bc = nc; }
			}
		}
		return HexCell(bc, bd);
	}

	// ── Full-resolution scene sample ────────────────────────────

	vec4 scene(vec2 uv) {
		return texture2D(tScene, uv);
	}

	// ── Variants ────────────────────────────────────────────────
	// Each variant samples at full resolution (no pixelation).
	// Only the hex overlay pattern changes.

	vec4 variantGrid(vec2 uv, vec2 p, float size) {
		vec4 color = scene(uv);
		HexCell h = getHexCell(p);
		float edge = smoothstep(size - 1.0, size - 0.2, h.dist);
		float line = 1.0 - edge;
		color.rgb *= 1.0 - line * 0.2;
		return color;
	}

	vec4 variantVignette(vec2 uv, vec2 p, float size) {
		vec4 color = scene(uv);
		HexCell h = getHexCell(p);
		float vig = 1.0 - smoothstep(0.0, size * 0.75, h.dist) * 0.12;
		color.rgb *= vig;
		return color;
	}

	vec4 variantPrism(vec2 uv, vec2 p, float size) {
		HexCell h = getHexCell(p);
		float ca = h.dist / size * 0.002;

		float r = scene(uv + vec2(ca, 0.0)).r;
		float g = scene(uv).g;
		float b = scene(uv - vec2(ca, 0.0)).b;
		vec4 color = vec4(r, g, b, 1.0);

		float edge = smoothstep(size - 1.0, size - 0.2, h.dist);
		color.rgb *= 1.0 - (1.0 - edge) * 0.08;
		return color;
	}

	vec4 variantGlare(vec2 uv, vec2 p, float size) {
		vec4 color = scene(uv);
		HexCell h = getHexCell(p);

		float a = uTime * 0.15;
		vec2 dir = vec2(cos(a), sin(a));
		float spec = pow(max(0.0, dot(normalize(h.center - p), dir)), 12.0);
		color.rgb += spec * 0.15;

		float edge = smoothstep(size - 1.0, size - 0.2, h.dist);
		color.rgb *= 1.0 - (1.0 - edge) * 0.15;
		return color;
	}

	vec4 variantTwilight(vec2 uv, vec2 p, float size) {
		vec4 color = scene(uv);
		HexCell h = getHexCell(p);

		float bright = 1.0 - smoothstep(0.0, size * 0.3, h.dist) * 0.1;
		float dark = 1.0 - smoothstep(size * 0.6, size * 0.9, h.dist) * 0.18;
		color.rgb *= bright * dark;

		float edge = smoothstep(size - 1.0, size - 0.2, h.dist);
		color.rgb *= 1.0 - (1.0 - edge) * 0.1;
		return color;
	}

	// ── Main ────────────────────────────────────────────────────

	void main() {
		vec2 p = vUv * uResolution / uCellSize;

		vec4 color;
		if (uVariant == 0) color = variantGrid(vUv, p, uCellSize);
		else if (uVariant == 1) color = variantVignette(vUv, p, uCellSize);
		else if (uVariant == 2) color = variantPrism(vUv, p, uCellSize);
		else if (uVariant == 3) color = variantGlare(vUv, p, uCellSize);
		else color = variantTwilight(vUv, p, uCellSize);

		gl_FragColor = color;
	}
`;

export class CompoundEyeEffect {
	private renderer: THREE.WebGLRenderer;
	private renderTarget: THREE.WebGLRenderTarget;
	private material: THREE.ShaderMaterial;
	private quad: THREE.Mesh;
	private camera: THREE.OrthographicCamera;

	constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
		this.renderer = renderer;

		this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
		});

		this.material = new THREE.ShaderMaterial({
			vertexShader,
			fragmentShader,
			uniforms: {
				tScene: { value: this.renderTarget.texture },
				uResolution: { value: new THREE.Vector2(width, height) },
				uCellSize: { value: 32.0 },
				uVariant: { value: 0 },
				uTime: { value: 0 },
			},
			depthWrite: false,
			depthTest: false,
		});

		const geo = new THREE.PlaneGeometry(2, 2);
		this.quad = new THREE.Mesh(geo, this.material);
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	}

	setVariant(index: number): void {
		this.material.uniforms.uVariant.value = Math.max(0, Math.min(index, VARIANTS.length - 1));
	}

	setCellSize(size: number): void {
		this.material.uniforms.uCellSize.value = Math.max(8, size);
	}

	resize(width: number, height: number): void {
		this.renderTarget.setSize(width, height);
		this.material.uniforms.uResolution.value.set(width, height);
	}

	render(scene: THREE.Scene, camera: THREE.Camera, time?: number): void {
		this.renderer.setRenderTarget(this.renderTarget);
		this.renderer.render(scene, camera);
		this.renderer.setRenderTarget(null);

		if (time !== undefined) {
			this.material.uniforms.uTime.value = time;
		}

		this.renderer.render(this.quad, this.camera);
	}

	dispose(): void {
		this.renderTarget.dispose();
		this.material.dispose();
		this.quad.geometry.dispose();
	}
}
