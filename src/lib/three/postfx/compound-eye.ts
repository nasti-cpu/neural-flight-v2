import * as THREE from "three";

export const VARIANTS = [
	{ name: "Hexagonal (spitz)", desc: "Sechseckraster wie ein Insektenauge" },
	{ name: "Hexagonal (flach)", desc: "Flache Sechsecke, breiteres Sichtfeld" },
	{ name: "Pixel-Mosaik", desc: "Klassische quadratische Pixelung" },
	{ name: "Ommatidien-Linsen", desc: "Runde Linsen mit dunklen Rändern" },
	{ name: "Waben-Glühen", desc: "Sechsecke mit hell leuchtenden Kanten" },
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

	// ── HEX GRID HELPERS ──────────────────────────────────────────

	// Pointy-top hex: width = 2, height = SQRT3
	vec2 pointyHexCenter(vec2 p) {
		float w = 2.0;
		float h = SQRT3;
		vec2 grid = vec2(w, h);

		vec2 hexId = floor(p / grid);

		float rowOff = mod(hexId.y, 2.0) * 0.5;
		vec2 center = (hexId + vec2(rowOff, 0.5)) * grid;

		vec2 best = center;
		float bestD = distance(p, center);

		for (int dy = -1; dy <= 1; dy++) {
			for (int dx = -1; dx <= 1; dx++) {
				vec2 nId = hexId + vec2(float(dx), float(dy));
				float nOff = mod(nId.y, 2.0) * 0.5;
				vec2 nCenter = (nId + vec2(nOff, 0.5)) * grid;
				float d = distance(p, nCenter);
				if (d < bestD) { bestD = d; best = nCenter; }
			}
		}
		return best;
	}

	// Flat-top hex: width = SQRT3, height = 2
	vec2 flatHexCenter(vec2 p) {
		float w = SQRT3;
		float h = 2.0;
		vec2 grid = vec2(w, h);

		vec2 hexId = floor(p / grid);

		float colOff = mod(hexId.x, 2.0) * 0.5;
		vec2 center = (hexId + vec2(0.5, colOff)) * grid;

		vec2 best = center;
		float bestD = distance(p, center);

		for (int dy = -1; dy <= 1; dy++) {
			for (int dx = -1; dx <= 1; dx++) {
				vec2 nId = hexId + vec2(float(dx), float(dy));
				float nOff = mod(nId.x, 2.0) * 0.5;
				vec2 nCenter = (nId + vec2(0.5, nOff)) * grid;
				float d = distance(p, nCenter);
				if (d < bestD) { bestD = d; best = nCenter; }
			}
		}
		return best;
	}

	// ── SAMPLING VARIANTS ────────────────────────────────────────

	vec4 sampleHexPointy(vec2 uv, float size) {
		vec2 p = uv * uResolution / size;
		vec2 c = pointyHexCenter(p);
		vec2 sampleUv = c * size / uResolution;
		return texture2D(tScene, sampleUv);
	}

	vec4 sampleHexFlat(vec2 uv, float size) {
		vec2 p = uv * uResolution / size;
		vec2 c = flatHexCenter(p);
		vec2 sampleUv = c * size / uResolution;
		return texture2D(tScene, sampleUv);
	}

	vec4 samplePixelated(vec2 uv, float size) {
		vec2 grid = floor(uv * uResolution / size) * size / uResolution;
		return texture2D(tScene, grid + size * 0.5 / uResolution);
	}

	vec4 sampleOmmatidia(vec2 uv, float size) {
		vec2 p = uv * uResolution / size;
		vec2 c = pointyHexCenter(p);
		vec2 sampleUv = c * size / uResolution;
		vec4 color = texture2D(tScene, sampleUv);

		float dist = distance(p, c);
		float radius = 0.85;
		float border = smoothstep(radius, radius - 0.1, dist);
		color.rgb *= border * 0.8 + 0.2;
		return color;
	}

	vec4 sampleHoneycomb(vec2 uv, float size) {
		vec2 p = uv * uResolution / size;
		vec2 c = pointyHexCenter(p);
		vec2 sampleUv = c * size / uResolution;
		vec4 color = texture2D(tScene, sampleUv);

		float dist = distance(p, c);
		float glow = exp(-dist * 6.0) * 0.5;
		float edge = smoothstep(0.9, 0.7, dist);
		color.rgb += vec3(0.6, 0.7, 1.0) * glow;
		color.rgb *= edge * 0.6 + 0.4;
		return color;
	}

	// ── MAIN ─────────────────────────────────────────────────────

	void main() {
		vec4 color;

		if (uVariant == 0) {
			color = sampleHexPointy(vUv, uCellSize);
		} else if (uVariant == 1) {
			color = sampleHexFlat(vUv, uCellSize);
		} else if (uVariant == 2) {
			color = samplePixelated(vUv, uCellSize);
		} else if (uVariant == 3) {
			color = sampleOmmatidia(vUv, uCellSize);
		} else if (uVariant == 4) {
			color = sampleHoneycomb(vUv, uCellSize);
		} else {
			color = sampleHexPointy(vUv, uCellSize);
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
				uCellSize: { value: 12.0 },
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
		this.material.uniforms.uCellSize.value = Math.max(2, size);
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
