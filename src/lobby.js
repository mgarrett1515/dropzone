// ============================================================================
// LOBBY — full-screen atmospheric main-menu scene + tab switching + play wiring
// ----------------------------------------------------------------------------
// Self-contained: its own Three.js renderer/scene/loop, separate from the
// game's renderer (which doesn't exist until startGame/startRange run). The
// canvas is a full-bleed background: an environment scene with the player's
// character on a lit podium, prop silhouettes, drifting embers and fog. The UI
// (lobby.css) floats over it. initLobby() runs once at page load;
// teardownLobby() disposes everything when a match starts.
//
// buildSoldierMesh is passed in (not imported) to avoid a circular dependency.
// ============================================================================
import * as THREE from 'three';
import { PERF } from './perf.js';

let _renderer = null, _scene = null, _camera = null;
let _viewport = null, _resizeObs = null;
let _raf = 0, _running = false, _lastT = 0;
let _soldier = null;
let _embers = null, _emberVel = null;     // Points cloud + per-particle rise speeds
let _coneMat = null, _podiumLight = null; // animated each frame
let _skyTex = null;                       // scene.background — not reachable via traverse
let _mode = 'normal';                     // 'normal' | 'range' — which hidden trigger to fire

const EMBER_COUNT = PERF.lobbyEmberCount;
const EMBER_TOP = 7;                      // recycle height for rising embers

export function initLobby({ buildSoldierMesh }) {
  _viewport = document.getElementById('lobbyCharViewport');
  if (!_viewport) return;

  _renderer = new THREE.WebGLRenderer({ antialias: PERF.lobbyAntialias, powerPreference: 'high-performance' });
  _renderer.setPixelRatio(PERF.lobbyPixelRatio);
  _viewport.appendChild(_renderer.domElement);

  _scene = new THREE.Scene();

  // Gradient sky as the background + matching fog so props melt into the dark.
  _skyTex = _makeGradientTexture('#2a3855', '#0c111c', '#05070c');
  _scene.background = _skyTex;
  _scene.fog = new THREE.Fog(0x0a0e16, 11, 40);

  _camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  _camera.position.set(0, 1.7, 5.6);
  _camera.lookAt(0, 1.05, 0);

  // Lighting — cool ambient, warm key, orange accent rim, warm podium glow.
  _scene.add(new THREE.HemisphereLight(0x6f86b8, 0x141118, 0.55));
  const key = new THREE.DirectionalLight(0xffe6c8, 1.35);
  key.position.set(-3, 4.5, 3.2);
  _scene.add(key);
  const rim = new THREE.DirectionalLight(0xff5a32, 1.15);
  rim.position.set(3.4, 2.2, -3.0);
  _scene.add(rim);
  _podiumLight = new THREE.PointLight(0xffb070, 1.6, 9, 2);
  _podiumLight.position.set(0, 1.4, 0.6);
  _scene.add(_podiumLight);

  // Ground plane + a warm additive "light pool" disc beneath the podium.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 140),
    new THREE.MeshStandardMaterial({ color: 0x0c0f16, roughness: 0.85, metalness: 0.1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  _scene.add(ground);

  const poolTex = _makeRadialTexture('rgba(255,150,80,0.55)', 'rgba(255,150,80,0)');
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = -0.28;
  _scene.add(pool);

  // Podium the character stands on, with a glowing accent rim.
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.9, 0.3, 40),
    new THREE.MeshStandardMaterial({ color: 0x1a1f2b, roughness: 0.5, metalness: 0.6 })
  );
  podium.position.y = -0.15;
  _scene.add(podium);
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(1.73, 1.73, 0.07, 40, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff6a3c })
  );
  ring.position.y = 0.0;
  _scene.add(ring);

  // Faint volumetric spotlight cone over the podium.
  _coneMat = new THREE.MeshBasicMaterial({
    color: 0xffb070, transparent: true, opacity: 0.07,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.1, 6.2, 30, 1, true), _coneMat);
  cone.position.y = 3.1;
  _scene.add(cone);

  // Background prop silhouettes — crates/barriers ringing the podium for depth.
  const propMat = new THREE.MeshStandardMaterial({ color: 0x10141d, roughness: 0.92, metalness: 0.05 });
  for (let i = 0; i < PERF.lobbyPropCount; i++) {
    const ang = (i / PERF.lobbyPropCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.55;
    const dist = 7 + Math.random() * 15;
    const w = 0.8 + Math.random() * 2.6;
    const h = 0.6 + Math.random() * 3.4;
    const d = 0.8 + Math.random() * 2.6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), propMat);
    box.position.set(Math.cos(ang) * dist, h / 2 - 0.3, Math.sin(ang) * dist);
    box.rotation.y = Math.random() * Math.PI;
    _scene.add(box);
  }

  // Drifting embers — a slow rising particle cloud, recycled at the top.
  const eGeo = new THREE.BufferGeometry();
  const ePos = new Float32Array(EMBER_COUNT * 3);
  _emberVel = new Float32Array(EMBER_COUNT);
  for (let i = 0; i < EMBER_COUNT; i++) {
    ePos[i * 3]     = (Math.random() - 0.5) * 28;
    ePos[i * 3 + 1] = Math.random() * EMBER_TOP;
    ePos[i * 3 + 2] = (Math.random() - 0.5) * 22 - 2;
    _emberVel[i] = 0.18 + Math.random() * 0.5;
  }
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  _embers = new THREE.Points(eGeo, new THREE.PointsMaterial({
    color: 0xffb878, size: 0.05, transparent: true, opacity: 0.7,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  _embers.frustumCulled = false;
  _scene.add(_embers);

  // The character.
  _soldier = buildSoldierMesh();
  _scene.add(_soldier.group);

  _syncSize();
  _resizeObs = new ResizeObserver(_syncSize);
  _resizeObs.observe(_viewport);

  _wireTabs();
  _wirePlayDock();

  _running = true;
  _lastT = performance.now();
  _raf = requestAnimationFrame(_tick);
}

export function teardownLobby() {
  _running = false;
  if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
  if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
  if (_scene) {
    _scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      }
    });
  }
  if (_skyTex) { _skyTex.dispose(); _skyTex = null; }
  if (_renderer) {
    _renderer.dispose();
    _renderer.domElement.remove();
    _renderer = null;
  }
  _scene = _camera = _soldier = _viewport = _embers = _emberVel = _coneMat = _podiumLight = null;
}

// Vertical 3-stop gradient on a tall thin canvas — used as scene.background.
function _makeGradientTexture(top, mid, bot) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, top);
  grd.addColorStop(0.55, mid);
  grd.addColorStop(1, bot);
  g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft radial gradient — used for the warm "light pool" disc under the podium.
function _makeRadialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Match the renderer + camera to the (full-bleed) viewport's current box.
function _syncSize() {
  if (!_renderer || !_viewport) return;
  const w = _viewport.clientWidth, h = _viewport.clientHeight;
  if (w < 2 || h < 2) return;
  _renderer.setSize(w, h, false);
  _camera.aspect = w / h;
  _camera.updateProjectionMatrix();
}

function _tick() {
  if (!_running) return;
  _raf = requestAnimationFrame(_tick);
  const now = performance.now();
  const dt = Math.min(0.05, (now - _lastT) / 1000);
  _lastT = now;
  const t = now / 1000;

  // Character idle — slow turntable spin + breathing bob + faint arm sway.
  if (_soldier) {
    _soldier.group.rotation.y += dt * 0.35;
    _soldier.group.position.y = Math.sin(t * 1.4) * 0.015;
    const sway = Math.sin(t * 1.2) * 0.05;
    _soldier.shoulderL.rotation.x = sway;
    _soldier.shoulderR.rotation.x = -sway;
  }

  // Slow camera drift — life without disorientation.
  _camera.position.x = Math.sin(t * 0.12) * 0.55;
  _camera.position.y = 1.7 + Math.sin(t * 0.19) * 0.09;
  _camera.lookAt(0, 1.05, 0);

  // Embers rise + sway, recycled to the ground when they pass the top.
  if (_embers) {
    const arr = _embers.geometry.attributes.position.array;
    for (let i = 0; i < EMBER_COUNT; i++) {
      arr[i * 3 + 1] += _emberVel[i] * dt;
      arr[i * 3]     += Math.sin(t * 0.6 + i) * dt * 0.15;
      if (arr[i * 3 + 1] > EMBER_TOP) {
        arr[i * 3]     = (Math.random() - 0.5) * 28;
        arr[i * 3 + 1] = 0;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 22 - 2;
      }
    }
    _embers.geometry.attributes.position.needsUpdate = true;
  }

  // Gentle pulse on the spotlight cone + podium light.
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.1);
  if (_coneMat) _coneMat.opacity = 0.05 + pulse * 0.045;
  if (_podiumLight) _podiumLight.intensity = 1.4 + pulse * 0.5;

  _renderer.render(_scene, _camera);
}

// Tab bar: toggle .on on the tab + its panel. The 3D scene is the background
// now, so the loop keeps running on every tab (it doesn't pause).
function _wireTabs() {
  const tabs = document.querySelectorAll('#lobbyTabs .lobby-tab');
  const panels = document.querySelectorAll('.lobby-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('on', t === tab));
      panels.forEach(p => p.classList.toggle('on', p.dataset.panel === name));
    });
  });
}

// Play dock: the mode toggle picks which hidden trigger #lobbyPlayBtn
// proxy-clicks, so main.js's existing playBtn/rangeBtn listeners stay untouched.
function _wirePlayDock() {
  const modeBtns = document.querySelectorAll('#lobbyModeToggle button');
  const lobbyPlayBtn = document.getElementById('lobbyPlayBtn');
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      _mode = btn.dataset.mode;
      modeBtns.forEach(b => b.classList.toggle('on', b === btn));
      lobbyPlayBtn.textContent = _mode === 'range' ? 'ENTER RANGE' : 'DROP IN';
    });
  });
  lobbyPlayBtn.addEventListener('click', () => {
    const trigger = document.getElementById(_mode === 'range' ? 'rangeBtn' : 'playBtn');
    if (trigger) trigger.click();
  });
}
