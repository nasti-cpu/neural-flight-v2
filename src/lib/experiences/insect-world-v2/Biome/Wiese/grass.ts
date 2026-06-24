/**
 * Wiese (Meadow) Module für insect-world-v2
 *
 * Erzeugt Gras mit InstancedMesh + ShaderMaterial (WebGL).
 * 6 Voreinstellungen (Presets) mit unterschiedlichen Farben,
 * Wuchshöhen, Dichten und Wind.
 *
 * Jeder Aufruf von createMeadow() gibt eine THREE.Group zurück,
 * die ground + Gras + Labelsprite enthält.
 *
 * TODO: Für VR-Produktion auf TSL + WebGPU portieren.
 */

import * as THREE from "three";

// ─── Konfiguration ────────────────────────────────────────────────────

export interface MeadowConfig {
	fieldSize: number;
	grassCount: number;
	curvature: number;
	color: string;
	groundColor: string;
	minHeight: number;
	maxHeight: number;
	windStrength: number;
	windSpeedMultiplier: number;
}

export const MEADOW_PRESETS: Record<string, MeadowConfig> = {
	"Frühlingswiese": {
		fieldSize: 60, grassCount: 40000, curvature: 0.0001,
		color: "#6aaf4c", groundColor: "#6aaf4c",
		minHeight: 0.6, maxHeight: 1.8, windStrength: 0.06, windSpeedMultiplier: 1.0,
	},
	"Sommerwiese": {
		fieldSize: 6, grassCount: 3000, curvature: 0.0008,
		color: "#3d8c2e", groundColor: "#357a27",
		minHeight: 0.8, maxHeight: 2.2, windStrength: 0.03, windSpeedMultiplier: 0.6,
	},
	"Herbstwiese": {
		fieldSize: 6, grassCount: 2500, curvature: 0.0012,
		color: "#b8a54a", groundColor: "#a89440",
		minHeight: 0.7, maxHeight: 2.0, windStrength: 0.1, windSpeedMultiplier: 1.4,
	},
	"Trockenwiese": {
		fieldSize: 6, grassCount: 1500, curvature: 0.002,
		color: "#c4a85e", groundColor: "#b89a50",
		minHeight: 0.3, maxHeight: 0.9, windStrength: 0.04, windSpeedMultiplier: 0.8,
	},
	"Feuchtwiese": {
		fieldSize: 6, grassCount: 3500, curvature: 0.0005,
		color: "#2d7a2a", groundColor: "#256a22",
		minHeight: 0.5, maxHeight: 2.5, windStrength: 0.05, windSpeedMultiplier: 0.9,
	},
	"Kurzrasen": {
		fieldSize: 6, grassCount: 2000, curvature: 0.0003,
		color: "#7cc45a", groundColor: "#6cb44a",
		minHeight: 0.15, maxHeight: 0.4, windStrength: 0.01, windSpeedMultiplier: 0.3,
	},
};

export type MeadowPresetName = keyof typeof MEADOW_PRESETS;

// ─── Dichte-Varianten (basierend auf Frühlingswiese) ─────────────────

export interface SpacingVariant {
	name: string;
	config: MeadowConfig;
}

const fruehlingBase = MEADOW_PRESETS["Frühlingswiese"];

export const FRUEHLING_SPACING: SpacingVariant[] = [
	{ name: "Extrem locker (300)", config: { ...fruehlingBase, fieldSize: 6, grassCount: 300 } },
	{ name: "Sehr locker (800)", config: { ...fruehlingBase, fieldSize: 6, grassCount: 800 } },
	{ name: "Locker (1.500)", config: { ...fruehlingBase, fieldSize: 6, grassCount: 1500 } },
	{ name: "Normal (2.500)", config: { ...fruehlingBase, fieldSize: 6, grassCount: 2500 } },
	{ name: "Dicht (4.000)", config: { ...fruehlingBase, fieldSize: 6, grassCount: 4000 } },
	{ name: "Sehr dicht (6.000)", config: { ...fruehlingBase, fieldSize: 6, grassCount: 6000 } },
];

// ─── Shader (GLSL, Strings) ──────────────────────────────────────────

const vertexShader = `
	attribute float aPhase;
	attribute float aSpeed;
	attribute float aBaseX;
	attribute float aBaseZ;

	uniform float uTime;
	uniform float uWindStrength;
	uniform float uWindSpeed;

	varying vec3 vNormal;
	varying float vHeight;

	void main() {
		float timeFactor = uTime * uWindSpeed;
		float swayX = sin(timeFactor * aSpeed + aPhase + aBaseX * 0.5) * uWindStrength * position.y;
		float swayZ = sin(timeFactor * aSpeed * 0.7 + aPhase + aBaseZ * 0.5) * uWindStrength * 0.7 * position.y;

		vec3 pos = position + vec3(swayX, 0.0, swayZ);

		vec3 objectNormal = normalize(instanceMatrix * vec4(normal, 0.0)).xyz;
		vNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
		vHeight = position.y;

		gl_Position = projectionMatrix * viewMatrix * (instanceMatrix * vec4(pos, 1.0));
	}
`;

const fragmentShader = `
	uniform vec3 uColor;
	uniform vec3 uGroundColor;
	uniform float uMinHeight;
	uniform float uMaxHeight;

	varying vec3 vNormal;
	varying float vHeight;

	void main() {
		vec3 lightDir = normalize(vec3(0.5, 0.8, 0.3));
		float diff = max(dot(vNormal, lightDir), 0.0);
		float ambient = 0.35;
		float light = ambient + diff * 0.65;

		float t = clamp((vHeight - uMinHeight) / (uMaxHeight - uMinHeight + 0.001), 0.0, 1.0);
		vec3 col = mix(uGroundColor, uColor, t);

		gl_FragColor = vec4(col * light, 1.0);
	}
`;

const groundVertexShader = `
	varying vec3 vNormal;
	varying float vHeight;

	void main() {
		vec4 worldPos = modelMatrix * vec4(position, 1.0);
		vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
		vHeight = position.y;
		gl_Position = projectionMatrix * viewMatrix * worldPos;
	}
`;

// ─── Hilfsfunktion: Label-Sprite ──────────────────────────────────────

function makeLabel(text: string): THREE.Sprite {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 96;
	const ctx = canvas.getContext("2d")!;

	ctx.fillStyle = "rgba(0,0,0,0.45)";
	const r = 12;
	ctx.beginPath();
	ctx.roundRect(0, 0, 512, 96, r);
	ctx.fill();

	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 32px system-ui, sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(text, 256, 48);

	const texture = new THREE.CanvasTexture(canvas);
	texture.minFilter = THREE.LinearFilter;
	const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
	const sprite = new THREE.Sprite(mat);
	sprite.scale.set(6, 1.1, 1);
	return sprite;
}

// ─── MeadowPatch ──────────────────────────────────────────────────────

export interface MeadowPatch {
	group: THREE.Group;
	config: MeadowConfig;
	tick: (elapsed: number) => void;
	dispose: () => void;
	getHeightAt: (x: number, z: number) => number;
}

export function createMeadow(
	config: MeadowConfig,
	cx: number,
	cz: number,
	customLabel?: string,
): MeadowPatch {
	const group = new THREE.Group();
	const dummy = new THREE.Object3D();

	// --- ground plane (leicht konkav) ---
	function groundHeight(x: number, z: number): number {
		const dx = x - cx;
		const dz = z - cz;
		const dist = Math.sqrt(dx * dx + dz * dz);
		return -config.curvature * dist * dist;
	}

	const groundRadius = (config.fieldSize + 6) / 2;
	const groundSegs = Math.max(12, Math.round(config.fieldSize * 2));
	const groundGeo = new THREE.PlaneGeometry(groundRadius * 2, groundRadius * 2, groundSegs, groundSegs);
	groundGeo.rotateX(-Math.PI / 2);
	const gPos = groundGeo.attributes.position as THREE.Float32BufferAttribute;
	for (let i = 0; i < gPos.count; i++) {
		const x = gPos.getX(i);
		const z = gPos.getZ(i);
		const dist = Math.sqrt(x * x + z * z);
		const gh = groundHeight(x, z);
		if (dist > groundRadius) {
			const fade = 1 - (dist - groundRadius) / (groundRadius * 0.3);
			gPos.setY(i, gh * Math.max(0, fade));
		} else {
			gPos.setY(i, gh);
		}
	}
	gPos.needsUpdate = true;
	groundGeo.computeVertexNormals();

	const groundMat = new THREE.ShaderMaterial({
		vertexShader: groundVertexShader,
		fragmentShader: fragmentShader,
		uniforms: {
			uTime: { value: 0 },
			uWindStrength: { value: config.windStrength },
			uWindSpeed: { value: config.windSpeedMultiplier },
			uColor: { value: new THREE.Color(config.color) },
			uGroundColor: { value: new THREE.Color(config.groundColor) },
			uMinHeight: { value: config.minHeight },
			uMaxHeight: { value: config.maxHeight },
		},
	});
	const ground = new THREE.Mesh(groundGeo, groundMat);
	ground.position.set(cx, 0, cz);
	group.add(ground);

	// --- Instanced Grass ---
	const bladeGeo = new THREE.ConeGeometry(0.06, 1, 4);
	const bladeMat = new THREE.ShaderMaterial({
		vertexShader,
		fragmentShader,
		uniforms: {
			uTime: { value: 0 },
			uWindStrength: { value: config.windStrength },
			uWindSpeed: { value: config.windSpeedMultiplier },
			uColor: { value: new THREE.Color(config.color) },
			uGroundColor: { value: new THREE.Color(config.groundColor) },
			uMinHeight: { value: config.minHeight },
			uMaxHeight: { value: config.maxHeight },
		},
	});

	const mesh = new THREE.InstancedMesh(bladeGeo, bladeMat, config.grassCount);
	mesh.castShadow = false;
	mesh.receiveShadow = false;

	const phaseArr = new Float32Array(config.grassCount);
	const speedArr = new Float32Array(config.grassCount);
	const baseXArr = new Float32Array(config.grassCount);
	const baseZArr = new Float32Array(config.grassCount);

	const halfField = config.fieldSize / 2;

	for (let i = 0; i < config.grassCount; i++) {
		const x = cx + (Math.random() - 0.5) * config.fieldSize;
		const z = cz + (Math.random() - 0.5) * config.fieldSize;
		const height = config.minHeight + Math.random() * (config.maxHeight - config.minHeight);
		const baseRotY = Math.random() * Math.PI * 2;
		const sx = 0.5 + Math.random() * 0.8;
		const sz = 0.5 + Math.random() * 0.8;
		const baseY = groundHeight(x, z);

		dummy.position.set(x, baseY + height / 2, z);
		dummy.scale.set(sx, height, sz);
		dummy.rotation.set(0, baseRotY, 0);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);

		phaseArr[i] = Math.random() * Math.PI * 2;
		speedArr[i] = 0.5 + Math.random() * 1.5;
		baseXArr[i] = x;
		baseZArr[i] = z;
	}
	mesh.instanceMatrix.needsUpdate = true;

	bladeGeo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phaseArr, 1));
	bladeGeo.setAttribute("aSpeed", new THREE.InstancedBufferAttribute(speedArr, 1));
	bladeGeo.setAttribute("aBaseX", new THREE.InstancedBufferAttribute(baseXArr, 1));
	bladeGeo.setAttribute("aBaseZ", new THREE.InstancedBufferAttribute(baseZArr, 1));

	group.add(mesh);

	// --- Label ---
	const labelText = customLabel
		?? Object.entries(MEADOW_PRESETS).find(([, v]) => v === config)?.[0]
		?? "Wiese";
	const label = makeLabel(labelText);
	label.position.set(cx, config.maxHeight + 2, cz);
	group.add(label);

	// --- public API ---
	let skipFrame = 0;

	function tick(elapsed: number): void {
		skipFrame++;
		if (skipFrame % 2 !== 0) return;
		bladeMat.uniforms.uTime.value = elapsed;
		groundMat.uniforms.uTime.value = elapsed;
	}

	function dispose(): void {
		group.remove(ground);
		groundGeo.dispose();
		groundMat.dispose();

		group.remove(mesh);
		bladeGeo.dispose();
		bladeMat.dispose();

		group.remove(label);
		(label.material as THREE.SpriteMaterial).map?.dispose();
		(label.material as THREE.SpriteMaterial).dispose();
	}

	return { group, config, tick, dispose, getHeightAt: groundHeight };
}

/**
 * Erzeugt alle 6 Wiesen-Presets und platziert sie im Kreis.
 * Gibt ein Array von MeadowPatch zurück.
 */
export function createAllMeadowPatches(
	radius: number,
	startAngle: number = 0,
): MeadowPatch[] {
	const presetNames = Object.keys(MEADOW_PRESETS);
	return presetNames.map((name, i) => {
		const angle = startAngle + (i / presetNames.length) * Math.PI * 2;
		const cx = Math.cos(angle) * radius;
		const cz = Math.sin(angle) * radius;
		return createMeadow(MEADOW_PRESETS[name], cx, cz);
	});
}

/**
 * Erzeugt alle 6 Frühlings-Dichte-Varianten im Kreis.
 * Gibt ein Array von MeadowPatch zurück.
 */
export function createSpacingPatches(
	radius: number,
	startAngle: number = 0,
): MeadowPatch[] {
	return FRUEHLING_SPACING.map((v, i) => {
		const angle = startAngle + (i / FRUEHLING_SPACING.length) * Math.PI * 2;
		const cx = Math.cos(angle) * radius;
		const cz = Math.sin(angle) * radius;
		return createMeadow(v.config, cx, cz, v.name);
	});
}
