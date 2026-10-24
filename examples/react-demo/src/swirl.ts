import { Filter, GlProgram } from 'pixi.js';

const vertex = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vPixel;
out vec2 vSize;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  vPixel = aPosition * uOutputFrame.zw;
  vSize = uOutputFrame.zw;
}
`;

const fragment = /* glsl */ `
in vec2 vTextureCoord;
in vec2 vPixel;
in vec2 vSize;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTime;

const vec3 PURPLE = vec3(0.45, 0.25, 0.68);
const vec3 TEAL = vec3(0.09, 0.55, 0.56);
const vec3 DARK = vec3(0.09, 0.07, 0.14);

void main(void) {
  // chunky pixels, like a low-res backdrop
  float cell = max(vSize.x, vSize.y) / 360.0;
  vec2 p = (floor(vPixel / cell) * cell - 0.5 * vSize) / length(vSize);

  // a whirlpool: the further out, the more the angle turns
  float r = length(p);
  float a = atan(p.y, p.x) - 5.0 * r - 0.04 * uTime;
  p = 28.0 * r * vec2(cos(a), sin(a));

  // fold the plane over itself a few times: that is the paint
  float t = 0.9 * uTime;
  vec2 q = vec2(p.x + p.y);
  for (int i = 0; i < 5; i++) {
    q += sin(max(p.x, p.y)) + p;
    p += 0.5 * vec2(cos(5.1 + 0.35 * q.y + 0.13 * t), sin(q.x - 0.11 * t));
    p -= cos(p.x + p.y) - sin(0.71 * p.x - p.y);
  }

  float paint = clamp(0.075 * length(p), 0.0, 2.0);
  float purple = max(0.0, 1.0 - 2.2 * abs(1.0 - paint));
  float teal = max(0.0, 1.0 - 2.2 * abs(paint));
  float dark = 1.0 - min(1.0, purple + teal);
  vec3 color = 0.1 * PURPLE + 0.9 * (PURPLE * purple + TEAL * teal + DARK * dark);
  color += 0.2 * max(purple * 5.0 - 4.0, 0.0) + 0.3 * max(teal * 5.0 - 4.0, 0.0);

  // the sprite's own texture shades it (the vignette)
  finalColor = vec4(color * texture(uTexture, vTextureCoord).rgb, 1.0);
}
`;

/** A swirling paint backdrop. Advance `uTime` (seconds) every frame to animate it. */
export function createSwirl() {
  return new Filter({
    glProgram: GlProgram.from({ vertex, fragment, name: 'paint-swirl' }),
    resources: { swirlUniforms: { uTime: { value: 0, type: 'f32' } } },
  });
}
