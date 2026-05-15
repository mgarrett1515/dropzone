// ============================================================================
// ADAPTIVE PERFORMANCE TIER
// ----------------------------------------------------------------------------
// Detects the host system's rough capability once at module load using a few
// browser signals (GPU name, CPU thread count, RAM, mobile), then exposes a
// `PERF` object other modules read at startup to size their work:
//
//   PERF.tier            'low' | 'mid' | 'high'  (mid == prior defaults)
//   PERF.pixelRatio      game renderer pixel-ratio cap
//   PERF.lobbyPixelRatio lobby renderer pixel-ratio
//   PERF.antialias       game renderer MSAA
//   PERF.lobbyAntialias  lobby renderer MSAA
//   PERF.vegMul          multiplier on forest/tree/bush counts
//   PERF.botNearD2       squared metres for "full AI" range (every-frame AI)
//   PERF.botFarD2        squared metres for "skip entirely" range
//   PERF.impactPoolSize  pooled bullet-impact puff count
//   PERF.lobbyEmberCount drifting ember particle count in the lobby
//   PERF.lobbyPropCount  background prop silhouette count in the lobby
//
// Detection is heuristic — combining several signals, not a benchmark — and
// errs toward 'mid' when signals conflict. A manual override is supported:
//   localStorage.setItem('dropzone.perfTier', 'low' | 'mid' | 'high');
//   location.reload();
//
// The detected object is also pinned to `window.__PERF__` for diagnostics.
// ============================================================================

function _readGpuName() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
    // Free the WebGL context — we only needed the renderer string.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name.toLowerCase();
  } catch { return ''; }
}

function _scoreGpu(g) {
  if (!g) return 0;                                                           // unknown
  if (/swiftshader|llvmpipe|software/.test(g)) return -5;                     // CPU fallback
  // High-end discrete cards / Apple Silicon
  if (/(rtx\s?[2-9]\d{3}|radeon rx\s?(6|7|9)\d{3}|apple m[2-9]|geforce rtx|gtx\s?10[78]0|gtx\s?1660|gtx\s?1080)/.test(g)) return 4;
  if (/(rtx\b|radeon rx\b|gtx\s?\d|apple m1|quadro|tesla|geforce mx)/.test(g)) return 2;
  if (/(nvidia|geforce|amd radeon|apple gpu)/.test(g)) return 1;              // generic discrete
  if (/intel/.test(g)) return -1;                                             // integrated
  return 0;
}

function _detect() {
  const gpu = _readGpuName();                  // empty if WEBGL_debug_renderer_info is blocked
  let score = _scoreGpu(gpu);

  const cores = navigator.hardwareConcurrency || 4;
  if (cores >= 12) score += 2;
  else if (cores >= 8) score += 1;
  else if (cores <= 2) score -= 2;

  const mem = navigator.deviceMemory;          // GB (Chromium/Edge only)
  if (mem) {
    if (mem >= 16) score += 1;
    else if (mem <= 4) score -= 1;
  }

  const ua = navigator.userAgent || '';
  if (navigator.userAgentData?.mobile || /Mobi|Android|iPhone|iPad/i.test(ua)) score -= 3;

  let tier = score >= 3 ? 'high' : score >= 0 ? 'mid' : 'low';

  // Manual override via localStorage — gives you an escape hatch without UI.
  try {
    const o = localStorage.getItem('dropzone.perfTier');
    if (o === 'low' || o === 'mid' || o === 'high') tier = o;
  } catch {}

  const dpr = window.devicePixelRatio || 1;

  // Profiles. `mid` intentionally mirrors the prior hand-tuned defaults so
  // existing behavior is unchanged on a mid-tier system.
  const profiles = {
    high: {
      pixelRatio: Math.min(dpr, 1.25),  lobbyPixelRatio: Math.min(dpr, 1.5),
      antialias: false,                  lobbyAntialias: true,
      vegMul: 1.20,
      botNearD2: 10000,                  botFarD2: 62500,
      impactPoolSize: 32,
      lobbyEmberCount: 180,              lobbyPropCount: 18,
    },
    mid: {
      pixelRatio: 1.0,                   lobbyPixelRatio: 1.0,
      antialias: false,                  lobbyAntialias: true,
      vegMul: 1.00,
      botNearD2: 6400,                   botFarD2: 40000,
      impactPoolSize: 24,
      lobbyEmberCount: 150,              lobbyPropCount: 16,
    },
    low: {
      pixelRatio: 0.75,                  lobbyPixelRatio: 0.75,
      antialias: false,                  lobbyAntialias: false,
      vegMul: 0.55,
      botNearD2: 2500,                   botFarD2: 22500,
      impactPoolSize: 12,
      lobbyEmberCount: 60,               lobbyPropCount: 8,
    },
  };

  return { tier, gpu, score, ...profiles[tier] };
}

export const PERF = _detect();

if (typeof window !== 'undefined') {
  window.__PERF__ = PERF;
  // One concise line in the console so you can see what was picked.
  console.info(`[PERF] tier=${PERF.tier} score=${PERF.score} pxr=${PERF.pixelRatio} gpu="${PERF.gpu || 'unknown'}"`);
}
