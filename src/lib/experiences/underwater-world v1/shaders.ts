import * as THREE from "three";
import echoFrag from "./shaders/echolocation.frag?raw";
import echoVert from "./shaders/echolocation.vert?raw";

export function createEchoMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		vertexShader: echoVert,
		fragmentShader: echoFrag,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		uniforms: {
			uTime: { value: 0 },
			uColor: { value: new THREE.Color(0x00e5ff) },
			uIntensity: { value: 1.0 },
		},
	});
}
