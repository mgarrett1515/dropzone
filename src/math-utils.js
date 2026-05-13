// Pure math helpers used by terrain generation and AI rotation.
// No external dependencies — safe to import anywhere.

// ----- Value-noise / FBM stack used for terrain -----

// Hash two integers to [0,1).
export function vnoise(ix, iz) {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// Quintic-smoothed bilinear interpolation of vnoise.
export function smoothNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx*fx*fx*(fx*(fx*6-15)+10);
  const uz = fz*fz*fz*(fz*(fz*6-15)+10);
  return vnoise(ix,   iz  ) * (1-ux) * (1-uz)
       + vnoise(ix+1, iz  ) *    ux  * (1-uz)
       + vnoise(ix,   iz+1) * (1-ux) *    uz
       + vnoise(ix+1, iz+1) *    ux  *    uz;
}

// Fractional brownian motion: sum smoothNoise over `octaves` decreasing scales.
export function fbm(x, z, octaves) {
  let v = 0, amp = 1, freq = 1, max = 0;
  for (let o = 0; o < octaves; o++) {
    v   += (smoothNoise(x*freq, z*freq) * 2 - 1) * amp;
    max += amp;
    amp  *= 0.50;
    freq *= 2.10;
  }
  return v / max;
}

// Composite terrain height: rolling hills + ridges + fine detail + domain-warped ridges.
// Does NOT account for cities or building bboxes — callers handle that.
export function rawTerrainNoise(x, z) {
  const large = fbm(x*0.0055,           z*0.0055,           5) * 14.0;
  const mid   = fbm(x*0.018  + 4.3,     z*0.016  + 1.7,     4) *  4.5;
  const fine  = fbm(x*0.060  + 8.1,     z*0.058  + 3.2,     3) *  1.0;
  const warpX = fbm(x*0.010  + 2.0,     z*0.010  + 5.0,     3) * 18;
  const warpZ = fbm(x*0.010  + 7.0,     z*0.010  + 1.0,     3) * 18;
  const warped= fbm((x+warpX)*0.012,    (z+warpZ)*0.012,    4) *  7.0;
  return large + mid * 0.6 + fine + warped * 0.5;
}

// Shortest-arc angle lerp. Handles wrap-around at ±π.
export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}
