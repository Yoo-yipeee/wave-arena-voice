/**
 * The shared wave field — an actual water surface rather than a sum of shapes.
 *
 * The previous version added gaussian bumps, lobes and rings at fixed radii
 * straight into the height. That is a terrain generator: the result reads as a
 * graph of the music, not as water, because nothing in it obeys how water
 * behaves. Real water only ever does one thing — a disturbance spreads outward,
 * loses energy, and interferes with every other disturbance.
 *
 * So the music no longer draws shapes. It places SOURCES, and the surface is
 * the superposition of the waves they radiate:
 *
 *   displacement = gerstner swell        ambient, always breathing
 *                + radiating sources     music-driven, propagating, interfering
 *                + transient impulses    strikes: kick, snare, drops
 *                + capillary detail      fine ripples riding the big ones
 *
 * Two details carry most of the realism. Gerstner waves displace HORIZONTALLY
 * as well as vertically, which is what gives water its pinched crests and broad
 * flat troughs — a pure sine surface always looks like rubber. And source
 * amplitude falls as 1/sqrt(distance), because a circular wavefront spreads its
 * energy around an ever-growing circumference.
 */
export const FIELD_GLSL = /* glsl */`
#define TAU 6.28318530718
#define INV_TAU 0.15915494309
#define MAX_IMPULSES 8

uniform float uTime;
uniform float uAmp, uBass, uMids, uHighs, uAir;
uniform float uBeat, uBeatPulse, uBeatPhase;
uniform float uScale, uSpectrumGain, uComplexity, uChaos, uFlow, uSymmetry;
uniform float uRingRadius, uRingWidth;
uniform float uEruption, uShock, uAwake;
uniform float uRadius;
uniform float uForm[8];
uniform sampler2D uSpectrum;
uniform sampler2D uChroma;
uniform float uTonic, uMode, uConsonance, uHarmChange;
uniform float uVoicePresence, uVoicePitch, uEffort, uVibrato, uVoiceOnset, uVoicePhrase, uGrit;
uniform vec4 uImpulseA[MAX_IMPULSES];   // xz origin, birth time, strength
uniform vec4 uImpulseB[MAX_IMPULSES];   // speed, width, kind, -

// --- hashing / noise -------------------------------------------------------
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

// --- samplers --------------------------------------------------------------
float spec(float t) { return texture2D(uSpectrum, vec2(clamp(t, 0.0, 1.0), 0.5)).r; }
float chromaAt(float t) { return texture2D(uChroma, vec2(t, 0.5)).r; }

// ---------------------------------------------------------------------------
// A point on the surface disturbed continuously, radiating rings outward.
// Amplitude falls as 1/sqrt(d) because a circular front spreads its energy
// around a growing circumference — this is why real ripples fade the way they
// do, and getting it wrong is most of why fake water looks fake.
// ---------------------------------------------------------------------------
float radiate(vec2 p, vec2 c, float amp, float k, float speed, float ph) {
  float d = distance(p, c);
  float spread = inversesqrt(1.0 + d * 0.55);
  return sin(d * k - uTime * speed + ph) * amp * spread * exp(-d * 0.042);
}

// ---------------------------------------------------------------------------
// Gerstner wave. The horizontal term is the whole point: water particles move
// in circles, not up and down, which pinches the crests and flattens the
// troughs. Without it a surface reads as rubber sheeting however it is lit.
// ---------------------------------------------------------------------------
vec3 gerstner(vec2 p, vec2 dir, float lambda, float steep, float amp, float speed) {
  float k = TAU / lambda;
  float f = k * dot(dir, p) - uTime * speed;
  float c = cos(f);
  return vec3(dir.x * steep * amp * c, amp * sin(f), dir.y * steep * amp * c);
}

vec3 swell(vec2 p) {
  float e = 0.45 + uAmp * 0.75;
  vec3 s = vec3(0.0);
  // Wavelengths sized to the pool, not to an ocean. At 34 units across a
  // 26-unit arena there was barely one cycle of the largest wave in frame, so
  // the surface read as a smooth mound instead of moving water.
  // A spectrum, not a single scale: a few long swells carry the shape and the
  // short ones ride on top of them. Only the short ones and the surface looks
  // like sand; only the long ones and it looks like a mound.
  s += gerstner(p, normalize(vec2( 0.86,  0.51)), 24.0, 0.66, 0.72 * e, 0.52 * uFlow);
  s += gerstner(p, normalize(vec2(-0.44,  0.90)), 15.0, 0.60, 0.48 * e, 0.74 * uFlow);
  s += gerstner(p, normalize(vec2( 0.31, -0.95)),  9.0, 0.50, 0.30 * e, 1.02 * uFlow);
  s += gerstner(p, normalize(vec2(-0.92, -0.39)),  5.5, 0.40, 0.18 * e, 1.38 * uFlow);
  s += gerstner(p, normalize(vec2( 0.62, -0.78)),  3.2, 0.32, 0.10 * e, 1.80 * uFlow);
  return s;
}

// --- the music, as sources on the water ------------------------------------

// Twelve pitch classes standing around the pool, each disturbing the surface as
// strongly as that note is sounding. The rings they throw off interfere, and
// that interference is what makes the pattern look found rather than drawn.
float harmonicSources(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float amp = chromaAt((fi + 0.5) / 12.0);
    if (amp < 0.06) continue;
    float a = (fi / 12.0 + uTonic / 12.0) * TAU;
    vec2 c = vec2(cos(a), sin(a)) * uRingRadius;
    // minor ripples tighter and colder, major broader and calmer
    float k = mix(1.55, 1.05, uMode * 0.5 + 0.5);
    h += radiate(p, c, amp * amp, k, 2.3 * uFlow, fi * 1.7);
  }
  return h * 0.78;
}

// The singer, disturbing the middle of the pool. Pitch is a quality here: a
// high note tightens the ripples, a low one makes them long and heavy.
float voiceSource(vec2 p) {
  float amp = uVoicePresence * (0.25 + uEffort * 1.25);
  if (amp < 0.02) return 0.0;
  float k = mix(0.55, 1.45, uVoicePitch);
  float wob = uVibrato * 0.3 * sin(uTime * 5.4);
  float h = radiate(p, vec2(0.0), amp, k + wob, 1.85 * uFlow, 0.0);
  // strain roughens the water it disturbs
  float tear = uGrit * 0.3 + uEffort * uVoicePresence * 0.42;
  h *= 1.0 + tear * 0.32 * sin(length(p) * 3.1 - uTime * 4.6);
  return h * 1.85;
}

// A front crossing the pool, the way wind or a passing wake does.
float travellingFront(vec2 p) {
  float head = uTime * 0.09;
  vec2 d = vec2(cos(head), sin(head));
  float x = dot(p, d);
  return sin(x * 0.62 - uTime * 2.4 * uFlow) * exp(-abs(x) * 0.012) * (0.4 + uMids * 0.7);
}

// --- transient strikes ------------------------------------------------------
float impulses(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < MAX_IMPULSES; i++) {
    vec4 A = uImpulseA[i];
    vec4 B = uImpulseB[i];
    if (A.w <= 0.001) continue;
    float age = uTime - A.z;
    if (age < 0.0 || age > 4.2) continue;
    float d = distance(p, A.xy);
    float dd = (d - age * B.x) / max(B.y, 0.4);
    // a leading crest with a short wake, spreading and dying like a real ring
    float ring = sin(dd * 2.4) * exp(-dd * dd);
    float decay = exp(-age * 1.25) * inversesqrt(1.0 + d * 0.5);
    float kind = B.z > 1.5 ? 2.2 : (B.z > 0.5 ? 0.85 : 1.0);
    h += ring * decay * A.w * kind;
  }
  return h;
}

// --- the surface ------------------------------------------------------------
vec3 waveDisplace(vec2 p) {
  float r = length(p);
  float edge = 1.0 - smoothstep(uRadius * 0.56, uRadius, r);

  vec3 g = swell(p);
  float h = g.y;

  h += uForm[0] * voiceSource(p);
  h += uForm[1] * harmonicSources(p);
  h += uForm[5] * travellingFront(p) * 0.5;
  h += uForm[3] * sin(r * 0.68 - uTime * 1.9 * uFlow) * exp(-r * 0.03) * 0.5;

  h += impulses(p) * 0.85;

  // capillary detail — the fine ripples that ride the big ones and catch light
  float cap = fbm(p * 1.9 + vec2(uTime * 0.5, -uTime * 0.36)) - 0.5;
  h += cap * (0.13 + uHighs * 0.28) * (0.4 + uComplexity * 0.7);

  // turbulence when the music turns harsh
  h += (fbm(p * 0.34 + vec2(uTime * 0.22, uTime * 0.19)) - 0.5) * uChaos * 1.1;

  // arena-wide events
  h += uEruption * (0.9 + 0.7 * fbm(p * 0.14 - uTime * 0.5)) * exp(-r * 0.035) * 1.0;
  h += uShock * exp(-r * 0.05) * 0.3;

  h *= uScale * edge * uAwake;

  // Horizontal motion scales with the vertical so crests stay pinched at any
  // size, and is damped at the rim so the disc keeps a clean silhouette.
  vec2 lateral = vec2(g.x, g.z) * uScale * 0.5 * edge * uAwake;
  return vec3(lateral.x, h, lateral.y);
}

float waveHeight(vec2 p) { return waveDisplace(p).y; }
`;

/** Uniform block shared by every material that samples the field. */
export function createFieldUniforms(THREE, spectrumTexture, chromaTexture, radius) {
  return {
    uTime: { value: 0 },
    uAmp: { value: 0 }, uBass: { value: 0 }, uMids: { value: 0 }, uHighs: { value: 0 }, uAir: { value: 0 },
    uBeat: { value: 0 }, uBeatPulse: { value: 0 }, uBeatPhase: { value: 0 },
    uScale: { value: 0.16 }, uSpectrumGain: { value: 0.1 }, uComplexity: { value: 0.1 },
    uChaos: { value: 0.02 }, uFlow: { value: 0.3 }, uSymmetry: { value: 2 },
    uRingRadius: { value: 9 }, uRingWidth: { value: 6 },
    uEruption: { value: 0 }, uShock: { value: 0 }, uAwake: { value: 0.25 },
    uHeightRef: { value: 1.0 },
    uRadius: { value: radius },
    uForm: { value: new Float32Array(8) },
    uSpectrum: { value: spectrumTexture },
    uChroma: { value: chromaTexture },
    uTonic: { value: 0 }, uMode: { value: 0 },
    uConsonance: { value: 0 }, uHarmChange: { value: 0 },
    uVoicePresence: { value: 0 }, uVoicePitch: { value: 0 }, uEffort: { value: 0 },
    uVibrato: { value: 0 }, uVoiceOnset: { value: 0 }, uVoicePhrase: { value: 0 },
    uGrit: { value: 0 },
    uImpulseA: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uImpulseB: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
  };
}
