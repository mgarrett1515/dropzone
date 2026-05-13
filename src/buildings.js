// ============================================================================
// buildings.js — gritty GTA-style building variants for Dropzone
// ============================================================================
// Every variant produces ONE merged BufferGeometry mesh with per-vertex colors,
// rendered through a single shared MeshLambertMaterial. No textures, no
// per-building materials, no separate meshes. Geometry is composed of
// BoxGeometry pieces in local space; rotation/position are applied to the
// mesh, not baked into geometry.
//
// Public API
//   makeRanchHouse(x, z, rotY, seed)            → BuildResult
//   makeTwoStoryHouse(x, z, rotY, seed)         → BuildResult
//   makeBungalow(x, z, rotY, seed)              → BuildResult
//   makeRundownHouse(x, z, rotY, seed)          → BuildResult
//   makeCornerStore(x, z, rotY, seed)           → BuildResult
//   makeLowRiseApartment(x, z, rotY, seed)      → BuildResult
//   makeWarehouse(x, z, rotY, seed)             → BuildResult
//   makeGasStation(x, z, rotY, seed)            → BuildResult
//   makeDriveway(x, z, rotY, w, d, seed)        → THREE.Mesh
//   placeBuilding(type, x, z, rotY, seed, deps) → BuildResult
//   generateNeighborhood(config, deps)          → BuildResult[]
//
// BuildResult shape
//   { mesh, driveway, sentinels, bbox, footprint }
//     mesh       : THREE.Mesh — positioned at (x, 0, z), pre-rotated; the
//                  caller must lift it onto terrain (mesh.position.y = groundY)
//     driveway   : THREE.Mesh | null — already positioned in world space
//     sentinels  : Array<{ userData: { bbox, losOnly } }> for LOS blocking,
//                  in WORLD space (caller pushes into the buildings[] array)
//     bbox       : THREE.Box3 — solid-collision footprint in WORLD space
//                  (or null for hollow buildings whose walls are LOS-only)
//     footprint  : { w, d, h } in metres
//
// Unit convention: 1 world unit = 1 metre.
// ============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─── Geometry constants ─────────────────────────────────────────────────────
const STOREY_HEIGHT      = 3.0;
const WALL_THICKNESS     = 0.25;
const FOUNDATION_HEIGHT  = 0.45;
const FOUNDATION_LIP     = 0.30;   // foundation extends this far past wall
const WINDOW_RECESS      = 0.08;
const WINDOW_W           = 1.30;
const WINDOW_H           = 1.45;
const DOOR_W             = 0.95;
const DOOR_H             = 2.15;
const TRIM_PROUD         = 0.05;
const TRIM_THICK         = 0.10;
const ROOF_OVERHANG      = 0.45;
const ROOF_THICK         = 0.20;
const GARAGE_W           = 2.80;
const GARAGE_H           = 2.20;
const PARAPET_H          = 0.55;
const PARAPET_THICK      = 0.22;
const SIDEWALK_LIP       = 0.04;   // driveway raised this far above ground

// ─── Color palettes (vertex-color only; no textures) ────────────────────────
// Walls are intentionally desaturated and dirty. Roofs are very dark. Trim is
// close to wall tone so it reads as part of the building. Windows are near-
// black with no emissive — depth and frame trim carry the read.
const PALETTES = {
  residential: {
    walls:      [0xb8a890, 0xa89878, 0xa49a8a, 0xb08070, 0xc8b89a, 0x988a70, 0x8a807a, 0xa4866c, 0x968476],
    roofs:      [0x2a2a2c, 0x1a1a1c, 0x3a302c, 0x2e2825, 0x322f2d],
    trim:       [0x4a4640, 0x5a5650, 0x6a6258, 0x3a3632, 0x504a44],
    foundation: [0x3e3c38, 0x4a4844, 0x342f2a, 0x46423e],
    door:       [0x2a1f18, 0x1c1a18, 0x202a3a, 0x3a2a1c, 0x281814],
    window:     [0x14181c, 0x181c20, 0x1a1f24],
    accent:     [0x6a5e50, 0x5a4e42, 0x423a32],
  },
  rundown: {
    walls:      [0x8c8074, 0x7a6f62, 0x95876e, 0x806e5e, 0x847665, 0x9a8c74, 0x6e6056],
    roofs:      [0x1a1a18, 0x2a2522, 0x322a24, 0x1e1c1a],
    trim:       [0x3a3530, 0x4a4238, 0x282520, 0x3e3a34],
    foundation: [0x2f2d2a, 0x3a3632, 0x42403c],
    door:       [0x1a1614, 0x2a2018, 0x231a14],
    window:     [0x141816, 0x16181a, 0x1c1c1e],
    accent:     [0x4a4036, 0x3a322a, 0x564a3e],
  },
  commercial: {
    walls:      [0xc0b6a0, 0xa49880, 0xb8ad94, 0x968a76, 0xada18a, 0xc2b9a4, 0x8c8474],
    roofs:      [0x202022, 0x2a2a2c, 0x1c1c1e, 0x303032],
    trim:       [0x3a3a3c, 0x4a4a4c, 0x2c2c2e],
    foundation: [0x424040, 0x363432, 0x4a4846],
    door:       [0x1c1c1e, 0x2a2a2c, 0x252523],
    window:     [0x14181c, 0x10141a, 0x182026],
    accent:     [0x504c46, 0x5e5852, 0x42403c],
  },
  industrial: {
    walls:      [0x9a9690, 0x8a8680, 0xa8a49c, 0x7c7872, 0x88847e, 0x969088],
    walls_alt:  [0x8a8682, 0x76726c, 0x9a9690, 0x827e78, 0x6e6a64], // for corrugated strip variation
    roofs:      [0x1e1e20, 0x2a2a2c, 0x282624, 0x35302a],
    trim:       [0x3a3836, 0x2c2a28, 0x4a4642],
    foundation: [0x2e2c2a, 0x3a3836, 0x444240],
    door:       [0x2a2826, 0x1a1816, 0x383634], // roll-up door
    window:     [0x12161a, 0x181c20],
    accent:     [0x4a4642, 0x35332f],
  },
  gas: {
    walls:      [0xc8b89a, 0xa89880, 0xb8a890],
    roofs:      [0x202020, 0x2a2a2a],
    trim:       [0x3a3835, 0x4a4642],
    foundation: [0x3a3835, 0x424040],
    door:       [0x1a1c1e, 0x252525],
    window:     [0x141a22, 0x1a2028],
    accent:     [0xb02828, 0xc04030, 0xa02820], // for fascia / branding stripe
    canopy:     [0x2a2a2c, 0x1c1c1e],
    pump:       [0x9a2218, 0x4a4842, 0x8a1818],
  },
  driveway:   { surface: [0x4a4845, 0x504e4a, 0x46443f, 0x52504b] },
};

const _matInternal = new THREE.MeshLambertMaterial({
  vertexColors: true,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBoxGeo(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) {
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  }
  if (x || y || z) {
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  }
  return g;
}

// Merge a `parts` array into one mesh with baked per-vertex colors.
// parts: [{ geo: BufferGeometry, color: 0xRRGGBB }]
function makeMergedMesh(parts) {
  if (!parts.length) return null;
  const geos = [];
  for (const p of parts) {
    const g = p.geo.clone();
    const count = g.attributes.position.count;
    const c = new THREE.Color(p.color);
    const cArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      cArr[i*3] = c.r; cArr[i*3+1] = c.g; cArr[i*3+2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
    // Strip non-essential attributes so all geos share the same set.
    for (const k of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    }
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, _matInternal);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

// mulberry32: small, fast seedable PRNG. Returns a () => float in [0,1).
function mulberry32(seed) {
  let s = (seed | 0) || 1;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// Transform a local-space (lx, lz) into world space given pivot (x, z) and yaw.
function _rotLocal(lx, lz, cosR, sinR, x, z) {
  return { x: x + lx*cosR - lz*sinR, z: z + lx*sinR + lz*cosR };
}

// Make a wall-edge LOS sentinel in WORLD space.
// (lx0, lz0)–(lx1, lz1) define the wall in local coords; height h is from
// ground. Output is an Object3D-like with userData.bbox + userData.losOnly.
function _wallSentinel(lcx, lcz, lW, lD, h, cosR, sinR, x, z, groundY, padding = 0) {
  // Rotate the centre point into world space; the bbox is axis-aligned around it.
  // For axis-aligned walls (wide W or wide D), we project the rotated extents
  // back onto world XZ. We assume walls run along either local X or local Z.
  const wx = x + lcx*cosR - lcz*sinR;
  const wz = z + lcx*sinR + lcz*cosR;
  // Compute world-space half extents from local W/D (assumes wall is axis-aligned in local frame)
  const hw = Math.abs(lW * 0.5 * cosR) + Math.abs(lD * 0.5 * sinR);
  const hd = Math.abs(lW * 0.5 * sinR) + Math.abs(lD * 0.5 * cosR);
  const bbox = new THREE.Box3(
    new THREE.Vector3(wx - hw - padding, groundY - 0.3,        wz - hd - padding),
    new THREE.Vector3(wx + hw + padding, groundY + h + 0.5,    wz + hd + padding),
  );
  return { userData: { bbox, losOnly: true } };
}

// World-space AABB for an OBB centred at (cx, cz) with half-extents (hw, hd)
// rotated by (cosR, sinR), spanning Y range [y0, y1].
function _obbWorldAABB(cx, cz, hw, hd, cosR, sinR, y0, y1) {
  const ex = Math.abs(hw * cosR) + Math.abs(hd * sinR);
  const ez = Math.abs(hw * sinR) + Math.abs(hd * cosR);
  return new THREE.Box3(
    new THREE.Vector3(cx - ex, y0, cz - ez),
    new THREE.Vector3(cx + ex, y1, cz + ez),
  );
}

// Standard door-trim parts (frame around an opening on the +Z wall at x = 0).
// Local origin is centred on the wall, opening base at y = 0.
function _doorTrimParts(parts, dW, dH, wallZ, trimC) {
  // Top, left, right strips proud of the wall by TRIM_PROUD
  const z = wallZ + TRIM_PROUD;
  parts.push({ geo: makeBoxGeo(dW + 0.20, TRIM_THICK,    0.06, 0, dH + 0.04, z), color: trimC });
  parts.push({ geo: makeBoxGeo(TRIM_THICK, dH,           0.06, -dW/2 - 0.05, dH/2, z), color: trimC });
  parts.push({ geo: makeBoxGeo(TRIM_THICK, dH,           0.06,  dW/2 + 0.05, dH/2, z), color: trimC });
}

// Window helpers. wallZ / wallX is the wall's CENTRE coordinate. The wall is
// WALL_THICKNESS thick, so its outer face is half-thickness outside that.
// The pane is placed slightly proud of the outer face so it isn't hidden
// inside the wall; the trim sits even prouder, creating a visual "recess"
// impression even though the wall geometry is solid (no real cutout).

// +Z wall (front).
function _windowParts(parts, lx, ly, wallZ, dW, dH, winC, trimC) {
  const outerZ = wallZ + WALL_THICKNESS / 2;            // outer wall face
  const paneZ  = outerZ + 0.01;                          // pane just barely proud
  const mullZ  = paneZ + 0.03;                           // mullion in front of pane
  const trimZ  = outerZ + TRIM_PROUD;                    // trim furthest out
  // Pane
  parts.push({ geo: makeBoxGeo(dW, dH, 0.04, lx, ly, paneZ), color: winC });
  // Cross mullion
  parts.push({ geo: makeBoxGeo(0.07, dH * 0.92, 0.04, lx, ly, mullZ), color: trimC });
  parts.push({ geo: makeBoxGeo(dW * 0.92, 0.07, 0.04, lx, ly, mullZ), color: trimC });
  // Trim (header, sill, sides)
  parts.push({ geo: makeBoxGeo(dW + 0.24, 0.10, 0.06, lx, ly + dH/2 + 0.06, trimZ), color: trimC });
  parts.push({ geo: makeBoxGeo(dW + 0.34, 0.16, 0.12, lx, ly - dH/2 - 0.10, trimZ + 0.03), color: trimC }); // chunky sill
  parts.push({ geo: makeBoxGeo(0.09, dH + 0.18, 0.06, lx - dW/2 - 0.06, ly, trimZ), color: trimC });
  parts.push({ geo: makeBoxGeo(0.09, dH + 0.18, 0.06, lx + dW/2 + 0.06, ly, trimZ), color: trimC });
}

// -Z wall (back). Geometry mirrored along Z.
function _windowPartsBack(parts, lx, ly, wallZ, dW, dH, winC, trimC) {
  const outerZ = wallZ - WALL_THICKNESS / 2;
  const paneZ  = outerZ - 0.01;
  const mullZ  = paneZ - 0.03;
  const trimZ  = outerZ - TRIM_PROUD;
  parts.push({ geo: makeBoxGeo(dW, dH, 0.04, lx, ly, paneZ), color: winC });
  parts.push({ geo: makeBoxGeo(0.07, dH * 0.92, 0.04, lx, ly, mullZ), color: trimC });
  parts.push({ geo: makeBoxGeo(dW * 0.92, 0.07, 0.04, lx, ly, mullZ), color: trimC });
  parts.push({ geo: makeBoxGeo(dW + 0.24, 0.10, 0.06, lx, ly + dH/2 + 0.06, trimZ), color: trimC });
  parts.push({ geo: makeBoxGeo(dW + 0.34, 0.16, 0.12, lx, ly - dH/2 - 0.10, trimZ - 0.03), color: trimC });
  parts.push({ geo: makeBoxGeo(0.09, dH + 0.18, 0.06, lx - dW/2 - 0.06, ly, trimZ), color: trimC });
  parts.push({ geo: makeBoxGeo(0.09, dH + 0.18, 0.06, lx + dW/2 + 0.06, ly, trimZ), color: trimC });
}

// +X wall (right side).
function _windowPartsRight(parts, lz, ly, wallX, dW, dH, winC, trimC) {
  const outerX = wallX + WALL_THICKNESS / 2;
  const paneX  = outerX + 0.01;
  const mullX  = paneX + 0.03;
  const trimX  = outerX + TRIM_PROUD;
  parts.push({ geo: makeBoxGeo(0.04, dH, dW, paneX, ly, lz), color: winC });
  parts.push({ geo: makeBoxGeo(0.04, dH * 0.92, 0.07, mullX, ly, lz), color: trimC });
  parts.push({ geo: makeBoxGeo(0.04, 0.07, dW * 0.92, mullX, ly, lz), color: trimC });
  parts.push({ geo: makeBoxGeo(0.06, 0.10, dW + 0.24, trimX, ly + dH/2 + 0.06, lz), color: trimC });
  parts.push({ geo: makeBoxGeo(0.12, 0.16, dW + 0.34, trimX + 0.03, ly - dH/2 - 0.10, lz), color: trimC });
  parts.push({ geo: makeBoxGeo(0.06, dH + 0.18, 0.09, trimX, ly, lz - dW/2 - 0.06), color: trimC });
  parts.push({ geo: makeBoxGeo(0.06, dH + 0.18, 0.09, trimX, ly, lz + dW/2 + 0.06), color: trimC });
}

// -X wall (left side).
function _windowPartsLeft(parts, lz, ly, wallX, dW, dH, winC, trimC) {
  const outerX = wallX - WALL_THICKNESS / 2;
  const paneX  = outerX - 0.01;
  const mullX  = paneX - 0.03;
  const trimX  = outerX - TRIM_PROUD;
  parts.push({ geo: makeBoxGeo(0.04, dH, dW, paneX, ly, lz), color: winC });
  parts.push({ geo: makeBoxGeo(0.04, dH * 0.92, 0.07, mullX, ly, lz), color: trimC });
  parts.push({ geo: makeBoxGeo(0.04, 0.07, dW * 0.92, mullX, ly, lz), color: trimC });
  parts.push({ geo: makeBoxGeo(0.06, 0.10, dW + 0.24, trimX, ly + dH/2 + 0.06, lz), color: trimC });
  parts.push({ geo: makeBoxGeo(0.12, 0.16, dW + 0.34, trimX - 0.03, ly - dH/2 - 0.10, lz), color: trimC });
  parts.push({ geo: makeBoxGeo(0.06, dH + 0.18, 0.09, trimX, ly, lz - dW/2 - 0.06), color: trimC });
  parts.push({ geo: makeBoxGeo(0.06, dH + 0.18, 0.09, trimX, ly, lz + dW/2 + 0.06), color: trimC });
}

// Foundation slab below the building (sticks down into ground a metre).
function _foundationParts(parts, w, d, foundC) {
  parts.push({ geo: makeBoxGeo(w + FOUNDATION_LIP*2, FOUNDATION_HEIGHT, d + FOUNDATION_LIP*2, 0, FOUNDATION_HEIGHT/2, 0), color: foundC });
  // Below-ground footing so terrain dips don't reveal nothing
  parts.push({ geo: makeBoxGeo(w + FOUNDATION_LIP*2, 1.8, d + FOUNDATION_LIP*2, 0, -0.9 + FOUNDATION_HEIGHT*0.5, 0), color: 0x1e1c1a });
}

// Hollow box walls on three sides (back, left, right) — front wall is built
// separately because it usually has the door opening.
function _hollowSidesAndBack(parts, w, d, h, wallC) {
  // Left
  parts.push({ geo: makeBoxGeo(WALL_THICKNESS, h, d, -w/2, FOUNDATION_HEIGHT + h/2, 0), color: wallC });
  // Right
  parts.push({ geo: makeBoxGeo(WALL_THICKNESS, h, d,  w/2, FOUNDATION_HEIGHT + h/2, 0), color: wallC });
  // Back
  parts.push({ geo: makeBoxGeo(w, h, WALL_THICKNESS, 0, FOUNDATION_HEIGHT + h/2, -d/2), color: wallC });
}

// Front wall with a door opening centred horizontally.
function _frontWallWithDoor(parts, w, d, h, doorW, doorH, wallC) {
  const sideW = (w - doorW) / 2;
  const z = d/2;
  // Left strip
  parts.push({ geo: makeBoxGeo(sideW, h, WALL_THICKNESS, -(doorW/2 + sideW/2), FOUNDATION_HEIGHT + h/2, z), color: wallC });
  // Right strip
  parts.push({ geo: makeBoxGeo(sideW, h, WALL_THICKNESS,  (doorW/2 + sideW/2), FOUNDATION_HEIGHT + h/2, z), color: wallC });
  // Lintel above door
  if (doorH < h - 0.1) {
    parts.push({ geo: makeBoxGeo(doorW, h - doorH, WALL_THICKNESS, 0, FOUNDATION_HEIGHT + doorH + (h - doorH)/2, z), color: wallC });
  }
}

// Hip roof: 4 sloped slabs meeting at a ridge running along local X.
function _hipRoofParts(parts, w, d, roofY, riseH, roofC) {
  const overhang = ROOF_OVERHANG;
  const W = w + overhang*2;
  const D = d + overhang*2;
  const ridgeLen = D * 0.5; // ridge length (along Z if we want gable-ish)
  // Two long slopes (run along Z, sloping down on +X and -X)
  const slopeLenX = Math.sqrt((W/2)*(W/2) + riseH*riseH);
  const slopeAngleX = Math.atan2(riseH, W/2);
  parts.push({ geo: makeBoxGeo(slopeLenX, ROOF_THICK, D,  W/4, roofY + riseH/2, 0, 0, 0, -slopeAngleX), color: roofC });
  parts.push({ geo: makeBoxGeo(slopeLenX, ROOF_THICK, D, -W/4, roofY + riseH/2, 0, 0, 0,  slopeAngleX), color: roofC });
  // Two end caps (smaller sloped triangles toward +Z and -Z)
  const slopeLenZ = Math.sqrt((D/2)*(D/2) + riseH*riseH);
  const slopeAngleZ = Math.atan2(riseH, D/2);
  parts.push({ geo: makeBoxGeo(W*0.7, ROOF_THICK, slopeLenZ, 0, roofY + riseH/2,  D/4,  slopeAngleZ, 0, 0), color: roofC });
  parts.push({ geo: makeBoxGeo(W*0.7, ROOF_THICK, slopeLenZ, 0, roofY + riseH/2, -D/4, -slopeAngleZ, 0, 0), color: roofC });
}

// Gable roof: two slopes meeting at a ridge running along local X. Front and
// back faces get triangular gable walls produced by _gableEndWall — the
// stepped strips fit UNDER the roof slope so no wall corners stick out.
function _gableRoofParts(parts, w, d, roofY, riseH, roofC, wallC) {
  const overhang = ROOF_OVERHANG;
  const W = w + overhang*2;
  const D = d + overhang*2;
  // Two slope slabs running along X (the ridge is along X)
  const slopeLen = Math.sqrt((D/2)*(D/2) + riseH*riseH);
  const slopeAngle = Math.atan2(riseH, D/2);
  parts.push({ geo: makeBoxGeo(W, ROOF_THICK, slopeLen, 0, roofY + riseH/2,  D/4,  slopeAngle, 0, 0), color: roofC });
  parts.push({ geo: makeBoxGeo(W, ROOF_THICK, slopeLen, 0, roofY + riseH/2, -D/4, -slopeAngle, 0, 0), color: roofC });
  // Triangular gable end walls (stepped strips — won't punch through slopes)
  _gableEndWall(parts, w * 0.98, riseH, wallC, roofY,  d/2 - 0.02);
  _gableEndWall(parts, w * 0.98, riseH, wallC, roofY, -d/2 + 0.02);
}

// Flat roof with parapet wall around the edge.
function _flatRoofWithParapet(parts, w, d, roofY, roofC, trimC) {
  // Roof slab
  parts.push({ geo: makeBoxGeo(w + 0.10, ROOF_THICK, d + 0.10, 0, roofY + ROOF_THICK/2, 0), color: roofC });
  // Parapet: 4 thin walls forming a low border
  const py = roofY + ROOF_THICK + PARAPET_H/2;
  parts.push({ geo: makeBoxGeo(w + 0.10, PARAPET_H, PARAPET_THICK, 0, py,  d/2 + PARAPET_THICK/2), color: trimC });
  parts.push({ geo: makeBoxGeo(w + 0.10, PARAPET_H, PARAPET_THICK, 0, py, -d/2 - PARAPET_THICK/2), color: trimC });
  parts.push({ geo: makeBoxGeo(PARAPET_THICK, PARAPET_H, d + 0.10,  w/2 + PARAPET_THICK/2, py, 0), color: trimC });
  parts.push({ geo: makeBoxGeo(PARAPET_THICK, PARAPET_H, d + 0.10, -w/2 - PARAPET_THICK/2, py, 0), color: trimC });
}

// Add the LOS-blocking sentinels for a standard rectangular building's 4 walls.
// Skips the front (+Z) wall by default so doorway entry isn't gated.
function _wallSentinelsForBox(sentinels, w, d, h, cosR, sinR, x, z, groundY, includeFront = false) {
  // Left wall: spans local x = -w/2, full depth d in local z
  sentinels.push(_wallSentinel(-w/2, 0, WALL_THICKNESS * 2, d + WALL_THICKNESS, h, cosR, sinR, x, z, groundY, 0.05));
  sentinels.push(_wallSentinel( w/2, 0, WALL_THICKNESS * 2, d + WALL_THICKNESS, h, cosR, sinR, x, z, groundY, 0.05));
  sentinels.push(_wallSentinel(0, -d/2, w + WALL_THICKNESS, WALL_THICKNESS * 2, h, cosR, sinR, x, z, groundY, 0.05));
  if (includeFront) {
    sentinels.push(_wallSentinel(0, d/2, w + WALL_THICKNESS, WALL_THICKNESS * 2, h, cosR, sinR, x, z, groundY, 0.05));
  }
}

// ─── Architectural detail helpers ───────────────────────────────────────────
// All take a `parts` array and append the detail pieces to it.

// Gutters along the roof's drip edge on all four sides. roofY is the wall-top
// height (where the gutter sits). w/d are the OUTSIDE dimensions of the
// gutter loop (typically wall span + roof overhang × 2 so it tracks the eave).
function _addGutters(parts, w, d, roofY, gutterC) {
  const gThick = 0.10;
  const gDepth = 0.12;
  // Front + back (run along X)
  parts.push({ geo: makeBoxGeo(w, gThick, gDepth, 0, roofY - 0.04,  d/2 + gDepth/2 - 0.02), color: gutterC });
  parts.push({ geo: makeBoxGeo(w, gThick, gDepth, 0, roofY - 0.04, -d/2 - gDepth/2 + 0.02), color: gutterC });
  // Left + right (run along Z)
  parts.push({ geo: makeBoxGeo(gDepth, gThick, d,  w/2 + gDepth/2 - 0.02, roofY - 0.04, 0), color: gutterC });
  parts.push({ geo: makeBoxGeo(gDepth, gThick, d, -w/2 - gDepth/2 + 0.02, roofY - 0.04, 0), color: gutterC });
  // Downspouts on two corners (front-right + back-left for variety)
  parts.push({ geo: makeBoxGeo(0.08, roofY - FOUNDATION_HEIGHT, 0.08,  w/2 - 0.10, (roofY - FOUNDATION_HEIGHT)/2 + FOUNDATION_HEIGHT, d/2 - 0.10), color: gutterC });
  parts.push({ geo: makeBoxGeo(0.08, roofY - FOUNDATION_HEIGHT, 0.08, -w/2 + 0.10, (roofY - FOUNDATION_HEIGHT)/2 + FOUNDATION_HEIGHT, -d/2 + 0.10), color: gutterC });
}

// Brick chimney rising from a roof position. cx/cz are the chimney centre in
// local coords; baseY is the wall-top height; chimneyH is how far it rises
// above the wall top. Brick is a 0.55 × 0.55 column with a slightly wider cap.
function _addChimney(parts, cx, cz, baseY, chimneyH, brickC, capC) {
  parts.push({ geo: makeBoxGeo(0.55, chimneyH, 0.55, cx, baseY + chimneyH/2, cz), color: brickC });
  parts.push({ geo: makeBoxGeo(0.70, 0.10, 0.70, cx, baseY + chimneyH + 0.05, cz), color: capC });
  // Small flue opening — very dark recess on top
  parts.push({ geo: makeBoxGeo(0.20, 0.04, 0.20, cx, baseY + chimneyH + 0.12, cz), color: 0x080808 });
}

// Mailbox: short post + small box on top. Placed at (cx, cz) in local coords.
function _addMailbox(parts, cx, cz, postC, boxC) {
  const postH = 1.05;
  parts.push({ geo: makeBoxGeo(0.07, postH, 0.07, cx, postH/2, cz), color: postC });
  parts.push({ geo: makeBoxGeo(0.32, 0.22, 0.46, cx, postH + 0.11, cz), color: boxC });
  // Red flag tab
  parts.push({ geo: makeBoxGeo(0.04, 0.18, 0.10, cx + 0.18, postH + 0.20, cz - 0.18), color: 0xa02020 });
}

// House number plate beside the door — small dark slab proud of the wall.
function _addHouseNumber(parts, lx, ly, wallZ, plateC) {
  parts.push({ geo: makeBoxGeo(0.32, 0.16, 0.04, lx, ly, wallZ + TRIM_PROUD * 0.8), color: plateC });
}

// Gable-end wall: stepped triangle that fits under a gable roof's slopes.
// `w` is the base width (at the wall top), `riseH` is the peak height above
// the wall top. `wallZ` is the z position of the gable face (e.g. d/2 for the
// front gable). Each strip uses its BOTTOM-edge width so the strip fully
// covers the triangle at its base — the top corner pokes are tiny because we
// use lots of small steps.
function _gableEndWall(parts, w, riseH, wallC, roofY, wallZ) {
  const STEPS = 10;
  const stripH = riseH / STEPS;
  for (let i = 0; i < STEPS; i++) {
    // Width at the BOTTOM of this strip (the wider edge). This guarantees the
    // strip fills the triangle base-side completely.
    const tBot = i / STEPS;
    const stripW = w * (1 - tBot);
    if (stripW < 0.20) continue;
    const cy = roofY + (i + 0.5) * stripH;
    parts.push({ geo: makeBoxGeo(stripW, stripH, WALL_THICKNESS, 0, cy, wallZ), color: wallC });
  }
}

// Same idea but on a +X / -X face (the wall plane normal is along X). Used by
// the bungalow if we ever need it for cross-gabled designs.
function _gableEndWallSideways(parts, d, riseH, wallC, roofY, wallX) {
  const STEPS = 10;
  const stripH = riseH / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const tBot = i / STEPS;
    const stripD = d * (1 - tBot);
    if (stripD < 0.20) continue;
    const cy = roofY + (i + 0.5) * stripH;
    parts.push({ geo: makeBoxGeo(WALL_THICKNESS, stripH, stripD, wallX, cy, 0), color: wallC });
  }
}

// Awning over a storefront/door. Slopes slightly down toward the street.
function _addAwning(parts, cx, awningY, wallZ, w, d, fabricC) {
  // Main slab, tilted slightly down toward the street (+Z)
  parts.push({ geo: makeBoxGeo(w, 0.10, d, cx, awningY,        wallZ + d/2, 0, 0, 0), color: fabricC });
  // Trim along the leading edge
  parts.push({ geo: makeBoxGeo(w + 0.10, 0.18, 0.06, cx, awningY - 0.08, wallZ + d + 0.02), color: fabricC });
  // Two diagonal supports back to the wall
  for (const px of [-w/2 + 0.25, w/2 - 0.25]) {
    parts.push({ geo: makeBoxGeo(0.06, 0.08, d * 1.05, cx + px, awningY - 0.02, wallZ + d/2, 0, 0, 0), color: fabricC });
  }
}

// ─── Higher-detail architectural helpers ───────────────────────────────────

// Corner trim — square vertical pillars at each external corner. Sits flush
// to the wall corner and slightly proud, so it reads as banding.
function _addCornerTrim(parts, w, d, h, trimC) {
  const baseY = FOUNDATION_HEIGHT;
  const trimW = 0.18;
  const offsetX = w/2 + WALL_THICKNESS/2 - trimW * 0.20;
  const offsetZ = d/2 + WALL_THICKNESS/2 - trimW * 0.20;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({ geo: makeBoxGeo(trimW, h, trimW, sx * offsetX, baseY + h/2, sz * offsetZ), color: trimC });
    }
  }
}

// Base course — slightly lighter horizontal band just above the foundation.
// Sits proud of the wall by a small amount (~0.04m) to give the wall depth.
function _addBaseCourse(parts, w, d, courseC) {
  const baseY = FOUNDATION_HEIGHT;
  const courseH = 0.34;
  const overhang = 0.05;
  parts.push({ geo: makeBoxGeo(w + WALL_THICKNESS + overhang*2, courseH, d + WALL_THICKNESS + overhang*2, 0, baseY + courseH/2, 0), color: courseC });
}

// Frieze — darker horizontal band just below the eave. Adds the "trim where
// wall meets roof" detail.
function _addFrieze(parts, w, d, friezeY, friezeC) {
  const friezeH = 0.22;
  const overhang = 0.03;
  parts.push({ geo: makeBoxGeo(w + WALL_THICKNESS + overhang*2, friezeH, d + WALL_THICKNESS + overhang*2, 0, friezeY - friezeH/2, 0), color: friezeC });
}

// Window shutters on a +Z (front) wall. Two flat slabs flanking the window.
function _addShutters(parts, lx, ly, wallZ, dW, dH, shutterC) {
  const outerZ = wallZ + WALL_THICKNESS / 2;
  const shutterZ = outerZ + 0.025;
  const shutterW = Math.min(dW * 0.32, 0.55);
  const shutterH = dH * 1.08;
  parts.push({ geo: makeBoxGeo(shutterW, shutterH, 0.04, lx - dW/2 - shutterW/2 - 0.08, ly, shutterZ), color: shutterC });
  parts.push({ geo: makeBoxGeo(shutterW, shutterH, 0.04, lx + dW/2 + shutterW/2 + 0.08, ly, shutterZ), color: shutterC });
  // Two slat lines per shutter (subtle horizontal divisions)
  for (const dir of [-1, 1]) {
    const sx = lx + dir * (dW/2 + shutterW/2 + 0.08);
    for (const offY of [-shutterH * 0.25, shutterH * 0.25]) {
      parts.push({ geo: makeBoxGeo(shutterW * 0.85, 0.03, 0.04, sx, ly + offY, shutterZ + 0.015), color: 0x1a1a18 });
    }
  }
}

// Door panels — 4 recessed rectangles on the door surface (classic 4-panel door).
function _addDoorPanels(parts, cx, baseY, doorH, doorZ, dW, panelC) {
  const padX = 0.10;
  const padYTop = 0.10;
  const padYMid = 0.06;
  const padYBot = 0.18;
  const colW = (dW - 3 * padX) / 2;
  const rowH = (doorH - padYTop - padYBot - padYMid) / 2;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const px = cx + (c - 0.5) * (colW + padX);
      const py = baseY + padYBot + r * (rowH + padYMid) + rowH / 2;
      // Panel sits slightly back (recessed shadow look) — z = doorZ - 0.015
      parts.push({ geo: makeBoxGeo(colW, rowH, 0.015, px, py, doorZ - 0.018), color: panelC });
    }
  }
}

// Door threshold — small step at the door's base, sticks out from the wall.
function _addDoorThreshold(parts, cx, doorZ, dW, threshC) {
  parts.push({ geo: makeBoxGeo(dW + 0.10, 0.08, 0.16, cx, FOUNDATION_HEIGHT + 0.04, doorZ + 0.08), color: threshC });
}

// Porch light fixture — small wall-mounted lantern beside the door. Has a
// dim "bulb" colour so it reads as a fixture even though it isn't emissive.
function _addPorchLight(parts, cx, ly, wallZ, fixtureC) {
  const outerZ = wallZ + WALL_THICKNESS / 2;
  // Backplate on the wall
  parts.push({ geo: makeBoxGeo(0.16, 0.10, 0.04, cx, ly, outerZ + 0.02), color: fixtureC });
  // Lantern body (slightly proud)
  parts.push({ geo: makeBoxGeo(0.14, 0.20, 0.14, cx, ly + 0.04, outerZ + 0.10), color: 0x141414 });
  // Bulb panel (slightly lighter to read as light source even without emissive)
  parts.push({ geo: makeBoxGeo(0.10, 0.14, 0.02, cx, ly + 0.04, outerZ + 0.18), color: 0xc6b48a });
  // Small cap on top
  parts.push({ geo: makeBoxGeo(0.18, 0.04, 0.18, cx, ly + 0.16, outerZ + 0.10), color: fixtureC });
}

// Ridge cap for a gable roof — a slightly darker band along the ridge.
// `axis` is 'x' for a ridge running along X (two-story uses this), 'z' for
// a ridge running along Z (bungalow uses this).
function _addRidgeCap(parts, length, ridgeY, ridgeC, axis) {
  const capH = 0.10;
  const capW = 0.30;
  if (axis === 'x') {
    parts.push({ geo: makeBoxGeo(length, capH, capW, 0, ridgeY + capH/2, 0), color: ridgeC });
  } else {
    parts.push({ geo: makeBoxGeo(capW, capH, length, 0, ridgeY + capH/2, 0), color: ridgeC });
  }
}

// ============================================================================
// BUILDING VARIANTS
// ============================================================================
// Each variant returns a BuildResult with the mesh positioned at (x, 0, z),
// already rotated, ready for the caller to lift onto terrain.
// ============================================================================

// ─── 1. RANCH HOUSE ─────────────────────────────────────────────────────────
/** ~9.5w × 9d × 3.2h. Single-storey ranch with attached single-car garage,
 *  hip roof, front stoop, side and back windows. */
export function makeRanchHouse(x, z, rotY, seed) {
  const rng = mulberry32(seed);
  const P = PALETTES.residential;
  const wallC  = pick(P.walls, rng);
  const roofC  = pick(P.roofs, rng);
  const trimC  = pick(P.trim, rng);
  const foundC = pick(P.foundation, rng);
  const doorC  = pick(P.door, rng);
  const winC   = pick(P.window, rng);
  // Derived shades for new detail: shutter is a tinted door-colour, base
  // course is foundation tone, frieze is darker trim.
  const shutterC = pick(P.door, rng);
  const baseCourseC = foundC;
  const friezeC = pick(P.trim, rng);

  const W = 9.5, D = 9.0, H = 3.2;
  const garageW = GARAGE_W;
  const garageH = GARAGE_H;
  const baseY = FOUNDATION_HEIGHT;
  const parts = [];

  // Foundation
  _foundationParts(parts, W, D, foundC);
  // Base course around the bottom of the wall (above foundation slab)
  _addBaseCourse(parts, W, D, baseCourseC);
  // Three solid walls (left, right, back)
  _hollowSidesAndBack(parts, W, D, H, wallC);

  // ── Front wall composition: front door on left half, garage door on right ──
  // Pillar between front door and garage
  const garageL = W/2 - garageW;
  const garageR = W/2;
  // Front door is at x = (-W/2 + (W - garageW)/2) — centred on the non-garage half
  const livingHalfW = W - garageW;
  const doorCx = -W/2 + livingHalfW * 0.62; // slightly right of centre so the window has room
  // Strip left of door, strip right of door (between door and garage)
  parts.push({ geo: makeBoxGeo(doorCx - DOOR_W/2 - (-W/2), H, WALL_THICKNESS, ((-W/2) + (doorCx - DOOR_W/2))/2, baseY + H/2, D/2), color: wallC });
  const rightStripW = garageL - (doorCx + DOOR_W/2);
  parts.push({ geo: makeBoxGeo(rightStripW, H, WALL_THICKNESS, (doorCx + DOOR_W/2 + garageL)/2, baseY + H/2, D/2), color: wallC });
  // Lintel above front door
  if (DOOR_H < H - 0.1) {
    parts.push({ geo: makeBoxGeo(DOOR_W, H - DOOR_H, WALL_THICKNESS, doorCx, baseY + DOOR_H + (H - DOOR_H)/2, D/2), color: wallC });
  }
  // Garage opening: full-width column above garage door
  if (garageH < H - 0.1) {
    parts.push({ geo: makeBoxGeo(garageW, H - garageH, WALL_THICKNESS, garageL + garageW/2, baseY + garageH + (H - garageH)/2, D/2), color: wallC });
  }

  // Front door slab (sits flush in the opening)
  parts.push({ geo: makeBoxGeo(DOOR_W - 0.02, DOOR_H - 0.02, 0.06, doorCx, baseY + DOOR_H/2, D/2 - WALL_THICKNESS/2 + 0.04), color: doorC });
  // Door trim around the actual (off-centre) opening
  const zT = D/2 + TRIM_PROUD;
  parts.push({ geo: makeBoxGeo(DOOR_W + 0.20, TRIM_THICK, 0.06, doorCx, baseY + DOOR_H + 0.04, zT), color: trimC });
  parts.push({ geo: makeBoxGeo(TRIM_THICK, DOOR_H, 0.06, doorCx - DOOR_W/2 - 0.05, baseY + DOOR_H/2, zT), color: trimC });
  parts.push({ geo: makeBoxGeo(TRIM_THICK, DOOR_H, 0.06, doorCx + DOOR_W/2 + 0.05, baseY + DOOR_H/2, zT), color: trimC });
  // Door knob
  parts.push({ geo: makeBoxGeo(0.08, 0.10, 0.08, doorCx + DOOR_W/2 - 0.18, baseY + DOOR_H * 0.45, D/2 + WALL_THICKNESS/2 + 0.04), color: 0x16140e });

  // ── Garage door — raised-panel look (4 horizontal panels separated by thin grooves) ──
  const garageCx = garageL + garageW/2;
  const garageZ = D/2 - WALL_THICKNESS/2 + 0.04;
  const panelGap = 0.04;
  const panelH = (garageH - panelGap * 3) / 4;
  for (let i = 0; i < 4; i++) {
    const py = baseY + panelH/2 + i * (panelH + panelGap);
    parts.push({ geo: makeBoxGeo(garageW - 0.05, panelH, 0.05, garageCx, py, garageZ), color: doorC });
  }
  // Garage frame trim
  parts.push({ geo: makeBoxGeo(garageW + 0.20, TRIM_THICK, 0.06, garageCx, baseY + garageH + 0.04, zT), color: trimC });
  parts.push({ geo: makeBoxGeo(TRIM_THICK, garageH, 0.06, garageCx - garageW/2 - 0.05, baseY + garageH/2, zT), color: trimC });
  parts.push({ geo: makeBoxGeo(TRIM_THICK, garageH, 0.06, garageCx + garageW/2 + 0.05, baseY + garageH/2, zT), color: trimC });

  // ── Front-facing windows ──
  // Big picture window on the living-room side (left of door)
  const winCx = -W/2 + (doorCx - DOOR_W/2 - (-W/2)) * 0.55;
  const winLW = WINDOW_W * 1.3, winLH = WINDOW_H * 1.05;
  _windowParts(parts, winCx, baseY + H * 0.55, D/2, winLW, winLH, winC, trimC);
  // Smaller kitchen window between the door and the garage
  const kitchCx = (doorCx + DOOR_W/2 + garageL) / 2;
  const kitchW = WINDOW_W * 0.7, kitchH = WINDOW_H * 0.75;
  _windowParts(parts, kitchCx, baseY + H * 0.62, D/2, kitchW, kitchH, winC, trimC);
  // Shutters flanking the front windows
  _addShutters(parts, winCx, baseY + H * 0.55, D/2, winLW, winLH, shutterC);
  _addShutters(parts, kitchCx, baseY + H * 0.62, D/2, kitchW, kitchH, shutterC);

  // ── Side windows ──
  _windowPartsLeft(parts, -D * 0.10, baseY + H * 0.55, -W/2, WINDOW_W, WINDOW_H, winC, trimC);
  _windowPartsLeft(parts,  D * 0.18, baseY + H * 0.55, -W/2, WINDOW_W, WINDOW_H, winC, trimC);
  _windowPartsRight(parts, -D * 0.10, baseY + H * 0.55, W/2, WINDOW_W, WINDOW_H, winC, trimC);
  // ── Back windows ──
  _windowPartsBack(parts, -W/4, baseY + H * 0.55, -D/2, WINDOW_W, WINDOW_H, winC, trimC);
  _windowPartsBack(parts,  W/4, baseY + H * 0.55, -D/2, WINDOW_W, WINDOW_H, winC, trimC);

  // ── Front stoop (small concrete slab in front of door) ──
  parts.push({ geo: makeBoxGeo(DOOR_W + 0.70, 0.18, 0.85, doorCx, 0.09, D/2 + 0.42), color: foundC });
  // Porch post on the door side (mailbox is now its own piece outside the building)
  parts.push({ geo: makeBoxGeo(0.12, 1.10, 0.12, doorCx + DOOR_W/2 + 0.30, 0.55, D/2 + 0.78), color: trimC });
  // House-number plate beside the door
  _addHouseNumber(parts, doorCx + DOOR_W/2 + 0.18, baseY + DOOR_H * 0.80, D/2, 0x141414);

  // ── Hip roof ──
  _hipRoofParts(parts, W, D, baseY + H, 1.35, roofC);

  // ── Gutters around the eave ──
  _addGutters(parts, W + ROOF_OVERHANG * 2 - 0.6, D + ROOF_OVERHANG * 2 - 0.6, baseY + H, trimC);

  // ── Chimney over the living-room side ──
  _addChimney(parts, -W * 0.18, -D * 0.10, baseY + H + 0.5, 1.4, 0x5e3a30, 0x282624);

  // ── Mailbox at the front-left corner of the yard (street side) ──
  _addMailbox(parts, -W * 0.40, D/2 + 1.10, trimC, doorC);

  // ── Architectural detail: corner trim, frieze, door panels/threshold, porch light ──
  _addCornerTrim(parts, W, D, H, trimC);
  _addFrieze(parts, W, D, baseY + H, friezeC);
  _addDoorPanels(parts, doorCx, baseY, DOOR_H, D/2 - WALL_THICKNESS/2 + 0.04, DOOR_W - 0.02, doorC);
  _addDoorThreshold(parts, doorCx, D/2, DOOR_W, foundC);
  _addPorchLight(parts, doorCx - DOOR_W/2 - 0.35, baseY + DOOR_H * 0.85, D/2, trimC);

  // ── Build mesh ──
  const mesh = makeMergedMesh(parts);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return null;
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY || 0;

  // ── World-space collision + LOS sentinels ──
  const cosR = Math.cos(rotY || 0), sinR = Math.sin(rotY || 0);
  const groundY = 0; // caller will lift mesh; sentinels use the same offset
  const sentinels = [];
  _wallSentinelsForBox(sentinels, W, D, H + 1.6, cosR, sinR, x, z, groundY, /* includeFront */ false);
  const bbox = _obbWorldAABB(x, z, W/2, D/2, cosR, sinR, groundY, groundY + H + 1.6);

  // The driveway anchor is the GARAGE x in local space — driveways for ranch
  // houses should lead to the garage, not the door.
  return {
    mesh,
    driveway: null,
    sentinels,
    bbox,
    footprint: { w: W, d: D, h: H },
    doorOffset: { lx: doorCx, lz: D/2 },
    drivewayAnchor: { lx: garageCx, lz: D/2 },
  };
}

// ─── 2. TWO-STORY HOUSE ─────────────────────────────────────────────────────
/** ~9w × 8.5d × 6.2h. Two-storey with gabled roof, upstairs window row,
 *  small front porch on two thin posts. */
export function makeTwoStoryHouse(x, z, rotY, seed) {
  const rng = mulberry32(seed);
  const P = PALETTES.residential;
  const wallC  = pick(P.walls, rng);
  const roofC  = pick(P.roofs, rng);
  const trimC  = pick(P.trim, rng);
  const foundC = pick(P.foundation, rng);
  const doorC  = pick(P.door, rng);
  const winC   = pick(P.window, rng);
  const shutterC = pick(P.door, rng);
  const baseCourseC = foundC;
  const friezeC = pick(P.trim, rng);

  const W = 9.0, D = 8.5, H = 6.2;
  const baseY = FOUNDATION_HEIGHT;
  const parts = [];

  _foundationParts(parts, W, D, foundC);
  _addBaseCourse(parts, W, D, baseCourseC);
  _hollowSidesAndBack(parts, W, D, H, wallC);
  _frontWallWithDoor(parts, W, D, H, DOOR_W, DOOR_H, wallC);

  // Front door slab + trim
  const doorCx = 0;
  parts.push({ geo: makeBoxGeo(DOOR_W - 0.02, DOOR_H - 0.02, 0.06, doorCx, baseY + DOOR_H/2, D/2 - WALL_THICKNESS/2 + 0.04), color: doorC });
  _doorTrimParts(parts, DOOR_W, DOOR_H, D/2 + WALL_THICKNESS/2, trimC);
  parts.push({ geo: makeBoxGeo(0.08, 0.10, 0.08, DOOR_W/2 - 0.18, baseY + DOOR_H * 0.45, D/2 + WALL_THICKNESS/2 + 0.04), color: 0x16140e });

  // ── Front: two ground-floor windows (flanking door), three upstairs windows ──
  // Ground-floor pair
  for (const wx of [-W * 0.30, W * 0.30]) {
    _windowParts(parts, wx, baseY + H * 0.28, D/2, WINDOW_W, WINDOW_H, winC, trimC);
    _addShutters(parts, wx, baseY + H * 0.28, D/2, WINDOW_W, WINDOW_H, shutterC);
  }
  // Upstairs trio
  for (const wx of [-W * 0.32, 0, W * 0.32]) {
    _windowParts(parts, wx, baseY + H * 0.72, D/2, WINDOW_W, WINDOW_H, winC, trimC);
    _addShutters(parts, wx, baseY + H * 0.72, D/2, WINDOW_W, WINDOW_H, shutterC);
  }
  // ── Side windows (two storeys) ──
  for (const wy of [baseY + H * 0.28, baseY + H * 0.72]) {
    _windowPartsLeft(parts, -D * 0.20, wy, -W/2, WINDOW_W, WINDOW_H, winC, trimC);
    _windowPartsLeft(parts,  D * 0.20, wy, -W/2, WINDOW_W, WINDOW_H, winC, trimC);
    _windowPartsRight(parts, -D * 0.20, wy, W/2, WINDOW_W, WINDOW_H, winC, trimC);
    _windowPartsRight(parts,  D * 0.20, wy, W/2, WINDOW_W, WINDOW_H, winC, trimC);
  }
  // ── Back windows ──
  for (const wy of [baseY + H * 0.28, baseY + H * 0.72]) {
    _windowPartsBack(parts, -W * 0.28, wy, -D/2, WINDOW_W, WINDOW_H, winC, trimC);
    _windowPartsBack(parts,  W * 0.28, wy, -D/2, WINDOW_W, WINDOW_H, winC, trimC);
  }

  // ── Front porch: stoop slab + 2 thin posts + porch roof slab + railing ──
  const porchD = 1.40;
  parts.push({ geo: makeBoxGeo(DOOR_W * 2.2, 0.18, porchD, 0, 0.09, D/2 + porchD/2 + 0.05), color: foundC });
  parts.push({ geo: makeBoxGeo(0.16, 2.40, 0.16, -DOOR_W * 0.95, 1.30, D/2 + porchD + 0.05), color: trimC });
  parts.push({ geo: makeBoxGeo(0.16, 2.40, 0.16,  DOOR_W * 0.95, 1.30, D/2 + porchD + 0.05), color: trimC });
  parts.push({ geo: makeBoxGeo(DOOR_W * 2.6, 0.18, porchD + 0.20, 0, 2.55, D/2 + porchD/2 + 0.10), color: roofC });
  // Porch railing on the two sides of the stoop (not in front of the door)
  for (const px of [-DOOR_W * 1.0, DOOR_W * 1.0]) {
    parts.push({ geo: makeBoxGeo(0.08, 0.85, porchD - 0.10, px, 0.50, D/2 + porchD/2 + 0.05), color: trimC });
    // Two horizontal rails
    parts.push({ geo: makeBoxGeo(0.08, 0.05, porchD - 0.20, px, 0.32, D/2 + porchD/2 + 0.05), color: trimC });
    parts.push({ geo: makeBoxGeo(0.08, 0.05, porchD - 0.20, px, 0.78, D/2 + porchD/2 + 0.05), color: trimC });
  }
  // House-number plate beside the door
  _addHouseNumber(parts, DOOR_W/2 + 0.18, baseY + DOOR_H * 0.80, D/2, 0x141414);

  // ── Gable roof ──
  _gableRoofParts(parts, W, D, baseY + H, 2.0, roofC, wallC);

  // ── Gable-end window (small attic window in the front gable triangle) ──
  parts.push({ geo: makeBoxGeo(0.80, 0.60, 0.05, 0, baseY + H + 1.0, D/2 + 0.02), color: winC });
  parts.push({ geo: makeBoxGeo(0.95, 0.06, 0.04, 0, baseY + H + 1.32, D/2 + 0.04), color: trimC });
  parts.push({ geo: makeBoxGeo(0.95, 0.07, 0.04, 0, baseY + H + 0.66, D/2 + 0.04), color: trimC });

  // ── Gutters along the eave ──
  _addGutters(parts, W + ROOF_OVERHANG * 2 - 0.6, D + ROOF_OVERHANG * 2 - 0.6, baseY + H, trimC);

  // ── Chimney on the side ──
  _addChimney(parts, W * 0.32, -D * 0.08, baseY + H + 0.5, 2.2, 0x5e3a30, 0x282624);

  // ── Mailbox at the curb ──
  _addMailbox(parts, -W * 0.42, D/2 + porchD + 1.10, trimC, doorC);

  // ── Architectural detail: corner trim, frieze, ridge cap, door panels, threshold, porch light ──
  _addCornerTrim(parts, W, D, H, trimC);
  _addFrieze(parts, W, D, baseY + H, friezeC);
  _addRidgeCap(parts, W + ROOF_OVERHANG * 1.6, baseY + H + 2.0, friezeC, 'x');
  _addDoorPanels(parts, 0, baseY, DOOR_H, D/2 - WALL_THICKNESS/2 + 0.04, DOOR_W - 0.02, doorC);
  _addDoorThreshold(parts, 0, D/2, DOOR_W, foundC);
  _addPorchLight(parts, -DOOR_W/2 - 0.30, baseY + DOOR_H * 0.85, D/2, trimC);

  const mesh = makeMergedMesh(parts);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return null;
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY || 0;

  const cosR = Math.cos(rotY || 0), sinR = Math.sin(rotY || 0);
  const sentinels = [];
  _wallSentinelsForBox(sentinels, W, D, H + 2.2, cosR, sinR, x, z, 0, false);
  const bbox = _obbWorldAABB(x, z, W/2, D/2, cosR, sinR, 0, H + 2.2);

  return { mesh, driveway: null, sentinels, bbox, footprint: { w: W, d: D, h: H }, doorOffset: { lx: 0, lz: D/2 } };
}

// ─── 3. BUNGALOW ────────────────────────────────────────────────────────────
/** ~6w × 11d × 3.4h. Narrow + deep, steeply pitched front gable, tiny stoop. */
export function makeBungalow(x, z, rotY, seed) {
  const rng = mulberry32(seed);
  const P = PALETTES.residential;
  const wallC  = pick(P.walls, rng);
  const roofC  = pick(P.roofs, rng);
  const trimC  = pick(P.trim, rng);
  const foundC = pick(P.foundation, rng);
  const doorC  = pick(P.door, rng);
  const winC   = pick(P.window, rng);
  const shutterC = pick(P.door, rng);
  const baseCourseC = foundC;
  const friezeC = pick(P.trim, rng);

  const W = 6.0, D = 11.0, H = 3.4;
  const baseY = FOUNDATION_HEIGHT;
  const parts = [];

  _foundationParts(parts, W, D, foundC);
  _addBaseCourse(parts, W, D, baseCourseC);
  _hollowSidesAndBack(parts, W, D, H, wallC);
  _frontWallWithDoor(parts, W, D, H, DOOR_W, DOOR_H, wallC);

  // Door
  parts.push({ geo: makeBoxGeo(DOOR_W - 0.02, DOOR_H - 0.02, 0.06, 0, baseY + DOOR_H/2, D/2 - WALL_THICKNESS/2 + 0.04), color: doorC });
  _doorTrimParts(parts, DOOR_W, DOOR_H, D/2 + WALL_THICKNESS/2, trimC);
  parts.push({ geo: makeBoxGeo(0.08, 0.10, 0.08, DOOR_W/2 - 0.18, baseY + DOOR_H * 0.45, D/2 + WALL_THICKNESS/2 + 0.04), color: 0x16140e });

  // ── Front: one window beside the door (narrow house) ──
  const bungalowWinW = WINDOW_W * 0.9, bungalowWinH = WINDOW_H;
  _windowParts(parts, -W * 0.30, baseY + H * 0.55, D/2, bungalowWinW, bungalowWinH, winC, trimC);
  _addShutters(parts, -W * 0.30, baseY + H * 0.55, D/2, bungalowWinW, bungalowWinH, shutterC);

  // ── Long side walls: 4 windows each (it's a long narrow house) ──
  for (const lz of [-D * 0.32, -D * 0.10, D * 0.12, D * 0.32]) {
    _windowPartsLeft(parts, lz, baseY + H * 0.55, -W/2, WINDOW_W * 0.9, WINDOW_H, winC, trimC);
    _windowPartsRight(parts, lz, baseY + H * 0.55, W/2, WINDOW_W * 0.9, WINDOW_H, winC, trimC);
  }
  // ── Back ──
  _windowPartsBack(parts, 0, baseY + H * 0.55, -D/2, WINDOW_W, WINDOW_H, winC, trimC);

  // ── Tiny stoop + post ──
  parts.push({ geo: makeBoxGeo(DOOR_W + 0.50, 0.18, 0.70, 0, 0.09, D/2 + 0.35), color: foundC });
  parts.push({ geo: makeBoxGeo(0.10, 1.95, 0.10, DOOR_W/2 + 0.18, 0.97, D/2 + 0.65), color: trimC });
  // Small porch roof
  parts.push({ geo: makeBoxGeo(DOOR_W + 0.90, 0.14, 1.00, 0, 2.20, D/2 + 0.50), color: roofC });
  // House-number plate
  _addHouseNumber(parts, DOOR_W/2 + 0.20, baseY + DOOR_H * 0.80, D/2, 0x141414);

  // ── Window box under the front window (flower-box detail) ──
  parts.push({ geo: makeBoxGeo(WINDOW_W * 0.95, 0.22, 0.22, -W * 0.30, baseY + H * 0.55 - WINDOW_H * 0.5 - 0.18, D/2 + 0.12), color: trimC });
  parts.push({ geo: makeBoxGeo(WINDOW_W * 0.80, 0.06, 0.20, -W * 0.30, baseY + H * 0.55 - WINDOW_H * 0.5 - 0.06, D/2 + 0.18), color: 0x4a2818 });

  // ── Steep front-gable roof. We give it a steeper rise than typical. ──
  const rise = 2.4;
  // Gable runs front-to-back: the ridge runs along the local Z axis from
  // front to back; slopes go down to the left and right (along X).
  const overhang = ROOF_OVERHANG;
  const W2 = W + overhang*2, D2 = D + overhang*2;
  const slopeLen = Math.sqrt((W2/2)*(W2/2) + rise*rise);
  const slopeAngle = Math.atan2(rise, W2/2);
  parts.push({ geo: makeBoxGeo(slopeLen, ROOF_THICK, D2,  W2/4, baseY + H + rise/2, 0, 0, 0, -slopeAngle), color: roofC });
  parts.push({ geo: makeBoxGeo(slopeLen, ROOF_THICK, D2, -W2/4, baseY + H + rise/2, 0, 0, 0,  slopeAngle), color: roofC });
  // Front + back gable walls — triangular, won't punch out above the slopes
  _gableEndWall(parts, W * 0.98, rise, wallC, baseY + H,  D/2 - 0.02);
  _gableEndWall(parts, W * 0.98, rise, wallC, baseY + H, -D/2 + 0.02);
  // Attic vent in the front gable
  parts.push({ geo: makeBoxGeo(0.60, 0.36, 0.04, 0, baseY + H + rise * 0.55, D/2 + 0.02), color: 0x0e0e0c });
  parts.push({ geo: makeBoxGeo(0.72, 0.06, 0.04, 0, baseY + H + rise * 0.55 + 0.21, D/2 + 0.04), color: trimC });
  parts.push({ geo: makeBoxGeo(0.72, 0.06, 0.04, 0, baseY + H + rise * 0.55 - 0.21, D/2 + 0.04), color: trimC });

  // ── Gutters along the long eaves (left + right side, where the gable slopes drain) ──
  // Left eave (along Z, at -X)
  parts.push({ geo: makeBoxGeo(0.10, 0.10, D + 0.4, -W/2 - 0.05, baseY + H - 0.04, 0), color: trimC });
  parts.push({ geo: makeBoxGeo(0.10, 0.10, D + 0.4,  W/2 + 0.05, baseY + H - 0.04, 0), color: trimC });
  // Downspouts
  parts.push({ geo: makeBoxGeo(0.08, baseY + H - FOUNDATION_HEIGHT, 0.08,  W/2 + 0.05, (baseY + H + FOUNDATION_HEIGHT)/2, -D * 0.35), color: trimC });
  parts.push({ geo: makeBoxGeo(0.08, baseY + H - FOUNDATION_HEIGHT, 0.08, -W/2 - 0.05, (baseY + H + FOUNDATION_HEIGHT)/2,  D * 0.35), color: trimC });

  // ── Brick chimney near the back ──
  _addChimney(parts, W * 0.25, -D * 0.30, baseY + H + 0.5, 1.8, 0x5e3a30, 0x282624);

  // ── Mailbox at curb ──
  _addMailbox(parts, -W * 0.45, D/2 + 1.40, trimC, doorC);

  // ── Architectural detail: corner trim, frieze, ridge cap (along Z for this front-gable layout), door panels, threshold, porch light ──
  _addCornerTrim(parts, W, D, H, trimC);
  _addFrieze(parts, W, D, baseY + H, friezeC);
  _addRidgeCap(parts, D + ROOF_OVERHANG * 1.6, baseY + H + rise, friezeC, 'z');
  _addDoorPanels(parts, 0, baseY, DOOR_H, D/2 - WALL_THICKNESS/2 + 0.04, DOOR_W - 0.02, doorC);
  _addDoorThreshold(parts, 0, D/2, DOOR_W, foundC);
  _addPorchLight(parts, -DOOR_W/2 - 0.30, baseY + DOOR_H * 0.85, D/2, trimC);

  const mesh = makeMergedMesh(parts);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return null;
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY || 0;

  const cosR = Math.cos(rotY || 0), sinR = Math.sin(rotY || 0);
  const sentinels = [];
  _wallSentinelsForBox(sentinels, W, D, H + rise + 0.5, cosR, sinR, x, z, 0, false);
  const bbox = _obbWorldAABB(x, z, W/2, D/2, cosR, sinR, 0, H + rise + 0.5);

  return { mesh, driveway: null, sentinels, bbox, footprint: { w: W, d: D, h: H }, doorOffset: { lx: 0, lz: D/2 } };
}

// ─── 4. RUNDOWN HOUSE ───────────────────────────────────────────────────────
/** ~7w × 9d × 3.3h. Sagging roof, boarded window, uneven stoop. */
export function makeRundownHouse(x, z, rotY, seed) {
  const rng = mulberry32(seed);
  const P = PALETTES.rundown;
  const wallC  = pick(P.walls, rng);
  const roofC  = pick(P.roofs, rng);
  const trimC  = pick(P.trim, rng);
  const foundC = pick(P.foundation, rng);
  const doorC  = pick(P.door, rng);
  const winC   = pick(P.window, rng);
  const accentC= pick(P.accent, rng);

  const W = 7.0, D = 9.0, H = 3.3;
  const baseY = FOUNDATION_HEIGHT;
  const parts = [];

  _foundationParts(parts, W, D, foundC);
  _hollowSidesAndBack(parts, W, D, H, wallC);
  _frontWallWithDoor(parts, W, D, H, DOOR_W, DOOR_H, wallC);

  // Sagging door (slightly off-vertical)
  parts.push({ geo: makeBoxGeo(DOOR_W - 0.04, DOOR_H - 0.04, 0.05, 0, baseY + DOOR_H/2, D/2 - WALL_THICKNESS/2 + 0.04, 0, 0, -0.04), color: doorC });
  _doorTrimParts(parts, DOOR_W, DOOR_H, D/2 + WALL_THICKNESS/2, trimC);

  // Front-left window — boarded over: window pane behind, dark planks proud of wall
  const boardCx = -W * 0.30, boardCy = baseY + H * 0.55;
  // Window itself (dim, behind boards)
  parts.push({ geo: makeBoxGeo(WINDOW_W, WINDOW_H, 0.05, boardCx, boardCy, D/2 - WINDOW_RECESS), color: 0x0e0e0c });
  // Three horizontal planks across the window
  for (let i = 0; i < 3; i++) {
    const dy = (i - 1) * 0.36;
    const tilt = (rng() - 0.5) * 0.18;
    parts.push({ geo: makeBoxGeo(WINDOW_W + 0.30, 0.16, 0.05, boardCx, boardCy + dy, D/2 + 0.06, 0, 0, tilt), color: accentC });
  }
  // ── Front-right window — regular, but cracked-looking (offset frame) ──
  _windowParts(parts, W * 0.30, baseY + H * 0.55, D/2, WINDOW_W, WINDOW_H, winC, trimC);

  // ── Side / back windows (regular) ──
  _windowPartsLeft(parts, -D * 0.15, baseY + H * 0.55, -W/2, WINDOW_W, WINDOW_H, winC, trimC);
  _windowPartsRight(parts, D * 0.15, baseY + H * 0.55, W/2, WINDOW_W, WINDOW_H, winC, trimC);
  _windowPartsBack(parts, -W * 0.25, baseY + H * 0.55, -D/2, WINDOW_W, WINDOW_H, winC, trimC);
  _windowPartsBack(parts,  W * 0.25, baseY + H * 0.55, -D/2, WINDOW_W, WINDOW_H, winC, trimC);

  // ── Uneven stoop: two cracked slabs at different heights ──
  parts.push({ geo: makeBoxGeo(DOOR_W + 0.40, 0.16, 0.55, -0.20, 0.08, D/2 + 0.30, 0, 0, -0.04), color: foundC });
  parts.push({ geo: makeBoxGeo(DOOR_W * 0.6, 0.20, 0.50,  0.40, 0.10, D/2 + 0.55, 0, 0, 0.05), color: foundC });

  // ── Yard debris: trash bag, scrap wood, an old tyre — scattered in the front yard ──
  // Trash bag (small dark blob)
  parts.push({ geo: makeBoxGeo(0.45, 0.30, 0.40, -W * 0.42, 0.15, D/2 + 1.20), color: 0x1a1816 });
  // Scrap wood planks (two tilted dark planks)
  parts.push({ geo: makeBoxGeo(1.20, 0.08, 0.18, W * 0.30, 0.05, D/2 + 0.95, 0, 0, 0.12), color: accentC });
  parts.push({ geo: makeBoxGeo(0.95, 0.08, 0.16, W * 0.36, 0.13, D/2 + 1.15, 0, 0, -0.08), color: 0x4a3a2a });
  // Tyre — a low cylinder approximated as a flat hex via two boxes
  parts.push({ geo: makeBoxGeo(0.55, 0.18, 0.55, -W * 0.20, 0.09, D/2 + 1.85), color: 0x141414 });
  parts.push({ geo: makeBoxGeo(0.40, 0.16, 0.40, -W * 0.20, 0.10, D/2 + 1.85), color: 0x4a4844 });

  // ── Broken / busted trim around the door (only the top piece) ──
  parts.push({ geo: makeBoxGeo(DOOR_W + 0.20, TRIM_THICK, 0.06, -0.08, baseY + DOOR_H + 0.04, D/2 + TRIM_PROUD, 0, 0, 0.06), color: trimC });
  // Lower-left trim is missing — only one vertical strip on the right side
  parts.push({ geo: makeBoxGeo(TRIM_THICK, DOOR_H, 0.06, DOOR_W/2 + 0.05, baseY + DOOR_H/2, D/2 + TRIM_PROUD), color: trimC });

  // ── Sagging roof: hip roof with one corner slightly lower ──
  const rise = 1.3;
  const overhang = ROOF_OVERHANG;
  const W2 = W + overhang*2, D2 = D + overhang*2;
  const sag = 0.06;
  const slopeLenX = Math.sqrt((W2/2)*(W2/2) + rise*rise);
  const slopeAngleX = Math.atan2(rise, W2/2);
  parts.push({ geo: makeBoxGeo(slopeLenX, ROOF_THICK, D2,  W2/4, baseY + H + rise/2 - 0.12, 0.10, 0, 0, -slopeAngleX + sag), color: roofC });
  parts.push({ geo: makeBoxGeo(slopeLenX, ROOF_THICK, D2, -W2/4, baseY + H + rise/2,        0,    0, 0,  slopeAngleX), color: roofC });
  const slopeLenZ = Math.sqrt((D2/2)*(D2/2) + rise*rise);
  const slopeAngleZ = Math.atan2(rise, D2/2);
  parts.push({ geo: makeBoxGeo(W2*0.7, ROOF_THICK, slopeLenZ, 0, baseY + H + rise/2 - 0.08,  D2/4,  slopeAngleZ - sag*0.5, 0, 0), color: roofC });
  parts.push({ geo: makeBoxGeo(W2*0.7, ROOF_THICK, slopeLenZ, 0, baseY + H + rise/2,        -D2/4, -slopeAngleZ,           0, 0), color: roofC });

  // ── Crooked, missing-piece chimney ──
  parts.push({ geo: makeBoxGeo(0.45, 1.2, 0.45, W * 0.20, baseY + H + 0.6, -D * 0.10, 0, 0, 0.08), color: 0x4e3228 });
  // Half-crumbled cap (offset)
  parts.push({ geo: makeBoxGeo(0.55, 0.08, 0.30, W * 0.20 - 0.10, baseY + H + 1.24, -D * 0.10, 0, 0, 0.08), color: 0x282624 });

  // ── Gutter with a broken section dangling at one end ──
  parts.push({ geo: makeBoxGeo(W * 0.55, 0.08, 0.10, -W * 0.05, baseY + H - 0.04, D/2 + 0.30), color: trimC });
  parts.push({ geo: makeBoxGeo(W * 0.25, 0.08, 0.10,  W * 0.40, baseY + H - 0.16, D/2 + 0.30, 0, 0, -0.20), color: trimC });

  // ── Partial corner trim — only 2 of 4 corners remaining (others peeled off) ──
  // Front-left and back-right corners only
  const _ctW = 0.18;
  const _ctOffsetX = W/2 + WALL_THICKNESS/2 - _ctW * 0.20;
  const _ctOffsetZ = D/2 + WALL_THICKNESS/2 - _ctW * 0.20;
  parts.push({ geo: makeBoxGeo(_ctW, H, _ctW, -_ctOffsetX, baseY + H/2,  _ctOffsetZ), color: trimC });
  parts.push({ geo: makeBoxGeo(_ctW, H, _ctW,  _ctOffsetX, baseY + H/2, -_ctOffsetZ), color: trimC });
  // Front-right trim half-broken (shorter, tilted)
  parts.push({ geo: makeBoxGeo(_ctW, H * 0.55, _ctW, _ctOffsetX, baseY + H * 0.30, _ctOffsetZ, 0, 0, 0.10), color: trimC });
  // Single hanging dangling shutter on the front-right (boarded) window — broken off, tilted
  parts.push({ geo: makeBoxGeo(0.30, 1.10, 0.04, W * 0.30 + WINDOW_W * 0.5 + 0.20, baseY + H * 0.40, D/2 + WALL_THICKNESS / 2 + 0.04, 0, 0, -0.6), color: accentC });
  // Sagging threshold (no proper one — just a single tilted board)
  parts.push({ geo: makeBoxGeo(DOOR_W + 0.10, 0.06, 0.18, 0, FOUNDATION_HEIGHT + 0.03, D/2 + 0.10, 0, 0, -0.05), color: foundC });
  // Dim, missing-bulb porch light (just the empty backplate, no lantern)
  parts.push({ geo: makeBoxGeo(0.16, 0.10, 0.04, -DOOR_W/2 - 0.30, baseY + DOOR_H * 0.85, D/2 + WALL_THICKNESS/2 + 0.02), color: trimC });

  const mesh = makeMergedMesh(parts);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return null;
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY || 0;

  const cosR = Math.cos(rotY || 0), sinR = Math.sin(rotY || 0);
  const sentinels = [];
  _wallSentinelsForBox(sentinels, W, D, H + 1.6, cosR, sinR, x, z, 0, false);
  const bbox = _obbWorldAABB(x, z, W/2, D/2, cosR, sinR, 0, H + 1.6);

  return { mesh, driveway: null, sentinels, bbox, footprint: { w: W, d: D, h: H }, doorOffset: { lx: 0, lz: D/2 } };
}

// ─── 5. CORNER STORE ────────────────────────────────────────────────────────
/** ~10w × 8d × 4.2h. Flat roof, wide storefront, rolldown shutter, sign fascia. */
export function makeCornerStore(x, z, rotY, seed) {
  const rng = mulberry32(seed);
  const P = PALETTES.commercial;
  const wallC  = pick(P.walls, rng);
  const roofC  = pick(P.roofs, rng);
  const trimC  = pick(P.trim, rng);
  const foundC = pick(P.foundation, rng);
  const doorC  = pick(P.door, rng);
  const winC   = pick(P.window, rng);
  const accentC= pick(P.accent, rng);

  const W = 10.0, D = 8.0, H = 4.2;
  const baseY = FOUNDATION_HEIGHT;
  const parts = [];

  _foundationParts(parts, W, D, foundC);
  // Sides + back solid
  _hollowSidesAndBack(parts, W, D, H, wallC);

  // ── Front: big storefront window area + entry door on one side ──
  // Door at right side of front, storefront window across the rest.
  const doorCx = W/2 - 1.3; // 1.3m from right edge
  const storeLeftEnd = -W/2;
  const storeRightEnd = doorCx - DOOR_W/2 - 0.2; // small pillar between door and store window
  // Bottom rail (kneewall ~0.6m tall under the storefront)
  const knee = 0.60;
  const storefrontW = storeRightEnd - storeLeftEnd;
  parts.push({ geo: makeBoxGeo(storefrontW, knee, WALL_THICKNESS, (storeLeftEnd + storeRightEnd)/2, baseY + knee/2, D/2), color: wallC });
  // Top header above storefront (between window top and roof)
  const winTop = H - 0.6;
  const headerH = H - winTop;
  parts.push({ geo: makeBoxGeo(storefrontW, headerH, WALL_THICKNESS, (storeLeftEnd + storeRightEnd)/2, baseY + winTop + headerH/2, D/2), color: wallC });
  // Pillar between door and storefront
  parts.push({ geo: makeBoxGeo(0.40, H, WALL_THICKNESS, storeRightEnd + 0.20, baseY + H/2, D/2), color: wallC });
  // Right edge strip (between door and right wall)
  const rightStripW = W/2 - (doorCx + DOOR_W/2);
  parts.push({ geo: makeBoxGeo(rightStripW, H, WALL_THICKNESS, doorCx + DOOR_W/2 + rightStripW/2, baseY + H/2, D/2), color: wallC });
  // Door lintel
  if (DOOR_H < H - 0.1) {
    parts.push({ geo: makeBoxGeo(DOOR_W, H - DOOR_H, WALL_THICKNESS, doorCx, baseY + DOOR_H + (H - DOOR_H)/2, D/2), color: wallC });
  }
  // Big storefront window (dark glass, recessed)
  const storeWinH = winTop - knee;
  parts.push({ geo: makeBoxGeo(storefrontW * 0.94, storeWinH * 0.96, 0.05, (storeLeftEnd + storeRightEnd)/2, baseY + knee + storeWinH/2, D/2 - WINDOW_RECESS), color: winC });
  // Vertical mullion (~3-4 dividers in the big window)
  const mullCount = 3;
  for (let i = 1; i <= mullCount; i++) {
    const t = i / (mullCount + 1);
    const mx = storeLeftEnd + storefrontW * t;
    parts.push({ geo: makeBoxGeo(0.08, storeWinH * 0.96, 0.05, mx, baseY + knee + storeWinH/2, D/2 - WINDOW_RECESS + 0.02), color: trimC });
  }
  // Rolldown shutter on the LEFT half of the storefront (~40% closed) — vertical strips
  const shutterEnd = storeLeftEnd + storefrontW * 0.42;
  const shutterDropY = baseY + knee + storeWinH * 0.60;
  for (let sx = storeLeftEnd + 0.10; sx < shutterEnd; sx += 0.18) {
    parts.push({ geo: makeBoxGeo(0.16, storeWinH * 0.55, 0.04, sx, shutterDropY, D/2 - WINDOW_RECESS + 0.04), color: trimC });
  }

  // Entry door
  parts.push({ geo: makeBoxGeo(DOOR_W - 0.02, DOOR_H - 0.04, 0.05, doorCx, baseY + DOOR_H/2, D/2 - WALL_THICKNESS/2 + 0.04), color: doorC });
  // Small door window
  parts.push({ geo: makeBoxGeo(DOOR_W * 0.6, DOOR_H * 0.35, 0.02, doorCx, baseY + DOOR_H * 0.7, D/2 - WALL_THICKNESS/2 + 0.07), color: winC });
  _doorTrimParts(parts, DOOR_W, DOOR_H, D/2 + WALL_THICKNESS/2, trimC);

  // ── Sign fascia above the storefront ──
  parts.push({ geo: makeBoxGeo(W * 0.9, 0.85, 0.18, 0, baseY + H + 0.45, D/2 + 0.10), color: accentC });
  // Sign trim border
  parts.push({ geo: makeBoxGeo(W * 0.92, 0.06, 0.10, 0, baseY + H + 0.88, D/2 + 0.16), color: trimC });
  parts.push({ geo: makeBoxGeo(W * 0.92, 0.06, 0.10, 0, baseY + H + 0.02, D/2 + 0.16), color: trimC });
  // Logo plate on the sign
  parts.push({ geo: makeBoxGeo(W * 0.34, 0.55, 0.04, -W * 0.14, baseY + H + 0.45, D/2 + 0.21), color: 0xc8b070 });
  // A second small smaller sign tag (price spec / open sign)
  parts.push({ geo: makeBoxGeo(0.85, 0.32, 0.04, W * 0.30, baseY + H + 0.40, D/2 + 0.21), color: 0xa84830 });

  // ── Fabric awning over the entry door ──
  _addAwning(parts, doorCx, baseY + DOOR_H + 0.10, D/2, 1.6, 0.85, 0x6a3022);

  // ── Wall-mount AC unit on the side (-X face) ──
  parts.push({ geo: makeBoxGeo(0.18, 0.55, 0.65, -W/2 - 0.10, baseY + H * 0.32, -D * 0.18), color: trimC });
  parts.push({ geo: makeBoxGeo(0.04, 0.45, 0.55, -W/2 - 0.20, baseY + H * 0.32, -D * 0.18), color: 0x1a1a1c });

  // ── Trash dumpster around back, against the back wall ──
  parts.push({ geo: makeBoxGeo(1.40, 1.10, 0.85, -W * 0.30, FOUNDATION_HEIGHT + 0.55, -D/2 - 0.50), color: 0x2a4a32 });
  parts.push({ geo: makeBoxGeo(1.45, 0.08, 0.90, -W * 0.30, FOUNDATION_HEIGHT + 1.12, -D/2 - 0.50), color: 0x1a2a1c });
  // Two cheap wheels under it
  parts.push({ geo: makeBoxGeo(0.14, 0.14, 0.16, -W * 0.30 - 0.50, FOUNDATION_HEIGHT + 0.07, -D/2 - 0.30), color: 0x141414 });
  parts.push({ geo: makeBoxGeo(0.14, 0.14, 0.16, -W * 0.30 + 0.50, FOUNDATION_HEIGHT + 0.07, -D/2 - 0.30), color: 0x141414 });

  // ── Roof-top mechanical (HVAC box) and a satellite dish ──
  parts.push({ geo: makeBoxGeo(1.40, 0.60, 1.10, W * 0.15, baseY + H + ROOF_THICK + 0.32, -D * 0.05), color: trimC });
  parts.push({ geo: makeBoxGeo(0.40, 0.04, 0.40, -W * 0.30, baseY + H + ROOF_THICK + 0.04, D * 0.20), color: 0x5a584c });
  parts.push({ geo: makeBoxGeo(0.05, 0.45, 0.05, -W * 0.30, baseY + H + ROOF_THICK + 0.28, D * 0.20), color: 0x5a584c });
  parts.push({ geo: makeBoxGeo(0.30, 0.30, 0.04, -W * 0.30, baseY + H + ROOF_THICK + 0.50, D * 0.16, 0.3, 0, 0), color: 0xb0aa9c });

  // ── House-number plate beside the door ──
  _addHouseNumber(parts, doorCx + DOOR_W/2 + 0.18, baseY + DOOR_H * 0.82, D/2, 0x141414);

  // ── Flat roof + parapet ──
  _flatRoofWithParapet(parts, W, D, baseY + H, roofC, trimC);

  const mesh = makeMergedMesh(parts);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return null;
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY || 0;

  const cosR = Math.cos(rotY || 0), sinR = Math.sin(rotY || 0);
  const sentinels = [];
  _wallSentinelsForBox(sentinels, W, D, H + 1.0, cosR, sinR, x, z, 0, false);
  const bbox = _obbWorldAABB(x, z, W/2, D/2, cosR, sinR, 0, H + 1.0);

  return { mesh, driveway: null, sentinels, bbox, footprint: { w: W, d: D, h: H }, doorOffset: { lx: doorCx, lz: D/2 } };
}

// ─── 6. LOW-RISE APARTMENT ──────────────────────────────────────────────────
/** ~12w × 9d × 9h. 3 storeys, flat roof with parapet, grid of windows,
 *  recessed entry with double-doors, fire escape on one side. */
export function makeLowRiseApartment(x, z, rotY, seed) {
  const rng = mulberry32(seed);
  const P = PALETTES.commercial;
  const wallC  = pick(P.walls, rng);
  const roofC  = pick(P.roofs, rng);
  const trimC  = pick(P.trim, rng);
  const foundC = pick(P.foundation, rng);
  const doorC  = pick(P.door, rng);
  const winC   = pick(P.window, rng);

  const W = 12.0, D = 9.0, H = 9.0;
  const baseY = FOUNDATION_HEIGHT;
  const storeyH = H / 3;
  const parts = [];

  _foundationParts(parts, W, D, foundC);
  _hollowSidesAndBack(parts, W, D, H, wallC);

  // ── Front wall with recessed double-door entry ──
  const entryW = 2.2;
  _frontWallWithDoor(parts, W, D, H, entryW, DOOR_H + 0.2, wallC);
  // Recessed entry: a small alcove (the wall is pushed back behind the entry)
  // We add a darker shadow panel where the recess would be.
  parts.push({ geo: makeBoxGeo(entryW + 0.20, DOOR_H + 0.30, 0.05, 0, baseY + (DOOR_H + 0.30)/2, D/2 - 0.10), color: 0x18181a });
  // Two door slabs (left + right) for the double door
  parts.push({ geo: makeBoxGeo(entryW/2 - 0.05, DOOR_H, 0.05, -entryW/4, baseY + DOOR_H/2, D/2 - 0.05), color: doorC });
  parts.push({ geo: makeBoxGeo(entryW/2 - 0.05, DOOR_H, 0.05,  entryW/4, baseY + DOOR_H/2, D/2 - 0.05), color: doorC });
  // Door glass insets
  parts.push({ geo: makeBoxGeo(entryW/2 - 0.30, DOOR_H * 0.55, 0.02, -entryW/4, baseY + DOOR_H * 0.65, D/2 - 0.02), color: winC });
  parts.push({ geo: makeBoxGeo(entryW/2 - 0.30, DOOR_H * 0.55, 0.02,  entryW/4, baseY + DOOR_H * 0.65, D/2 - 0.02), color: winC });
  // Frame
  _doorTrimParts(parts, entryW, DOOR_H + 0.05, D/2 + WALL_THICKNESS/2, trimC);
  // Entry awning/canopy
  parts.push({ geo: makeBoxGeo(entryW + 1.0, 0.16, 0.90, 0, baseY + DOOR_H + 0.50, D/2 + 0.40), color: roofC });

  // ── Front windows: 3 per storey × 3 storeys (skipping the centre column on storey 1 because of entry) ──
  const winCols = 4;
  for (let storey = 0; storey < 3; storey++) {
    const wy = baseY + storey * storeyH + storeyH * 0.55;
    for (let c = 0; c < winCols; c++) {
      const wx = -W/2 + W * ((c + 1) / (winCols + 1));
      // Skip the centre two columns on the ground floor where the entry is
      if (storey === 0 && Math.abs(wx) < entryW * 0.7) continue;
      _windowParts(parts, wx, wy, D/2, WINDOW_W * 0.85, WINDOW_H * 0.95, winC, trimC);
    }
  }
  // ── Back windows (full grid) ──
  for (let storey = 0; storey < 3; storey++) {
    const wy = baseY + storey * storeyH + storeyH * 0.55;
    for (let c = 0; c < winCols; c++) {
      const wx = -W/2 + W * ((c + 1) / (winCols + 1));
      _windowPartsBack(parts, wx, wy, -D/2, WINDOW_W * 0.85, WINDOW_H * 0.95, winC, trimC);
    }
  }
  // ── Side windows (2 per storey × 3 storeys, each side) ──
  for (let storey = 0; storey < 3; storey++) {
    const wy = baseY + storey * storeyH + storeyH * 0.55;
    for (const lz of [-D * 0.22, D * 0.22]) {
      _windowPartsLeft(parts, lz, wy, -W/2, WINDOW_W * 0.85, WINDOW_H * 0.95, winC, trimC);
      _windowPartsRight(parts, lz, wy, W/2, WINDOW_W * 0.85, WINDOW_H * 0.95, winC, trimC);
    }
  }

  // ── Fire escape on right side (+X): 3 platforms with thin ladders between them ──
  const feX = W/2 + 0.30;
  const feZ = 0; // centred on the side
  const platW = 1.30, platD = 0.55;
  for (let storey = 1; storey < 3; storey++) {
    const py = baseY + storey * storeyH + 0.30;
    // Platform
    parts.push({ geo: makeBoxGeo(platD, 0.08, platW, feX, py, feZ), color: 0x1a1a18 });
    // Front + back rail (thin)
    parts.push({ geo: makeBoxGeo(0.04, 0.85, platW, feX + platD/2 - 0.02, py + 0.45, feZ), color: 0x1a1a18 });
    // Side rails
    parts.push({ geo: makeBoxGeo(platD, 0.85, 0.04, feX, py + 0.45, feZ - platW/2 + 0.02), color: 0x1a1a18 });
    parts.push({ geo: makeBoxGeo(platD, 0.85, 0.04, feX, py + 0.45, feZ + platW/2 - 0.02), color: 0x1a1a18 });
    // Ladder up to this platform (skip on bottom)
    const ladderY = py - storeyH * 0.45;
    parts.push({ geo: makeBoxGeo(0.05, storeyH * 0.95, 0.06, feX - 0.04, ladderY, feZ - platW/2 + 0.15), color: 0x1a1a18 });
    parts.push({ geo: makeBoxGeo(0.05, storeyH * 0.95, 0.06, feX - 0.04, ladderY, feZ + platW/2 - 0.15), color: 0x1a1a18 });
    // Rungs
    for (let r = 0; r < 6; r++) {
      const ry = ladderY - storeyH * 0.45 + r * storeyH * 0.18;
      parts.push({ geo: makeBoxGeo(0.05, 0.04, platW - 0.30, feX - 0.04, ry, feZ), color: 0x1a1a18 });
    }
  }

  // ── Window-mount AC units jutting out of a few units (visible weathering) ──
  for (const [wx, sy, sd] of [
    [-W * 0.30, 1, +1], [W * 0.30, 0, -1], [-W * 0.05, 2, +1], [W * 0.05, 1, -1],
  ]) {
    const wy = baseY + sy * storeyH + storeyH * 0.32;
    const wz = sd > 0 ? D/2 + 0.10 : -D/2 - 0.10;
    parts.push({ geo: makeBoxGeo(0.55, 0.30, 0.32, wx, wy, wz), color: 0x9a958c });
    parts.push({ geo: makeBoxGeo(0.45, 0.22, 0.06, wx, wy, wz + (sd > 0 ? 0.18 : -0.18)), color: 0x1a1a1c });
  }

  // ── Downpipes on the corners (rain drainage from the parapet) ──
  for (const [px, pz] of [[-W/2 - 0.08, D/2 - 0.20], [W/2 + 0.08, -D/2 + 0.20]]) {
    parts.push({ geo: makeBoxGeo(0.10, H, 0.10, px, baseY + H/2, pz), color: trimC });
    // Drain hopper at top
    parts.push({ geo: makeBoxGeo(0.18, 0.18, 0.18, px, baseY + H - 0.10, pz), color: trimC });
  }

  // ── Front entry house-number / unit number plate ──
  _addHouseNumber(parts, entryW/2 + 0.25, baseY + DOOR_H + 0.10, D/2, 0x141414);

  // ── Flat roof + parapet ──
  _flatRoofWithParapet(parts, W, D, baseY + H, roofC, trimC);
  // ── Roof clutter: bigger HVAC unit + satellite dishes + smaller boxes ──
  // Main HVAC enclosure
  parts.push({ geo: makeBoxGeo(W * 0.30, 0.85, D * 0.32, W * 0.18, baseY + H + ROOF_THICK + 0.45, -D * 0.18), color: trimC });
  parts.push({ geo: makeBoxGeo(W * 0.30 + 0.08, 0.08, D * 0.32 + 0.08, W * 0.18, baseY + H + ROOF_THICK + 0.90, -D * 0.18), color: 0x1c1c1e });
  // Vent stacks on the HVAC
  parts.push({ geo: makeBoxGeo(0.20, 0.45, 0.20, W * 0.10, baseY + H + ROOF_THICK + 1.10, -D * 0.10), color: 0x1c1c1e });
  parts.push({ geo: makeBoxGeo(0.20, 0.45, 0.20, W * 0.26, baseY + H + ROOF_THICK + 1.10, -D * 0.26), color: 0x1c1c1e });
  // Two satellite dishes (poles + dish plates)
  for (const [sx, sz] of [[-W * 0.32, D * 0.28], [-W * 0.12, D * 0.22]]) {
    parts.push({ geo: makeBoxGeo(0.06, 0.60, 0.06, sx, baseY + H + ROOF_THICK + 0.30, sz), color: trimC });
    parts.push({ geo: makeBoxGeo(0.42, 0.04, 0.42, sx + 0.05, baseY + H + ROOF_THICK + 0.62, sz, 0.35, 0, 0), color: 0xb0aa9c });
  }
  // A few small mechanical boxes / lit signs
  parts.push({ geo: makeBoxGeo(0.40, 0.30, 0.40, -W * 0.32, baseY + H + ROOF_THICK + 0.20, -D * 0.30), color: 0x404040 });

  const mesh = makeMergedMesh(parts);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return null;
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY || 0;

  const cosR = Math.cos(rotY || 0), sinR = Math.sin(rotY || 0);
  const sentinels = [];
  _wallSentinelsForBox(sentinels, W, D, H + 1.6, cosR, sinR, x, z, 0, false);
  const bbox = _obbWorldAABB(x, z, W/2, D/2, cosR, sinR, 0, H + 1.6);

  return { mesh, driveway: null, sentinels, bbox, footprint: { w: W, d: D, h: H }, doorOffset: { lx: 0, lz: D/2 } };
}

// ─── 7. WAREHOUSE ───────────────────────────────────────────────────────────
/** ~14w × 11d × 6.5h. Corrugated-look walls (vertical strips), big roll-up door,
 *  flat roof, few windows. */
export function makeWarehouse(x, z, rotY, seed) {
  const rng = mulberry32(seed);
  const P = PALETTES.industrial;
  const baseWallC = pick(P.walls, rng);
  const altWallC  = pick(P.walls_alt, rng);
  const roofC  = pick(P.roofs, rng);
  const trimC  = pick(P.trim, rng);
  const foundC = pick(P.foundation, rng);
  const doorC  = pick(P.door, rng);
  const winC   = pick(P.window, rng);

  const W = 14.0, D = 11.0, H = 6.5;
  const baseY = FOUNDATION_HEIGHT;
  const parts = [];

  _foundationParts(parts, W, D, foundC);

  // ── Corrugated walls: vertical strips alternating between two greys ──
  const STRIP = 0.5; // strip width
  // Left wall (-X face): strips along Z
  for (let lz = -D/2; lz < D/2 - 0.001; lz += STRIP) {
    const c = (Math.floor((lz + 100) / STRIP) % 2 === 0) ? baseWallC : altWallC;
    const ww = Math.min(STRIP, D/2 - lz);
    parts.push({ geo: makeBoxGeo(WALL_THICKNESS, H, ww, -W/2, baseY + H/2, lz + ww/2), color: c });
  }
  // Right wall (+X face)
  for (let lz = -D/2; lz < D/2 - 0.001; lz += STRIP) {
    const c = (Math.floor((lz + 100) / STRIP) % 2 === 0) ? baseWallC : altWallC;
    const ww = Math.min(STRIP, D/2 - lz);
    parts.push({ geo: makeBoxGeo(WALL_THICKNESS, H, ww, W/2, baseY + H/2, lz + ww/2), color: c });
  }
  // Back wall (-Z face)
  for (let lx = -W/2; lx < W/2 - 0.001; lx += STRIP) {
    const c = (Math.floor((lx + 100) / STRIP) % 2 === 0) ? baseWallC : altWallC;
    const ww = Math.min(STRIP, W/2 - lx);
    parts.push({ geo: makeBoxGeo(ww, H, WALL_THICKNESS, lx + ww/2, baseY + H/2, -D/2), color: c });
  }
  // Front wall with a big roll-up door centred
  const rollW = 4.5, rollH = 4.2;
  const rollCx = 0;
  // Left strip (full height) - corrugated
  const leftEnd = rollCx - rollW/2;
  for (let lx = -W/2; lx < leftEnd; lx += STRIP) {
    const c = (Math.floor((lx + 100) / STRIP) % 2 === 0) ? baseWallC : altWallC;
    const ww = Math.min(STRIP, leftEnd - lx);
    parts.push({ geo: makeBoxGeo(ww, H, WALL_THICKNESS, lx + ww/2, baseY + H/2, D/2), color: c });
  }
  // Right strip (full height) - corrugated
  const rightStart = rollCx + rollW/2;
  for (let lx = rightStart; lx < W/2 - 0.001; lx += STRIP) {
    const c = (Math.floor((lx + 100) / STRIP) % 2 === 0) ? baseWallC : altWallC;
    const ww = Math.min(STRIP, W/2 - lx);
    parts.push({ geo: makeBoxGeo(ww, H, WALL_THICKNESS, lx + ww/2, baseY + H/2, D/2), color: c });
  }
  // Lintel above the roll-up door
  parts.push({ geo: makeBoxGeo(rollW, H - rollH, WALL_THICKNESS, rollCx, baseY + rollH + (H - rollH)/2, D/2), color: baseWallC });

  // ── Roll-up door — horizontal slat panels ──
  const slats = 14;
  for (let i = 0; i < slats; i++) {
    const slatH = rollH / slats;
    const py = baseY + slatH/2 + i * slatH;
    parts.push({ geo: makeBoxGeo(rollW - 0.06, slatH * 0.85, 0.06, rollCx, py, D/2 - WALL_THICKNESS/2 + 0.04), color: doorC });
  }
  // Door frame
  parts.push({ geo: makeBoxGeo(rollW + 0.30, 0.18, 0.10, rollCx, baseY + rollH + 0.04, D/2 + 0.05), color: trimC });
  parts.push({ geo: makeBoxGeo(0.18, rollH, 0.10, rollCx - rollW/2 - 0.05, baseY + rollH/2, D/2 + 0.05), color: trimC });
  parts.push({ geo: makeBoxGeo(0.18, rollH, 0.10, rollCx + rollW/2 + 0.05, baseY + rollH/2, D/2 + 0.05), color: trimC });

  // ── A few high windows along the sides ──
  for (const lz of [-D * 0.25, 0, D * 0.25]) {
    _windowPartsLeft(parts, lz, baseY + H * 0.80, -W/2, WINDOW_W * 0.7, WINDOW_H * 0.6, winC, trimC);
    _windowPartsRight(parts, lz, baseY + H * 0.80, W/2, WINDOW_W * 0.7, WINDOW_H * 0.6, winC, trimC);
  }

  // ── Loading dock to the side of the roll-up door (raised concrete platform) ──
  const dockH = 1.10;
  const dockW = 3.0;
  const dockD = 1.80;
  const dockCx = rollCx + rollW/2 + dockW/2 + 0.5; // right of the roll-up door
  parts.push({ geo: makeBoxGeo(dockW, dockH, dockD, dockCx, dockH/2, D/2 + dockD/2), color: foundC });
  // Yellow-edged bumper strip along the front of the dock
  parts.push({ geo: makeBoxGeo(dockW + 0.06, 0.12, 0.08, dockCx, dockH - 0.10, D/2 + dockD - 0.02), color: 0xb09030 });
  // Steel ladder/steps up the side
  for (let s = 0; s < 3; s++) {
    parts.push({ geo: makeBoxGeo(0.50, 0.10, 0.40, dockCx - dockW/2 - 0.30, 0.12 + s * 0.32, D/2 + dockD/2), color: trimC });
  }
  // A small personnel door beside the dock (for workers)
  parts.push({ geo: makeBoxGeo(DOOR_W * 0.9, DOOR_H, WALL_THICKNESS + 0.04, dockCx + dockW/2 + 1.10, baseY + DOOR_H/2, D/2), color: doorC });
  parts.push({ geo: makeBoxGeo(DOOR_W * 1.05, TRIM_THICK, 0.05, dockCx + dockW/2 + 1.10, baseY + DOOR_H + 0.04, D/2 + TRIM_PROUD), color: trimC });

  // ── Painted address number on the front wall, large ──
  parts.push({ geo: makeBoxGeo(0.80, 1.00, 0.04, -W * 0.35, baseY + H * 0.55, D/2 + 0.04), color: 0x141414 });

  // ── Side electrical conduit / breaker box ──
  parts.push({ geo: makeBoxGeo(0.35, 0.60, 0.20, -W/2 - 0.10, baseY + H * 0.30, D * 0.30), color: 0x4a4844 });
  parts.push({ geo: makeBoxGeo(0.08, H * 0.40, 0.08, -W/2 - 0.04, baseY + H * 0.50, D * 0.30), color: trimC });

  // ── Flat roof + low parapet ──
  _flatRoofWithParapet(parts, W, D, baseY + H, roofC, trimC);
  // ── Roof-top mechanical clutter ──
  // Big HVAC unit
  parts.push({ geo: makeBoxGeo(W * 0.22, 0.75, D * 0.25, 0, baseY + H + ROOF_THICK + 0.40, -D * 0.15), color: trimC });
  parts.push({ geo: makeBoxGeo(W * 0.22 + 0.06, 0.06, D * 0.25 + 0.06, 0, baseY + H + ROOF_THICK + 0.80, -D * 0.15), color: 0x1c1c1e });
  // Smaller vents scattered
  for (let i = 0; i < 5; i++) {
    const vx = -W * 0.35 + (i % 3) * W * 0.30;
    const vz = (i < 3 ? D * 0.20 : -D * 0.32);
    parts.push({ geo: makeBoxGeo(0.45, 0.30, 0.45, vx, baseY + H + ROOF_THICK + 0.18, vz), color: trimC });
  }
  // Vent stacks (tall thin)
  for (let i = 0; i < 2; i++) {
    parts.push({ geo: makeBoxGeo(0.18, 0.80, 0.18, W * 0.30 - i * 0.45, baseY + H + ROOF_THICK + 0.42, D * 0.30), color: 0x1c1c1e });
  }

  const mesh = makeMergedMesh(parts);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return null;
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY || 0;

  const cosR = Math.cos(rotY || 0), sinR = Math.sin(rotY || 0);
  const sentinels = [];
  _wallSentinelsForBox(sentinels, W, D, H + 1.0, cosR, sinR, x, z, 0, false);
  const bbox = _obbWorldAABB(x, z, W/2, D/2, cosR, sinR, 0, H + 1.0);

  return { mesh, driveway: null, sentinels, bbox, footprint: { w: W, d: D, h: H }, doorOffset: { lx: 0, lz: D/2 } };
}

// ─── 8. GAS STATION ─────────────────────────────────────────────────────────
/** Building ~5.5w × 5.5d × 3.5h + canopy ~7w × 7d on 4 posts.
 *  The canopy footprint sits IN FRONT of the building (toward +Z). */
export function makeGasStation(x, z, rotY, seed) {
  const rng = mulberry32(seed);
  const P = PALETTES.gas;
  const wallC  = pick(P.walls, rng);
  const roofC  = pick(P.roofs, rng);
  const trimC  = pick(P.trim, rng);
  const foundC = pick(P.foundation, rng);
  const doorC  = pick(P.door, rng);
  const winC   = pick(P.window, rng);
  const accentC= pick(P.accent, rng);
  const canopyC= pick(P.canopy, rng);
  const pumpC  = pick(P.pump, rng);

  const W = 5.5, D = 5.5, H = 3.5;
  const baseY = FOUNDATION_HEIGHT;
  const parts = [];

  // ── Building ──
  _foundationParts(parts, W, D, foundC);
  _hollowSidesAndBack(parts, W, D, H, wallC);
  // Front wall: door on right, big window on left
  const doorCx = W * 0.30;
  // Strip left of window all the way to left edge: storefront window
  const winLeftEnd = -W/2;
  const winRightEnd = doorCx - DOOR_W/2 - 0.25;
  const winW2 = winRightEnd - winLeftEnd;
  const knee = 0.55;
  // Kneewall + header for storefront window
  parts.push({ geo: makeBoxGeo(winW2, knee, WALL_THICKNESS, (winLeftEnd + winRightEnd)/2, baseY + knee/2, D/2), color: wallC });
  const winTop = H - 0.5;
  const headerH = H - winTop;
  parts.push({ geo: makeBoxGeo(winW2, headerH, WALL_THICKNESS, (winLeftEnd + winRightEnd)/2, baseY + winTop + headerH/2, D/2), color: wallC });
  // Pillar between window and door
  parts.push({ geo: makeBoxGeo(0.40, H, WALL_THICKNESS, winRightEnd + 0.20, baseY + H/2, D/2), color: wallC });
  // Right strip
  const rStripW = W/2 - (doorCx + DOOR_W/2);
  parts.push({ geo: makeBoxGeo(rStripW, H, WALL_THICKNESS, doorCx + DOOR_W/2 + rStripW/2, baseY + H/2, D/2), color: wallC });
  // Door lintel
  if (DOOR_H < H - 0.1) {
    parts.push({ geo: makeBoxGeo(DOOR_W, H - DOOR_H, WALL_THICKNESS, doorCx, baseY + DOOR_H + (H - DOOR_H)/2, D/2), color: wallC });
  }
  // Storefront window
  const swH = winTop - knee;
  parts.push({ geo: makeBoxGeo(winW2 * 0.94, swH * 0.96, 0.05, (winLeftEnd + winRightEnd)/2, baseY + knee + swH/2, D/2 - WINDOW_RECESS), color: winC });
  // Mullions
  for (let i = 1; i <= 2; i++) {
    const mx = winLeftEnd + winW2 * i / 3;
    parts.push({ geo: makeBoxGeo(0.08, swH * 0.96, 0.05, mx, baseY + knee + swH/2, D/2 - WINDOW_RECESS + 0.02), color: trimC });
  }
  // Door + small window in door
  parts.push({ geo: makeBoxGeo(DOOR_W - 0.02, DOOR_H - 0.02, 0.05, doorCx, baseY + DOOR_H/2, D/2 - WALL_THICKNESS/2 + 0.04), color: doorC });
  parts.push({ geo: makeBoxGeo(DOOR_W * 0.6, DOOR_H * 0.35, 0.02, doorCx, baseY + DOOR_H * 0.7, D/2 - WALL_THICKNESS/2 + 0.07), color: winC });
  _doorTrimParts(parts, DOOR_W, DOOR_H, D/2 + WALL_THICKNESS/2, trimC);

  // ── Branded sign fascia (red stripe) across the top of the front wall ──
  parts.push({ geo: makeBoxGeo(W * 0.95, 0.45, 0.10, 0, baseY + H + 0.25, D/2 + 0.06), color: accentC });

  // ── Flat roof + parapet ──
  _flatRoofWithParapet(parts, W, D, baseY + H, roofC, trimC);

  // ── Canopy (separate structure in front of building) ──
  // Canopy positioned at z = D/2 + canopyOffset + canopyD/2 from building origin
  const canopyW = 7.5, canopyD = 7.0;
  const canopyOffset = 1.5;          // gap between building front and canopy
  const canopyCz = D/2 + canopyOffset + canopyD/2;
  const canopyY = 4.6;               // canopy underside height
  const canopyThick = 0.30;
  // Roof slab
  parts.push({ geo: makeBoxGeo(canopyW, canopyThick, canopyD, 0, canopyY + canopyThick/2, canopyCz), color: canopyC });
  // Red top trim band
  parts.push({ geo: makeBoxGeo(canopyW + 0.10, 0.30, canopyD + 0.10, 0, canopyY + canopyThick + 0.10, canopyCz), color: accentC });
  // 4 thin posts
  const postR = 0.14;
  const cpHalfW = canopyW * 0.42;
  const cpHalfD = canopyD * 0.42;
  for (const [px, pz] of [[-cpHalfW, canopyCz - cpHalfD], [cpHalfW, canopyCz - cpHalfD], [-cpHalfW, canopyCz + cpHalfD], [cpHalfW, canopyCz + cpHalfD]]) {
    parts.push({ geo: makeBoxGeo(postR * 2, canopyY, postR * 2, px, canopyY/2, pz), color: trimC });
  }

  // ── Two pumps under the canopy ──
  for (const px of [-1.8, 1.8]) {
    // Pump body
    parts.push({ geo: makeBoxGeo(0.50, 1.40, 0.80, px, 0.70, canopyCz), color: pumpC });
    // Display panel (dark)
    parts.push({ geo: makeBoxGeo(0.45, 0.40, 0.04, px, 1.20, canopyCz + 0.42), color: 0x0a0a0a });
    // Display screen highlight
    parts.push({ geo: makeBoxGeo(0.36, 0.18, 0.02, px, 1.26, canopyCz + 0.45), color: 0x447a4a });
    // Nozzle holster
    parts.push({ geo: makeBoxGeo(0.12, 0.30, 0.14, px + 0.28, 1.05, canopyCz + 0.35), color: 0x1a1a1c });
    // Hose (curved, approximated as a short tilted box)
    parts.push({ geo: makeBoxGeo(0.06, 0.50, 0.06, px + 0.28, 0.75, canopyCz + 0.34, 0, 0, -0.35), color: 0x141414 });
    // Concrete island under pump
    parts.push({ geo: makeBoxGeo(0.90, 0.18, 1.30, px, 0.09, canopyCz), color: foundC });
  }

  // ── Tall price-sign pole at the corner of the lot ──
  const poleX = -W/2 - 2.2;
  const poleZ = D/2 + canopyOffset + canopyD/2;
  const poleH = 5.5;
  parts.push({ geo: makeBoxGeo(0.18, poleH, 0.18, poleX, poleH/2, poleZ), color: trimC });
  // Sign panel on top
  parts.push({ geo: makeBoxGeo(2.20, 1.40, 0.16, poleX, poleH - 0.30, poleZ), color: accentC });
  // White price digit panels (3 horizontal strips)
  for (let r = 0; r < 3; r++) {
    parts.push({ geo: makeBoxGeo(1.80, 0.30, 0.04, poleX, poleH - 0.10 - r * 0.36, poleZ + 0.10), color: 0xece4cc });
  }
  // Sign frame trim
  parts.push({ geo: makeBoxGeo(2.30, 0.08, 0.18, poleX, poleH + 0.46, poleZ), color: trimC });
  parts.push({ geo: makeBoxGeo(2.30, 0.08, 0.18, poleX, poleH - 1.06, poleZ), color: trimC });

  // ── Oil drums stacked near the building's side wall ──
  for (let i = 0; i < 3; i++) {
    const dx = -W/2 - 0.55;
    const dz = -D/4 + i * 0.62;
    // 0.56-tall drum (cylinder approximated by box for vertex-color simplicity)
    parts.push({ geo: makeBoxGeo(0.50, 0.56, 0.50, dx, 0.28, dz), color: 0x4a4a48 });
    parts.push({ geo: makeBoxGeo(0.52, 0.06, 0.52, dx, 0.56, dz), color: 0x202020 });
    parts.push({ geo: makeBoxGeo(0.52, 0.06, 0.52, dx, 0.04, dz), color: 0x202020 });
    // Red stripe band
    parts.push({ geo: makeBoxGeo(0.52, 0.08, 0.52, dx, 0.30, dz), color: 0xa02818 });
  }

  // ── Ice / propane cabinet against the front wall (right of door) ──
  parts.push({ geo: makeBoxGeo(0.80, 1.50, 0.55, W * 0.40, baseY + 0.75, D/2 + 0.30), color: 0xe4e4e4 });
  parts.push({ geo: makeBoxGeo(0.70, 1.10, 0.04, W * 0.40, baseY + 0.65, D/2 + 0.60), color: 0x202020 });

  // ── House-number / address plate beside door ──
  _addHouseNumber(parts, doorCx + DOOR_W/2 + 0.18, baseY + DOOR_H * 0.82, D/2, 0x141414);

  const mesh = makeMergedMesh(parts);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return null;
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY || 0;

  const cosR = Math.cos(rotY || 0), sinR = Math.sin(rotY || 0);
  const sentinels = [];
  _wallSentinelsForBox(sentinels, W, D, H + 1.0, cosR, sinR, x, z, 0, false);
  // Solid bbox covers both the building and the canopy footprint so the
  // player can't walk through the pumps.
  const bbox = _obbWorldAABB(x, z + (D/2 + canopyOffset + canopyD/2) * 0.4, W/2 + 0.5, D/2 + canopyD * 0.6, cosR, sinR, 0, H + 1.0);

  return { mesh, driveway: null, sentinels, bbox, footprint: { w: Math.max(W, canopyW), d: D + canopyOffset + canopyD, h: H }, doorOffset: { lx: doorCx, lz: D/2 } };
}

// ─── DRIVEWAY ───────────────────────────────────────────────────────────────
/** Flat slab connecting a building's front to the road. (x, z) is the centre
 *  of the slab in world space; rotY rotates the slab. Width is along local X,
 *  depth (toward the road) is along local Z. */
export function makeDriveway(x, z, rotY, width, depth, seed) {
  const rng = mulberry32(seed || 0);
  const surfaceC = pick(PALETTES.driveway.surface, rng);
  const parts = [];
  // Main slab
  parts.push({ geo: makeBoxGeo(width, 0.10, depth, 0, 0.05, 0), color: surfaceC });
  // Subtle border strip on the long edges (a touch lighter)
  const edgeC = (surfaceC + 0x0a0a0a) & 0x9c9c9c | 0x484848;
  parts.push({ geo: makeBoxGeo(0.08, 0.12, depth, -width/2 + 0.05, 0.06, 0), color: edgeC });
  parts.push({ geo: makeBoxGeo(0.08, 0.12, depth,  width/2 - 0.05, 0.06, 0), color: edgeC });
  const mesh = makeMergedMesh(parts);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return null;
  mesh.position.set(x, SIDEWALK_LIP, z);
  mesh.rotation.y = rotY || 0;
  // Drivable surface — caller will register as a `ground` bbox so players
  // walk on top (not through) and the height sample picks the slab.
  return mesh;
}

// ─── DISPATCHER ─────────────────────────────────────────────────────────────
const _DISPATCH = {
  ranch:     makeRanchHouse,
  twoStory:  makeTwoStoryHouse,
  bungalow:  makeBungalow,
  rundown:   makeRundownHouse,
  store:     makeCornerStore,
  apartment: makeLowRiseApartment,
  warehouse: makeWarehouse,
  gas:       makeGasStation,
};

/** Build a single building by name. Returns the variant's BuildResult.
 *  `deps` may contain { sampleTerrainHeight } so this helper can lift the
 *  mesh and sentinels onto terrain in one call. */
export function placeBuilding(type, x, z, rotY, seed, deps = {}) {
  const fn = _DISPATCH[type];
  if (!fn) throw new Error(`placeBuilding: unknown type "${type}"`);
  const res = fn(x, z, rotY, seed);
  if (!res) return null;
  const sampleY = deps.sampleTerrainHeight ? deps.sampleTerrainHeight(x, z) : 0;
  res.groundY = sampleY;
  res.mesh.position.y = sampleY;
  // Lift sentinels and bbox to match terrain
  for (const s of res.sentinels) {
    s.userData.bbox.min.y += sampleY;
    s.userData.bbox.max.y += sampleY;
  }
  if (res.bbox) {
    res.bbox.min.y += sampleY;
    res.bbox.max.y += sampleY;
  }
  return res;
}

// ─── NEIGHBORHOOD ───────────────────────────────────────────────────────────
/** Build a grid of lots filled with buildings + driveways. Returns an array
 *  of BuildResults so the caller can scene.add() each one and feed sentinels
 *  into the LOS array. Roads are NOT drawn here — the caller renders streets
 *  using the gaps between rows/cols.
 *
 *  config:
 *    originX, originZ : world position of the block centre
 *    rows, cols       : grid dimensions
 *    lotWidth, lotDepth : per-lot footprint (must comfortably fit buildings)
 *    roadWidth        : gap between rows / between cols
 *    seed             : seed for variation
 *    typeMixer(row,col,rows,cols,rng) -> type   (optional)
 *      If omitted, a sensible default mix: corner lots get stores/apartments,
 *      edge lots get warehouses or apartments, interior lots get residential.
 */
export function generateNeighborhood(config, deps = {}) {
  const {
    originX = 0, originZ = 0,
    rows = 3, cols = 4,
    lotWidth = 16, lotDepth = 14,
    roadWidth = 8,
    seed = 1,
    typeMixer = null,
  } = config;

  const rng = mulberry32(seed);
  const blockW = cols * lotWidth + (cols - 1) * roadWidth;
  const blockD = rows * lotDepth + (rows - 1) * roadWidth;
  const startX = originX - blockW / 2 + lotWidth / 2;
  const startZ = originZ - blockD / 2 + lotDepth / 2;

  const out = [];

  function defaultMixer(r, c, R, C, _rng) {
    const isCorner = (r === 0 || r === R - 1) && (c === 0 || c === C - 1);
    const isEdge   = (r === 0 || r === R - 1 || c === 0 || c === C - 1);
    if (isCorner) {
      return _rng() < 0.5 ? 'store' : 'apartment';
    }
    if (isEdge) {
      const r2 = _rng();
      if (r2 < 0.25) return 'warehouse';
      if (r2 < 0.40) return 'gas';
      if (r2 < 0.65) return 'apartment';
      return r2 < 0.85 ? 'twoStory' : 'ranch';
    }
    // Interior — pure residential mix
    const r3 = _rng();
    if (r3 < 0.30) return 'ranch';
    if (r3 < 0.55) return 'twoStory';
    if (r3 < 0.78) return 'bungalow';
    return 'rundown';
  }

  const mixer = typeMixer || defaultMixer;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lotCx = startX + c * (lotWidth + roadWidth);
      const lotCz = startZ + r * (lotDepth + roadWidth);
      // Sub-rng for this lot (deterministic but per-lot)
      const lotSeed = (seed * 0x9E37 + r * 7919 + c * 6151) | 0;
      const lotRng = mulberry32(lotSeed);
      const type = mixer(r, c, rows, cols, lotRng);

      // Building faces the nearest road. Default = +Z (south). For edge lots,
      // pick the closer outer edge. For interior, +Z by default.
      let rotY = 0;
      if (r === 0)                rotY = Math.PI;     // top row faces -Z (toward road above) → rotate 180 so front +Z points -Z world... wait
      // The building's "front" is +Z in local space. To face it toward +Z world, rotY = 0.
      // To face it toward -Z world (i.e. front of building points up the page), rotY = π.
      // For a row at the top of the block (r=0), the road is above (smaller Z = more negative);
      //   we want the building's front to point toward -Z → rotY = π.
      // For the bottom row (r = rows-1), the road is below; front points +Z → rotY = 0.
      // For interior rows, alternate (front faces road across the gap to the road between r and r-1
      //   or r and r+1 — we pick the nearer based on a stable rule).
      if (r === 0) {
        rotY = Math.PI;
      } else if (r === rows - 1) {
        rotY = 0;
      } else {
        // Alternate: even r faces +Z, odd faces -Z (so adjacent rows face each other across the road)
        rotY = (r % 2 === 0) ? 0 : Math.PI;
      }
      // For leftmost / rightmost columns, prefer facing along X instead (corner stores etc.)
      if (type === 'store' || type === 'gas' || type === 'apartment') {
        // Corners face out to the nearer perimeter road
        if (c === 0)               rotY = -Math.PI / 2;  // face -X
        else if (c === cols - 1)   rotY =  Math.PI / 2;  // face +X
      }

      const built = placeBuilding(type, lotCx, lotCz, rotY, lotSeed, deps);
      if (!built) continue;

      // ── Driveway ──
      // The driveway extends from the building's front toward the road. Some
      // variants (ranch) anchor the driveway at the GARAGE in local-X rather
      // than the building centre; honour their drivewayAnchor when provided.
      const cosR = Math.cos(rotY), sinR = Math.sin(rotY);
      const frontX = Math.sin(rotY);      // +Z in local → world (sin(rotY), 0, cos(rotY))
      const frontZ = Math.cos(rotY);
      const fp = built.footprint;
      const drvLx = built.drivewayAnchor ? built.drivewayAnchor.lx : 0;
      let driveWidth, driveDepth;
      if (type === 'store' || type === 'apartment' || type === 'warehouse' || type === 'gas') {
        driveWidth = Math.min(lotWidth * 0.75, fp.w * 1.10);
        driveDepth = roadWidth * 0.85;
      } else {
        driveWidth = 3.8;
        driveDepth = roadWidth * 0.85;
      }
      // Driveway centre is offset along the building's local X (lateral) by drvLx
      // and pushed from the building's front face outward by half its own depth.
      const setback = fp.d / 2 + driveDepth / 2 + 0.20;
      const drvX = lotCx + frontX * setback + drvLx * cosR;
      const drvZ = lotCz + frontZ * setback + drvLx * sinR;
      const drv = makeDriveway(drvX, drvZ, rotY, driveWidth, driveDepth, lotSeed + 1);
      if (drv && deps.sampleTerrainHeight) {
        drv.position.y = deps.sampleTerrainHeight(drvX, drvZ) + SIDEWALK_LIP;
      }
      built.driveway = drv;

      out.push(built);
    }
  }
  return out;
}

