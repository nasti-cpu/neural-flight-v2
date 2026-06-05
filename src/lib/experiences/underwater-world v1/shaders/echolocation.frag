uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;

varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  float dist = length(vUv - 0.5) * 2.0;
  float ring = sin(dist * 60.0 - uTime * 8.0) * 0.5 + 0.5;
  ring = pow(ring, 3.0);
  ring *= exp(-dist * 4.0);

  float glow = exp(-dist * 2.5) * 0.3;

  vec3 color = uColor * (ring + glow) * uIntensity * 0.6;
  float alpha = (ring * 0.5 + glow * 0.2) * uIntensity;
  alpha = clamp(alpha, 0.0, 0.35);

  gl_FragColor = vec4(color, alpha);
}
