import * as THREE from "three";
import { WATER_SURFACE_Y } from "./wasser";

export const waterVertexShader = `
uniform float uTime;
uniform float uWaveHeight;
uniform float uWaveFreq;

varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
    vec3 pos = position;
    float wave = sin(pos.x * uWaveFreq + uTime * 1.5) * uWaveHeight
               + cos(pos.z * uWaveFreq * 0.8 + uTime * 1.1) * uWaveHeight * 0.6
               + sin((pos.x + pos.z) * uWaveFreq * 0.5 + uTime * 0.7) * uWaveHeight * 0.3;
    pos.y += wave;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;

    vec3 tangent = normalize(cross(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0)));
    vec3 bitangent = normalize(cross(vec3(0.0, 1.0, 0.0), tangent));
    vNormal = normalize(cross(tangent, bitangent));

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const waterFragmentShader = `
uniform float uTime;
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uSunDir;

varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 3.0);
    float spec = pow(max(dot(vNormal, normalize(uSunDir + viewDir)), 0.0), 32.0);

    float foam = sin(vWorldPos.x * 2.0 + uTime * 2.0)
               * cos(vWorldPos.z * 2.0 + uTime * 1.7) * 0.5 + 0.5;
    foam = smoothstep(0.7, 1.0, foam);

    vec3 col = uColor + fresnel * vec3(0.3, 0.5, 0.6) + spec * vec3(1.0);
    col += foam * vec3(0.2, 0.3, 0.4) * 0.15;

    gl_FragColor = vec4(col, uOpacity + fresnel * 0.2);
}
`;

export function createWaterSurfaceShader(scene: THREE.Scene): THREE.Mesh {
	const geo = new THREE.CircleGeometry(600, 64);
	geo.rotateX(-Math.PI / 2);

	const mat = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uWaveHeight: { value: 0.8 },
			uWaveFreq: { value: 0.15 },
			uColor: { value: new THREE.Color(0x1a8aaa) },
			uOpacity: { value: 0.35 },
			uSunDir: { value: new THREE.Vector3(0, 1, -0.3).normalize() },
		},
		vertexShader: waterVertexShader,
		fragmentShader: waterFragmentShader,
		transparent: true,
		side: THREE.DoubleSide,
		depthWrite: false,
	});

	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.y = WATER_SURFACE_Y;
	mesh.renderOrder = 1;
	scene.add(mesh);
	return mesh;
}

export function updateWaterSurfaceShader(mesh: THREE.Mesh, elapsed: number): void {
	const mat = mesh.material as THREE.ShaderMaterial;
	mat.uniforms.uTime.value = elapsed;
}

export function disposeWaterSurfaceShader(mesh: THREE.Mesh, scene: THREE.Scene): void {
	mesh.geometry.dispose();
	(mesh.material as THREE.ShaderMaterial).dispose();
	scene.remove(mesh);
}
