import * as THREE from "three";

export const VARIANTS = [
	{ name: "Hex-Gitter", desc: "Feines Sechseck-Gitter wie ein Facettenauge" },
	{ name: "Linsen-Array", desc: "Runde Linsen mit Vignettierung pro Zelle" },
	{ name: "Waben-Schimmer", desc: "Farbige Schimmer-Verschiebung pro Wabe" },
	{ name: "Ommatidien-Blick", desc: "Lichtreflexe auf jeder Linse" },
	{ name: "Bienen-Sicht", desc: "Chromatische Aberration + Wabenmuster" },
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

	// ── HEX GRID ──────────────────────────────────────────────────

	struct HexInfo {
		vec2 center;
		float dist;
	};

	HexInfo getHex(vec2 p) {
		float w = 2.0;
		float h = SQRT3;
		vec2 grid = vec2(w, h);

		vec2 hexId = floor(p / grid);
		float rowOff = mod(hexId.y, 2.0) * 0.5;
		vec2 center = (hexId + vec2(rowOff, 0.5)) * grid;
		float bestD = distance(p, center);
		vec2 best = center;

		for (int dy = -1; dy <= 1; dy++) {
			for (int dx = -1; dx <= 1; dx++) {
				vec2 nId = hexId + vec2(float(dx), float(dy));
				float nOff = mod(nId.y, 2.0) * 0.5;
				vec2 nCenter = (nId + vec2(nOff, 0.5)) * grid;
				float d = distance(p, nCenter);
				if (d < bestD) { bestD = d; best = nCenter; }
			}
		}
		return HexInfo(best, bestD);
	}

	// ── GRID LINES ────────────────────────────────────────────────

	float hexEdge(vec2 p, float size, float thickness) {
		HexInfo h = getHex(p);
		return 1.0 - smoothstep(size - thickness - 0.5, size - thickness + 0.5, h.dist);
	}

	// ── VARIANTS ──────────────────────────────────────────────────

	// 0 — Hex-Gitter: clear image + subtle dark hex grid overlay
	vec4 variantGrid(vec2 uv, vec2 p, float size) {
		vec4 color = texture2D(tScene, uv);
		HexInfo h = getHex(p);
		float edge = smoothstep(size - 1.0, size - 0.2, h.dist);
		float gridLine = 1.0 - edge;
		color.rgb *= 1.0 - gridLine * 0.25;
		return color;
	}

	// 1 — Linsen-Array: clear image + circular vignette per cell
	vec4 variantLenses(vec2 uv, vec2 p, float size) {
		vec4 color = texture2D(tScene, uv);
		HexInfo h = getHex(p);
		float lensRim = smoothstep(size * 0.82, size * 0.7, h.dist);
		float lensCenter = 1.0 - smoothstep(0.0, size * 0.3, h.dist);
		color.rgb *= 0.85 + lensRim * 0.15 + lensCenter * 0.06;
		return color;
	}

	// 2 — Waben-Schimmer: per-cell hue shift
	vec4 variantShimmer(vec2 uv, vec2 p, float size) {
		vec4 color = texture2D(tScene, uv);
		HexInfo h = getHex(p);

		float shift = sin(h.center.x * 1.7 + h.center.y * 2.3 + uTime * 0.3) * 0.04;
		color.r += shift;
		color.b -= shift;

		float edge = smoothstep(size - 1.5, size - 0.3, h.dist);
		color.rgb *= 1.0 - (1.0 - edge) * 0.18;

		return color;
	}

	// 3 — Ommatidien-Blick: bright specular highlight on each lens
	vec4 variantOmmatidia(vec2 uv, vec2 p, float size) {
		vec4 color = texture2D(tScene, uv);
		HexInfo h = getHex(p);

		float lightAngle = uTime * 0.2;
		vec2 lightDir = vec2(cos(lightAngle), sin(lightAngle));
		float spec = max(0.0, dot(normalize(h.center - p), lightDir));
		float highlight = pow(spec, 8.0) * 0.3;

		float vignette = 1.0 - smoothstep(0.0, size * 0.9, h.dist) * 0.1;
		float rim = smoothstep(size * 0.85, size * 0.7, h.dist) * 0.08;

		color.rgb += highlight;
		color.rgb *= vignette + rim;
		return color;
	}

	// 4 — Bienen-Sicht: chromatic aberration + honeycomb
	vec4 variantBeeVision(vec2 uv, vec2 p, float size) {
		HexInfo h = getHex(p);

		float chromaOffset = 2.0 / uResolution.x;
		float r = texture2D(tScene, uv + vec2(chromaOffset, 0.0)).r;
		float g = texture2D(tScene, uv).g;
		float b = texture2D(tScene, uv - vec2(chromaOffset, 0.0)).b;
		vec4 color = vec4(r, g, b, 1.0);

		float edge = smoothstep(size - 1.2, size - 0.3, h.dist);
		color.rgb *= 1.0 - (1.0 - edge) * 0.2;

		float glow = exp(-h.dist * 4.0 / size) * 0.06;
		color.rgb += vec3(0.9, 0.95, 1.0) * glow;

		return color;
	}

	// ── MAIN ─────────────────────────────────────────────────────

	void main() {
		vec2 p = vUv * uResolution / uCellSize;

		vec4 color;
		if (uVariant == 0) {
			color = variantGrid(vUv, p, uCellSize);
		} else if (uVariant == 1) {
			color = variantLenses(vUv, p, uCellSize);
		} else if (uVariant == 2) {
			color = variantShimmer(vUv, p, uCellSize);
		} else if (uVariant == 3) {
			color = variantOmmatidia(vUv, p, uCellSize);
		} else {
			color = variantBeeVision(vUv, p, uCellSize);
		}

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
				uCellSize: { value: 24.0 },
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
		this.material.uniforms.uCellSize.value = Math.max(4, size);
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
