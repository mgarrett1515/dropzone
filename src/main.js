import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// Minimal in-house geometry merger that only handles the cases we actually need:
// indexed geometries (Box/Cylinder/Circle) with identical attribute sets.
// Auto-indexes any non-indexed geometry first (Icosahedron, Dodecahedron).
const BufferGeometryUtils = { mergeBufferGeometries: simpleMergeIndexed };
function ensureIndexed(g) {
  if (g.index) return g;
  const count = g.attributes.position.count;
  const idx = new (count < 65535 ? Uint16Array : Uint32Array)(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
function simpleMergeIndexed(geometries) {
  if (!geometries || geometries.length === 0) return null;
  // Auto-index any non-indexed inputs so the merge can proceed
  for (const g of geometries) ensureIndexed(g);
  const first = geometries[0];
  const attrNames = Object.keys(first.attributes);
  // Require all geometries to share the same attribute set
  for (const g of geometries) {
    for (const n of attrNames) if (!g.attributes[n]) return null;
  }
  let totalIndex = 0, totalVerts = 0;
  for (const g of geometries) {
    totalIndex += g.index.count;
    totalVerts += g.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  for (const name of attrNames) {
    const itemSize = first.attributes[name].itemSize;
    const ArrayType = first.attributes[name].array.constructor;
    const out = new ArrayType(totalVerts * itemSize);
    let offset = 0;
    for (const g of geometries) {
      const a = g.attributes[name].array;
      out.set(a, offset);
      offset += a.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
  }
  const indexArr = new Uint32Array(totalIndex);
  let iOff = 0, vOff = 0;
  for (const g of geometries) {
    const idx = g.index.array;
    for (let i=0; i<idx.length; i++) indexArr[iOff + i] = idx[i] + vOff;
    iOff += idx.length;
    vOff += g.attributes.position.count;
  }
  merged.setIndex(new THREE.BufferAttribute(indexArr, 1));
  return merged;
}

// ============================================================================
// MENU SETUP
// ============================================================================
const settings = { bots:20, skill:0.7, view:'fp', shoulder:'r', mapSize:900 };

document.getElementById('botCount').addEventListener('input', e => {
  settings.bots = parseInt(e.target.value);
  document.getElementById('botCountVal').textContent = settings.bots;
});
function bindSeg(id, key, parser=(v)=>v) {
  document.querySelectorAll(`#${id} button`).forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll(`#${id} button`).forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      settings[key] = parser(b.dataset.v);
    });
  });
}
bindSeg('botSkill', 'skill', parseFloat);
bindSeg('viewMode', 'view');
bindSeg('shoulder', 'shoulder');
bindSeg('mapSize', 'mapSize', parseInt);

// Nature-model globals — declared before preloadNature() call to avoid TDZ
let NATURE_MODELS = null;
let _natureLoadPromise = null;
const _treePlacements = [];
const _rockPlacements = [];
const _bushPlacements = [];

// Weapon GLTF model globals
let M4_MODEL = null;
let _m4LoadPromise = null;
let AK_MODEL       = null; let _akLoadPromise      = null;
let KAR98_MODEL    = null; let _kar98LoadPromise   = null;
let UMP45_MODEL    = null; let _ump45LoadPromise   = null;
let BERETTA_MODEL  = null; let _berettaLoadPromise = null;
let IZH27_MODEL    = null; let _izh27LoadPromise   = null;
let SPAS12_MODEL   = null; let _spas12LoadPromise  = null;

function _launchWithErrorCatch(fn) {
  settings.gamertag = (document.getElementById('gamertagInput').value.trim().toUpperCase() || 'PLAYER');
  document.getElementById('menu').style.display = 'none';
  document.getElementById('clickHint').style.display = 'flex';
  function showError(err) {
    console.error('Game failed to start:', err);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:200;background:#100;color:#fff;padding:30px;font-family:monospace;font-size:13px;overflow:auto;white-space:pre-wrap;';
    overlay.textContent = 'GAME FAILED TO START\n\n' + (err && err.stack ? err.stack : err);
    document.body.appendChild(overlay);
  }
  try {
    const result = fn();
    if (result && typeof result.then === 'function') result.catch(showError);
  } catch (err) { showError(err); }
}

function preloadNature() {
  if (_natureLoadPromise) return _natureLoadPromise;
  const loader = new GLTFLoader();
  const load = name => new Promise((res, rej) =>
    loader.load(`/nature/${name}`, g => res(g.scene), null, rej));
  _natureLoadPromise = Promise.all([
    load('CommonTree_1.gltf'), load('CommonTree_2.gltf'), load('CommonTree_3.gltf'),
    load('CommonTree_4.gltf'), load('CommonTree_5.gltf'),
    load('Pine_1.gltf'),       load('Pine_2.gltf'),       load('Pine_3.gltf'),
    load('Pine_4.gltf'),       load('Pine_5.gltf'),
    load('DeadTree_1.gltf'),   load('DeadTree_2.gltf'),   load('DeadTree_3.gltf'),
    load('TwistedTree_1.gltf'),load('TwistedTree_2.gltf'),load('TwistedTree_3.gltf'),
    load('Rock_Medium_1.gltf'),load('Rock_Medium_2.gltf'),load('Rock_Medium_3.gltf'),
    load('Bush_Common.gltf'),  load('Bush_Common_Flowers.gltf'),
  ]).then(([bt1,bt2,bt3,bt4,bt5, ct1,ct2,ct3,ct4,ct5,
            dt1,dt2,dt3, tt1,tt2,tt3, r1,r2,r3, bu1,bu2]) => {
    NATURE_MODELS = {
      broadleaf: [bt1,bt2,bt3,bt4,bt5],
      conifer:   [ct1,ct2,ct3,ct4,ct5],
      dead:      [dt1,dt2,dt3],
      twisted:   [tt1,tt2,tt3],
      rocks:     [r1,r2,r3],
      bushes:    [bu1,bu2],
    };
  });
  return _natureLoadPromise;
}
preloadNature(); // kick off immediately so models are ready by game start

function preloadM4() {
  if (_m4LoadPromise) return _m4LoadPromise;
  const loader = new GLTFLoader();
  _m4LoadPromise = new Promise((res, rej) =>
    loader.load('/weapons/m4a1/scene.gltf', g => res(g.scene), null, rej)
  ).then(scene => { M4_MODEL = scene; });
  return _m4LoadPromise;
}
preloadM4();

function preloadAK() {
  if (_akLoadPromise) return _akLoadPromise;
  const loader = new GLTFLoader();
  _akLoadPromise = new Promise((res, rej) =>
    loader.load('/weapons/ak47/scene.gltf', g => res(g.scene), null, rej)
  ).then(scene => { AK_MODEL = scene; });
  return _akLoadPromise;
}
preloadAK();

function _makeWeaponPreloader(urlPath, modelRef, promiseRef) {
  return function() {
    if (promiseRef.v) return promiseRef.v;
    const loader = new GLTFLoader();
    promiseRef.v = new Promise((res, rej) =>
      loader.load(urlPath, g => res(g.scene), null, rej)
    ).then(scene => { modelRef.v = scene; });
    return promiseRef.v;
  };
}
const _kar98Ref   = {v:null}, _kar98P   = {v:null};
const _ump45Ref   = {v:null}, _ump45P   = {v:null};
const _berettaRef = {v:null}, _berettaP = {v:null};
const _izh27Ref   = {v:null}, _izh27P   = {v:null};
const _spas12Ref  = {v:null}, _spas12P  = {v:null};
function preloadKar98()   { if (_kar98LoadPromise)   return _kar98LoadPromise;   const l=new GLTFLoader(); _kar98LoadPromise   = new Promise((r,j)=>l.load('/weapons/kar98/scene.gltf',  g=>r(g.scene),null,j)).then(s=>{KAR98_MODEL   =s;}); return _kar98LoadPromise;   }
function preloadUmp45()   { if (_ump45LoadPromise)   return _ump45LoadPromise;   const l=new GLTFLoader(); _ump45LoadPromise   = new Promise((r,j)=>l.load('/weapons/ump45/scene.gltf',  g=>r(g.scene),null,j)).then(s=>{UMP45_MODEL   =s;}); return _ump45LoadPromise;   }
function preloadBeretta() { if (_berettaLoadPromise) return _berettaLoadPromise; const l=new GLTFLoader(); _berettaLoadPromise = new Promise((r,j)=>l.load('/weapons/beretta/scene.gltf',g=>r(g.scene),null,j)).then(s=>{BERETTA_MODEL =s;}); return _berettaLoadPromise; }
function preloadIzh27()   { if (_izh27LoadPromise)   return _izh27LoadPromise;   const l=new GLTFLoader(); _izh27LoadPromise   = new Promise((r,j)=>l.load('/weapons/izh27/scene.gltf',  g=>r(g.scene),null,j)).then(s=>{IZH27_MODEL   =s;}); return _izh27LoadPromise;   }
function preloadSpas12()  { if (_spas12LoadPromise)  return _spas12LoadPromise;  const l=new GLTFLoader(); _spas12LoadPromise  = new Promise((r,j)=>l.load('/weapons/spas12/scene.gltf', g=>r(g.scene),null,j)).then(s=>{SPAS12_MODEL  =s;}); return _spas12LoadPromise;  }
preloadKar98(); preloadUmp45(); preloadBeretta(); preloadIzh27(); preloadSpas12();

document.getElementById('playBtn').addEventListener('click', () => _launchWithErrorCatch(startGame));
document.getElementById('rangeBtn').addEventListener('click', () => _launchWithErrorCatch(startRange));

// ============================================================================
// GAME
// ============================================================================
let scene, camera, renderer, clock, composer, fxaaPass;
let player, world;
let entities = [];
let lootItems = [];
const searchableObjects = []; // dumpsters, cars, bushes that can be searched

function registerSearchable(mesh, type, worldX, worldZ) {
  searchableObjects.push({ mesh, type, worldX, worldZ, searched: false, items: null });
}
let bullets = [];
let buildings = [];
let trees = [];
let zone;
let input = {};
let mouse = { dx:0, dy:0 };
let pointerLocked = false;
let gameOver = false;
let killCount = 0;
const dobbleGolpGroups = [];
const MAP = { size: 900 };

// ----- Weapons / Attachments definitions -----
const WEAPONS = {
  pistol: { name:'P92',     dmg:18, rpm:380, mag:15, reserve:30,  recoil:0.6, spread:0.025, range:80,  adsZoom:1.4, auto:false, slot:3, color:0x666666 },
  deagle: { name:'DEAGLE',  dmg:55, rpm:80,  mag:7,  reserve:14,  recoil:2.5, spread:0.012, range:150, adsZoom:2.0, auto:false, slot:3, color:0x888888 },
  ar:     { name:'M416',    dmg:25, rpm:680, mag:30, reserve:60,  recoil:1.2, spread:0.04,  range:200, adsZoom:1.8, auto:true,  slot:1, color:0x4a4a55 },
  ak:     { name:'AK47',    dmg:32, rpm:600, mag:30, reserve:60,  recoil:1.6, spread:0.05,  range:180, adsZoom:1.8, auto:true,  slot:1, color:0x5a4a32 },
  smg:    { name:'UMP',     dmg:20, rpm:760, mag:30, reserve:60,  recoil:0.8, spread:0.06,  range:90,  adsZoom:1.5, auto:true,  slot:1, color:0x554a3a },
  p90:    { name:'P90',     dmg:18, rpm:900, mag:50, reserve:50,  recoil:0.6, spread:0.07,  range:80,  adsZoom:1.5, auto:true,  slot:1, color:0x3a3a4a },
  sr:     { name:'KAR98',   dmg:80, rpm:60,  mag:5,  reserve:10,  recoil:2.2, spread:0.005, range:400, adsZoom:4.0, auto:false, slot:2, color:0x7a5a3a, bolt:true },
  barrett:{ name:'BARRETT M82', dmg:95, rpm:100, mag:10, reserve:10, recoil:3.0, spread:0.004, range:500, adsZoom:4.0, auto:false, slot:2, color:0x2a2a2a },
  shotgun:{ name:'S686',    dmg:10, rpm:180, mag:2,  reserve:8,   recoil:1.8, spread:0.18,  range:30,  adsZoom:1.2, auto:false, slot:1, pellets:8, color:0x4a3a2a },
  spas:   { name:'SPAS-12', dmg:12, rpm:200, mag:8,  reserve:16,  recoil:1.6, spread:0.16,  range:35,  adsZoom:1.2, auto:false, slot:1, pellets:7, color:0x3a3a3a },
  machete:{ name:'KNIFE',   dmg:18, rpm:150, mag:1,  reserve:0,   recoil:0,   spread:0,     range:1.8, adsZoom:1.0, auto:false, slot:4, color:0x8a9aaa, melee:true },
  crowbar:{ name:'CROWBAR', dmg:20, rpm:90,  mag:1,  reserve:0,   recoil:0,   spread:0,     range:2.2, adsZoom:1.0, auto:false, slot:4, color:0x3a3a4a, melee:true },
  bat:    { name:'BAT',     dmg:15, rpm:110, mag:1,  reserve:0,   recoil:0,   spread:0,     range:2.5, adsZoom:1.0, auto:false, slot:4, color:0xc8a060, melee:true }
};
const ATTACHMENTS = {
  reddot:   { name:'RED DOT',   type:'scope', zoom:1.3 },
  scope2x:  { name:'2x SCOPE',  type:'scope', zoom:2.2 },
  scope4x:  { name:'4x SCOPE',  type:'scope', zoom:4.0 },
  scope8x:  { name:'8x SCOPE',  type:'scope', zoom:8.0 },
  grip:     { name:'V-GRIP',    type:'grip',  recoilMul:0.7 },
  extmag:   { name:'EXT MAG',   type:'mag',   magMul:1.5 },
  comp:     { name:'COMP',      type:'muzzle',recoilMul:0.85, spreadMul:0.85 },
  silencer: { name:'SILENCER',  type:'muzzle',recoilMul:0.95, silent:true }
};
const HEAL_ITEMS = {
  bandage:    { name:'BANDAGE',            heal:15,  time:3 },
  medkit:     { name:'MEDKIT',             heal:75,  time:6 },
  dobble_golp:{ name:'5 TIMES DOBBLE GOLP', heal:100, armor:100, time:5, legendary:true }
};

// ============================================================================
// INIT
// ============================================================================
async function startGame() {
  globalThis._rangeMode = false;
  MAP.size = settings.mapSize;
  camera = new THREE.PerspectiveCamera(72, innerWidth/innerHeight, 0.05, 2500);
  scene = new THREE.Scene();
  scene.add(camera);

  renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);
  clock = new THREE.Clock();

  // ── Random time of day ──────────────────────────────────────────────────────
  // tod: 0=dawn 1=morning 2=midday 3=afternoon 4=dusk 5=night
  const TOD_NAMES = ['DAWN','MORNING','MIDDAY','AFTERNOON','DUSK','NIGHT'];
  const tod = Math.floor(Math.random() * TOD_NAMES.length);
  globalThis._timeOfDay = tod;
  console.log('[DROPZONE] Time of day:', TOD_NAMES[tod]);

  // Per-tod config: { exposure, sunPos, sunColor, sunInt, hemiSky, hemiGnd, hemiInt, fillColor, fillInt, ambColor, ambInt, fogColor, fogDensity, moonInt }
  const TOD = [
    // DAWN
    { exposure:0.85, sunPos:[120,40,200],  sunColor:0xff9060, sunInt:1.2, hemiSky:0x4a5070, hemiGnd:0x3a2818, hemiInt:0.55, fillColor:0x8090b0, fillInt:0.30, ambColor:0x1a1020, ambInt:0.25, fogColor:0xb0907a, fogDensity:0.0020 },
    // MORNING
    { exposure:0.95, sunPos:[160,120,160], sunColor:0xffc070, sunInt:1.7, hemiSky:0x6070a0, hemiGnd:0x5a3e20, hemiInt:0.75, fillColor:0x8090c0, fillInt:0.38, ambColor:0x2a1e10, ambInt:0.18, fogColor:0xbcaa90, fogDensity:0.0016 },
    // MIDDAY
    { exposure:1.05, sunPos:[60,280,100],  sunColor:0xfff8e8, sunInt:2.4, hemiSky:0x7090d0, hemiGnd:0x4a3820, hemiInt:1.00, fillColor:0x90a0c8, fillInt:0.50, ambColor:0x181818, ambInt:0.15, fogColor:0xc0c8d0, fogDensity:0.0012 },
    // AFTERNOON
    { exposure:1.00, sunPos:[180,160,80],  sunColor:0xffd580, sunInt:2.0, hemiSky:0x7080c0, hemiGnd:0x6b4a28, hemiInt:0.90, fillColor:0x8090c8, fillInt:0.45, ambColor:0x3d2e1a, ambInt:0.20, fogColor:0xb8a898, fogDensity:0.0014 },
    // DUSK
    { exposure:0.80, sunPos:[200,30,100],  sunColor:0xff6030, sunInt:1.0, hemiSky:0x3a3050, hemiGnd:0x3a2010, hemiInt:0.50, fillColor:0x5060a0, fillInt:0.28, ambColor:0x200a08, ambInt:0.22, fogColor:0xa07060, fogDensity:0.0022 },
    // NIGHT
    { exposure:0.40, sunPos:[0,-100,0],    sunColor:0x203060, sunInt:0.0, hemiSky:0x101828, hemiGnd:0x080808, hemiInt:0.25, fillColor:0x203050, fillInt:0.15, ambColor:0x050810, ambInt:0.30, fogColor:0x101820, fogDensity:0.0025 },
  ];
  const tc = TOD[tod];

  renderer.toneMappingExposure = tc.exposure;
  const pmremGen = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGen.fromScene(new RoomEnvironment(), 0.04).texture;
  pmremGen.dispose();
  setupComposer(innerWidth, innerHeight);

  buildSky(tc);

  // Sun / Moon
  const sun = new THREE.DirectionalLight(tc.sunColor, tc.sunInt);
  sun.position.set(...tc.sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  const sd = 110;
  sun.shadow.camera.left = -sd; sun.shadow.camera.right = sd;
  sun.shadow.camera.top = sd; sun.shadow.camera.bottom = -sd;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.06;
  sun.target = new THREE.Object3D();
  scene.add(sun.target);
  scene.add(sun);
  globalThis._sunLight = sun;

  // Night: add a dim blue moon light
  if (tod === 5) {
    const moon = new THREE.DirectionalLight(0x3050a0, 0.35);
    moon.position.set(-80, 200, 120);
    scene.add(moon);
  }

  const hemi = new THREE.HemisphereLight(tc.hemiSky, tc.hemiGnd, tc.hemiInt);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(tc.fillColor, tc.fillInt);
  fill.position.set(-80, 60, -60);
  scene.add(fill);

  scene.add(new THREE.AmbientLight(tc.ambColor, tc.ambInt));

  scene.fog = new THREE.FogExp2(tc.fogColor, tc.fogDensity);

  await Promise.all([preloadNature(), preloadM4(), preloadAK(),
    preloadKar98(), preloadUmp45(), preloadBeretta(), preloadIzh27(), preloadSpas12()]);
  // Pre-warm the GLTF gun flat-cache during loading so first pickup has no spike.
  // Calling each build function bakes and caches the final positioned mesh group.
  const _pw = new THREE.Group();
  if (BERETTA_MODEL) buildPistol(_pw, {});
  if (UMP45_MODEL)   buildSMG(_pw, {});
  if (KAR98_MODEL)   buildSniper(_pw, {});
  if (IZH27_MODEL)   buildShotgun(_pw, {});
  if (SPAS12_MODEL)  buildSPAS(_pw, {});
  _pw.traverse(o => {
    if (o.geometry && !o.userData.fromBaked) o.geometry.dispose();
    if (o.material && !o.userData.fromBaked) o.material.dispose();
  });
  buildWorld();
  spawnPlayer();
  buildMuzzleFlash();
  buildViewmodel();
  spawnBots(settings.bots);
  // Populate all containers with loot
  for (const obj of searchableObjects) {
    obj.items = generateContainerLoot(obj.type);
  }
  initZone();

  setupInput();
  preloadAudio();
  // Decode dobble golp audio via Blob URL in background — never blocks main thread
  setTimeout(() => {
    try {
      const bytes = Uint8Array.from(atob(DOBBLE_GOLP_B64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'audio/mp4' });
      const url = URL.createObjectURL(blob);
      const tmpAudio = new Audio(url);
      tmpAudio.addEventListener('canplaythrough', () => {
        // Now decode into AudioContext buffer
        fetch(url).then(r => r.arrayBuffer()).then(arr => {
          if (audioCtx) audioCtx.decodeAudioData(arr).then(buf => {
            _audioBuffers['dobble_golp'] = buf;
            URL.revokeObjectURL(url);
          }).catch(() => {});
        }).catch(() => {});
      }, { once: true });
    } catch(e) {}
  }, 2000); // wait 2s after game start so other sounds decode first
  window.addEventListener('resize', onResize);
  animate();
}

// ============================================================================
// SHOOTING RANGE
// ============================================================================
async function startRange() {
  globalThis._rangeMode = true;
  MAP.size = 400;
  camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.05, 600);
  scene  = new THREE.Scene();
  scene.add(camera);

  renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);
  const pmremGenR = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenR.fromScene(new RoomEnvironment(), 0.04).texture;
  pmremGenR.dispose();
  setupComposer(innerWidth, innerHeight);
  clock = new THREE.Clock();
  globalThis._timeOfDay = 2;

  // ── Dimensions ─────────────────────────────────────────────────────────────
  const LANES    = 8;
  const LANE_W   = 6.0;
  const ROOM_W   = LANES * LANE_W;   // 48m wide
  const ROOM_D   = 70;               // 70m deep
  const ROOM_H   = 4.0;              // ceiling height
  const BOOTH_D  = 3.5;              // booth depth (at back wall)
  const BOOTH_H  = 2.8;              // booth height
  const BENCH_H  = 1.0;

  const SHOOTER_Z = -ROOM_D / 2;     // back wall (booths)
  const TARGET_Z  =  ROOM_D / 2;     // front wall (targets)
  // Target sits 3m from front wall
  const TGT_Z     = TARGET_Z - 3.0;

  // ── Materials ──────────────────────────────────────────────────────────────
  const mConc   = new THREE.MeshStandardMaterial({ color:0x7e7e86, roughness:0.95, metalness:0.02 });
  const mConcDk = new THREE.MeshStandardMaterial({ color:0x424248, roughness:0.96, metalness:0.02 });
  const mCeil   = new THREE.MeshStandardMaterial({ color:0x505058, roughness:0.92, metalness:0.02 });
  const mSteel  = new THREE.MeshStandardMaterial({ color:0x1c1c22, roughness:0.38, metalness:0.88 });
  const mSteelL = new THREE.MeshStandardMaterial({ color:0x606068, roughness:0.28, metalness:0.92 });
  const mRubber = new THREE.MeshStandardMaterial({ color:0x0e0e10, roughness:0.99, metalness:0.00 });
  const mBench  = new THREE.MeshStandardMaterial({ color:0x1a1a1e, roughness:0.88, metalness:0.05 });
  const mYellow = new THREE.MeshStandardMaterial({ color:0xf0c000, emissive:0x604800, emissiveIntensity:0.5 });
  const mLED    = new THREE.MeshStandardMaterial({ color:0xffffff, emissive:0xfff0d0, emissiveIntensity:1.5 });
  const mAccent = new THREE.MeshStandardMaterial({ color:0xff5028, emissive:0x801800, emissiveIntensity:0.4 });
  const mShelf  = new THREE.MeshStandardMaterial({ color:0x141418, roughness:0.75, metalness:0.35 });
  const mGlass  = new THREE.MeshStandardMaterial({ color:0x203040, roughness:0.05, metalness:0.10, transparent:true, opacity:0.30 });
  const mBoothW = new THREE.MeshStandardMaterial({ color:0x2e2e36, roughness:0.85, metalness:0.05 }); // booth walls
  // Target
  const mPaper  = new THREE.MeshStandardMaterial({ color:0xf0ead8, roughness:0.90 });
  const mRBlk   = new THREE.MeshStandardMaterial({ color:0x141414, roughness:0.85 });
  const mRGry   = new THREE.MeshStandardMaterial({ color:0x585858, roughness:0.85 });
  const mRWht   = new THREE.MeshStandardMaterial({ color:0xd0d0d0, roughness:0.85 });
  const mRRed   = new THREE.MeshStandardMaterial({ color:0xcc2010, roughness:0.80 });
  const mROrg   = new THREE.MeshStandardMaterial({ color:0xff5808, roughness:0.72, emissive:0x601800, emissiveIntensity:0.18 });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function add(geo, mat, x, y, z, rx=0, ry=0, rz=0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x,y,z);
    if (rx||ry||rz) m.rotation.set(rx,ry,rz);
    m.castShadow=true; m.receiveShadow=true;
    scene.add(m); return m;
  }
  const B = (w,h,d) => new THREE.BoxGeometry(w,h,d);

  // ── FLOOR ─────────────────────────────────────────────────────────────────
  // Plain polished concrete with lane lines baked in
  const flGeo = new THREE.PlaneGeometry(ROOM_W+2, ROOM_D+2, ROOM_W*2, ROOM_D*2);
  flGeo.rotateX(-Math.PI/2);
  const fPos = flGeo.attributes.position;
  const fCol = new Float32Array(fPos.count * 3);
  for (let i = 0; i < fPos.count; i++) {
    const fx = fPos.getX(i), fz = fPos.getZ(i);
    // Concrete base
    let v = 0.30 + (Math.sin(fx*3.1+0.5)*Math.cos(fz*2.9+1.2)) * 0.02;
    // Lane stripe lines (thin black lines at each lane boundary)
    for (let l = 0; l <= LANES; l++) {
      if (Math.abs(fx - (-ROOM_W/2 + l*LANE_W)) < 0.055) { v = 0.10; }
    }
    // Yellow safety line at front of booths
    if (Math.abs(fz - (SHOOTER_Z + BOOTH_D + 0.12)) < 0.07) v = 0.88;
    fCol[i*3]=v; fCol[i*3+1]=v; fCol[i*3+2]=v+0.025;
  }
  flGeo.setAttribute('color', new THREE.BufferAttribute(fCol, 3));
  const flMesh = new THREE.Mesh(flGeo, new THREE.MeshStandardMaterial({
    vertexColors:true, roughness:0.78, metalness:0.07
  }));
  flMesh.receiveShadow=true; flMesh.userData.isGround=true; scene.add(flMesh);
  world = { ground:flMesh, cityCenter:new THREE.Vector2(9999,9999), cityRadius:1, cityBaseY:0 };

  // ── CEILING ────────────────────────────────────────────────────────────────
  add(B(ROOM_W+2,0.35,ROOM_D+2), mCeil, 0, ROOM_H+0.175, 0);

  // ── OUTER WALLS ────────────────────────────────────────────────────────────
  add(B(ROOM_W+2,ROOM_H,0.4), mConcDk, 0, ROOM_H/2,  TARGET_Z+0.2);  // far wall
  add(B(ROOM_W+2,ROOM_H,0.4), mConc,   0, ROOM_H/2,  SHOOTER_Z-0.2); // back wall
  add(B(0.4,ROOM_H,ROOM_D+2), mConc,  -ROOM_W/2-0.2, ROOM_H/2, 0);   // left
  add(B(0.4,ROOM_H,ROOM_D+2), mConc,   ROOM_W/2+0.2, ROOM_H/2, 0);   // right
  // Baseboard accent
  add(B(0.06,0.15,ROOM_D), mAccent, -ROOM_W/2-0.05, 0.075, 0);
  add(B(0.06,0.15,ROOM_D), mAccent,  ROOM_W/2+0.05, 0.075, 0);

  // ── CEILING STRUCTURE ─────────────────────────────────────────────────────
  // Longitudinal I-beams over each lane boundary
  for (let l = 0; l <= LANES; l++) {
    const bx = -ROOM_W/2 + l*LANE_W;
    add(B(0.09,0.26,ROOM_D+1), mSteel,  bx, ROOM_H-0.13, 0);
    add(B(0.26,0.055,ROOM_D+1), mSteelL, bx, ROOM_H-0.01, 0);
    add(B(0.26,0.055,ROOM_D+1), mSteelL, bx, ROOM_H-0.26, 0);
  }
  // Cross-purlins every 7m
  for (let z=SHOOTER_Z+5; z<TARGET_Z; z+=7)
    add(B(ROOM_W+1,0.09,0.10), mSteel, 0, ROOM_H-0.15, z);

  // ── OVERHEAD RAIL per lane ─────────────────────────────────────────────────
  const RAIL_Y = ROOM_H - 0.52;
  for (let l = 0; l < LANES; l++) {
    const lx = -ROOM_W/2 + l*LANE_W + LANE_W/2;
    const railLen = ROOM_D - 1.0;
    add(B(0.09,0.055,railLen), mSteel,  lx, RAIL_Y, 0);       // bottom flange
    add(B(0.055,0.16,railLen), mSteel,  lx, RAIL_Y+0.11, 0);  // web
    add(B(0.13,0.04,railLen),  mSteelL, lx, RAIL_Y+0.21, 0);  // top flange
    // Hanging brackets from ceiling beams
    for (let hz=SHOOTER_Z+5; hz<TARGET_Z; hz+=7)
      add(B(0.035,0.24,0.035), mSteelL, lx, RAIL_Y+0.33, hz);
  }

  // ── LED STRIP LIGHTING per lane ────────────────────────────────────────────
  for (let l = 0; l < LANES; l++) {
    const lx = -ROOM_W/2 + l*LANE_W + LANE_W/2;
    for (const ox of [-0.20, 0.20]) {
      const ls = new THREE.Mesh(B(0.045,0.025,ROOM_D-2), mLED);
      ls.position.set(lx+ox, ROOM_H-0.30, 0); scene.add(ls);
    }
    for (let lz=SHOOTER_Z+4; lz<TARGET_Z; lz+=7) {
      const pl = new THREE.PointLight(0xfff0d0, 1.0, 16);
      pl.position.set(lx, ROOM_H-0.34, lz); scene.add(pl);
    }
  }
  scene.add(new THREE.AmbientLight(0xc8d0d8, 0.55));
  const sun = new THREE.DirectionalLight(0xfff8f0, 0.55);
  sun.position.set(6,18,-10); sun.castShadow=true;
  sun.shadow.mapSize.width = sun.shadow.mapSize.height = 1024;
  sun.shadow.camera.left=sun.shadow.camera.bottom=-40;
  sun.shadow.camera.right=sun.shadow.camera.top=40;
  sun.shadow.camera.near=1; sun.shadow.camera.far=100;
  scene.add(sun);
  scene.fog = new THREE.Fog(0x282830, 55, 130);

  // ── BOOTHS — all joined in a row along the back wall ──────────────────────
  // Continuous counter top running the full width
  const counterY = BENCH_H;
  add(B(ROOM_W+0.2, 0.07, BOOTH_D), mBench, 0, counterY, SHOOTER_Z+BOOTH_D/2); // bench top
  add(B(ROOM_W+0.2, 0.06, 0.06),    mSteel, 0, counterY+0.065, SHOOTER_Z+0.18); // front lip
  // Under-counter shelf
  add(B(ROOM_W+0.2, 0.05, BOOTH_D*0.7), mShelf, 0, 0.55, SHOOTER_Z+BOOTH_D/2+0.1);
  // Counter legs — pairs across full width
  for (let l=0; l<=LANES; l++) {
    const lx=-ROOM_W/2+l*LANE_W;
    add(B(0.07,counterY,0.07),mSteel,lx,counterY/2,SHOOTER_Z+0.35);
    add(B(0.07,counterY,0.07),mSteel,lx,counterY/2,SHOOTER_Z+BOOTH_D-0.25);
    add(B(0.05,0.05,BOOTH_D),mSteel,lx,0.06,SHOOTER_Z+BOOTH_D/2); // foot brace
  }

  // Divider panels between booths — only the partial walls from back wall to counter
  // They do NOT extend down the range — just define the stall at the back
  for (let l=1; l<LANES; l++) {
    const dx = -ROOM_W/2 + l*LANE_W;
    // Lower panel (floor to bench)
    add(B(0.06,counterY,BOOTH_D),  mRubber, dx, counterY/2, SHOOTER_Z+BOOTH_D/2);
    // Upper panel (bench to booth ceiling) — partial height glass/frosted
    add(B(0.05,BOOTH_H-counterY,BOOTH_D), mGlass, dx, counterY+(BOOTH_H-counterY)/2, SHOOTER_Z+BOOTH_D/2);
    // Cap strip on top
    add(B(0.10,0.045,BOOTH_D), mSteelL, dx, BOOTH_H+0.02, SHOOTER_Z+BOOTH_D/2);
  }

  // Booth ceiling — low dropped ceiling over stalls only
  add(B(ROOM_W+0.1, 0.08, BOOTH_D), mCeil, 0, BOOTH_H+0.04, SHOOTER_Z+BOOTH_D/2);
  // Recess lights in booth ceiling
  for (let l=0; l<LANES; l++) {
    const lx=-ROOM_W/2+l*LANE_W+LANE_W/2;
    const rl=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,0.04,16),mLED);
    rl.position.set(lx,BOOTH_H,SHOOTER_Z+BOOTH_D*0.55); scene.add(rl);
    const rpl=new THREE.PointLight(0xfff8e8,0.8,5);
    rpl.position.set(lx,BOOTH_H-0.1,SHOOTER_Z+BOOTH_D*0.55); scene.add(rpl);
  }
  // Lane number placard on front face of counter per booth
  for (let l=0; l<LANES; l++) {
    const lx=-ROOM_W/2+l*LANE_W+LANE_W/2;
    add(B(0.30,0.22,0.025),mAccent,lx,counterY-0.04,SHOOTER_Z+0.10);
  }
  // Yellow safety line on floor at open end of booth
  // (already in floor vertex colors above)
  // Physical strip
  add(B(ROOM_W,0.014,0.07),mYellow,0,0.007,SHOOTER_Z+BOOTH_D+0.12);

  // Back wall behind booths — pegboard + shelf for guns/attachments
  const pegW=ROOM_W, pegH=ROOM_H-BOOTH_H-0.12;
  add(B(pegW,pegH,0.06), new THREE.MeshStandardMaterial({color:0x101014,roughness:0.88}),
      0, BOOTH_H+pegH/2+0.12, SHOOTER_Z);
  // Horizontal gun pegs / slots visual
  for (let row=0; row<3; row++) {
    const py=BOOTH_H+0.35+row*0.55;
    add(B(pegW,0.025,0.04),mSteelL,0,py,SHOOTER_Z+0.05);
  }

  // ── DISTANCE MARKERS ──────────────────────────────────────────────────────
  [10,15,20,25,30,40,50,60].forEach(dist => {
    const lz = SHOOTER_Z + BOOTH_D + dist;
    add(B(ROOM_W,0.012,0.06),mYellow,0,0.006,lz);
    add(B(0.12,0.35,0.06),mSteelL,-ROOM_W/2+0.25,0.175,lz);
    add(B(0.12,0.35,0.06),mSteelL, ROOM_W/2-0.25,0.175,lz);
  });

  // ── SINGLE TARGET per lane — one distance (25m from bench) ───────────────
  const TARGET_DIST = 25; // 25m from the front of the booth
  const targetRowZ  = SHOOTER_Z + BOOTH_D + TARGET_DIST;

  function makeTarget(cx, cz) {
    const scale = 0.70;
    const tY    = 1.80;
    const fd    = 0.018; // face depth
    const R     = scale;

    // Paper backer — tan cardboard
    add(B(R*1.75, R*2.20, fd), mPaper, cx, tY+R*0.08, cz);

    // Concentric ring discs (face-on cylinders)
    const rings = [
      { r:R*0.88, mat:mRBlk },
      { r:R*0.70, mat:mRGry },
      { r:R*0.52, mat:mRWht },
      { r:R*0.36, mat:mRRed },
      { r:R*0.20, mat:mROrg },
    ];
    rings.forEach((ring, ri) => {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(ring.r, ring.r, fd*0.5, 30),
        ring.mat
      );
      disc.rotation.x = Math.PI/2;
      disc.position.set(cx, tY, cz+fd*(rings.length-ri)*0.45);
      scene.add(disc);
    });

    // Cardboard side clips
    add(B(0.035,R*2.20,0.035), mSteelL, cx-R*0.90, tY+R*0.08, cz);
    add(B(0.035,R*2.20,0.035), mSteelL, cx+R*0.90, tY+R*0.08, cz);

    // Hanging wire to rail
    const wireTop  = RAIL_Y - 0.04;
    const wireBot  = tY + R*1.20;
    const wireLen  = wireTop - wireBot;
    if (wireLen > 0.05)
      add(B(0.012,wireLen,0.012), mSteel, cx, wireBot+wireLen/2, cz);
    // Rail clip
    add(B(0.14,0.06,0.06), mSteelL, cx, RAIL_Y-0.02, cz);
  }

  for (let l=0; l<LANES; l++) {
    const tx = -ROOM_W/2 + l*LANE_W + LANE_W/2;
    makeTarget(tx, targetRowZ);
  }

  // ── BULLET TRAP at far wall ───────────────────────────────────────────────
  add(B(ROOM_W+1,2.2,0.10),mSteel,0,1.1,TARGET_Z-0.22);
  // Angled deflector baffle
  const trapGeo=B(ROOM_W+1,0.08,1.4);
  const trap=new THREE.Mesh(trapGeo,mSteel);
  trap.position.set(0,1.26,TARGET_Z-0.90); trap.rotation.x=0.45;
  trap.castShadow=trap.receiveShadow=true; scene.add(trap);

  // ── WEAPONS ON BENCH (all guns, pick up with F) ───────────────────────────
  const GUN_KEYS=['pistol','deagle','ar','ak','smg','p90','sr','barrett','shotgun','spas','machete','crowbar','bat'];
  GUN_KEYS.forEach((wk,gi) => {
    const lane = gi % LANES;
    const col  = Math.floor(gi/LANES);
    const lx   = -ROOM_W/2 + lane*LANE_W + LANE_W/2 + (col===0?-0.45:0.45);
    createLootMesh({type:'weapon',key:wk,name:WEAPONS[wk].name}, lx, SHOOTER_Z+BOOTH_D*0.6, counterY+0.10);
  });

  // Attachments on bench back edge
  const ATT_KEYS=['reddot','scope2x','scope4x','scope8x','grip','extmag','comp','silencer'];
  ATT_KEYS.forEach((ak2,ai) => {
    const ax=-ROOM_W/2+1.5+ai*(ROOM_W-3)/(ATT_KEYS.length-1);
    createLootMesh({type:'attachment',key:ak2,name:ATTACHMENTS[ak2].name}, ax, SHOOTER_Z+BOOTH_D-0.6, counterY+0.10);
  });
  createLootMesh({type:'heal',key:'medkit', name:'MEDKIT' }, -ROOM_W/2+1.2, SHOOTER_Z+BOOTH_D*0.6, counterY+0.10);
  createLootMesh({type:'heal',key:'bandage',name:'BANDAGE'}, -ROOM_W/2+2.2, SHOOTER_Z+BOOTH_D*0.6, counterY+0.10);

  // ── HUD ──────────────────────────────────────────────────────────────────
  const badge=document.createElement('div');
  badge.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);font-family:"Bebas Neue",sans-serif;font-size:15px;letter-spacing:5px;color:#ff5028;background:rgba(0,0,0,0.65);padding:4px 18px;z-index:20;pointer-events:none;border:1px solid rgba(255,80,40,0.3);';
  badge.textContent='⊕  SHOOTING RANGE  ·  8 LANES  ·  25M  ·  F=PICKUP  TAB=INVENTORY  ⊕';
  document.body.appendChild(badge);

  // ── SPAWN ────────────────────────────────────────────────────────────────
  await Promise.all([preloadKar98(), preloadUmp45(), preloadBeretta(), preloadIzh27(), preloadSpas12()]);
  player=new Entity(0, SHOOTER_Z+BOOTH_D*0.5, true);
  player.botName='YOU';
  player.giveWeapon('pistol');
  player.equip(3);

  entities=[player];
  zone={center:new THREE.Vector3(),radius:9999,nextRadius:9999,nextCenter:new THREE.Vector3(),
        stage:0,timer:99999,shrinkTime:0,shrinkDuration:0,damage:0,startRadius:9999,startCenter:new THREE.Vector3()};
  const rg=new THREE.RingGeometry(9998,9999,4); rg.rotateX(-Math.PI/2);
  zone.ring=new THREE.Mesh(rg,new THREE.MeshBasicMaterial({visible:false})); scene.add(zone.ring);
  zone.wallGeo=new THREE.CylinderGeometry(9999,9999,80,4,1,true);
  zone.wallMat=new THREE.MeshBasicMaterial({visible:false});
  zone.wall=new THREE.Mesh(zone.wallGeo,zone.wallMat); scene.add(zone.wall);

  for(const obj of searchableObjects) obj.items=generateContainerLoot(obj.type);
  const _pw2 = new THREE.Group();
  if (BERETTA_MODEL) buildPistol(_pw2, {});
  if (UMP45_MODEL)   buildSMG(_pw2, {});
  if (KAR98_MODEL)   buildSniper(_pw2, {});
  if (IZH27_MODEL)   buildShotgun(_pw2, {});
  if (SPAS12_MODEL)  buildSPAS(_pw2, {});
  _pw2.traverse(o => {
    if (o.geometry && !o.userData.fromBaked) o.geometry.dispose();
    if (o.material && !o.userData.fromBaked) o.material.dispose();
  });
  buildMuzzleFlash(); buildViewmodel(); setupInput(); preloadAudio();
  window.addEventListener('resize',onResize);
  animate();
}


// ============================================================================
// SKY
// ============================================================================
function buildSky(tc) {
  // Derive sky colors from time-of-day config
  const sunPos = new THREE.Vector3(...tc.sunPos).normalize();
  const isNight = globalThis._timeOfDay === 5;
  const isDusk  = globalThis._timeOfDay === 4;
  const isDawn  = globalThis._timeOfDay === 0;

  // Sky palette per tod
  const skyPalettes = {
    //          zenith              mid-sky             horizon             haze/low
    0: [ [0.12,0.14,0.28], [0.40,0.30,0.36], [0.80,0.48,0.28], [0.95,0.62,0.35] ], // dawn
    1: [ [0.20,0.32,0.60], [0.38,0.50,0.75], [0.75,0.65,0.50], [0.90,0.78,0.58] ], // morning
    2: [ [0.18,0.32,0.68], [0.32,0.52,0.80], [0.68,0.75,0.85], [0.82,0.84,0.88] ], // midday
    3: [ [0.18,0.28,0.55], [0.30,0.42,0.68], [0.82,0.62,0.38], [0.95,0.80,0.60] ], // afternoon
    4: [ [0.08,0.06,0.16], [0.24,0.14,0.22], [0.75,0.28,0.10], [0.90,0.45,0.18] ], // dusk
    5: [ [0.02,0.03,0.08], [0.04,0.06,0.14], [0.08,0.10,0.20], [0.12,0.14,0.22] ], // night
  };
  const pal = skyPalettes[globalThis._timeOfDay];

  const skyGeo = new THREE.SphereGeometry(1500, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      sunDir:   { value: sunPos },
      zenith:   { value: new THREE.Vector3(...pal[0]) },
      midSky:   { value: new THREE.Vector3(...pal[1]) },
      horizon:  { value: new THREE.Vector3(...pal[2]) },
      haze:     { value: new THREE.Vector3(...pal[3]) },
      isNight:  { value: isNight ? 1.0 : 0.0 },
      isDuskDawn:{ value: (isDusk || isDawn) ? 1.0 : 0.0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 sunDir, zenith, midSky, horizon, haze;
      uniform float isNight, isDuskDawn;

      float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

      void main() {
        float h = clamp(vDir.y, -0.05, 1.0);

        // Four-band sky gradient
        vec3 sky = mix(haze,    horizon, smoothstep(-0.05, 0.06, h));
        sky       = mix(sky,    midSky,  smoothstep(0.04,  0.22, h));
        sky       = mix(sky,    zenith,  smoothstep(0.18,  0.70, h));

        // Rayleigh scatter near horizon (stronger at dusk/dawn)
        float scatter = pow(max(0.0, 1.0 - h * 5.0), 2.5);
        vec3 scatterCol = mix(vec3(0.5,0.3,0.1), vec3(0.8,0.4,0.1), isDuskDawn) * (0.2 + isDuskDawn * 0.3);
        sky += scatterCol * scatter;

        // Sun disk, corona, glow
        float sd     = max(dot(vDir, sunDir), 0.0);
        float disk   = smoothstep(0.9994, 0.9999, sd);
        float corona = smoothstep(0.996,  0.9994, sd) * 0.55;
        float glow   = pow(sd, isDuskDawn > 0.5 ? 4.0 : 10.0) * (0.15 + isDuskDawn * 0.25);
        float halo   = pow(sd, 2.5) * 0.06 * (1.0 - isNight);
        sky += vec3(1.0, 0.98, 0.85) * disk;
        sky += vec3(1.0, 0.80, 0.50) * corona;
        sky += vec3(1.0, 0.60, 0.20) * glow * (1.0 - isNight * 0.9);
        sky += vec3(0.8, 0.65, 0.45) * halo;

        // Moon (night only) — opposite of sun roughly
        if (isNight > 0.5) {
          vec3 moonDir = normalize(vec3(-0.3, 0.8, 0.5));
          float md = max(dot(vDir, moonDir), 0.0);
          sky += vec3(0.85,0.88,1.0) * smoothstep(0.9996, 0.9999, md);        // disk
          sky += vec3(0.5, 0.55, 0.7) * pow(md, 18.0) * 0.08;                // glow
          // Stars
          vec3 starDir = floor(vDir * 80.0);
          float star = hash(starDir.xy + starDir.z * 43.0);
          float starVis = step(0.988, star) * max(0.0, vDir.y) * (1.0 - smoothstep(0.0,0.15,abs(dot(vDir,moonDir)-1.0)));
          sky += vec3(0.9,0.92,1.0) * starVis * 0.8;
        }

        // Cloud band near horizon
        float cloud = smoothstep(0.03, 0.10, h) * smoothstep(0.28, 0.12, h);
        vec3 cloudCol = mix(vec3(0.55,0.45,0.42), vec3(0.90,0.86,0.82), 1.0 - isDuskDawn * 0.6);
        sky = mix(sky, cloudCol, cloud * 0.22);

        gl_FragColor = vec4(sky, 1.0);
      }
    `
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
}

// ============================================================================
// WORLD GENERATION
// ============================================================================

// ---------- Performance helpers: merge static geometry into single meshes ----------
// Collect (geometry, color) pairs and merge them into one buffer geometry whose
// vertex colors encode each piece's color. One mesh = one draw call.
function makeMergedMesh(parts, baseMaterial = null) {
  // parts: [{ geo: BufferGeometry, color: number, matrix: Matrix4 }]
  if (!parts.length) return null;
  const geos = [];
  for (const p of parts) {
    const g = p.geo.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    const count = g.attributes.position.count;
    const c = new THREE.Color(p.color);
    const cArr = new Float32Array(count * 3);
    for (let i=0; i<count; i++) {
      cArr[i*3] = c.r; cArr[i*3+1] = c.g; cArr[i*3+2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
    // Strip non-position/normal/uv/color attributes so all geos are compatible
    for (const k of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    }
    geos.push(g);
  }
  const merged = BufferGeometryUtils.mergeBufferGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return null;
  const mat = baseMaterial || new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, metalness: 0.04,
  });
  return new THREE.Mesh(merged, mat);
}

// Shared geometries (created once and reused)
const SHARED_GEO = {
  unitBox: new THREE.BoxGeometry(1, 1, 1),
  unitCyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  unitCyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  unitSphere: new THREE.IcosahedronGeometry(1, 0),
  unitDodec: new THREE.DodecahedronGeometry(1, 0),
};
// Make a transformed unit-box geo (for merging)
function makeBoxGeo(w, h, d, x=0, y=0, z=0, rx=0, ry=0, rz=0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) {
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  }
  if (x || y || z) {
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  }
  return g;
}
function makeCylGeo(r1, r2, h, segs, x=0, y=0, z=0, rx=0, ry=0, rz=0) {
  const g = new THREE.CylinderGeometry(r1, r2, h, segs);
  if (rx || ry || rz) {
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  }
  if (x || y || z) {
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  }
  return g;
}

function buildWorld() {
  // Compute city center & footprint up front so we can color the ground accordingly
  const cityCenter = new THREE.Vector2(
    (Math.random()-0.5) * MAP.size * 0.4,
    (Math.random()-0.5) * MAP.size * 0.4
  );
  const cityRadius = Math.min(MAP.size * 0.44, 280);

  // ----- Ground mesh — higher res, FBM-driven vertex colors -----
  const SEGS = 200; // more subdivisions = smoother hills
  const groundGeo = new THREE.PlaneGeometry(MAP.size*2.4, MAP.size*2.4, SEGS, SEGS);
  groundGeo.rotateX(-Math.PI/2);
  const pos = groundGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const cityBaseY = 0;
  const WATER_LEVEL = -2.8; // anything below this is a riverbed/pond

  // Palette — richer, more naturalistic
  const cSnow      = new THREE.Color(0xe8ecee);
  const cRock      = new THREE.Color(0x686460);
  const cRockDark  = new THREE.Color(0x424040);
  const cRockLight = new THREE.Color(0x807c78);
  const cGrassDark = new THREE.Color(0x243016);
  const cGrass     = new THREE.Color(0x3a5624);  // base green
  const cGrassLite = new THREE.Color(0x527038);
  const cGrassHill = new THREE.Color(0x6a7a44);  // lighter at altitude
  const cDry       = new THREE.Color(0x847840);  // dry/yellowed
  const cDirt      = new THREE.Color(0x623e26);
  const cDirtDark  = new THREE.Color(0x3e2616);
  const cClay      = new THREE.Color(0x8e6444);
  const cMoss      = new THREE.Color(0x2e441a);
  const cSand      = new THREE.Color(0xbcae88);  // riverbanks / exposed sand
  const cWetSand   = new THREE.Color(0x6e5e44);  // underwater / wet
  const cAsphalt   = new THREE.Color(0x22222a);
  const cAsphaltW  = new THREE.Color(0x30302e);

  // Pre-compute heights for slope calculation (need neighbours)
  const SEG1 = SEGS + 1;
  const heightCache = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const distCity = Math.hypot(x - cityCenter.x, z - cityCenter.y);
    const bS = cityRadius + 30, bE = cityRadius + 170;
    let cf;
    if (distCity <= bS) cf = 1.0;
    else if (distCity >= bE) cf = 0.0;
    else { const t=(distCity-bS)/(bE-bS); cf=1.0-t*t*(3-2*t); }
    heightCache[i] = rawTerrainNoise(x, z) * (1 - cf);
  }

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightCache[i];
    pos.setY(i, Math.max(h, WATER_LEVEL - 0.2)); // clamp river bed

    // Slope: approximate gradient from neighbours
    const row = Math.floor(i / SEG1), col = i % SEG1;
    const hR = col < SEGS ? heightCache[i+1]      : h;
    const hL = col > 0    ? heightCache[i-1]      : h;
    const hU = row < SEGS ? heightCache[i+SEG1]   : h;
    const hD = row > 0    ? heightCache[i-SEG1]   : h;
    const slope = Math.sqrt(((hR-hL)*0.5)**2 + ((hU-hD)*0.5)**2);

    // City blend
    const distCity = Math.hypot(x - cityCenter.x, z - cityCenter.y);
    const bS = cityRadius + 30, bE = cityRadius + 170;
    let cityFlat;
    if (distCity <= bS) cityFlat = 1.0;
    else if (distCity >= bE) cityFlat = 0.0;
    else { const t=(distCity-bS)/(bE-bS); cityFlat=1.0-t*t*(3-2*t); }

    // Noise layers for biome
    const nb = _fbm(x*0.022 + 1.3, z*0.020 + 0.7, 3) * 0.5 + 0.5; // biome blend
    const nd = _fbm(x*0.045 + 3.1, z*0.042 + 5.2, 2) * 0.5 + 0.5; // detail
    const nm = _fbm(x*0.012 + 7.4, z*0.011 + 2.8, 3) * 0.5 + 0.5; // macro

    let gc = new THREE.Color();

    if (h <= WATER_LEVEL + 0.4) {
      // Riverbed / pond bottom — dark wet silt
      gc.copy(cWetSand).lerp(cDirtDark, nd * 0.7 + 0.15);
    } else if (h <= WATER_LEVEL + 2.2) {
      // Riverbank / muddy shore gradient
      const bankT = (h - (WATER_LEVEL + 0.4)) / 1.8;
      gc.copy(cWetSand).lerp(cSand, bankT).lerp(cDirt, nd * 0.45);
    } else if (slope > 1.4) {
      // Very steep cliff face — raw rock
      gc.copy(cRockDark).lerp(cRock, nd * 0.8 + 0.1);
    } else if (slope > 0.70) {
      // Scree / rocky slope — rock with dirt veins
      gc.copy(cRock).lerp(cRockLight, nm * 0.4).lerp(cDirt, nd * 0.3 + nb * 0.2);
    } else if (h > 7.5) {
      // High altitude — snow-capped rock
      const snowT = Math.min(1, (h - 7.5) / 5.0);
      gc.copy(cRock).lerp(cRockLight, nm * 0.3).lerp(cSnow, snowT * nm * 0.9 + snowT * 0.1);
    } else if (h > 4.0 && slope > 0.30) {
      // Mid-altitude rocky grass
      gc.copy(cGrassHill).lerp(cRock, (slope - 0.30) / 0.40 * 0.55).lerp(cGrassLite, nd * 0.3);
    } else if (nb < 0.20) {
      // Dry / arid biome
      gc.copy(cClay).lerp(cDry, nd * 0.6 + 0.1);
    } else if (nb > 0.75) {
      // Very moist — deep moss and dark undergrowth
      gc.copy(cMoss).lerp(cGrassDark, nd * 0.6).lerp(cGrass, nm * 0.3);
    } else if (nd < 0.22) {
      // Bare exposed dirt patches
      gc.copy(cDirtDark).lerp(cDirt, nb * 0.8 + 0.1);
    } else if (h > 2.8 && nm > 0.48) {
      // Elevated open grass / meadow
      gc.copy(cGrassHill).lerp(cGrassLite, nd * 0.5).lerp(cGrass, (1 - nm) * 0.4);
    } else {
      // Default grass — smooth biome blend with moisture
      const moistureT = Math.max(0, Math.min(1, (nb - 0.20) / 0.55));
      gc.copy(cGrassDark).lerp(cGrass, moistureT).lerp(cGrassLite, nd * moistureT * 0.5);
    }

    // Worn dirt band at city edge transition
    const edgeMix = Math.max(0, 1.0 - Math.abs(distCity - (cityRadius + 70)) / 50);
    gc.lerp(cDirt, edgeMix * 0.55);

    // Asphalt
    const aspC = new THREE.Color().copy(cAsphalt).lerp(cAsphaltW, nb * 0.4);
    const c = new THREE.Color().copy(gc).lerp(aspC, cityFlat);

    // Micro jitter
    const jv = ((Math.sin(i*127.1+311.7)*43758.5453)%1+1)%1;
    const jit = (jv-0.5)*0.05;
    c.r = Math.max(0,Math.min(1, c.r + jit*0.7));
    c.g = Math.max(0,Math.min(1, c.g + jit));
    c.b = Math.max(0,Math.min(1, c.b + jit*0.5));
    colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
  }

  groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.90, metalness: 0.0 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.userData.isGround = true;
  ground.matrixAutoUpdate = false; ground.updateMatrix();
  scene.add(ground);

  // ── Water plane (river/pond) ──
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x18324e, roughness: 0.02, metalness: 0.88,
    transparent: true, opacity: 0.76,
    envMapIntensity: 1.6,
  });
  const waterGeo = new THREE.PlaneGeometry(MAP.size*2.4, MAP.size*2.4);
  waterGeo.rotateX(-Math.PI/2);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WATER_LEVEL;
  water.receiveShadow = false;
  water.frustumCulled = false;
  scene.add(water);

  world = { ground, cityCenter, cityRadius, cityBaseY };

  // borders (visible map edge - subtle dark wall)
  const wallMat = new THREE.MeshStandardMaterial({ color:0x1c1c1c, roughness:1.0 });
  for (let i=0; i<4; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(MAP.size*2.4, 30, 2), wallMat);
    w.position.y = 15;
    if (i===0) w.position.set(0, 15, -MAP.size*1.2);
    if (i===1) w.position.set(0, 15, MAP.size*1.2);
    if (i===2) { w.rotation.y=Math.PI/2; w.position.set(-MAP.size*1.2, 15, 0); }
    if (i===3) { w.rotation.y=Math.PI/2; w.position.set(MAP.size*1.2, 15, 0); }
    scene.add(w);
  }

  // ----- BUILD THE CITY -----
  buildCity(cityCenter.x, cityCenter.y, cityRadius);

  flushLampPosts(); // merge all lamp posts into one draw call
  // ── Neighborhoods: one per map quadrant ─────────────────────────────────
  // Four quadrant offsets: NW, NE, SE, SW
  const quadrants = [
    { sx: -1, sz: -1 }, { sx:  1, sz: -1 },
    { sx:  1, sz:  1 }, { sx: -1, sz:  1 }
  ];

  const LOOT_WEAPONS = ['pistol','ar','smg','shotgun','sr','bat','crowbar'];

  function spawnHouseLoot(hx, hz, facing) {
    const itemCount = 1 + Math.floor(Math.random() * 3);
    const lootPool = [...LOOT_WEAPONS].sort(() => Math.random()-0.5);
    for (let i = 0; i < itemCount; i++) {
      const lx = hx + Math.cos(facing) * 2.5 + (Math.random()-0.5)*3;
      const lz = hz + Math.sin(facing) * 2.5 + (Math.random()-0.5)*3;
      // Get terrain Y then add floor height so loot sits on the floor, not in it
      const ly = rawTerrainNoise(lx, lz) + 0.35;
      const roll = Math.random();
      if (roll < 0.45) {
        // Weighted weapon pool
        const gunRoll = Math.random();
        let wk;
        if      (gunRoll < 0.20) wk = 'pistol';
        else if (gunRoll < 0.38) wk = 'bat';
        else if (gunRoll < 0.50) wk = 'deagle';
        else if (gunRoll < 0.62) wk = 'ar';
        else if (gunRoll < 0.72) wk = 'shotgun';
        else if (gunRoll < 0.80) wk = 'smg';
        else if (gunRoll < 0.87) wk = 'spas';
        else if (gunRoll < 0.93) wk = 'ak';
        else if (gunRoll < 0.96) wk = 'p90';
        else                     wk = 'sr';
        const w = WEAPONS[wk];
        createLootMesh({ type:'weapon', key:wk, name:w.name }, lx, lz, ly);
        if (!w.melee) createLootMesh({ type:'ammo', amount: Math.floor(w.reserve * 0.4), name:'AMMO' }, lx + 1, lz, ly);
      } else if (roll < 0.75) {
        createLootMesh({ type:'heal', key:'bandage', name:'BANDAGE' }, lx, lz, ly);
      } else if (roll < 0.90) {
        createLootMesh({ type:'armor', amount:50, name:'ARMOR' }, lx, lz, ly);
      } else {
        createLootMesh({ type:'ammo', amount:10, name:'AMMO' }, lx, lz, ly);
      }
    }
  }

  function makeNeighborhood(qx, qz) {
    // Pick centre in this quadrant, away from city and map edge
    let ncx, ncz, att = 0;
    do {
      const r = cityRadius + 140 + Math.random() * (MAP.size * 0.22);
      const ang = Math.atan2(qz, qx) + (Math.random()-0.5) * 0.6;
      ncx = cityCenter.x + Math.cos(ang) * r;
      ncz = cityCenter.y + Math.sin(ang) * r;
      att++;
    } while ((Math.abs(ncx) > MAP.size*0.78 || Math.abs(ncz) > MAP.size*0.78) && att < 20);

    const houseCount = 3 + Math.floor(Math.random() * 3); // 3-5 houses
    const circleR = 24 + Math.random() * 8; // radius of the neighborhood circle
    const lootHouseIdx = Math.floor(Math.random() * houseCount);

    for (let i = 0; i < houseCount; i++) {
      const ang = (i / houseCount) * Math.PI * 2;
      const hx = ncx + Math.cos(ang) * circleR;
      const hz = ncz + Math.sin(ang) * circleR;
      // rotation.y = ang+PI → local +Z faces toward centre (inward)
      const facingAng = ang + Math.PI;

      if (Math.hypot(hx - cityCenter.x, hz - cityCenter.y) < cityRadius + 50) continue;
      if (Math.abs(hx) > MAP.size*0.82 || Math.abs(hz) > MAP.size*0.82) continue;

      const isLootHouse = (i === lootHouseIdx);

      if (isLootHouse) {
        makeLootHouse(hx, hz, facingAng);
        spawnHouseLoot(hx, hz, facingAng);
        // Garbage can: spawn perpendicular, far enough to always be outside house (w=12, so w/2+3=9)
        const doorDirX2 = Math.cos(ang + Math.PI);
        const doorDirZ2 = Math.sin(ang + Math.PI);
        const perpX2 = -doorDirZ2, perpZ2 = doorDirX2;
        const canX = hx + perpX2 * 9;
        const canZ = hz + perpZ2 * 9;
        makeGarbageCan(canX, canZ, Math.random() * Math.PI * 2);
      } else {
        makeBuilding(hx, hz, 12, 14, 5.5, facingAng);
      }

      // (path removed — never lined up correctly)

      // Tree behind house (opposite of door direction = toward ang)
      if (Math.random() < 0.5) {
        makeTree(hx + Math.cos(ang) * 9 + (Math.random()-0.5)*3,
                 hz + Math.sin(ang) * 9 + (Math.random()-0.5)*3);
      }
    }

    // Gravel/dirt circle in the middle
    const circleGeo = new THREE.CylinderGeometry(circleR * 0.55, circleR * 0.55, 0.14, 32);
    const circleMat = new THREE.MeshStandardMaterial({
      color: 0xa09678, roughness: 0.96, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const circleMesh = new THREE.Mesh(circleGeo, circleMat);
    const cY = sampleTerrainHeight(ncx, ncz);
    circleMesh.position.set(ncx, cY + 0.12, ncz);
    circleMesh.receiveShadow = true;
    scene.add(circleMesh);
  }

  function makeLootHouse(x, z, facingAng) {
    const w = 12, d = 14, h = 5.5;
    const cs = BLDG_COLORS[Math.floor(Math.random()*BLDG_COLORS.length)];
    const wallC = cs.wall, roofC = cs.roof, accentC = cs.accent;
    const windowC = 0x2a3a4a, trimC = 0x222428;
    const groundY = rawTerrainNoise(x, z);
    const doorW = 1.8, doorH = 3.8; // much taller door
    const sideW = (w - doorW) / 2;

    const parts = [];
    // Side walls (full)
    parts.push({ geo: makeBoxGeo(0.4, h, d, -w/2, h/2, 0), color: wallC });
    parts.push({ geo: makeBoxGeo(0.4, h, d,  w/2, h/2, 0), color: wallC });
    // Back wall (full)
    parts.push({ geo: makeBoxGeo(w, h, 0.4, 0, h/2, -d/2), color: wallC });
    // Front wall — open door gap: left strip, right strip, lintel
    parts.push({ geo: makeBoxGeo(sideW, h, 0.4, -(doorW/2+sideW/2), h/2, d/2), color: wallC });
    parts.push({ geo: makeBoxGeo(sideW, h, 0.4,  (doorW/2+sideW/2), h/2, d/2), color: wallC });
    // Only add lintel if door doesn't reach ceiling
    if (doorH < h - 0.2) {
      parts.push({ geo: makeBoxGeo(doorW, h-doorH, 0.4, 0, doorH+(h-doorH)/2, d/2), color: wallC });
    }
    // Door frame trim
    parts.push({ geo: makeBoxGeo(doorW+0.15, 0.12, 0.08, 0, doorH, d/2+0.05), color: trimC });
    parts.push({ geo: makeBoxGeo(0.12, doorH, 0.08, -(doorW/2), doorH/2, d/2+0.05), color: trimC });
    parts.push({ geo: makeBoxGeo(0.12, doorH, 0.08,  (doorW/2), doorH/2, d/2+0.05), color: trimC });
    // Foundation
    parts.push({ geo: makeBoxGeo(w+0.4, 0.6, d+0.4, 0, 0.3, 0), color: accentC });
    parts.push({ geo: makeBoxGeo(w+0.8, 2.5, d+0.8, 0, -1.25, 0), color: 0x2a2828 });
    // Windows — sides and back ONLY, not front face
    const winW = 1.0, winH = 1.2, wy = h*0.35;
    const winColsZ = Math.max(1, Math.floor(d/4));
    // Side windows (X faces)
    parts.push({ geo: makeBoxGeo(0.04, winH, winW, -w/2-0.025, wy, -d/4), color: windowC });
    parts.push({ geo: makeBoxGeo(0.04, winH, winW, -w/2-0.025, wy,  d/4), color: windowC });
    parts.push({ geo: makeBoxGeo(0.04, winH, winW,  w/2+0.025, wy, -d/4), color: windowC });
    parts.push({ geo: makeBoxGeo(0.04, winH, winW,  w/2+0.025, wy,  d/4), color: windowC });
    // Back windows only
    for (let c=0; c<winColsZ; c++) {
      const wz = -d/2 + (d/(winColsZ+1))*(c+1);
      parts.push({ geo: makeBoxGeo(winW, winH, 0.04, -w/4, wy, -d/2-0.025), color: windowC });
      parts.push({ geo: makeBoxGeo(winW, winH, 0.04,  w/4, wy, -d/2-0.025), color: windowC });
      break; // just 2 back windows
    }
    // Hip roof
    const rh=1.4, overhang=0.4;
    const W=w+overhang*2, D=d+overhang*2, ridgeLen=D*0.55;
    const slopeAngleX=Math.atan2(rh,D/2-ridgeLen*0.05);
    const slopeLen=Math.sqrt((D/2)*(D/2)+rh*rh);
    parts.push({ geo: makeBoxGeo(W,0.22,slopeLen,0,h+rh/2, D/4, slopeAngleX,0,0), color:roofC });
    parts.push({ geo: makeBoxGeo(W,0.22,slopeLen,0,h+rh/2,-D/4,-slopeAngleX,0,0), color:roofC });
    const slopeAngleZ=Math.atan2(rh,W/2), slopeLenZ=Math.sqrt((W/2)*(W/2)+rh*rh);
    parts.push({ geo: makeBoxGeo(slopeLenZ,0.22,ridgeLen, W/4,h+rh/2,0,0,0,-slopeAngleZ), color:roofC });
    parts.push({ geo: makeBoxGeo(slopeLenZ,0.22,ridgeLen,-W/4,h+rh/2,0,0,0, slopeAngleZ), color:roofC });

    if (!makeBuilding._mat) makeBuilding._mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const mesh = makeMergedMesh(parts, makeBuilding._mat);
    for (const p of parts) p.geo.dispose();
    if (!mesh) return;
    mesh.position.set(x, groundY, z);
    mesh.rotation.y = facingAng;
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);

    // Add LOS-blocking collision boxes for three walls (no lateral movement block, just LOS).
    // The front wall (with the door) is intentionally omitted so bots can't see through
    // the side/back walls but entry through the doorway isn't blocked visually or for LOS.
    const halfW = (w / 2) * 1.05, halfD = (d / 2) * 1.05;
    const wallThick = 0.5;
    const houseY = groundY;
    function addWallSentinel(cx, cz, ww, wd) {
      const obj = new THREE.Object3D();
      const bbox = new THREE.Box3(
        new THREE.Vector3(cx - ww/2, houseY - 0.3, cz - wd/2),
        new THREE.Vector3(cx + ww/2, houseY + h + 0.5, cz + wd/2)
      );
      obj.userData.bbox = bbox;
      obj.userData.losOnly = true; // don't block player movement
      buildings.push(obj);
    }
    // Rotate wall centres into world space
    const cos = Math.cos(facingAng), sin = Math.sin(facingAng);
    function rot(lx, lz) {
      return { x: x + lx*cos - lz*sin, z: z + lx*sin + lz*cos };
    }
    // left wall  (local -x face)
    const lw = rot(-halfW, 0); addWallSentinel(lw.x, lw.z, wallThick, d + wallThick*2);
    // right wall (local +x face)
    const rw = rot( halfW, 0); addWallSentinel(rw.x, rw.z, wallThick, d + wallThick*2);
    // back wall  (local -z face, opposite door)
    const bk = rot(0, -halfD); addWallSentinel(bk.x, bk.z, w + wallThick*2, wallThick);
    // front wall (local +z, has door) — NO sentinel: keeps door entry open for LOS too
  }

  for (const q of quadrants) {
    makeNeighborhood(q.sx, q.sz);
  }

  // Lone loot houses scattered outside city
  const numTowns = Math.max(2, Math.floor(MAP.size/220));
  for (let t=0; t<numTowns; t++) {
    let lhx, lhz, attempts = 0;
    do {
      lhx = (Math.random()-0.5) * MAP.size*1.6;
      lhz = (Math.random()-0.5) * MAP.size*1.6;
      attempts++;
    } while (Math.hypot(lhx - cityCenter.x, lhz - cityCenter.y) < cityRadius + 80 && attempts < 12);
    const facingAng = Math.random() * Math.PI * 2;
    makeLootHouse(lhx, lhz, facingAng);
    spawnHouseLoot(lhx, lhz, facingAng);
    makeGarbageCan(
      lhx + Math.cos(facingAng+Math.PI/2)*7.0,
      lhz + Math.sin(facingAng+Math.PI/2)*7.0,
      Math.random()*Math.PI*2
    );
  }

  // ── Vegetation scatter — cluster-based for natural groupings ──────────────
  const WATER_LEVEL_VEG = -2.8;
  const halfMap = MAP.size * 0.95;

  function inCity(x, z, pad=10) {
    return Math.hypot(x - cityCenter.x, z - cityCenter.y) < cityRadius + pad;
  }
  function randPos() {
    return [(Math.random()-0.5)*MAP.size*1.9, (Math.random()-0.5)*MAP.size*1.9];
  }

  // Forest clusters — dense groups of trees
  const forestCount = 8 + Math.floor(Math.random() * 4);
  for (let f = 0; f < forestCount; f++) {
    const [fx, fz] = randPos();
    if (inCity(fx, fz, 60)) continue;
    const fh = rawTerrainNoise(fx, fz);
    if (fh < WATER_LEVEL_VEG + 1.5) continue; // no forest in water
    const radius = 25 + Math.random() * 45;
    const treesInForest = Math.floor(radius * 0.9 + Math.random() * radius * 0.5);
    for (let t = 0; t < treesInForest; t++) {
      const ang = Math.random() * Math.PI * 2;
      const r   = Math.random() * radius;
      const tx  = fx + Math.cos(ang) * r;
      const tz  = fz + Math.sin(ang) * r;
      if (inCity(tx, tz, 15)) continue;
      const th = rawTerrainNoise(tx, tz);
      if (th < WATER_LEVEL_VEG + 1.0) continue;
      makeTree(tx, tz);
    }
    // Bushes around forest edge
    for (let b = 0; b < Math.floor(radius * 0.6); b++) {
      const ang = Math.random() * Math.PI * 2;
      const r   = radius * (0.7 + Math.random() * 0.5);
      const bx  = fx + Math.cos(ang) * r;
      const bz  = fz + Math.sin(ang) * r;
      if (inCity(bx, bz, 60)) continue;
      makeBush(bx, bz);
    }
  }

  // Scattered solo/pair trees outside forests
  const soloTrees = Math.floor(MAP.size * 0.10);
  for (let i = 0; i < soloTrees; i++) {
    const [tx, tz] = randPos();
    if (inCity(tx, tz, 20)) continue;
    const th = rawTerrainNoise(tx, tz);
    if (th < WATER_LEVEL_VEG + 1.0) continue;
    makeTree(tx, tz);
    // Occasionally a companion tree nearby
    if (Math.random() < 0.35) {
      makeTree(tx + (Math.random()-0.5)*6, tz + (Math.random()-0.5)*6);
    }
  }

  // Rock outcrops — clusters on ridges and slopes
  const rockClusterCount = 12 + Math.floor(Math.random() * 8);
  for (let r = 0; r < rockClusterCount; r++) {
    const [rx, rz] = randPos();
    if (inCity(rx, rz, 10)) continue;
    const rh = rawTerrainNoise(rx, rz);
    // Prefer higher terrain for rock outcrops
    const rockProb = Math.max(0, (rh - 1.0) / 6.0);
    if (Math.random() > 0.3 + rockProb * 0.7) continue;
    const clusterR = 8 + Math.random() * 20;
    const rocksInCluster = 2 + Math.floor(Math.random() * 5);
    for (let i = 0; i < rocksInCluster; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist= Math.random() * clusterR;
      makeRock(rx + Math.cos(ang)*dist, rz + Math.sin(ang)*dist);
    }
  }
  // Scattered solo rocks
  for (let i = 0; i < MAP.size * 0.08; i++) {
    const [rx, rz] = randPos();
    if (!inCity(rx, rz, 10)) makeRock(rx, rz);
  }

  // Bushes — near water, forest edges, open fields
  const bushCount = Math.floor(MAP.size * 0.18);
  for (let i = 0; i < bushCount; i++) {
    const [bx, bz] = randPos();
    if (inCity(bx, bz, 55)) continue;
    const bh = rawTerrainNoise(bx, bz);
    // More bushes near water line (riparian vegetation)
    const nearWater = Math.abs(bh - (WATER_LEVEL_VEG + 2.0)) < 2.5;
    if (bh < WATER_LEVEL_VEG + 0.6) continue;
    if (!nearWater && Math.random() < 0.3) continue;
    makeBush(bx, bz);
  }

  // Flush all vegetation into batched meshes (massive draw-call reduction)
  commitVegetationBatches();
}

// ============================================================================
// CITY BUILDER — grid of streets with multi-story buildings, cars, props
// ============================================================================
function buildCity(cx, cz, radius) {
  // Block size = building footprint + sidewalk
  const blockSize = 38;
  const streetWidth = 10;
  const cellSize = blockSize + streetWidth;
  const cellsAcross = Math.floor((radius * 2) / cellSize);
  const startX = cx - (cellsAcross * cellSize) / 2;
  const startZ = cz - (cellsAcross * cellSize) / 2;

  // Materials reused across the city
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: 0x1e1e22, roughness: 0.97, metalness: 0.03,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const sidewalkMat = new THREE.MeshStandardMaterial({
    color: 0x38363c, roughness: 0.94, metalness: 0.0,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xc8b850 });

  // Asphalt base: subdivided plane that conforms to the actual terrain at each vertex
  // so it never floats above or dips below the ground mesh.
  const baseR = radius + 6;
  const cityBaseSegs = 32; // enough resolution to follow the terrain smoothly
  const cityBaseGeo = new THREE.PlaneGeometry(baseR * 2, baseR * 2, cityBaseSegs, cityBaseSegs);
  cityBaseGeo.rotateX(-Math.PI / 2);
  {
    const bp = cityBaseGeo.attributes.position;
    for (let vi = 0; vi < bp.count; vi++) {
      const vx = bp.getX(vi) + cx;
      const vz = bp.getZ(vi) + cz;
      // Only keep vertices inside the circle — push outside ones down so they hide
      const vd = Math.hypot(bp.getX(vi), bp.getZ(vi));
      if (vd <= baseR) {
        bp.setY(vi, sampleTerrainHeight(vx, vz) + 0.02);
      } else {
        bp.setY(vi, sampleTerrainHeight(vx, vz) - 0.5); // sink outside verts below ground
      }
    }
    bp.needsUpdate = true;
    cityBaseGeo.computeVertexNormals();
  }
  const cityBase = new THREE.Mesh(cityBaseGeo, asphaltMat);
  cityBase.position.set(cx, 0, cz);
  cityBase.receiveShadow = true;
  cityBase.renderOrder = 0; // renders first; parking lots (renderOrder 1) go on top
  scene.add(cityBase);

  // Collision slab for city ground — use cityBaseY (the flat centre height)
  buildings.push({ userData:{ ground: true, bbox: new THREE.Box3(
    new THREE.Vector3(cx - baseR, -1, cz - baseR),
    new THREE.Vector3(cx + baseR, 0.20, cz + baseR)
  )}});

  // For each cell, decide if it's a building block or a (rare) park/plaza
  for (let i=0; i<cellsAcross; i++) {
    for (let j=0; j<cellsAcross; j++) {
      const cellCx = startX + i*cellSize + cellSize/2;
      const cellCz = startZ + j*cellSize + cellSize/2;
      // Skip cells whose center falls outside the city radius
      if (Math.hypot(cellCx - cx, cellCz - cz) > radius - 4) continue;

      // Sidewalk pad (slightly raised) — also registers as a solid surface
      const _swY = (world && Math.hypot(cellCx - world.cityCenter.x, cellCz - world.cityCenter.y) < world.cityRadius + 20)
        ? 0 : sampleTerrainHeight(cellCx, cellCz);
      const sw = new THREE.Mesh(
        new THREE.BoxGeometry(blockSize+2, 0.18, blockSize+2),
        sidewalkMat
      );
      sw.position.set(cellCx, _swY + 0.09, cellCz);
      sw.receiveShadow = true;
      scene.add(sw);
      // Solid collision slab for the sidewalk (thin but tall enough to stand on)
      buildings.push({ userData:{ bbox: new THREE.Box3(
        new THREE.Vector3(cellCx-(blockSize+2)/2, _swY - 0.5, cellCz-(blockSize+2)/2),
        new THREE.Vector3(cellCx+(blockSize+2)/2, _swY + 0.20, cellCz+(blockSize+2)/2)
      ), solid:false, ground:true }}); // ground:true = player stands on top

      const r = Math.random();
      if (r < 0.08) {
        makePark(cellCx, cellCz, blockSize);
      } else if (r < 0.18) {
        makeParkingLot(cellCx, cellCz, blockSize, 0);
      } else {
        makeCityBuilding(cellCx, cellCz, blockSize);
      }
    }
  }

  // Street-level ground collision slabs (invisible, fill gaps between sidewalk blocks)
  const streetSlabMat = null; // invisible
  for (let i=0; i<cellsAcross; i++) {
    for (let j=0; j<cellsAcross; j++) {
      const cellCx2 = startX + i*cellSize + cellSize/2;
      const cellCz2 = startZ + j*cellSize + cellSize/2;
      if (Math.hypot(cellCx2 - cx, cellCz2 - cz) > radius + cellSize) continue;
      const _sy = sampleTerrainHeight(cellCx2, cellCz2);
      // Horizontal street slab (between this cell and next along X)
      if (i < cellsAcross-1) {
        const sx = cellCx2 + blockSize/2 + streetWidth/2;
        const sy = sampleTerrainHeight(sx, cellCz2);
        buildings.push({ userData:{ bbox: new THREE.Box3(
          new THREE.Vector3(sx - streetWidth/2 - 1, sy - 0.5, cellCz2 - (blockSize+2)/2),
          new THREE.Vector3(sx + streetWidth/2 + 1, sy + 0.15, cellCz2 + (blockSize+2)/2)
        ), solid:false, ground:true }});
      }
      // Vertical street slab (between this cell and next along Z)
      if (j < cellsAcross-1) {
        const sz = cellCz2 + blockSize/2 + streetWidth/2;
        const sy2 = sampleTerrainHeight(cellCx2, sz);
        buildings.push({ userData:{ bbox: new THREE.Box3(
          new THREE.Vector3(cellCx2 - (blockSize+2)/2, sy2 - 0.5, sz - streetWidth/2 - 1),
          new THREE.Vector3(cellCx2 + (blockSize+2)/2, sy2 + 0.15, sz + streetWidth/2 + 1)
        ), solid:false, ground:true }});
      }
    }
  }

  // Road centre lines — one dashed line per street, clipped to city radius
  // Each street runs between adjacent cell blocks; draw per-block-pair segment
  const lineMat2 = new THREE.MeshBasicMaterial({
    color: 0xd4c840,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  // Vertical streets (run N-S, one per column boundary)
  for (let i=1; i<cellsAcross; i++) {
    const lx = startX + i*cellSize - streetWidth/2; // centre of this street
    for (let j=0; j<cellsAcross; j++) {
      // Segment runs through one cell block's span along Z
      const segZ0 = startZ + j*cellSize;
      const segZ1 = startZ + (j+1)*cellSize;
      const midZ  = (segZ0 + segZ1) / 2;
      if (Math.hypot(lx - cx, midZ - cz) > radius - 2) continue;
      const segLen = cellSize;
      const segs = Math.max(2, Math.floor(segLen / 4));
      const gV = new THREE.PlaneGeometry(0.22, segLen, 1, segs);
      gV.rotateX(-Math.PI/2);
      const pV = gV.attributes.position;
      for (let vi=0; vi<pV.count; vi++)
        pV.setY(vi, 0.06);
      pV.needsUpdate = true;
      const mV = new THREE.Mesh(gV, lineMat2);
      mV.position.set(lx, 0, midZ);
      scene.add(mV);
    }
  }
  // Horizontal streets (run E-W, one per row boundary)
  for (let j=1; j<cellsAcross; j++) {
    const lz = startZ + j*cellSize - streetWidth/2;
    for (let i=0; i<cellsAcross; i++) {
      const segX0 = startX + i*cellSize;
      const segX1 = startX + (i+1)*cellSize;
      const midX  = (segX0 + segX1) / 2;
      if (Math.hypot(midX - cx, lz - cz) > radius - 2) continue;
      const segLen = cellSize;
      const segs = Math.max(2, Math.floor(segLen / 4));
      const gH = new THREE.PlaneGeometry(segLen, 0.22, segs, 1);
      gH.rotateX(-Math.PI/2);
      const pH = gH.attributes.position;
      for (let vi=0; vi<pH.count; vi++)
        pH.setY(vi, 0.06);
      pH.needsUpdate = true;
      const mH = new THREE.Mesh(gH, lineMat2);
      mH.position.set(midX, 0, lz);
      scene.add(mH);
    }
  }

  // Parallel parked cars. Car is 4.2u long along Z at rot=0.
  // E-W kerb (south/north): rot=PI/2 aligns length with X.
  // N-S kerb (east/west):   rot=0 keeps length along Z.
  // blockSize=38, sidewalk extends ±20 from block centre, street is 10u wide.
  // kerbOffset from block edge: sidewalk is 2u wide, car body 1.85u wide.
  // Place car centre 4.5u from block edge = 1.5u inside street, clear of sidewalk.
  const placedCarBoxes = [];
  const CAR_HALF_LEN=2.2, CAR_HALF_WID=1.0, SLOT_LEN=5.2, kerbOffset=4.5;
  function tryPlaceKerbCar(px,pz,rot) {
    if (Math.hypot(px-cx,pz-cz)>radius-3) return;
    const hw=(Math.abs(rot)>0.1)?CAR_HALF_LEN:CAR_HALF_WID;
    const hd=(Math.abs(rot)>0.1)?CAR_HALF_WID:CAR_HALF_LEN;
    if (placedCarBoxes.some(b=>Math.abs(b.x-px)<hw+b.hw+0.6&&Math.abs(b.z-pz)<hd+b.hd+0.6)) return;
    placedCarBoxes.push({x:px,z:pz,hw,hd}); if(Math.random()<0.25) makeTruck(px,pz,rot); else makeCar(px,pz,rot);
  }
  for (let i=0; i<cellsAcross; i++) {
    for (let j=0; j<cellsAcross; j++) {
      const blockCx=startX+i*cellSize+cellSize/2, blockCz=startZ+j*cellSize+cellSize/2;
      if (Math.hypot(blockCx-cx,blockCz-cz)>radius-4) continue;
      const sX=Math.max(1,Math.floor((blockSize*0.7)/SLOT_LEN));
      const sZ=Math.max(1,Math.floor((blockSize*0.7)/SLOT_LEN));
      if (Math.random()<0.18) tryPlaceKerbCar(blockCx-(sX-1)*SLOT_LEN/2+Math.floor(Math.random()*sX)*SLOT_LEN, blockCz+blockSize/2+kerbOffset, Math.PI/2);
      if (Math.random()<0.18) tryPlaceKerbCar(blockCx-(sX-1)*SLOT_LEN/2+Math.floor(Math.random()*sX)*SLOT_LEN, blockCz-blockSize/2-kerbOffset, Math.PI/2);
      if (Math.random()<0.18) tryPlaceKerbCar(blockCx+blockSize/2+kerbOffset, blockCz-(sZ-1)*SLOT_LEN/2+Math.floor(Math.random()*sZ)*SLOT_LEN, 0);
      if (Math.random()<0.18) tryPlaceKerbCar(blockCx-blockSize/2-kerbOffset, blockCz-(sZ-1)*SLOT_LEN/2+Math.floor(Math.random()*sZ)*SLOT_LEN, 0);
    }
  }

  // Lamp posts on corners
  for (let i=0; i<=cellsAcross; i++) {
    for (let j=0; j<=cellsAcross; j++) {
      const lx = startX + i*cellSize - streetWidth/2;
      const lz = startZ + j*cellSize - streetWidth/2;
      if (Math.hypot(lx - cx, lz - cz) > radius - 1) continue;
      if (Math.random() > 0.55) continue;
      makeLampPost(lx + 1.5, lz + 1.5);
    }
  }

  // Dumpsters placed along building edges (realistic alley placement)
  for (let i=0; i<cellsAcross; i++) {
    for (let j=0; j<cellsAcross; j++) {
      if (Math.random() > 0.18) continue; // sparse
      const dcx = startX + i*cellSize + cellSize/2;
      const dcz = startZ + j*cellSize + cellSize/2;
      if (Math.hypot(dcx - cx, dcz - cz) > radius - 6) continue;
      // Place along the rear of the block
      const side = Math.random() < 0.5 ? 1 : -1;
      const axis = Math.random() < 0.5 ? 'x' : 'z';
      const dx = axis==='x' ? dcx + side*(blockSize/2 - 1.5) : dcx + (Math.random()-0.5)*6;
      const dz = axis==='z' ? dcz + side*(blockSize/2 - 1.5) : dcz + (Math.random()-0.5)*6;
      makeDumpster(dx, dz, axis==='x' ? 0 : Math.PI/2);
    }
  }
}

// ----- City building: multi-story office/apartment block -----
const CITY_BLDG_COLORS = [
  { wall: 0x72706c, accent: 0x4c4a46 },  // weathered concrete
  { wall: 0x4e4c4a, accent: 0x32302e },  // dark charcoal concrete
  { wall: 0x7a6e5c, accent: 0x56483c },  // sandstone
  { wall: 0x8c5242, accent: 0x5c3228 },  // brick red
  { wall: 0x50586a, accent: 0x303844 },  // steel blue-gray
  { wall: 0x7c7268, accent: 0x524a40 },  // beige stone
  { wall: 0x6a7060, accent: 0x484e40 },  // mossy concrete
  { wall: 0x5c4e44, accent: 0x3c3028 },  // dark brown brick
  { wall: 0x9a8870, accent: 0x6a5e4e },  // warm limestone
];
function makeCityBuilding(cx, cz, blockSize) {
  const stories = 4 + Math.floor(Math.random()*9); // 4–12 stories
  const storyH = 3.6 + Math.random()*0.5;           // 3.6–4.1m per floor
  const totalH = stories * storyH;
  const w = blockSize - 4 - Math.random()*4;
  const d = blockSize - 4 - Math.random()*4;
  const cs = CITY_BLDG_COLORS[Math.floor(Math.random()*CITY_BLDG_COLORS.length)];
  const wallC = cs.wall, accentC = cs.accent;
  const winFrameC = 0x2a2624;
  const doorC = 0x222020;
  const acC = 0x6a6a6a;

  // Collect the structural parts (everything that goes into the merged mesh)
  const structParts = [];
  // Main mass
  structParts.push({ geo: makeBoxGeo(w, totalH, d, 0, totalH/2, 0), color: wallC });
  // Plinth/base
  structParts.push({ geo: makeBoxGeo(w + 0.6, 0.8, d + 0.6, 0, 0.4, 0), color: accentC });
  // Ground floor accent stripe
  structParts.push({ geo: makeBoxGeo(w + 0.05, storyH * 0.6, d + 0.05, 0, storyH * 0.3, 0), color: accentC });
  // Door
  structParts.push({ geo: makeBoxGeo(1.4, 2.2, 0.08, 0, 1.1, d/2 + 0.04), color: doorC });
  // Awning
  structParts.push({ geo: makeBoxGeo(2.2, 0.12, 0.8, 0, 2.4, d/2 + 0.4), color: accentC });
  // Parapet outer
  structParts.push({ geo: makeBoxGeo(w + 0.2, 0.7, d + 0.2, 0, totalH + 0.35, 0), color: accentC });
  // Parapet inner cutout fill
  structParts.push({ geo: makeBoxGeo(w - 0.6, 0.8, d - 0.6, 0, totalH + 0.4, 0), color: wallC });
  // AC unit
  const acX = (Math.random()-0.5)*(w-4), acZ = (Math.random()-0.5)*(d-4);
  structParts.push({ geo: makeBoxGeo(2.5, 1.2, 1.6, acX, totalH + 1.1, acZ), color: acC });
  if (Math.random() < 0.6) {
    const vX = (Math.random()-0.5)*(w-4), vZ = (Math.random()-0.5)*(d-4);
    structParts.push({ geo: makeCylGeo(0.4, 0.4, 0.8, 8, vX, totalH + 0.9, vZ), color: acC });
  }

  // Window frames (merged into struct mesh)
  const margin = 1.5;
  const winStripH = 1.2;
  const winsPerSide = Math.max(2, Math.floor((w - margin*2) / 2.0));
  const winsPerSideD = Math.max(2, Math.floor((d - margin*2) / 2.0));
  // Window panes go into a separate merged mesh with the glass material
  const windowParts = [];
  for (let s=0; s<stories; s++) {
    const cy = (s + 0.5) * storyH + 0.3;
    for (let k=0; k<winsPerSide; k++) {
      const winW = (w - margin*2) / winsPerSide - 0.4;
      const winX = -w/2 + margin + (k + 0.5) * ((w - margin*2) / winsPerSide);
      // Frames (struct, vertex-colored)
      structParts.push({ geo: makeBoxGeo(winW + 0.18, winStripH + 0.18, 0.04, winX, cy, d/2 + 0.018), color: winFrameC });
      structParts.push({ geo: makeBoxGeo(winW + 0.18, winStripH + 0.18, 0.04, winX, cy, -d/2 - 0.018), color: winFrameC });
      // Window panes (separate mesh w/ emissive)
      windowParts.push(makeBoxGeo(winW, winStripH, 0.05, winX, cy, d/2 + 0.025));
      windowParts.push(makeBoxGeo(winW, winStripH, 0.05, winX, cy, -d/2 - 0.025));
    }
    for (let k=0; k<winsPerSideD; k++) {
      const winD = (d - margin*2) / winsPerSideD - 0.4;
      const winZ = -d/2 + margin + (k + 0.5) * ((d - margin*2) / winsPerSideD);
      structParts.push({ geo: makeBoxGeo(0.04, winStripH + 0.18, winD + 0.18, -w/2 - 0.018, cy, winZ), color: winFrameC });
      structParts.push({ geo: makeBoxGeo(0.04, winStripH + 0.18, winD + 0.18,  w/2 + 0.018, cy, winZ), color: winFrameC });
      windowParts.push(makeBoxGeo(0.05, winStripH, winD, -w/2 - 0.025, cy, winZ));
      windowParts.push(makeBoxGeo(0.05, winStripH, winD,  w/2 + 0.025, cy, winZ));
    }
  }

  // Build merged structural mesh
  // City is always at Y=0; buildings inside city snap to 0
  const _cityBldgY = (world && Math.hypot(cx - world.cityCenter.x, cz - world.cityCenter.y) < world.cityRadius + 20)
    ? 0 : sampleTerrainHeight(cx, cz);
  // Foundation slab: extends 3 units below ground to fill any mesh interpolation gaps
  const foundH = 3.5;
  structParts.push({ geo: makeBoxGeo(w + 1.0, foundH, d + 1.0, 0, -foundH/2 + 0.1, 0), color: 0x2a2a2a });
  const structMesh = makeMergedMesh(structParts);
  if (structMesh) {
    structMesh.position.set(cx, _cityBldgY, cz);
    structMesh.castShadow = true;
    structMesh.receiveShadow = true;
    scene.add(structMesh);
  }
  // Build merged window mesh (single material, separate from struct because of emissive)
  if (windowParts.length) {
    const winGeo = BufferGeometryUtils.mergeBufferGeometries(windowParts, false);
    for (const g of windowParts) g.dispose();
    if (winGeo) {
      if (!makeCityBuilding._winMat) {
        makeCityBuilding._winMat = new THREE.MeshStandardMaterial({
          color: 0x3a4a58, roughness: 0.12, metalness: 0.45,
          emissive: 0x1a2a3a, emissiveIntensity: 0.55,
        });
      }
      const winMesh = new THREE.Mesh(winGeo, makeCityBuilding._winMat);
      winMesh.position.set(cx, _cityBldgY, cz);
      scene.add(winMesh);
    }
  }
  // free temp source geos
  for (const p of structParts) p.geo.dispose();

  // Collision bbox
  const bbox = new THREE.Box3(
    new THREE.Vector3(cx - w/2, _cityBldgY, cz - d/2),
    new THREE.Vector3(cx + w/2, _cityBldgY + totalH, cz + d/2)
  );
  buildings.push({ userData:{ bbox, solid: true } });
}

// ----- Cars -----
const CAR_COLORS = [
  0x2a2a30, 0x4a4a55, 0x701a1a, 0x223340, 0x6a4a30, 0x444844, 0x382a22, 0x8a2018, 0x5a5a60
];
function makeCar(x, z, rot, overrideY) {
  const color = CAR_COLORS[Math.floor(Math.random()*CAR_COLORS.length)];
  // Glass and tire/trim are darker base colors that work fine vertex-colored on a single Standard material
  const tireC = 0x161616, trimC = 0x222222, lightC = 0xddd8b4, tailC = 0x882018;
  const glassC = 0x1a1f24;

  const parts = [];
  // Body parts (paint color)
  parts.push({ geo: makeBoxGeo(1.85, 0.55, 4.2, 0, 0.55, 0), color });
  parts.push({ geo: makeBoxGeo(1.85, 0.30, 1.3, 0, 0.92, -1.2), color });
  parts.push({ geo: makeBoxGeo(1.7, 0.85, 2.0, 0, 1.18, 0.20), color });
  parts.push({ geo: makeBoxGeo(1.85, 0.32, 1.1, 0, 0.93, 1.4), color });
  // Windows (vertex-colored dark; we lose subtle emissive but save a draw call)
  parts.push({ geo: makeBoxGeo(1.6, 0.05, 0.8, 0, 1.30, -0.78, -0.45, 0, 0), color: glassC });
  parts.push({ geo: makeBoxGeo(1.6, 0.05, 0.7, 0, 1.30, 1.18, 0.45, 0, 0), color: glassC });
  parts.push({ geo: makeBoxGeo(0.05, 0.6, 1.7, -0.86, 1.30, 0.20), color: glassC });
  parts.push({ geo: makeBoxGeo(0.05, 0.6, 1.7,  0.86, 1.30, 0.20), color: glassC });
  // Wheels — rotated cylinders along X
  for (const [wx, wz] of [[-0.85, -1.30], [0.85, -1.30], [-0.85, 1.40], [0.85, 1.40]]) {
    parts.push({ geo: makeCylGeo(0.36, 0.36, 0.24, 10, wx, 0.36, wz, 0, 0, Math.PI/2), color: tireC });
    parts.push({ geo: makeCylGeo(0.18, 0.18, 0.26, 8,  wx, 0.36, wz, 0, 0, Math.PI/2), color: trimC });
  }
  // Headlights / tail lights — bake-in via vertex color (no emissive but tiny size)
  for (const lx of [-0.65, 0.65]) {
    parts.push({ geo: makeBoxGeo(0.32, 0.18, 0.06, lx, 0.85, -1.85), color: lightC });
  }
  for (const lx of [-0.7, 0.7]) {
    parts.push({ geo: makeBoxGeo(0.28, 0.14, 0.06, lx, 0.92, 1.95), color: tailC });
  }
  // Bumpers
  parts.push({ geo: makeBoxGeo(1.95, 0.2, 0.18, 0, 0.55, -2.05), color: trimC });
  parts.push({ geo: makeBoxGeo(1.95, 0.2, 0.18, 0, 0.55,  2.05), color: trimC });

  // Build merged mesh with a shared semi-metallic material
  if (!makeCar._mat) {
    makeCar._mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0.55,
    });
  }
  const mesh = makeMergedMesh(parts, makeCar._mat);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return;
  const _carY = (overrideY !== undefined) ? overrideY
    : (world && Math.hypot(x - world.cityCenter.x, z - world.cityCenter.y) < world.cityRadius + 20)
      ? 0 : sampleTerrainHeight(x, z);
  mesh.position.set(x, _carY + 0.18, z);
  mesh.rotation.y = rot;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Car collision: short side slabs only over the door section (not full length)
  // Front/rear quarters are open so player can walk up hood/trunk and off the roof freely.
  const cosR=Math.cos(rot), sinR=Math.sin(rot);
  const doorHalfLen=1.0; // only covers the door section, not the full 2.25 half-length
  const halfWid=0.92, sideThick=0.45, sideTopY=_carY+0.95;
  function obbAABB(cx2,cz2,hLon,hLat,cosA,sinA,yLo,yHi) {
    const ex=Math.abs(cosA*hLon)+Math.abs(sinA*hLat), ez=Math.abs(sinA*hLon)+Math.abs(cosA*hLat);
    return new THREE.Box3(new THREE.Vector3(cx2-ex,yLo,cz2-ez),new THREE.Vector3(cx2+ex,yHi,cz2+ez));
  }
  const perpX=sinR*halfWid, perpZ=-cosR*halfWid;
  buildings.push({userData:{bbox:obbAABB(x-perpX,z-perpZ,doorHalfLen,sideThick,cosR,sinR,_carY+0.1,sideTopY),solid:true}});
  buildings.push({userData:{bbox:obbAABB(x+perpX,z+perpZ,doorHalfLen,sideThick,cosR,sinR,_carY+0.1,sideTopY),solid:true}});
  // Roof ground slab — full footprint so player can stand anywhere on top
  const roofHx=Math.abs(cosR*halfWid)+Math.abs(sinR*2.25), roofHz=Math.abs(sinR*halfWid)+Math.abs(cosR*2.25);
  buildings.push({userData:{bbox:new THREE.Box3(new THREE.Vector3(x-roofHx,_carY+1.20,z-roofHz),new THREE.Vector3(x+roofHx,_carY+1.32,z+roofHz)),ground:true}});

  registerSearchable(mesh, 'car', x, z);
}

// ----- Lamp post -----
function makeLampPost(x, z) {
  const poleC = 0x2a2826;
  const lampC = 0xffe6a8;
  const rot = Math.random() * Math.PI * 2;
  const cosY = Math.cos(rot), sinY = Math.sin(rot);
  function rxz(px, pz) { return [px*cosY - pz*sinY, px*sinY + pz*cosY]; }
  const parts = [];
  parts.push({ geo: makeCylGeo(0.20, 0.26, 0.30, 8, 0, 0.15, 0), color: poleC });
  parts.push({ geo: makeCylGeo(0.07, 0.09, 5.5, 8, 0, 2.85, 0), color: poleC });
  const [ax, az] = rxz(0.7, 0);
  parts.push({ geo: makeBoxGeo(1.4, 0.10, 0.10, ax, 5.5, az, 0, rot, 0), color: poleC });
  const [hx, hz] = rxz(1.4, 0);
  parts.push({ geo: makeBoxGeo(0.45, 0.30, 0.55, hx, 5.4, hz, 0, rot, 0), color: poleC });
  parts.push({ geo: makeBoxGeo(0.32, 0.10, 0.42, hx, 5.20, hz, 0, rot, 0), color: lampC });
  // Bake world-space position into geometry for batching (one draw call for all posts)
  const posY = sampleTerrainHeight(x, z) + 0.10;
  for (const p of parts) p.geo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, posY, z));
  if (!makeLampPost._batch) makeLampPost._batch = [];
  makeLampPost._batch.push(...parts);
}
function flushLampPosts() {
  if (!makeLampPost._batch || !makeLampPost._batch.length) return;
  if (!makeLampPost._mat) makeLampPost._mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 });
  const mesh = makeMergedMesh(makeLampPost._batch, makeLampPost._mat);
  for (const p of makeLampPost._batch) p.geo.dispose();
  makeLampPost._batch = [];
  if (mesh) scene.add(mesh);
}

// ----- Dumpster -----
function makeTruck(x, z, rot, overrideY) {
  const color = CAR_COLORS[Math.floor(Math.random()*CAR_COLORS.length)];
  const tireC = 0x161616, trimC = 0x333333, lightC = 0xddd8b4, tailC = 0x882018;
  const glassC = 0x1a1f24, grillC = 0x111111;
  const parts = [];

  // === LAYOUT (negative z = front) ===
  // Wheel radius = 0.46, center y = 0.46, tops at y=0.92
  // Front axle z=-1.7, rear axle z=+1.8
  // Chassis bottom = 0.20 (sits inside wheel arches), top = 0.72
  // Hood:  z=-1.1 to z=-3.0  (front of cab to front bumper)
  // Cab:   z=-1.1 to z=+1.1  (centered at z=0)
  // Bed:   z=+1.1 to z=+3.8  (behind cab)

  // --- WHEELS ---
  for (const [wx, wz] of [[-1.05,-1.7],[1.05,-1.7],[-1.05,1.8],[1.05,1.8]]) {
    parts.push({ geo: makeCylGeo(0.46, 0.46, 0.32, 12, wx, 0.46, wz, 0, 0, Math.PI/2), color: tireC });
    parts.push({ geo: makeCylGeo(0.22, 0.22, 0.34, 8,  wx, 0.46, wz, 0, 0, Math.PI/2), color: trimC });
  }

  // --- CHASSIS / FRAME — solid block connecting everything, sits between wheels ---
  // h=0.52, center y=0.46 (same as wheel center), bottom=0.20, top=0.72
  // Full truck length z=-3.0 to z=+3.8
  parts.push({ geo: makeBoxGeo(1.40, 0.52, 6.8, 0, 0.46, 0.40), color: trimC });

  // --- WHEEL ARCHES / FENDER BLOCKS — fill gap between chassis and body ---
  // Front fenders (over front wheels at z=-1.7)
  parts.push({ geo: makeBoxGeo(2.10, 0.52, 1.20, 0, 0.46, -1.70), color });
  // Rear fenders (over rear wheels at z=+1.8)
  parts.push({ geo: makeBoxGeo(2.10, 0.52, 1.20, 0, 0.46,  1.80), color });

  // --- LOWER BODY — connects fenders, sits on top of chassis ---
  // cab area floor z=-1.1 to +1.1
  parts.push({ geo: makeBoxGeo(2.10, 0.45, 2.20, 0, 0.90, 0.0), color });
  // hood area floor z=-1.1 to -3.0
  parts.push({ geo: makeBoxGeo(1.90, 0.45, 1.90, 0, 0.90, -2.05), color });
  // bed floor z=+1.1 to +3.8
  parts.push({ geo: makeBoxGeo(2.10, 0.45, 2.70, 0, 0.90, 2.45), color });

  // --- HOOD (raised slab over engine, z=-1.1 to -2.9) ---
  // Hood top = 1.14, h = 0.08, giving a thin raised panel look
  parts.push({ geo: makeBoxGeo(1.86, 0.40, 1.80, 0, 1.325, -2.00), color });

  // --- CAB UPPER ---
  // Bottom at body top = 1.05, height = 1.55, top = 2.60, center y = 1.825
  // z=-1.10 to +1.10, center z=0
  parts.push({ geo: makeBoxGeo(2.00, 1.55, 2.20, 0, 1.825, 0.0), color });

  // --- WINDSHIELD (front face of cab at z=-1.10) ---
  parts.push({ geo: makeBoxGeo(1.74, 1.05, 0.08, 0, 1.90, -1.08), color: glassC });

  // --- REAR WINDOW (back face of cab at z=+1.10) ---
  parts.push({ geo: makeBoxGeo(1.74, 0.70, 0.08, 0, 1.92, 1.08), color: glassC });

  // --- SIDE WINDOWS ---
  parts.push({ geo: makeBoxGeo(0.06, 0.90, 2.00, -1.00, 1.95, 0.0), color: glassC });
  parts.push({ geo: makeBoxGeo(0.06, 0.90, 2.00,  1.00, 1.95, 0.0), color: glassC });

  // --- DOOR PANELS (below windows) ---
  parts.push({ geo: makeBoxGeo(0.06, 0.55, 2.10, -1.01, 1.30, 0.0), color });
  parts.push({ geo: makeBoxGeo(0.06, 0.55, 2.10,  1.01, 1.30, 0.0), color });

  // --- DOOR HANDLE ---
  parts.push({ geo: makeBoxGeo(0.04, 0.06, 0.28, -1.02, 1.48, 0.10), color: trimC });
  parts.push({ geo: makeBoxGeo(0.04, 0.06, 0.28,  1.02, 1.48, 0.10), color: trimC });

  // --- BED RAILS (z=+1.1 to +3.8, center=+2.45) ---
  // Rail height 0.38, bottom at body top 1.05, center=1.24
  parts.push({ geo: makeBoxGeo(0.12, 0.52, 2.70, -1.00, 1.39, 2.45), color });
  parts.push({ geo: makeBoxGeo(0.12, 0.52, 2.70,  1.00, 1.39, 2.45), color });
  // Tailgate
  parts.push({ geo: makeBoxGeo(2.10, 0.52, 0.10, 0, 1.39, 3.78), color });
  // Front bed wall (cab-bed divider)
  parts.push({ geo: makeBoxGeo(2.10, 0.52, 0.10, 0, 1.39, 1.12), color });

  // --- GRILLE ---
  parts.push({ geo: makeBoxGeo(1.50, 0.42, 0.08, 0, 1.00, -2.98), color: grillC });

  // --- HEADLIGHTS ---
  for (const lx of [-0.80, 0.80]) {
    parts.push({ geo: makeBoxGeo(0.36, 0.22, 0.06, lx, 1.20, -2.98), color: lightC });
  }

  // --- TAILLIGHTS ---
  for (const lx of [-0.80, 0.80]) {
    parts.push({ geo: makeBoxGeo(0.28, 0.18, 0.06, lx, 1.00, 3.80), color: tailC });
  }

  // --- BUMPERS ---
  parts.push({ geo: makeBoxGeo(2.14, 0.24, 0.22, 0, 0.54, -3.00), color: trimC });
  parts.push({ geo: makeBoxGeo(2.14, 0.24, 0.22, 0, 0.54,  3.80), color: trimC });

  if (!makeCar._mat) makeCar._mat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.55, metalness:0.55 });
  const mesh = makeMergedMesh(parts, makeCar._mat);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return;
  const _carY = (overrideY !== undefined) ? overrideY
    : (world && Math.hypot(x - world.cityCenter.x, z - world.cityCenter.y) < world.cityRadius + 20)
      ? 0 : sampleTerrainHeight(x, z);
  mesh.position.set(x, _carY, z);
  mesh.rotation.y = rot;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  function obbAABB(cx2, cz2, hLon, hLat, cosA, sinA, yLo, yHi) {
    const ex = Math.abs(cosA*hLon)+Math.abs(sinA*hLat), ez = Math.abs(sinA*hLon)+Math.abs(cosA*hLat);
    return new THREE.Box3(new THREE.Vector3(cx2-ex,yLo,cz2-ez), new THREE.Vector3(cx2+ex,yHi,cz2+ez));
  }
  function rotPt(lx, lz) { return { x: x + lx*cosR - lz*sinR, z: z + lx*sinR + lz*cosR }; }
  // Cab solid walls: center z=0, half-depth=1.10, cab top=2.60
  const halfWid = 1.00;
  const perpX = sinR*halfWid, perpZ = -cosR*halfWid;
  const cabCx = rotPt(0, 0.0);
  buildings.push({userData:{bbox:obbAABB(cabCx.x-perpX, cabCx.z-perpZ, 1.10, 0.50, cosR, sinR, _carY+0.90, _carY+2.60), solid:true}});
  buildings.push({userData:{bbox:obbAABB(cabCx.x+perpX, cabCx.z+perpZ, 1.10, 0.50, cosR, sinR, _carY+0.90, _carY+2.60), solid:true}});
  // Cab roof
  const roofCx = rotPt(0, 0.0);
  const roofHx = Math.abs(cosR*1.00)+Math.abs(sinR*1.10), roofHz = Math.abs(sinR*1.00)+Math.abs(cosR*1.10);
  buildings.push({userData:{bbox:new THREE.Box3(new THREE.Vector3(roofCx.x-roofHx,_carY+2.58,roofCx.z-roofHz),new THREE.Vector3(roofCx.x+roofHx,_carY+2.62,roofCx.z+roofHz)),ground:true}});
  // Bed floor top = 1.05
  const bedCx = rotPt(0, 2.45);
  const bedHx = Math.abs(cosR*1.00)+Math.abs(sinR*1.35), bedHz = Math.abs(sinR*1.00)+Math.abs(cosR*1.35);
  buildings.push({userData:{bbox:new THREE.Box3(new THREE.Vector3(bedCx.x-bedHx,_carY+1.13,bedCx.z-bedHz),new THREE.Vector3(bedCx.x+bedHx,_carY+1.17,bedCx.z+bedHz)),ground:true}});
  // Toolbox at far end of bed (z=+3.2 local)
  makeToolbox(x, z, rot, _carY + 1.13, cosR, sinR);
}

function makeToolbox(truckX, truckZ, rot, bedFloorY, cosR, sinR) {
  // Place at front of bed
  const lx = 0, lz = 2.80;
  const wx = truckX + lx*cosR - lz*sinR;
  const wz = truckZ + lx*sinR + lz*cosR;
  const wy = bedFloorY; // sits right on top of bed floor

  const redC = 0xcc2222, darkC = 0x1a1a1a, handleC = 0x888888;
  const parts = [];
  parts.push({ geo: makeBoxGeo(0.80, 0.32, 0.40, 0, 0.16, 0), color: redC });  // body
  parts.push({ geo: makeBoxGeo(0.80, 0.06, 0.40, 0, 0.34, 0), color: darkC }); // lid
  parts.push({ geo: makeBoxGeo(0.30, 0.04, 0.04, 0, 0.37, -0.22), color: handleC }); // handle

  if (!makeToolbox._mat) makeToolbox._mat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.6, metalness:0.5 });
  const mesh = makeMergedMesh(parts, makeToolbox._mat);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return;
  mesh.position.set(wx, wy, wz);
  mesh.rotation.y = rot;
  mesh.castShadow = true;
  scene.add(mesh);
  registerSearchable(mesh, 'toolbox', wx, wz);
}

function makeDumpster(x, z, rot) {
  const greens = [0x2a4a35, 0x35402a, 0x402b22, 0x2e3438];
  const c = greens[Math.floor(Math.random()*greens.length)];
  const lidC = 0x1a1a1a;
  const parts = [];
  parts.push({ geo: makeBoxGeo(2.0, 1.2, 1.0, 0, 0.6, 0), color: c });
  parts.push({ geo: makeBoxGeo(2.05, 0.10, 1.05, 0, 1.25, 0.05, -0.15, 0, 0), color: lidC });
  for (let i=-1; i<=1; i++) {
    parts.push({ geo: makeBoxGeo(0.04, 1.2, 0.06, i*0.5, 0.6, 0.51), color: lidC });
    parts.push({ geo: makeBoxGeo(0.04, 1.2, 0.06, i*0.5, 0.6, -0.51), color: lidC });
  }
  if (!makeDumpster._mat) {
    makeDumpster._mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  }
  const mesh = makeMergedMesh(parts, makeDumpster._mat);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return;
  mesh.position.set(x, sampleTerrainHeight(x, z), z);
  mesh.rotation.y = rot;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  buildings.push({ userData:{ bbox: new THREE.Box3().setFromObject(mesh), solid: true } });
  registerSearchable(mesh, 'dumpster', x, z);
}

// ----- Garbage Can -----
function makeGarbageCan(x, z, rot) {
  const bodyC  = 0x4a4a52; // dark grey plastic
  const lidC   = 0x333338;
  const parts  = [];
  // Body: slightly tapered cylinder approximated with a box
  parts.push({ geo: makeBoxGeo(0.52, 0.80, 0.52, 0, 0.40, 0), color: bodyC });
  // Lid: slightly wider flat slab on top
  parts.push({ geo: makeBoxGeo(0.58, 0.08, 0.58, 0, 0.84, 0), color: lidC });
  // Lid handle
  parts.push({ geo: makeBoxGeo(0.18, 0.06, 0.06, 0, 0.92, 0), color: lidC });
  // Wheels hint (two small boxes at base)
  parts.push({ geo: makeBoxGeo(0.10, 0.08, 0.08, -0.22, 0.04, 0.20), color: 0x222228 });
  parts.push({ geo: makeBoxGeo(0.10, 0.08, 0.08,  0.22, 0.04, 0.20), color: 0x222228 });
  if (!makeGarbageCan._mat) {
    makeGarbageCan._mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  }
  const mesh = makeMergedMesh(parts, makeGarbageCan._mat);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return;
  mesh.position.set(x, sampleTerrainHeight(x, z), z);
  mesh.rotation.y = rot || 0;
  mesh.castShadow = true;
  scene.add(mesh);
  buildings.push({ userData:{ bbox: new THREE.Box3().setFromObject(mesh), solid: true } });
  registerSearchable(mesh, 'garbage_can', x, z);
}

// ----- Park / plaza -----
function makePark(cx, cz, blockSize) {
  const _insideCity = (world && Math.hypot(cx - world.cityCenter.x, cz - world.cityCenter.y) < world.cityRadius + 20);
  const _baseY = _insideCity ? 0 : sampleTerrainHeight(cx, cz);
  const _grassY = _baseY + 0.22;
  const grass = new THREE.Mesh(
    new THREE.BoxGeometry(blockSize-2, 0.12, blockSize-2),
    new THREE.MeshStandardMaterial({ color: 0x283a18, roughness: 0.95, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  grass.position.set(cx, _grassY, cz);
  grass.receiveShadow = true;
  grass.renderOrder = 2;
  scene.add(grass);
  for (let i=0; i<3 + Math.floor(Math.random()*3); i++) {
    const tx = cx + (Math.random()-0.5)*(blockSize-8);
    const tz = cz + (Math.random()-0.5)*(blockSize-8);
    makeTree(tx, tz);
  }
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x40302a, roughness: 0.9 });
  const bench = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.10, 0.5), benchMat);
  bench.position.set(cx, _grassY + 0.30, cz + 4);
  bench.castShadow = true;
  scene.add(bench);
  const benchBack = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.10), benchMat);
  benchBack.position.set(cx, _grassY + 0.65, cz + 4.2);
  scene.add(benchBack);
}

// ----- Parking lot -----
function makeParkingLot(cx, cz, blockSize, baseY) {
  // Use provided baseY (city floor) if given, else sample terrain
  const _lotY = (baseY !== undefined) ? baseY : sampleTerrainHeight(cx, cz);

  // Parking lot slab — sits well above the city asphalt to eliminate z-fighting.
  // Using a box (not plane) so it has thickness and always occludes the ground.
  // Use a thicker slab placed clearly above the asphalt base to avoid z-fighting.
  // polygonOffset pulls it toward camera in depth buffer so it always wins.
  const lotMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1e, roughness: 0.98, metalness: 0.02,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const lotThick = 0.30;
  const lot = new THREE.Mesh(
    new THREE.BoxGeometry(blockSize-2, lotThick, blockSize-2),
    lotMat
  );
  lot.position.set(cx, _lotY + lotThick/2 + 0.01, cz);
  lot.receiveShadow = true;
  lot.renderOrder = 1;
  scene.add(lot);

  const topY = _lotY + lotThick + 0.01; // surface Y for stripes and cars

  // Parking bays: two rows of spots, one each side of a centre drive lane.
  // Cars face inward (toward centre), stripes mark each spot boundary.
  const numSpots = 5; // spots per row
  const spotW = (blockSize - 6) / numSpots; // width per spot
  const carLen = 5.0;
  const halfLot = (blockSize - 2) / 2;

  const stripeMat = new THREE.MeshBasicMaterial({
    color: 0xc8c0a8, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });

  // Two rows: top row (cz + offset) and bottom row (cz - offset)
  const rowZ = [cz + 6, cz - 6]; // centre Z of each row
  const carFacing = [Math.PI/2, -Math.PI/2]; // rows face E-W (parallel to lot aisle)

  for (let row = 0; row < 2; row++) {
    const rz = rowZ[row];
    const rot = carFacing[row];

    for (let i = 0; i < numSpots; i++) {
      const spotX = cx - (blockSize-6)/2 + spotW * (i + 0.5);

      // Spot divider line (vertical stripe between spots)
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(0.15, carLen + 0.5),
        stripeMat
      );
      line.rotation.x = -Math.PI/2;
      line.position.set(spotX - spotW/2, topY + 0.005, rz);
      line.renderOrder = 2;
      scene.add(line);

      // Last spot gets right-edge line too
      if (i === numSpots - 1) {
        const lineR = line.clone();
        lineR.position.x = spotX + spotW/2;
        scene.add(lineR);
      }

      // Back-of-spot line (the stop line)
      const stop = new THREE.Mesh(
        new THREE.PlaneGeometry(spotW - 0.1, 0.15),
        stripeMat
      );
      stop.rotation.x = -Math.PI/2;
      const stopZ = row === 0 ? rz + carLen/2 : rz - carLen/2;
      stop.position.set(spotX, topY + 0.005, stopZ);
      stop.renderOrder = 2;
      scene.add(stop);

      // Spawn a car in this spot
      if (Math.random() < 0.45) {
        makeCar(spotX, rz, rot, topY); // pass explicit Y so car sits on lot surface
      }
    }
  }

  // Centre drive lane arrow hint (thin line)
  const laneStripe = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, blockSize - 8),
    new THREE.MeshBasicMaterial({ color: 0xc8c0a8, transparent:true, opacity:0.4, depthWrite:false })
  );
  laneStripe.rotation.x = -Math.PI/2;
  laneStripe.position.set(cx, topY + 0.005, cz);
  laneStripe.renderOrder = 2;
  scene.add(laneStripe);
}

// ----- Buildings: warehouses, houses, sheds with windows + varied roofs -----
const BLDG_COLORS = [
  { wall: 0xa08e78, roof: 0x4a2a1e, accent: 0x706050 },  // warm beige stucco
  { wall: 0x7c8a8e, roof: 0x283040, accent: 0x546066 },  // slate-gray clapboard
  { wall: 0xa87868, roof: 0x3a1a14, accent: 0x705248 },  // terracotta brick
  { wall: 0x72705e, roof: 0x2a2a1c, accent: 0x504e40 },  // olive cement
  { wall: 0xc8b48e, roof: 0x5c3c28, accent: 0x9e8872 },  // tan adobe
  { wall: 0x8a6e58, roof: 0x382014, accent: 0x604638 },  // dark wood siding
  { wall: 0x889070, roof: 0x303824, accent: 0x586048 },  // sage green
];
function makeBuilding(x, z, fixedW, fixedD, fixedH, rotY) {
  const w = fixedW || (8 + Math.random()*16);
  const d = fixedD || (8 + Math.random()*16);
  const h = fixedH || (4 + Math.random()*8);
  const cs = BLDG_COLORS[Math.floor(Math.random()*BLDG_COLORS.length)];
  const wallC = cs.wall, roofC = cs.roof, accentC = cs.accent;
  const trimC = 0x222428;
  const doorC = 0x3a2820;
  const windowC = 0x2a3a4a;

  // Sit on the actual terrain height at this position
  const groundY = rawTerrainNoise(x, z);

  const parts = [];
  // Main walls
  parts.push({ geo: makeBoxGeo(w, h, d, 0, h/2, 0), color: wallC });
  // Foundation
  parts.push({ geo: makeBoxGeo(w+0.4, 0.6, d+0.4, 0, 0.3, 0), color: accentC });

  // Windows on each side (just thin boxes flush with walls)
  const winRows = h > 6 ? 2 : 1;
  const winCols = Math.max(1, Math.floor(w / 4));
  const winColsZ = Math.max(1, Math.floor(d / 4));
  const winW = 1.0, winH = 1.2;
  for (let r=0; r<winRows; r++) {
    const wy = (r === 0) ? h*0.32 : h*0.65;
    for (let c=0; c<winCols; c++) {
      const wx = -w/2 + (w/(winCols+1)) * (c+1);
      parts.push({ geo: makeBoxGeo(winW, winH, 0.04, wx, wy,  d/2 + 0.025), color: windowC });
      parts.push({ geo: makeBoxGeo(winW, winH, 0.04, wx, wy, -d/2 - 0.025), color: windowC });
    }
    for (let c=0; c<winColsZ; c++) {
      const wz = -d/2 + (d/(winColsZ+1)) * (c+1);
      parts.push({ geo: makeBoxGeo(0.04, winH, winW, -w/2 - 0.025, wy, wz), color: windowC });
      parts.push({ geo: makeBoxGeo(0.04, winH, winW,  w/2 + 0.025, wy, wz), color: windowC });
    }
  }
  // Door — taller so it looks walkable
  parts.push({ geo: makeBoxGeo(1.4, 2.6, 0.06, 0, 1.3, d/2 + 0.04), color: doorC });
  parts.push({ geo: makeBoxGeo(1.6, 2.8, 0.04, 0, 1.4, d/2 + 0.02), color: trimC });

  // Roof: flat parapet (50%) or simple hip/shed (50%)
  const roofType = Math.random();
  if (roofType < 0.5) {
    // Flat roof with parapet
    parts.push({ geo: makeBoxGeo(w+0.3, 0.25, d+0.3, 0, h + 0.12, 0), color: roofC });
    parts.push({ geo: makeBoxGeo(w+0.5, 0.5, d+0.5, 0, h + 0.25, 0), color: accentC });
    parts.push({ geo: makeBoxGeo(w-0.2, 0.5, d-0.2, 0, h + 0.25, 0), color: roofC });
  } else {
    // Hip roof: four trapezoidal slabs meeting at a ridge
    const rh = 1.2 + Math.random()*1.4; // ridge height
    const overhang = 0.4;
    const W = w + overhang*2, D = d + overhang*2;
    // Ridge runs along Z axis, length = d - some offset each end
    const ridgeLen = D * 0.55;
    // Two long slopes (front/back, tilt around X)
    const slopeAngleX = Math.atan2(rh, D/2 - ridgeLen*0.05);
    const slopeLen = Math.sqrt((D/2)*(D/2) + rh*rh);
    parts.push({ geo: makeBoxGeo(W, 0.22, slopeLen, 0, h + rh/2,  D/4, slopeAngleX, 0, 0), color: roofC });
    parts.push({ geo: makeBoxGeo(W, 0.22, slopeLen, 0, h + rh/2, -D/4, -slopeAngleX, 0, 0), color: roofC });
    // Two end slopes (left/right, tilt around Z)
    const slopeAngleZ = Math.atan2(rh, W/2);
    const slopeLenZ = Math.sqrt((W/2)*(W/2) + rh*rh);
    parts.push({ geo: makeBoxGeo(slopeLenZ, 0.22, ridgeLen,  W/4, h + rh/2, 0, 0, 0, -slopeAngleZ), color: roofC });
    parts.push({ geo: makeBoxGeo(slopeLenZ, 0.22, ridgeLen, -W/4, h + rh/2, 0, 0, 0,  slopeAngleZ), color: roofC });
  }

  // Foundation slab extending below ground to fill terrain interpolation gaps
  parts.push({ geo: makeBoxGeo(w+0.8, 2.5, d+0.8, 0, -1.25 + 0.1, 0), color: 0x2a2828 });
  // Build merged mesh with shared material
  if (!makeBuilding._mat) {
    makeBuilding._mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.88, metalness: 0.04,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
  }
  const mesh = makeMergedMesh(parts, makeBuilding._mat);
  for (const p of parts) p.geo.dispose();
  if (!mesh) return;
  mesh.position.set(x, groundY, z);
  if (rotY !== undefined) mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Collision bbox
  const bbox = new THREE.Box3(
    new THREE.Vector3(x - w/2, groundY, z - d/2),
    new THREE.Vector3(x + w/2, groundY + h, z + d/2)
  );
  buildings.push({ userData:{ bbox, solid: true } });
}

// ----- Trees: collect into batches, merged at end of world build -----
const TREE_GREENS = [
  0x1e3a14, 0x2a5020, 0x345e28, 0x3d6830, 0x4a7238,
  0x567838, 0x627c30, 0x4e6a28, 0x2e4c1c, 0x3a5c24,
];
const TREE_GREENS_LIGHT = [
  0x3a5c28, 0x4a6e34, 0x5a7a3c, 0x6a8240, 0x587038,
];
const _treeBatch = { trunkParts: [], branchParts: [], foliageParts: [], foliageLightParts: [] };

function makeTree(x, z) {
  const baseY = sampleTerrainHeight(x, z);
  const roll  = Math.random();
  let type;
  if      (roll < 0.08) type = 'dead';
  else if (roll < 0.14) type = 'twisted';
  else if (roll < 0.52) type = 'broadleaf';
  else                  type = 'conifer';
  const variantCounts = { broadleaf:5, conifer:5, dead:3, twisted:3 };
  _treePlacements.push({
    x, y: baseY, z, type,
    variantIdx: Math.floor(Math.random() * variantCounts[type]),
    scale: 0.75 + Math.random() * 0.65,
    rotY:  Math.random() * Math.PI * 2,
  });
  trees.push({ position: { x, y: baseY + 5, z }, userData: { radius: 0.6 } });
  // legacy: keep _treeBatch empty (commitVegetationBatches handles instanced path)
  if (false) { const trunkH = 5.5 + Math.random() * 5.5;
  const trunkR   = 0.24 + Math.random() * 0.20;

  // Bark: warm brown with grey lichen patches
  const barkBase  = new THREE.Color().setHSL(0.07 + Math.random() * 0.04, 0.55, 0.16 + Math.random() * 0.08);
  const barkColor = barkBase.getHex();

  // ── Trunk ──
  // Root flare (squat, wide)
  const rootH = trunkH * 0.18;
  const rootGeo = new THREE.CylinderGeometry(trunkR * 1.2, trunkR * 1.9, rootH, 8);
  rootGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, baseY + rootH * 0.5, z));
  _treeBatch.trunkParts.push({ geo: rootGeo, color: barkColor });
  // Main shaft (tapers more strongly)
  const shaftH = trunkH * 0.84;
  const shaftGeo = new THREE.CylinderGeometry(trunkR * 0.45, trunkR * 1.1, shaftH, 8);
  shaftGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, baseY + rootH + shaftH * 0.5, z));
  _treeBatch.trunkParts.push({ geo: shaftGeo, color: barkColor });

  // ── Foliage colors — vary by pseudo-season using position hash ──
  const posHash = (Math.sin(x * 0.13 + z * 0.17) + 1) * 0.5;
  let darkC, lightC;
  if (posHash < 0.20) {
    // Autumn: orange/yellow tones
    darkC  = [0x7a4a18, 0x8a5010, 0x6a4010, 0x905818][Math.floor(Math.random()*4)];
    lightC = [0xb07020, 0xc08018, 0xa06010, 0xb86818][Math.floor(Math.random()*4)];
  } else if (posHash < 0.38) {
    // Dry/late summer: yellowed greens
    darkC  = [0x4a5820, 0x526020, 0x486018, 0x4e5818][Math.floor(Math.random()*4)];
    lightC = [0x6a7828, 0x748030, 0x6e7820, 0x788430][Math.floor(Math.random()*4)];
  } else {
    // Normal green
    darkC  = TREE_GREENS [Math.floor(Math.random() * TREE_GREENS.length)];
    lightC = TREE_GREENS_LIGHT[Math.floor(Math.random() * TREE_GREENS_LIGHT.length)];
  }

  if (treeType < 0.55) {
    // ── BROADLEAF ──
    // Canopy base starts just above trunk top (no gap)
    const canopyBaseY = baseY + trunkH * 0.72;
    const mainR = 1.8 + Math.random() * 1.8;

    // Central mass — wider than tall (oblate)
    const mainGeo = new THREE.IcosahedronGeometry(mainR, 0);
    mainGeo.applyMatrix4(new THREE.Matrix4()
      .multiply(new THREE.Matrix4().makeTranslation(x, canopyBaseY + mainR * 0.2, z))
      .multiply(new THREE.Matrix4().makeScale(1.15, 0.78, 1.15)));
    _treeBatch.foliageParts.push({ geo: mainGeo, color: darkC });

    // Upper highlight dome (smaller, brighter — catches sun)
    const topGeo = new THREE.IcosahedronGeometry(mainR * 0.62, 0);
    topGeo.applyMatrix4(new THREE.Matrix4()
      .multiply(new THREE.Matrix4().makeTranslation(x + (Math.random()-0.5)*0.4, canopyBaseY + mainR * 0.55, z + (Math.random()-0.5)*0.4))
      .multiply(new THREE.Matrix4().makeScale(1.0, 0.90, 1.0)));
    _treeBatch.foliageLightParts.push({ geo: topGeo, color: lightC });

    // Side blobs (overlap with main to fill silhouette)
    const satCount = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < satCount; i++) {
      const sr   = mainR * (0.38 + Math.random() * 0.46);
      const sang = (i / satCount) * Math.PI * 2 + Math.random() * 0.7;
      const srad = mainR * (0.62 + Math.random() * 0.38);
      const sx   = x + Math.cos(sang) * srad;
      const sz   = z + Math.sin(sang) * srad;
      const sy   = canopyBaseY + (Math.random() - 0.4) * mainR * 0.9;
      const sGeo = new THREE.IcosahedronGeometry(sr, 0);
      sGeo.applyMatrix4(new THREE.Matrix4()
        .multiply(new THREE.Matrix4().makeTranslation(sx, sy, sz))
        .multiply(new THREE.Matrix4().makeRotationY(Math.random() * Math.PI))
        .multiply(new THREE.Matrix4().makeScale(1.05, 0.75 + Math.random() * 0.3, 1.05)));
      if (Math.random() > 0.45) {
        _treeBatch.foliageLightParts.push({ geo: sGeo, color: lightC });
      } else {
        _treeBatch.foliageParts.push({ geo: sGeo, color: darkC });
      }
    }

    // Visible branches below canopy
    const numBranches = 2 + Math.floor(Math.random() * 3);
    for (let b = 0; b < numBranches; b++) {
      const ang    = (b / numBranches) * Math.PI * 2 + Math.random() * 1.2;
      const bLen   = trunkR * 4 + Math.random() * trunkR * 5;
      const bR     = trunkR * 0.22;
      const bTilt  = 0.4 + Math.random() * 0.5;
      const bStartY= baseY + trunkH * (0.50 + Math.random() * 0.25);
      const bGeo   = new THREE.CylinderGeometry(bR * 0.4, bR, bLen, 5);
      bGeo.applyMatrix4(new THREE.Matrix4()
        .multiply(new THREE.Matrix4().makeTranslation(x, bStartY, z))
        .multiply(new THREE.Matrix4().makeRotationY(ang))
        .multiply(new THREE.Matrix4().makeRotationZ(-bTilt))
        .multiply(new THREE.Matrix4().makeTranslation(bLen * 0.5, 0, 0)));
      _treeBatch.branchParts.push({ geo: bGeo, color: barkColor });
    }

  } else {
    // ── CONIFER (pine/spruce) ──
    const layers    = 5 + Math.floor(Math.random() * 3);
    const totalH    = trunkH * 0.90;
    // Start cones where trunk becomes slim — overlapping trunk top
    const coneBase  = baseY + trunkH * 0.28;
    let lastR = 0.4;

    for (let i = 0; i < layers; i++) {
      const t      = i / (layers - 1);
      // Radius decreases exponentially to tip
      lastR        = (2.6 - t * 2.0) * (0.75 + Math.random() * 0.28);
      lastR        = Math.max(lastR, 0.15);
      const layerH = totalH / layers * (1.1 - t * 0.15);
      // Each layer slightly overlaps the one below (realistic pine skirt)
      const layerY = coneBase + t * totalH - layerH * 0.25;
      const cGeo   = new THREE.CylinderGeometry(lastR * 0.04, lastR, layerH, 8);
      cGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(
        x + (Math.random() - 0.5) * 0.25,
        layerY,
        z + (Math.random() - 0.5) * 0.25));
      // Alternate dark/light per layer for depth
      if (i % 2 === 0) {
        _treeBatch.foliageParts.push({ geo: cGeo, color: darkC });
      } else {
        _treeBatch.foliageLightParts.push({ geo: cGeo, color: lightC });
      }
    }
    // Needle tip spike
    const tipH   = trunkH * 0.18;
    const tipGeo = new THREE.CylinderGeometry(0.02, lastR * 0.28, tipH, 6);
    tipGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, coneBase + totalH + tipH * 0.3, z));
    _treeBatch.foliageParts.push({ geo: tipGeo, color: darkC });
  }

  } // end if(false) dead-code block
}

// ----- Rocks: batched, layered clusters -----
const ROCK_COLORS = [
  0x6a6868, 0x787070, 0x5e5c5a, 0x726860, // grey granite
  0x7a6e5e, 0x8a7a68, 0x6a5e50,           // sandstone
  0x5a5858, 0x686070, 0x504e5a,           // dark basalt
  0x8a7060, 0x967a64,                     // rust/iron
];
const _rockBatch = { parts: [], pebbleParts: [] };
function makeRock(x, z) {
  const gy = sampleTerrainHeight(x, z);
  const cluster = 1 + Math.floor(Math.random() * 3);
  const baseVariant = Math.floor(Math.random() * 3);
  const baseColor = ROCK_COLORS[Math.floor(Math.random() * ROCK_COLORS.length)];

  for (let i = 0; i < cluster; i++) {
    const isPrimary = i === 0;
    const s  = isPrimary ? (0.9 + Math.random() * 1.6) : (0.4 + Math.random() * 0.8);
    const ox = (Math.random() - 0.5) * (isPrimary ? 0.5 : 4);
    const oz = (Math.random() - 0.5) * (isPrimary ? 0.5 : 4);
    _rockPlacements.push({
      x: x + ox, y: gy - s * 0.18, z: z + oz,
      variantIdx: (baseVariant + i) % 3,
      scale: s * (0.55 + Math.random() * 0.35),
      rotY: Math.random() * Math.PI * 2,
    });
    if (isPrimary) {
      buildings.push({ userData: { bbox: new THREE.Box3(
        new THREE.Vector3(x - s * 1.2, gy - 0.1, z - s * 1.2),
        new THREE.Vector3(x + s * 1.2, gy + s,   z + s * 1.2)
      )}});
    }
  }

  // Procedural pebble scatter (too small to load models for)
  const pebbleCount = 3 + Math.floor(Math.random() * 5);
  for (let p = 0; p < pebbleCount; p++) {
    const ps  = 0.08 + Math.random() * 0.20;
    const pox = (Math.random() - 0.5) * 4;
    const poz = (Math.random() - 0.5) * 4;
    const pGeo = new THREE.DodecahedronGeometry(ps, 0);
    pGeo.applyMatrix4(new THREE.Matrix4()
      .multiply(new THREE.Matrix4().makeTranslation(x + pox, gy + ps * 0.4, z + poz))
      .multiply(new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI)))
      .multiply(new THREE.Matrix4().makeScale(
        0.8 + Math.random() * 0.5, 0.5 + Math.random() * 0.4, 0.8 + Math.random() * 0.5)));
    _rockBatch.pebbleParts.push({ geo: pGeo, color: baseColor });
  }
}

// ----- Bushes: batched, layered inner/outer -----
const BUSH_DARK  = [0x2a4018, 0x324a1e, 0x283c16, 0x1e3010, 0x304018];
const BUSH_MID   = [0x3a5a24, 0x486030, 0x506828, 0x3e5820, 0x446228];
const BUSH_LIGHT = [0x507838, 0x5a8040, 0x648844, 0x4e7030, 0x5c7838];
const BUSH_BERRY = [0x5a2828, 0x3a2040, 0x4a3010]; // occasional berries/flowers
const _bushBatch = { darkParts: [], midParts: [], lightParts: [] };
function makeBush(x, z) {
  registerSearchable(null, 'bush', x, z);
  const gy = sampleTerrainHeight(x, z);
  _bushPlacements.push({
    x, y: gy, z,
    variantIdx: Math.random() < 0.3 ? 1 : 0, // 30% chance of flowers variant
    scale: 0.55 + Math.random() * 0.80,
    rotY: Math.random() * Math.PI * 2,
  });
  if (false) {
  const bushR   = 0.7 + Math.random() * 0.8;
  const blobs   = 4 + Math.floor(Math.random() * 5);
  const darkC   = BUSH_DARK [Math.floor(Math.random() * BUSH_DARK.length)];
  const midC    = BUSH_MID  [Math.floor(Math.random() * BUSH_MID.length)];
  const lightC  = BUSH_LIGHT[Math.floor(Math.random() * BUSH_LIGHT.length)];

  for (let i = 0; i < blobs; i++) {
    const s    = bushR * (0.50 + Math.random() * 0.55);
    const ox   = (Math.random() - 0.5) * bushR * 2.2;
    const oz   = (Math.random() - 0.5) * bushR * 2.2;
    const oy   = gy + s * (0.35 + Math.random() * 0.25);
    const geo  = new THREE.IcosahedronGeometry(s, 0);
    const m4   = new THREE.Matrix4()
      .multiply(new THREE.Matrix4().makeTranslation(x + ox, oy, z + oz))
      .multiply(new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)))
      .multiply(new THREE.Matrix4().makeScale(
        1.0 + Math.random() * 0.4,
        0.45 + Math.random() * 0.30,
        1.0 + Math.random() * 0.4));
    geo.applyMatrix4(m4);

    // Layer: outer blobs are darker (shadow), top/inner blobs catch light
    const distFromCenter = Math.hypot(ox, oz) / (bushR * 1.1);
    if (distFromCenter > 0.65 || i < 2) {
      _bushBatch.darkParts.push({ geo, color: darkC });
    } else if (distFromCenter > 0.30) {
      _bushBatch.midParts.push({ geo, color: midC });
    } else {
      _bushBatch.lightParts.push({ geo, color: lightC });
    }
  }

  // Occasional berry cluster (small dark-red blobs)
  if (Math.random() < 0.22) {
    const berryC = BUSH_BERRY[Math.floor(Math.random() * BUSH_BERRY.length)];
    const numBerries = 2 + Math.floor(Math.random() * 4);
    for (let b = 0; b < numBerries; b++) {
      const bs   = 0.06 + Math.random() * 0.08;
      const box  = (Math.random() - 0.5) * bushR * 1.6;
      const boz  = (Math.random() - 0.5) * bushR * 1.6;
      const bGeo = new THREE.IcosahedronGeometry(bs, 0);
      bGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(x + box, gy + bushR * 0.6 + Math.random() * bushR * 0.4, z + boz));
      _bushBatch.midParts.push({ geo: bGeo, color: berryC });
    }
  }
  } // end if(false)
}

// Place GLTF nature models as InstancedMeshes — one instanced draw call per mesh per model variant
function commitVegetationBatches() {
  const dummy = new THREE.Object3D();
  const _tmpM = new THREE.Matrix4();

  function commitInstanced(placements, models, castShadow, receiveShadow) {
    if (!placements.length || !models || !models.length) return;
    const byVariant = new Map();
    for (const p of placements) {
      const vi = p.variantIdx % models.length;
      if (!byVariant.has(vi)) byVariant.set(vi, []);
      byVariant.get(vi).push(p);
    }
    for (const [vi, ps] of byVariant) {
      const model = models[vi];
      model.updateWorldMatrix(true, true);
      const meshData = [];
      model.traverse(child => {
        if (!child.isMesh) return;
        child.updateWorldMatrix(true, false);
        meshData.push({ geo: child.geometry, mat: child.material, localWM: child.matrixWorld.clone() });
      });
      for (const { geo, mat, localWM } of meshData) {
        const im = new THREE.InstancedMesh(geo, mat, ps.length);
        im.castShadow = castShadow;
        im.receiveShadow = receiveShadow;
        im.frustumCulled = false;
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(0, p.rotY, 0);
          dummy.scale.setScalar(p.scale);
          dummy.updateMatrix();
          _tmpM.copy(dummy.matrix).multiply(localWM);
          im.setMatrixAt(i, _tmpM);
        }
        im.instanceMatrix.needsUpdate = true;
        scene.add(im);
      }
    }
  }

  // Trees — split by type into their respective model pools
  commitInstanced(_treePlacements.filter(p => p.type === 'broadleaf'), NATURE_MODELS.broadleaf, false, false);
  commitInstanced(_treePlacements.filter(p => p.type === 'conifer'),   NATURE_MODELS.conifer,   false, false);
  commitInstanced(_treePlacements.filter(p => p.type === 'dead'),      NATURE_MODELS.dead,      false, false);
  commitInstanced(_treePlacements.filter(p => p.type === 'twisted'),   NATURE_MODELS.twisted,   false, false);

  // Rocks
  commitInstanced(_rockPlacements, NATURE_MODELS.rocks, false, false);

  // Bushes
  commitInstanced(_bushPlacements, NATURE_MODELS.bushes, false, false);

  // Procedural pebbles — kept as merged mesh (too small for loaded models)
  if (_rockBatch.pebbleParts.length) {
    const pebbleMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.80, metalness: 0.06 });
    const pm = makeMergedMesh(_rockBatch.pebbleParts, pebbleMat);
    if (pm) { pm.frustumCulled = false; pm.matrixAutoUpdate = false; pm.updateMatrix(); scene.add(pm); }
    for (const p of _rockBatch.pebbleParts) p.geo.dispose();
    _rockBatch.pebbleParts.length = 0;
  }
}

// ============================================================================
// ENTITY (Player + Bots share base)
// ============================================================================
class Entity {
  constructor(x, z, isPlayer=false) {
    this.isPlayer = isPlayer;
    this.hp = 100;
    this.maxHp = 100;
    this.armor = 0;
    this.alive = true;
    this.pos = new THREE.Vector3(x, 1, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random()*Math.PI*2;
    this.pitch = 0;
    this.speed = 6;
    this.height = 1.7;
    this.crouching = false;
    this.lean = 0; // -1 left, 1 right
    this.inventory = { 1:null, 2:null, 3:null }; // primary, secondary, sidearm
    this.activeSlot = 3;
    this.weapon = null;
    this.ammo = {};         // ammo per weapon
    this.reserve = {};
    this.attachments = {};  // weapon-key -> { scope, grip, mag, muzzle }
    this.lastShot = 0;
    this.reloading = false;
    this.shotsFired = 0;    // recoil pattern counter
    this.recoilOffset = 0;
    this.isAds = false;

    if (isPlayer) {
      this.mesh = new THREE.Group();
    } else {
      // Build a proper-looking soldier silhouette
      const botGroup = new THREE.Group();
      // Pick a uniform color for variety
      const uniforms = [0x4a5238, 0x3a4030, 0x554a38, 0x453228, 0x383428];
      const uniform = uniforms[Math.floor(Math.random()*uniforms.length)];
      const skinTones = [0xc7956a, 0xe0b690, 0xa07854, 0x8a6240, 0x5c3318, 0x3d2010, 0xf5cfa0, 0xd4a574, 0x7a4a28, 0x4a2810];
      const skin = skinTones[Math.floor(Math.random()*skinTones.length)];
      const armorC = 0x2a2a28;
      const helmetC = 0x33352a;

      // ----- Static body parts merged into ONE mesh -----
      const staticParts = [];
      // Torso
      staticParts.push({ geo: makeBoxGeo(0.55, 0.65, 0.32, 0, 1.15, 0), color: uniform });
      // Plate carrier
      staticParts.push({ geo: makeBoxGeo(0.50, 0.55, 0.10, 0, 1.18, 0.18), color: armorC });
      // Mag pouches
      for (let i=0; i<3; i++) {
        staticParts.push({ geo: makeBoxGeo(0.10, 0.13, 0.08, -0.16 + i*0.16, 1.05, 0.22), color: armorC });
      }
      // Belt
      staticParts.push({ geo: makeBoxGeo(0.55, 0.12, 0.34, 0, 0.80, 0), color: armorC });
      // Helmet (simplified to a single squashed box for perf — still reads as helmet)
      staticParts.push({ geo: makeBoxGeo(0.42, 0.22, 0.36, 0, 1.78, 0), color: helmetC });
      staticParts.push({ geo: makeBoxGeo(0.30, 0.04, 0.05, 0, 1.66, 0.16), color: helmetC });

      const staticMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
      const staticMesh = makeMergedMesh(staticParts, staticMat);
      for (const p of staticParts) p.geo.dispose();
      if (staticMesh) {
        staticMesh.castShadow = true;
        botGroup.add(staticMesh);
      }

      // Head: kept separate for headshot detection (small sphere)
      const headMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.85 });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), headMat);
      head.position.y = 1.65;
      head.userData.isHead = true;
      botGroup.add(head);

      // ----- Animated limbs (each is its own mesh because they rotate independently) -----
      const limbMat = new THREE.MeshStandardMaterial({ color: uniform, roughness: 0.95 });
      const legGeo = new THREE.CylinderGeometry(0.14, 0.12, 0.72, 12);
      const armGeo = new THREE.CylinderGeometry(0.10, 0.09, 0.50, 12);

      const hipL = new THREE.Group();
      hipL.position.set(-0.14, 0.78, 0);
      const legLMesh = new THREE.Mesh(legGeo, limbMat);
      legLMesh.position.y = -0.36;
      hipL.add(legLMesh);
      botGroup.add(hipL);

      const hipR = new THREE.Group();
      hipR.position.set(0.14, 0.78, 0);
      const legRMesh = new THREE.Mesh(legGeo, limbMat);
      legRMesh.position.y = -0.36;
      hipR.add(legRMesh);
      botGroup.add(hipR);

      const shoulderL = new THREE.Group();
      shoulderL.position.set(-0.34, 1.42, 0);
      const armLMesh = new THREE.Mesh(armGeo, limbMat);
      armLMesh.position.y = -0.25;
      shoulderL.add(armLMesh);
      botGroup.add(shoulderL);

      const shoulderR = new THREE.Group();
      shoulderR.position.set(0.34, 1.42, 0);
      const armRMesh = new THREE.Mesh(armGeo, limbMat);
      armRMesh.position.y = -0.25;
      shoulderR.add(armRMesh);
      botGroup.add(shoulderR);

      this.mesh = botGroup;
      this.mesh.position.copy(this.pos);
      this.bodyMesh = staticMesh;
      this.headMesh = head;
      this.hipL = hipL; this.hipR = hipR;
      this.shoulderL = shoulderL; this.shoulderR = shoulderR;
      this.walkPhase = Math.random() * Math.PI * 2;
      // Rifle silhouette carried by bots
      const gunGroup = new THREE.Group();
      const gMetal  = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.40, metalness: 0.80 });
      const gPolymer = new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.72, metalness: 0.04 });
      // Upper receiver
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.38), gPolymer);
      receiver.position.set(0, 0, -0.02);
      gunGroup.add(receiver);
      // Handguard (slim, hexagonal cross-section via low-poly cylinder)
      const hguard = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 6), gMetal);
      hguard.rotation.x = Math.PI / 2;
      hguard.position.set(0, 0.005, -0.28);
      gunGroup.add(hguard);
      // Barrel
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.38, 10), gMetal);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.010, -0.52);
      gunGroup.add(barrel);
      // Muzzle brake
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.045, 8), gMetal);
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.set(0, 0.010, -0.73);
      gunGroup.add(muzzle);
      // Pistol grip
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.13, 0.06), gPolymer);
      grip.position.set(0, -0.085, 0.12);
      grip.rotation.x = -0.22;
      gunGroup.add(grip);
      // Stock
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.22), gPolymer);
      stock.position.set(0, -0.010, 0.24);
      gunGroup.add(stock);
      // Magazine (curved via tapered box)
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.065), gPolymer);
      mag.position.set(0, -0.115, -0.04);
      mag.rotation.x = 0.14;
      gunGroup.add(mag);
      // Carry handle / optic rail bump
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.18), gMetal);
      rail.position.set(0, 0.057, 0.00);
      gunGroup.add(rail);
      gunGroup.position.set(0.18, 1.20, -0.20);
      this.mesh.add(gunGroup);
      this.gunMesh = gunGroup;
      scene.add(this.mesh);

      // bot AI state
      this.aiState = 'patrol';
      this.aiTarget = new THREE.Vector3();
      this.aiTimer = 0;
      this.aiTarget.set(this.pos.x + (Math.random()-0.5)*40, 0, this.pos.z + (Math.random()-0.5)*40);
      // Difficulty scaling
      // easy(0.4):  big spread, slow reaction, rarely fires
      // normal(0.7): moderate
      // hard(1.0):  tight aim, instant reaction, very aggressive
      const sk = settings.skill;
      this.aimError      = (1 - sk) * 0.32 + 0.01;   // easy=0.14, hard=0.01 rad spread error
      this.reactionTime  = (1 - sk) * 1.4  + 0.05;   // easy=0.61s, hard=0.05s
      this.fireChance    = 0.3 + sk * 0.65;           // easy=0.56, hard=0.95 per-frame fire prob
      this.trackSpeed    = 2  + sk * 6;               // easy=4.4, hard=8  yaw lerp speed
      this.burstLimit    = Math.round(2 + sk * 6);    // easy=4, hard=8 shots before burst pause
      this.lastSeen = null;
      this.alertTimer = 0;
      // give bot a starting weapon
      const startGuns = ['pistol','deagle','smg','p90','ar','ak','shotgun','spas','sr','barrett'];
      const wk = startGuns[Math.floor(Math.random()*startGuns.length)];
      this.giveWeapon(wk);
      // sometimes attach a scope to bot
      if (Math.random() < 0.4 && (wk==='ar'||wk==='ak'||wk==='sr'||wk==='barrett')) {
        this.attachments[wk] = { scope: Math.random()<0.5 ? 'scope2x' : 'scope4x' };
      }
    }
    entities.push(this);
  }

  giveWeapon(wk) {
    const w = WEAPONS[wk];
    if (!w) return;
    const slot = w.slot;
    this.inventory[slot] = wk;
    if (this.ammo[wk] === undefined) {
      this.ammo[wk] = w.mag;
      this.reserve[wk] = w.reserve;
    }
    if (!this.attachments[wk]) this.attachments[wk] = {};
    if (!this.weapon) this.equip(slot);
  }

  equip(slot) {
    if (!this.inventory[slot]) return;
    this.activeSlot = slot;
    this.weapon = this.inventory[slot];
    this.reloading = false;
    if (this.isPlayer) { updateHUD(); buildViewmodel(); }
  }

  effectiveStats() {
    if (!this.weapon) return null;
    const w = WEAPONS[this.weapon];
    const a = this.attachments[this.weapon] || {};
    let recoil = w.recoil;
    let spread = w.spread;
    let mag = w.mag;
    let zoom = w.adsZoom;
    if (a.grip) recoil *= ATTACHMENTS[a.grip].recoilMul;
    if (a.muzzle) {
      recoil *= ATTACHMENTS[a.muzzle].recoilMul || 1;
      spread *= ATTACHMENTS[a.muzzle].spreadMul || 1;
    }
    if (a.mag) mag = Math.floor(mag * ATTACHMENTS[a.mag].magMul);
    if (a.scope) zoom = ATTACHMENTS[a.scope].zoom;
    return { ...w, recoil, spread, mag, adsZoom: zoom, scope: a.scope };
  }

  shoot(now) {
    if (!this.weapon || this.reloading) return false;
    const stats = this.effectiveStats();
    if (stats.melee) {
      const interval = 60 / stats.rpm;
      if (now - this.lastShot < interval) return false;
      this.lastShot = now;
      this._meleeSwing = true;
      this._meleeSwingTime = now;
      this._meleeSwingCount = (this._meleeSwingCount || 0) + 1;
      if (this.isPlayer) playSwingSound();
      const range = stats.range || 2.5;
      const fwd = this.getAimDir();
      let meleeHit = false;
      for (const ent of entities.filter(e => e !== this && e.alive)) {
        const dx = ent.pos.x - this.pos.x, dy = ent.pos.y - this.pos.y, dz = ent.pos.z - this.pos.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist > range) continue;
        if ((dx*fwd.x + dy*fwd.y + dz*fwd.z)/dist < 0.3) continue;
        ent.takeDamage(stats.dmg, this);
        meleeHit = true;
      }
      if (this.isPlayer && meleeHit) showHitmarker();
      return true;
    }
    const interval = 60 / stats.rpm;
    if (now - this.lastShot < interval) return false;
    if (this.ammo[this.weapon] <= 0) {
      if (this.isPlayer) playSound('dryfire');
      return false;
    }
    this.lastShot = now;
    this.ammo[this.weapon]--;
    this.shotsFired++;
    if (this.isPlayer) updateHUD();

    // recoil kick (visual)
    this.recoilOffset = Math.min(this.recoilOffset + stats.recoil*0.8, 8);

    // direction with spread
    const baseDir = this.getAimDir();
    const spreadMul = this.isAds ? 0.25 : 1.0;
    const moveSpread = this.vel.lengthSq() > 1 ? 1.4 : 1.0;
    const crouchStab = this.crouching ? 0.55 : 1.0;  // crouching tightens spread significantly
    const finalSpread = stats.spread * spreadMul * moveSpread * crouchStab;
    const pellets = stats.pellets || 1;
    for (let p=0; p<pellets; p++) {
      const dir = baseDir.clone();
      dir.x += (Math.random()-0.5) * finalSpread;
      dir.y += (Math.random()-0.5) * finalSpread;
      dir.z += (Math.random()-0.5) * finalSpread;
      dir.normalize();
      spawnBullet(this, dir, stats);
    }

    // Recoil: kick the camera UP after shot is fired. Bullet has already left
    // along the actual aim direction, so kick affects the *next* shot.
    if (this.isPlayer) {
      const crouchRecoilMul = this.crouching ? 0.45 : 1.0;  // crouching halves recoil kick
      const climb = Math.min(0.005 + this.shotsFired * 0.0015, 0.025) * stats.recoil * crouchRecoilMul;
      this.pitch += climb;
      this.yaw += (Math.random()-0.5) * 0.004 * stats.recoil * crouchRecoilMul;
      this.recoilRecover = (this.recoilRecover || 0) + climb;
    }

    // muzzle flash (skip for melee)
    if (this.isPlayer && !(stats && stats.melee)) {
      flashMuzzle();
    }
    const _isSilenced = this.isPlayer && (this.attachments[this.weapon] || {}).muzzle === 'silencer';
    playSound('shoot', this.pos, this.weapon, _isSilenced);
    if (stats.bolt) {
      this.reloading = true;
      setTimeout(() => { this.reloading = false; }, 1200);
    }
    return true;
  }

  reload() {
    if (!this.weapon || this.reloading) return;
    const stats = this.effectiveStats();
    if (this.ammo[this.weapon] >= stats.mag) return;
    if (this.reserve[this.weapon] <= 0) return;
    this.reloading = true;
    if (this.isPlayer) playSound('reload', null, this.weapon);
    setTimeout(() => {
      const need = stats.mag - this.ammo[this.weapon];
      const take = Math.min(need, this.reserve[this.weapon]);
      this.ammo[this.weapon] += take;
      this.reserve[this.weapon] -= take;
      this.reloading = false;
      this.shotsFired = 0;
      if (this.isPlayer) updateHUD();
    }, 2200);
  }

  getAimDir() {
    if (this.isPlayer) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      return dir;
    } else {
      const dir = new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch)
      );
      return dir.normalize();
    }
  }

  takeDamage(amount, source, isHeadshot=false) {
    if (!this.alive) return;
    if (isHeadshot) amount *= 2.4;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.55);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.hp -= amount;
    if (this.isPlayer) {
      flashDamage();
      playSound('hit');
      updateHUD();
    } else {
      // bot becomes alert if shot
      this.aiState = 'engage';
      this.lastSeen = source ? source.pos.clone() : this.pos.clone();
      this.alertTimer = 8;
    }
    if (this.hp <= 0) this.die(source);
  }

  die(killer) {
    if (!this.alive) return;
    this.alive = false;
    if (this.isPlayer) {
      endGame(false);
    } else {
      // drop loot
      dropLootFromBot(this);
      scene.remove(this.mesh);
      if (killer && killer.isPlayer) {
        killCount++;
        const dist = Math.round(killer.pos.distanceTo(this.pos));
        addKillFeed(settings.gamertag || 'YOU', this.botName || 'BOT', killer.weapon, dist);
        document.getElementById('killCount').textContent = killCount;
      } else if (killer) {
        const dist = Math.round(killer.pos.distanceTo(this.pos));
        addKillFeed(killer.botName || 'BOT', this.botName || 'BOT', killer.weapon, dist);
      }
    }
    updateAliveCount();
    checkWin();
  }
}

// ============================================================================
// PLAYER
// ============================================================================
function spawnPlayer() {
  const WATER_LEVEL = -2.8;
  let sx, sz;
  for (let attempt = 0; attempt < 50; attempt++) {
    const angle = Math.random()*Math.PI*2;
    const r = MAP.size*0.80;
    sx = Math.cos(angle)*r; sz = Math.sin(angle)*r;
    if (rawTerrainNoise(sx, sz) > WATER_LEVEL + 1.5) break;
  }
  player = new Entity(sx, sz, true);
  player.botName = 'YOU';
  player.giveWeapon('pistol');
  player.giveWeapon('machete');
  player.equip(3);
}

// ============================================================================
// BOTS
// ============================================================================
const BOT_NAMES = ['REAVER','GHOST','VIPER','BANDIT','HAVOC','RECON','OUTLAW','RAVEN','SHADOW','BLITZ','FANG','NOMAD','HUNTER','RAZOR','ECHO','VENOM','CIPHER','TALON','RIPPER','MAVERICK','PHANTOM','WRAITH','KILO','NOVA','APEX','DRIFTER','STORM','WOLF','VEX','CRUX'];
function spawnBots(n) {
  // Spread bots evenly around the map using a ring + random offset per slice
  // so early-game fights are spread out rather than clustered.
  const spawnR = MAP.size * 0.78; // wider ring for larger map
  const usedPositions = [];
  const minSep = MAP.size * 0.12; // min distance between any two spawns

  // One random bot gets the special name
  const iHateIdx = Math.floor(Math.random() * n);
  for (let i=0; i<n; i++) {
    let x, z, ok=false, tries=0;
    // Distribute evenly around the ring with a wide random spread per sector
    const baseAngle = (i / n) * Math.PI * 2;
    while (!ok && tries++<30) {
      const angle = baseAngle + (Math.random() - 0.5) * (Math.PI * 2 / n) * 1.8;
      const r = spawnR * (0.55 + Math.random() * 0.45);
      x = Math.cos(angle) * r;
      z = Math.sin(angle) * r;
      // Check collision and min separation from other spawns
      if (collidesPos(x, z, 1)) continue;
      if (rawTerrainNoise(x, z) < -1.3) continue; // don't spawn in water
      const tooClose = usedPositions.some(p => Math.hypot(p[0]-x, p[1]-z) < minSep);
      if (!tooClose) ok = true;
    }
    if (!ok) { // fallback: just place anywhere collision-free
      tries = 0;
      while (tries++ < 20) {
        x = (Math.random()-0.5)*MAP.size*1.6;
        z = (Math.random()-0.5)*MAP.size*1.6;
        if (!collidesPos(x, z, 1)) break;
      }
    }
    usedPositions.push([x, z]);
    const b = new Entity(x, z, false);
    b.botName = i === iHateIdx
      ? 'IHATE' + (settings.gamertag || 'PLAYER')
      : BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? '-'+Math.floor(i/BOT_NAMES.length) : '');
  }
  updateAliveCount();
}

// ============================================================================
// LOOT
// ============================================================================
// Balanced loot generation for containers
function generateContainerLoot(containerType) {
  const pools = {
    dumpster:     [{type:'ammo',w:5},{type:'heal',w:4},{type:'attachment',w:3},{type:'armor',w:2},{type:'weapon',w:1}],
    car:          [{type:'weapon',w:4},{type:'ammo',w:3},{type:'attachment',w:2},{type:'heal',w:1}],
    toolbox:      [{type:'weapon',w:4},{type:'ammo',w:2},{type:'attachment',w:4},{type:'heal',w:1}],
    bush:         [{type:'ammo',w:6},{type:'heal',w:6},{type:'attachment',w:1}],
    garbage_can:  [{type:'ammo',w:5},{type:'heal',w:5},{type:'attachment',w:1},{type:'dobble',w:1}],
  };
  const pool = pools[containerType] || pools.dumpster;
  const totalW = pool.reduce((s,e)=>s+e.w,0);
  const count = containerType==='bush' ? 1 : 1+Math.floor(Math.random()*3);
  const items=[]; const usedTypes=new Set();
  for (let i=0;i<count;i++) {
    let entry,tries=0;
    do {
      let r=Math.random()*totalW; entry=pool[pool.length-1];
      for (const e of pool){r-=e.w;if(r<=0){entry=e;break;}}
      tries++;
    } while(usedTypes.has(entry.type)&&tries<8);
    usedTypes.add(entry.type);
    items.push(makeRandomItem(entry.type, containerType));
  }
  return items;
}
function makeRandomItem(type, containerType) {
  if (type==='weapon') {
    let k;
    if (containerType === 'car') {
      // pistol 30%, crowbar 20%, shotguns(s686+spas) 15%, ar 12.5%, smg 12.5%, sr ~10%
      const r = Math.random();
      if      (r < 0.30)  k = 'pistol';
      else if (r < 0.50)  k = 'crowbar';
      else if (r < 0.575) k = 'shotgun';
      else if (r < 0.65)  k = 'spas';
      else if (r < 0.775) k = 'ar';
      else if (r < 0.90)  k = 'smg';
      else                k = 'sr';
    } else if (containerType === 'toolbox') {
      // crowbar 60%, pistol 30%, smg 10%
      const r = Math.random();
      if      (r < 0.60) k = 'crowbar';
      else if (r < 0.90) k = 'pistol';
      else               k = 'smg';
    } else {
      const keys = ['pistol','deagle','smg','p90','ar','ak','shotgun','spas','sr','barrett'];
      k = keys[Math.floor(Math.random()*keys.length)];
    }
    return {type:'weapon',key:k,name:WEAPONS[k].name};
  } else if (type==='ammo') {
    return {type:'ammo',amount:8+Math.floor(Math.random()*12),name:'AMMO'};
  } else if (type==='dobble') {
    return {type:'heal',key:'dobble_golp',name:'5 TIMES DOBBLE GOLP',legendary:true};
  } else if (type==='heal') {
    const k=['bandage','medkit'][Math.floor(Math.random()*2)];
    return {type:'heal',key:k,name:HEAL_ITEMS[k].name};
  } else if (type==='attachment') {
    const keys=Object.keys(ATTACHMENTS);
    const k=keys[Math.floor(Math.random()*keys.length)];
    return {type:'attachment',key:k,name:ATTACHMENTS[k].name};
  } else {
    return {type:'armor',amount:50,name:'ARMOR VEST'};
  }
}
function createLootMesh(item, x, z, explicitY) {
  const isMelee = item.type === 'weapon' && item.key && WEAPONS[item.key] && WEAPONS[item.key].melee;
  const TYPE_CFG = {
    weapon:     { color: 0xff6622, emissive: 0xff3300, icon: 'gun'    },
    heal:       { color: 0x22ee55, emissive: 0x00cc33, icon: 'cross'  },
    ammo:       { color: 0xffcc00, emissive: 0xdd9900, icon: 'ammo'   },
    attachment: { color: 0x33aaff, emissive: 0x0077cc, icon: 'attach' },
    armor:      { color: 0xaaaaff, emissive: 0x6666cc, icon: 'armor'  },
  };
  const cfg = TYPE_CFG[item.type] || { color: 0xffffff, emissive: 0x888888, icon: 'box' };
  if (isMelee) { cfg.color = 0xc8901a; cfg.emissive = 0x9a6010; }
  const color = cfg.color;
  // Use terrain height, raised slightly above ground-level surfaces (sidewalks/roads)
  // but ignore solid building walls so loot doesn't float at roof height.
  let gy = explicitY !== undefined ? explicitY : sampleTerrainHeight(x, z);
  if (explicitY === undefined) {
    for (const bd of buildings) {
      if (!bd.userData.bbox || !bd.userData.ground) continue;
      const bb = bd.userData.bbox;
      if (x > bb.min.x && x < bb.max.x && z > bb.min.z && z < bb.max.z) {
        gy = Math.max(gy, bb.max.y);
      }
    }
  }

  const group = new THREE.Group();
  group.position.set(x, gy, z);

  // Glowing ground ring
  const ringGeo = new THREE.RingGeometry(0.45, 0.55, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: cfg.emissive, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.02;
  group.add(ring);

  // Main pickup model varies by type
  let modelMesh;
  const mat = new THREE.MeshStandardMaterial({ color, emissive: cfg.emissive, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.3 });

  if (isMelee) {
    // Baseball bat silhouette: thin handle + wide barrel
    const g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.30, 0.06), mat);
    handle.position.set(0, -0.18, 0);
    g.add(handle);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.16), mat);
    barrel.position.set(0, 0.15, 0);
    g.add(barrel);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.10), mat);
    knob.position.set(0, -0.35, 0);
    g.add(knob);
    modelMesh = g;
  } else if (item.type === 'weapon') {
    // Stylised gun silhouette: receiver box + barrel cylinder
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.22, 0.55), mat));
    const brl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), mat);
    brl.rotation.x = Math.PI/2; brl.position.set(0, 0.06, -0.44);
    g.add(brl);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.10), mat);
    grip.position.set(0, -0.18, 0.18); grip.rotation.x = 0.3;
    g.add(grip);
    modelMesh = g;
  } else if (item.type === 'heal') {
    // Pill / medkit cross
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.12), mat));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.12), mat));
    modelMesh = g;
  } else if (item.type === 'ammo') {
    // Stack of bullet cylinders
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const blt = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 7), mat);
      blt.position.set((i%3-1)*0.10, i > 2 ? 0.10 : 0, i > 2 ? (i-3-0.5)*0.10 : (i-1)*0.10);
      g.add(blt);
    }
    modelMesh = g;
  } else if (item.type === 'attachment') {
    // Scope cylinder
    const g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.44, 10), mat);
    tube.rotation.x = Math.PI/2;
    g.add(tube);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.07, 0.10, 10), mat);
    bell.rotation.x = Math.PI/2; bell.position.z = -0.26;
    g.add(bell);
    modelMesh = g;
  } else if (item.type === 'armor') {
    // Chest-plate shape: box with shoulder tabs
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.10), mat));
    const ls = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.10), mat);
    ls.position.set(-0.27, 0.20, 0); g.add(ls);
    const rs = ls.clone(); rs.position.x = 0.27; g.add(rs);
    modelMesh = g;
  } else {
    modelMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat);
  }

  modelMesh.position.y = 0.55;
  group.add(modelMesh);
  group.userData.modelMesh = modelMesh;
  group.userData.ring = ring;

  scene.add(group);

  // CSS2D-style label via a canvas sprite (no extra library needed)
  const label = makeLootLabel(item);
  label.position.set(x, gy + 1.25, z);
  label.visible = false;
  scene.add(label);
  group.userData.label = label;

  item.mesh = group;
  item.pos = group.position;
  lootItems.push(item);
}

// Floating text label as a sprite
function makeLootLabel(item) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,256,64);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  const r = 8, lx = 4, ly = 4, lw = 248, lh = 56;
  ctx.beginPath();
  ctx.moveTo(lx+r, ly);
  ctx.lineTo(lx+lw-r, ly); ctx.arcTo(lx+lw, ly, lx+lw, ly+r, r);
  ctx.lineTo(lx+lw, ly+lh-r); ctx.arcTo(lx+lw, ly+lh, lx+lw-r, ly+lh, r);
  ctx.lineTo(lx+r, ly+lh); ctx.arcTo(lx, ly+lh, lx, ly+lh-r, r);
  ctx.lineTo(lx, ly+r); ctx.arcTo(lx, ly, lx+r, ly, r);
  ctx.closePath(); ctx.fill();
  ctx.font = 'bold 22px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const TYPE_COLORS = { weapon:'#ff6622', heal:'#22ee55', ammo:'#ffcc00', attachment:'#33aaff', armor:'#aaaaff' };
  ctx.fillStyle = TYPE_COLORS[item.type] || '#ffffff';
  let label = item.name;
  if (item.type === 'ammo' && item.amount) label += ' ×' + item.amount;
  ctx.fillText(label.toUpperCase(), 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}
function spawnDobbleGolp(x, z) {
  const gy = sampleTerrainHeight(x, z) + 0.05;

  // Play jingle if pre-decoded, otherwise skip gracefully
  setTimeout(() => playBuffer('dobble_golp', 0.5, 1.0), 50);

  const group = new THREE.Group();
  group.position.set(x, gy, z);
  scene.add(group);

  // --- Big Gulp cup model (no branding, just the iconic shape) ---
  const cupMat   = new THREE.MeshStandardMaterial({ color:0x22aaff, roughness:0.3, metalness:0.1, transparent:true, opacity:0.85 });
  const lidMat   = new THREE.MeshStandardMaterial({ color:0xddddff, roughness:0.4, metalness:0.0, transparent:true, opacity:0.7 });
  const strawMat = new THREE.MeshStandardMaterial({ color:0xff2244, roughness:0.5, metalness:0.0 });
  const liquidMat= new THREE.MeshStandardMaterial({ color:0xff4422, roughness:0.1, metalness:0.0, transparent:true, opacity:0.9 });

  // Cup body (tapered cylinder)
  const cupGeo = new THREE.CylinderGeometry(0.18, 0.13, 0.45, 12);
  const cup = new THREE.Mesh(cupGeo, cupMat);
  cup.position.y = 0.225;
  group.add(cup);

  // Liquid inside (slightly smaller, same taper)
  const liqGeo = new THREE.CylinderGeometry(0.165, 0.12, 0.38, 12);
  const liq = new THREE.Mesh(liqGeo, liquidMat);
  liq.position.y = 0.22;
  group.add(liq);

  // Dome lid
  const lidGeo = new THREE.SphereGeometry(0.19, 12, 6, 0, Math.PI*2, 0, Math.PI/2);
  const lid = new THREE.Mesh(lidGeo, lidMat);
  lid.position.y = 0.455;
  group.add(lid);

  // Straw
  const strawGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.55, 6);
  const straw = new THREE.Mesh(strawGeo, strawMat);
  straw.position.set(0.02, 0.65, 0);
  straw.rotation.z = 0.05;
  group.add(straw);

  // Golden glow ring on ground
  const ringGeo = new THREE.RingGeometry(0.3, 0.65, 32);
  ringGeo.rotateX(-Math.PI/2);
  const ringMat = new THREE.MeshBasicMaterial({ color:0xffcc00, transparent:true, opacity:0.7, depthWrite:false, side:THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.02;
  group.add(ring);

  // Outer glow halo
  const haloGeo = new THREE.RingGeometry(0.65, 1.4, 32);
  haloGeo.rotateX(-Math.PI/2);
  const haloMat = new THREE.MeshBasicMaterial({ color:0xffaa00, transparent:true, opacity:0.3, depthWrite:false, side:THREE.DoubleSide });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.y = 0.02;
  group.add(halo);

  // Point light for the golden glow
  const glow = new THREE.PointLight(0xffcc00, 3.0, 8);
  glow.position.y = 0.5;
  group.add(glow);

  // Register animation — updated each frame by main game loop via dobbleGolpGroups
  const startT = performance.now();
  group.userData.dobbleAnim = { startT, glow, ringMat, haloMat, baseY: gy };
  dobbleGolpGroups.push(group);

  // Register as ground loot item using same pattern as createLootMesh
  const item = { type:'heal', key:'dobble_golp', name:'5 TIMES DOBBLE GOLP', legendary:true };
  item.mesh = group;
  item.pos = group.position;
  const label = makeLootLabel(item);
  label.position.set(x, gy + 1.5, z);
  label.visible = false;
  scene.add(label);
  group.userData.label = label;
  lootItems.push(item);

  // Floating label
  addKillFeed('⭐ 5 TIMES DOBBLE GOLP DROPPED ⭐', '', null);
}

function dropLootFromBot(bot) {
  // drop their guns + ammo + a random bonus
  Object.values(bot.inventory).forEach(wk => {
    if (wk) {
      createLootMesh({ type:'weapon', key:wk, name:WEAPONS[wk].name }, bot.pos.x + (Math.random()-0.5)*2, bot.pos.z + (Math.random()-0.5)*2);
    }
  });
  if (Math.random() < 0.6) {
    createLootMesh({ type:'ammo', amount:10, name:'AMMO' }, bot.pos.x+1, bot.pos.z);
  }
  if (Math.random() < 0.4) {
    createLootMesh({ type:'heal', key:'bandage', name:'BANDAGE' }, bot.pos.x-1, bot.pos.z);
  }
}

// ============================================================================
// ZONE
// ============================================================================
function initZone() {
  zone = {
    center: new THREE.Vector3(0,0,0),
    radius: MAP.size,
    nextRadius: MAP.size,
    nextCenter: new THREE.Vector3(),
    stage: 0,
    timer: 120,          // time until first shrink (was 60)
    shrinkTime: 0,       // currently shrinking?
    damage: 0.5,
  };
  // visualize zone with circle ring
  const ringGeo = new THREE.RingGeometry(MAP.size-1, MAP.size, 64);
  ringGeo.rotateX(-Math.PI/2);
  zone.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color:0x00ddff, side:THREE.DoubleSide, transparent:true, opacity:0.6 }));
  zone.ring.position.y = 0.5;
  scene.add(zone.ring);
  // wall
  zone.wallGeo = new THREE.CylinderGeometry(MAP.size, MAP.size, 80, 64, 1, true);
  zone.wallMat = new THREE.MeshBasicMaterial({ color:0x0099ff, transparent:true, opacity:0.18, side:THREE.DoubleSide });
  zone.wall = new THREE.Mesh(zone.wallGeo, zone.wallMat);
  zone.wall.position.y = 40;
  scene.add(zone.wall);
}
function updateZone(dt) {
  zone.timer -= dt;
  if (zone.shrinkTime > 0) {
    zone.shrinkTime -= dt;
    const t = 1 - Math.max(0, zone.shrinkTime / zone.shrinkDuration);
    zone.radius = THREE.MathUtils.lerp(zone.startRadius, zone.nextRadius, t);
    zone.center.lerpVectors(zone.startCenter, zone.nextCenter, t);
    if (zone.shrinkTime <= 0) {
      zone.shrinkTime = 0;
      zone.radius = zone.nextRadius;
      zone.center.copy(zone.nextCenter);
      zone.timer = Math.max(60, 120 - zone.stage*10);
    }
  } else if (zone.timer <= 0 && zone.radius > 30) {
    // start shrink
    zone.stage++;
    zone.startRadius = zone.radius;
    zone.startCenter = zone.center.clone();
    zone.nextRadius = zone.radius * (zone.stage <= 2 ? 0.55 : 0.62);
    // pick new center inside current zone
    const ang = Math.random()*Math.PI*2;
    const offset = (zone.radius - zone.nextRadius) * 0.7 * Math.random();
    zone.nextCenter = new THREE.Vector3(
      zone.center.x + Math.cos(ang)*offset, 0, zone.center.z + Math.sin(ang)*offset
    );
    zone.shrinkDuration = Math.max(15, 35 - zone.stage*4);
    zone.shrinkTime = zone.shrinkDuration;
    zone.damage = 0.5 + zone.stage * 0.8;
  }

  // update ring visuals
  const sr = zone.shrinkTime > 0 ? zone.nextRadius : zone.radius;
  const sc = zone.shrinkTime > 0 ? zone.nextCenter : zone.center;
  zone.ring.geometry.dispose();
  zone.ring.geometry = (() => {
    const g = new THREE.RingGeometry(sr-1.5, sr, 64);
    g.rotateX(-Math.PI/2);
    return g;
  })();
  zone.ring.position.set(sc.x, 0.5, sc.z);
  zone.wall.geometry.dispose();
  zone.wall.geometry = new THREE.CylinderGeometry(zone.radius, zone.radius, 80, 64, 1, true);
  zone.wall.position.set(zone.center.x, 40, zone.center.z);

  // damage entities outside zone
  entities.forEach(e => {
    if (!e.alive) return;
    const dx = e.pos.x - zone.center.x;
    const dz = e.pos.z - zone.center.z;
    if (dx*dx + dz*dz > zone.radius*zone.radius) {
      e.takeDamage(zone.damage * dt * 6, null);
    }
  });

  // HUD
  document.getElementById('zoneStage').textContent = zone.shrinkTime > 0 ? 'SHRINKING' : 'STABLE';
  document.getElementById('zoneTime').textContent = Math.ceil(zone.shrinkTime > 0 ? zone.shrinkTime : zone.timer);
}

// ============================================================================
// BULLETS
// ============================================================================
// Shared tracer geometry (reuse for all bullets)
let _tracerGeo = null;
function getTracerGeo() {
  if (!_tracerGeo) {
    _tracerGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.0, 4);
    _tracerGeo.rotateX(Math.PI/2);
  }
  return _tracerGeo;
}
const _tracerMatPlayer = new THREE.MeshBasicMaterial({ color: 0xffee66 });
const _tracerMatEnemy  = new THREE.MeshBasicMaterial({ color: 0xff8844 });

function spawnBullet(owner, dir, stats) {
  const m = new THREE.Mesh(getTracerGeo(), owner.isPlayer ? _tracerMatPlayer : _tracerMatEnemy);
  let origin;
  if (owner.isPlayer) {
    origin = camera.position.clone();
  } else {
    origin = owner.pos.clone(); origin.y += 1.4;
  }
  m.position.copy(origin);
  m.lookAt(origin.clone().add(dir));
  scene.add(m);
  bullets.push({ mesh:m, dir:dir.clone(), owner, dmg:stats.dmg, range:stats.range, traveled:0, speed:280 });
}
function updateBullets(dt) {
  for (let i=bullets.length-1; i>=0; i--) {
    const b = bullets[i];
    const step = b.speed * dt;
    const next = b.mesh.position.clone().add(b.dir.clone().multiplyScalar(step));
    // Hit detection vs entities (raycast small segment)
    let hit = null;
    let hitDist = Infinity;
    let isHead = false;
    for (const e of entities) {
      if (!e.alive || e === b.owner) continue;
      // Body hitbox: check multiple points along the vertical center to form a capsule
      // Lower body (hips/legs)
      const loPos = e.pos.clone(); loPos.y += 0.5;
      // Mid body (torso center - where plate carrier is)
      const midPos = e.pos.clone(); midPos.y += 1.15;
      // Head
      const headPos = e.pos.clone(); headPos.y += 1.65;

      const seg = next.clone().sub(b.mesh.position);
      const segLen = seg.length(); if (segLen < 0.001) continue;
      const segN = seg.clone().normalize();

      // Check each body zone against the bullet segment
      const bodyRadius = 0.80;  // generous to match soldier visual width
      const headRadius = 0.35;

      // Test body (lower + mid)
      for (const bPos of [loPos, midPos]) {
        const toE = bPos.clone().sub(b.mesh.position);
        const t = Math.max(0, Math.min(segLen, toE.dot(segN)));
        const closest = b.mesh.position.clone().add(segN.clone().multiplyScalar(t));
        const dist = closest.distanceTo(bPos);
        if (dist < bodyRadius) {
          const d = b.traveled + t;
          if (d < hitDist) { hit = e; hitDist = d; isHead = false; }
        }
      }
      // Head check (smaller radius, higher damage)
      const toH = headPos.clone().sub(b.mesh.position);
      const th = Math.max(0, Math.min(segLen, toH.dot(segN)));
      const closestH = b.mesh.position.clone().add(segN.clone().multiplyScalar(th));
      const distHead = closestH.distanceTo(headPos);
      if (distHead < headRadius) {
        const d = b.traveled + th;
        if (d < hitDist) { hit = e; hitDist = d; isHead = true; }
      }
    }
    // Hit detection vs world (terrain + buildings)
    let worldHit = false;
    const terrainH = sampleTerrainHeight(next.x, next.z);
    if (next.y < terrainH + 0.1) worldHit = true;
    for (const bd of buildings) {
      if (bd.userData.bbox && bd.userData.bbox.containsPoint(next)) { worldHit = true; break; }
    }
    if (hit) {
      hit.takeDamage(b.dmg, b.owner, isHead);
      if (b.owner && b.owner.isPlayer) showHitmarker();
      scene.remove(b.mesh);
      bullets.splice(i, 1);
      continue;
    }
    if (worldHit || b.traveled > b.range) {
      // tiny puff
      scene.remove(b.mesh);
      bullets.splice(i, 1);
      continue;
    }
    b.mesh.position.copy(next);
    b.mesh.lookAt(next.clone().add(b.dir));
    b.traveled += step;
  }
}

// ============================================================================
// COLLISION
// ============================================================================
function collidesPos(x, z, r) {
  for (const bd of buildings) {
    if (!bd.userData.bbox) continue;
    if (bd.userData.ground) continue; // ground slabs don't block lateral movement
    if (bd.userData.losOnly) continue; // LOS-only sentinels don't block movement
    const bb = bd.userData.bbox;
    if (x > bb.min.x - r && x < bb.max.x + r && z > bb.min.z - r && z < bb.max.z + r) {
      return true;
    }
  }
  for (const tr of trees) {
    const dx = x - tr.position.x;
    const dz = z - tr.position.z;
    const rr = (tr.userData.radius || 0.5) + r;
    if (dx*dx + dz*dz < rr*rr) return true;
  }
  return false;
}

// ============================================================================
// INPUT
// ============================================================================
function setupInput() {
  document.addEventListener('keydown', e => {
    input[e.code] = true;
    if (e.code === 'KeyR') player.reload();
    if (e.code === 'KeyV') settings.view = (settings.view==='fp') ? 'tp' : 'fp';
    if (e.code === 'KeyX') settings.shoulder = (settings.shoulder==='r') ? 'l' : 'r';
    if (e.code === 'Digit1') player.equip(1);
    if (e.code === 'Digit2') player.equip(2);
    if (e.code === 'Digit3') player.equip(3);
    if (e.code === 'Digit4') player.equip(4);
    if (e.code === 'KeyF') tryLoot();
    if (e.type==='keyup' && e.code==='KeyF' && _searchProgress) cancelSearchProgress();
    if (e.code === 'KeyH') tryHeal();
    if (e.code === 'Tab') { e.preventDefault(); toggleInventory(); }
    if (e.code === 'KeyI') { e.preventDefault(); toggleInventory(); }
    if (e.code === 'Escape') { cancelSearchProgress(); if (searchUIOpen) { closeSearchUI(); return; } if (inventoryOpen) { closeInventory(); return; } }
  });
  document.addEventListener('keyup', e => { input[e.code] = false; if (e.code==='KeyF') { if (_searchProgress) cancelSearchProgress(); _requireFRelease = false; } });

  // Click anywhere on the canvas (or HUD) to acquire pointer lock first.
  // Subsequent clicks fire the gun.
  const tryLock = () => {
    if (inventoryOpen || searchUIOpen) return;
    if (!pointerLocked) {
      const p = renderer.domElement.requestPointerLock();
      if (p && p.catch) p.catch(()=>{});
    }
  };
  // Only lock on canvas clicks — not document-wide, which would eat UI button clicks
  renderer.domElement.addEventListener('click', tryLock);

  document.addEventListener('mousedown', e => {
    // Let UI panels handle their own mouse events completely
    if (searchUIOpen || inventoryOpen) return;
    if (!pointerLocked) {
      // Only steal focus if click was on the canvas/game area, not on UI
      if (e.target === renderer.domElement || e.target === document.body) {
        tryLock();
        e.preventDefault();
      }
      return;
    }
    if (e.button === 0) input.fire = true;
    if (e.button === 2) input.ads = true;
  });
  document.addEventListener('mouseup', e => {
    if (e.button === 0) { input.fire = false; if (player) player.shotsFired = 0; }
    if (e.button === 2) input.ads = false;
  });
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('mousemove', e => {
    if (!pointerLocked) return;
    mouse.dx += e.movementX || 0;
    mouse.dy += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    document.body.classList.toggle('pointer-locked', pointerLocked);
    const hint = document.getElementById('clickHint');
    // Never show hint if a UI is open OR if we're in the middle of re-acquiring lock
    if (hint) hint.style.display = (pointerLocked || inventoryOpen || searchUIOpen || _reacquiringLock) ? 'none' : 'flex';
  });
  document.addEventListener('pointerlockerror', () => {
    console.warn('Pointer lock failed');
  });

  // Scroll wheel cycles through weapon slots
  document.addEventListener('wheel', e => {
    if (!pointerLocked || gameOver || inventoryOpen || searchUIOpen) return;
    const slots = [1, 2, 3, 4];
    const filled = slots.filter(s => player.inventory[s]);
    if (filled.length < 2) return;
    const curIdx = filled.indexOf(player.activeSlot);
    const dir = e.deltaY > 0 ? 1 : -1;
    const nextIdx = ((curIdx + dir) + filled.length) % filled.length;
    player.equip(filled[nextIdx]);
  }, { passive: true });
}

function onResize() {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  if (fxaaPass) {
    fxaaPass.material.uniforms['resolution'].value.set(1 / (innerWidth * renderer.getPixelRatio()), 1 / (innerHeight * renderer.getPixelRatio()));
  }
}

// ============================================================================
// VIEWMODEL (first-person gun in player's hands)
// ============================================================================
let viewmodel = null;

// Cache of (model.uuid|params) → flat Group of regular Meshes with final positions baked in.
// First pickup per param set runs SkeletonUtils.clone (expensive, once only).
// All subsequent pickups clone the flat cached Group (cheap — no skeleton).
const _gltfGunFlatCache = new Map();

// Shared helper — clones a GLTF gun model, auto-scales to targetLen, applies rotation,
// centres+offsets, then caches the result as flat regular Meshes for fast future clones.
function _gltfGun(model, group, targetLen, rx, ry, rz, dx, dy, dz) {
  const key = `${model.uuid}|${targetLen}|${rx}|${ry}|${rz}|${dx}|${dy}|${dz}`;
  if (_gltfGunFlatCache.has(key)) {
    group.add(_gltfGunFlatCache.get(key).clone());
    return true;
  }
  // First call: full SkeletonUtils.clone + scale/rotate/position (identical to original code)
  const m = SkeletonUtils.clone(model);
  m.traverse(c => {
    if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; c.frustumCulled = false; }
  });
  m.updateMatrixWorld(true);
  const b0 = new THREE.Box3().setFromObject(m);
  const s0 = new THREE.Vector3();
  b0.getSize(s0);
  const maxDim = Math.max(s0.x, s0.y, s0.z);
  if (!(maxDim > 0)) {
    console.warn('[_gltfGun] empty bounding box — falling back to procedural');
    return false;
  }
  m.scale.setScalar(targetLen / maxDim);
  m.rotation.set(rx, ry, rz);
  m.updateMatrixWorld(true);
  const b1 = new THREE.Box3().setFromObject(m);
  const ctr = new THREE.Vector3();
  b1.getCenter(ctr);
  m.position.set(-ctr.x + dx, -ctr.y + dy, -ctr.z + dz);
  m.updateMatrixWorld(true);
  // Bake final positioned result into flat regular Meshes so future clones skip SkeletonUtils
  const flat = new THREE.Group();
  m.traverse(node => {
    if (node.isMesh) {
      const geo = node.geometry.clone();
      geo.applyMatrix4(node.matrixWorld);
      geo.boundingBox = null; geo.boundingSphere = null;
      const mesh = new THREE.Mesh(geo, node.material);
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
      mesh.userData.fromBaked = true;
      flat.add(mesh);
    }
  });
  _gltfGunFlatCache.set(key, flat);
  group.add(flat.clone());
  return true;
}

// Materials reused across all gun builds (created once) — full PBR
const VM_MATS = {
  black:      () => new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55, metalness: 0.10 }),
  darkmetal:  () => new THREE.MeshStandardMaterial({ color: 0x24242c, roughness: 0.40, metalness: 0.75 }),
  metal:      () => new THREE.MeshStandardMaterial({ color: 0x6a6e78, roughness: 0.30, metalness: 0.90 }),
  bluedSteel: () => new THREE.MeshStandardMaterial({ color: 0x32363e, roughness: 0.25, metalness: 0.95 }),
  wood:       () => new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.88, metalness: 0.00 }),
  woodLight:  () => new THREE.MeshStandardMaterial({ color: 0x6a4220, roughness: 0.85, metalness: 0.00 }),
  polymer:    () => new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.70, metalness: 0.02 }),
  polymerTan: () => new THREE.MeshStandardMaterial({ color: 0x4a3f2a, roughness: 0.72, metalness: 0.02 }),
  skin:       () => new THREE.MeshStandardMaterial({ color: 0xc7956a, roughness: 0.80, metalness: 0.00 }),
  glass:      () => new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.05, metalness: 0.10, transparent: true, opacity: 0.55 }),
  lens:       () => new THREE.MeshStandardMaterial({ color: 0x4466aa, roughness: 0.05, metalness: 0.20, transparent: true, opacity: 0.75 }),
};

// Helper: simple beveled box (looks less cardboard-y than a plain BoxGeometry by adding chamfer details)
function box(w, h, d, mat, x=0, y=0, z=0, rx=0, ry=0, rz=0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}
function cyl(r1, r2, h, mat, x=0, y=0, z=0, segs=16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, segs), mat);
  m.position.set(x, y, z);
  return m;
}
// Cylinder oriented along the Z (forward) axis — for barrels, scope tubes, etc.
function cylZ(r1, r2, len, mat, x=0, y=0, z=0, segs=16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, segs), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
// Cylinder oriented along the X (sideways) axis — for bolt handles, etc.
function cylX(r1, r2, len, mat, x=0, y=0, z=0, segs=16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, segs), mat);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

// Merge all direct-child Meshes that share the same material into single draw calls.
// Each mesh's local matrix is baked into its geometry clone before merging.
function mergeGunGroup(group) {
  const byMat = new Map();
  const meshChildren = group.children.filter(c => c.isMesh);
  meshChildren.forEach(mesh => {
    mesh.updateMatrix();
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrix);
    const key = mesh.material.uuid;
    if (!byMat.has(key)) byMat.set(key, { mat: mesh.material, geos: [] });
    byMat.get(key).geos.push(geo);
  });
  meshChildren.forEach(mesh => group.remove(mesh));
  byMat.forEach(({ mat, geos }) => {
    const merged = mergeGeometries(geos);
    if (merged) group.add(new THREE.Mesh(merged, mat));
    geos.forEach(g => g.dispose());
  });
}

// Build hands attached to gun (so they move together)
// ---------- Per-weapon builders ----------

// ── Shared hand builder ───────────────────────────────────────────────────────
function buildHands(group, gripZ, foregripZ, hasForegrip) {
  const skin    = new THREE.MeshStandardMaterial({ color:0xc28860, roughness:0.75, metalness:0.0 });
  const sleeve  = new THREE.MeshStandardMaterial({ color:0x3a3028, roughness:0.80, metalness:0.0 });
  const glove   = new THREE.MeshStandardMaterial({ color:0x1e1a14, roughness:0.85, metalness:0.0 });

  // Right (trigger) hand — gloved
  // Palm block
  const rPalm = box(0.068, 0.072, 0.088, glove, 0.026, -0.148, gripZ - 0.010);
  group.add(rPalm);
  // Thumb stub
  group.add(box(0.032, 0.028, 0.048, glove, 0.048, -0.128, gripZ + 0.014));
  // Index finger curl around trigger guard
  group.add(box(0.016, 0.056, 0.020, glove, 0.022, -0.130, gripZ - 0.060));
  // Wrist / sleeve
  group.add(box(0.072, 0.076, 0.100, sleeve, 0.028, -0.100, gripZ + 0.058));
  group.add(box(0.060, 0.088, 0.130, sleeve, 0.024, -0.070, gripZ + 0.130));

  // Left (support) hand
  const lz = foregripZ;
  if (hasForegrip) {
    group.add(box(0.068, 0.072, 0.080, glove, -0.032, -0.160, lz));
    group.add(box(0.030, 0.030, 0.050, glove, -0.054, -0.140, lz + 0.020));
    group.add(box(0.066, 0.080, 0.120, sleeve, -0.028, -0.110, lz + 0.060));
  } else {
    group.add(box(0.080, 0.058, 0.092, glove, -0.036, -0.122, lz));
    group.add(box(0.028, 0.026, 0.048, glove, -0.058, -0.106, lz + 0.018));
    group.add(box(0.068, 0.072, 0.120, sleeve, -0.030, -0.082, lz + 0.060));
  }
}

// ── GLOCK 17 (or Beretta M92 GLTF) ───────────────────────────────────────────
function buildPistol(group, attach) {
  if (BERETTA_MODEL) {
    // Barrel at +X in world space → Ry(+90°) maps +X → -Z (forward)
    _gltfGun(BERETTA_MODEL, group, 0.28, 0, Math.PI/2, 0, 0.04, -0.06, -0.22);
    group.userData.barrelTip = new THREE.Vector3(0, 0.024, -0.222);
    group.userData.basePos   = new THREE.Vector3(0.16, -0.18, -0.26);
    group.userData.adsPos    = new THREE.Vector3(0,    -0.066, -0.22);
    buildHands(group, 0.0, -0.05, false);
    mergeGunGroup(group);
    return group;
  }
}

// ── M4A1 ──────────────────────────────────────────────────────────────────────
function buildAR(group, attach) {
  if (M4_MODEL) {
    const m4 = M4_MODEL.clone();
    m4.traverse(child => {
      if (child.isMesh) { child.castShadow = false; child.receiveShadow = false; }
    });

    // Auto-scale: measure natural bounding box, scale so longest axis ≈ 0.90 viewmodel units
    const bbox0 = new THREE.Box3().setFromObject(m4);
    const size0 = new THREE.Vector3();
    bbox0.getSize(size0);
    const naturalLen = Math.max(size0.x, size0.y, size0.z);
    const scaleFactor = 0.90 / naturalLen;
    m4.scale.setScalar(scaleFactor);

    // Rotate so barrel faces -Z (camera forward in viewmodel space).
    // Natural barrel direction after GLTF load is -X, so rotate -90° on Y.
    m4.rotation.set(0, -Math.PI / 2, 0);
    m4.updateMatrixWorld(true);

    // Recompute bbox after scale + rotation to centre the gun correctly
    const bbox1 = new THREE.Box3().setFromObject(m4);
    const centre = new THREE.Vector3();
    bbox1.getCenter(centre);

    // Fine-tune offsets so the grip sits in the right-hand viewmodel position
    m4.position.set(-centre.x + 0.04, -centre.y - 0.10, -centre.z - 0.45);

    group.add(m4);
    group.userData.barrelTip = new THREE.Vector3(0, 0.024, -0.956);
    group.userData.basePos   = new THREE.Vector3(0.18, -0.20, -0.28);
    group.userData.adsPos    = new THREE.Vector3(0,    -0.10, -0.32);
    buildHands(group, -0.085, -0.490, attach.grip === 'grip');
    mergeGunGroup(group); // only merges direct Mesh children (hands), GLTF sub-tree is a Group so it's skipped
    return group;
  }
}

// ── HK UMP-45 ─────────────────────────────────────────────────────────────────
function buildSMG(group, attach) {
  if (UMP45_MODEL && _gltfGun(UMP45_MODEL, group, 0.043, Math.PI/2, Math.PI, Math.PI, 0.04, -0.16, -0.50)) {
    group.userData.barrelTip = new THREE.Vector3(0, 0.012, -0.548);
    group.userData.basePos   = new THREE.Vector3(0.18, -0.20, -0.26);
    group.userData.adsPos    = new THREE.Vector3(0,    -0.067, -0.24);
    buildHands(group, -0.085, -0.390, attach.grip === 'grip');
    mergeGunGroup(group);
    return group;
  }
}

// ── Kar98k ────────────────────────────────────────────────────────────────────
function buildSniper(group, attach) {
  if (KAR98_MODEL) {
    // Barrel already at -Z in world space after Sketchfab root — no rotation needed
    _gltfGun(KAR98_MODEL, group, 0.95, 0, 0, 0, 0.04, -0.10, -0.45);
    group.userData.barrelTip = new THREE.Vector3(0, 0.034, -0.934);
    group.userData.basePos   = new THREE.Vector3(0.18, -0.20, -0.26);
    group.userData.adsPos    = new THREE.Vector3(0,    -0.088, -0.30);
    buildHands(group, -0.080, -0.490, false);
    mergeGunGroup(group);
    return group;
  }
}

// ── Over/Under Shotgun (IZH-27 GLTF) ─────────────────────────────────────────
function buildShotgun(group, attach) {
  if (IZH27_MODEL && _gltfGun(IZH27_MODEL, group, 0.88, 0, Math.PI, 0, 0.04, -0.10, -0.45)) {
    group.userData.barrelTip = new THREE.Vector3(0, 0.056, -0.862);
    group.userData.basePos   = new THREE.Vector3(0.18, -0.20, -0.26);
    group.userData.adsPos    = new THREE.Vector3(0,    -0.082, -0.20);
    buildHands(group, -0.080, -0.354, false);
    mergeGunGroup(group);
    return group;
  }
}

// ── Desert Eagle ──────────────────────────────────────────────────────────────
function buildDeagle(group, attach) {
  const B=VM_MATS.bluedSteel(), BL=VM_MATS.black(),
        PL=VM_MATS.polymer(), DK=VM_MATS.darkmetal();
  const CH=new THREE.MeshStandardMaterial({color:0x888890,roughness:0.16,metalness:0.96});
  const W=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.5});
  const g=group, a=(...x)=>g.add(box(...x)), c=(...x)=>g.add(cylZ(...x));

  // ── Slide — massive Desert Eagle ──
  a(0.052,0.076,0.328,B, 0,0.018,-0.090);
  a(0.026,0.007,0.308,DK, 0,0.058,-0.090);   // top flat milled
  // Rear serrations (deep, 10 cuts)
  for(let i=0;i<10;i++) a(0.056,0.056,0.003,BL, 0,0.018,0.022-i*0.010);
  // Front serrations (4)
  for(let i=0;i<4;i++) a(0.056,0.030,0.003,BL, 0,0.026,-0.228-i*0.010);
  // Ejection port — right side (large)
  a(0.003,0.028,0.082,BL, 0.028,0.020,-0.106);
  // Barrel hood at breach
  a(0.022,0.012,0.018,CH, 0,0.040,-0.168);
  // Gas piston rib (rotating barrel mechanism)
  c(0.005,0.005,0.180,DK, 0,0.062,-0.140);
  // Slide muzzle taper
  a(0.052,0.020,0.012,B, 0,0.008,-0.256);
  a(0.052,0.008,0.020,B, 0,0.002,-0.260,0.3,0,0);
  // Slide rail grooves (underside)
  a(0.004,0.006,0.328,DK, 0.024,-0.002,-0.090);
  a(0.004,0.006,0.328,DK, -0.024,-0.002,-0.090);

  // ── Frame ──
  a(0.046,0.058,0.282,B, 0,-0.014,-0.076);
  // Trigger guard — boxy with forward finger shelf
  a(0.048,0.011,0.034,B, 0,-0.050,-0.020);
  a(0.048,0.030,0.011,B, 0,-0.034,-0.043);
  a(0.048,0.030,0.011,B, 0,-0.034,0.007);
  a(0.048,0.014,0.026,B, 0,-0.056,-0.052);
  // Trigger
  a(0.011,0.024,0.012,CH, 0,-0.032,-0.020);
  a(0.011,0.009,0.017,CH, 0,-0.020,-0.026);
  // Mag release (oversized)
  a(0.016,0.015,0.012,DK, 0.026,-0.054,-0.006);

  // ── Grip panels — rubber textured ──
  a(0.048,0.134,0.072,PL, 0,-0.088,0.052);
  // Grip texture strips
  for(let i=0;i<7;i++) a(0.050,0.003,0.074,BL, 0,-0.056-i*0.012,0.052);
  // Backstrap
  a(0.014,0.134,0.020,DK, 0,-0.088,0.090);
  // Frontstrap
  a(0.008,0.134,0.012,DK, 0,-0.088,0.016);
  // Mag baseplate
  a(0.046,attach.mag==='extmag'?0.046:0.016,0.074,DK, 0,-0.170,0.052);

  // ── Barrel — chrome-lined, ported ──
  c(0.015,0.015,0.108,CH, 0,0.018,-0.304,14);
  c(0.018,0.015,0.010,DK, 0,0.018,-0.360,12);  // muzzle crown
  c(0.017,0.015,0.010,DK, 0,0.018,-0.294,12);  // rear thread
  // Gas vents on slide top
  for(let i=0;i<4;i++) a(0.014,0.005,0.009,BL, 0,0.064,-0.128-i*0.020);

  // Iron sights
  if(!attach.scope){
    a(0.046,0.013,0.013,DK, 0,0.062,0.013);
    a(0.011,0.016,0.015,BL,  0.018,0.067,0.013);
    a(0.011,0.016,0.015,BL, -0.018,0.067,0.013);
    a(0.006,0.020,0.010,DK, 0,0.060,-0.248);
    a(0.002,0.002,0.010,W,   0,0.071,-0.249);
  }

  // ── Hands (single strong hand) ──
  const SK=new THREE.MeshStandardMaterial({color:0xc28860,roughness:0.75});
  const SL=new THREE.MeshStandardMaterial({color:0x1e1a14,roughness:0.85});
  g.add(box(0.066,0.068,0.088,SL, 0.025,-0.146,0.042));
  g.add(box(0.064,0.076,0.128,SL, 0.023,-0.096,0.130));
  g.add(box(0.028,0.025,0.048,SL, 0.046,-0.126,0.014));

  group.userData.barrelTip=new THREE.Vector3(0,0.018,-0.368);
  group.userData.basePos=new THREE.Vector3(0.15,-0.17,-0.24);
  group.userData.adsPos=new THREE.Vector3(0,-0.070,-0.28);
  mergeGunGroup(group);
}

// ── AKM ───────────────────────────────────────────────────────────────────────
function buildAK(group, attach) {
  if (AK_MODEL) {
    const ak = AK_MODEL.clone();
    ak.traverse(child => {
      if (child.isMesh) { child.castShadow = false; child.receiveShadow = false; }
    });

    const bbox0 = new THREE.Box3().setFromObject(ak);
    const size0 = new THREE.Vector3();
    bbox0.getSize(size0);
    const naturalLen = Math.max(size0.x, size0.y, size0.z);
    ak.scale.setScalar(0.90 / naturalLen);

    // Barrel already at -Z in world space after Sketchfab root — no rotation needed.
    ak.rotation.set(0, 0, 0);
    ak.updateMatrixWorld(true);

    const bbox1 = new THREE.Box3().setFromObject(ak);
    const centre = new THREE.Vector3();
    bbox1.getCenter(centre);
    ak.position.set(-centre.x + 0.04, -centre.y - 0.10, -centre.z - 0.45);

    group.add(ak);
    group.userData.barrelTip = new THREE.Vector3(0, 0.028, -0.802);
    group.userData.basePos   = new THREE.Vector3(0.18, -0.20, -0.28);
    group.userData.adsPos    = new THREE.Vector3(0,    -0.077, -0.30);
    buildHands(group, -0.080, -0.490, false);
    mergeGunGroup(group);
    return group;
  }
}

// ── FN P90 ────────────────────────────────────────────────────────────────────
function buildP90(group, attach) {
  const PL=VM_MATS.polymer(), BL=VM_MATS.black(),
        M=VM_MATS.metal(), DK=VM_MATS.darkmetal();
  const TR=new THREE.MeshStandardMaterial({color:0x3a5a3a,roughness:0.25,metalness:0.05,transparent:true,opacity:0.62});
  const g=group, a=(...x)=>g.add(box(...x)), c=(...x)=>g.add(cylZ(...x));

  // ── Main bullpup body — wide flat teardrop shape ──
  a(0.072,0.060,0.460,PL, 0,0.010,-0.128);
  a(0.054,0.072,0.410,PL, 0,0.014,-0.114);   // side overlap
  // Top shoulder / comb
  a(0.068,0.024,0.384,PL, 0,0.044,-0.098);
  a(0.064,0.010,0.384,DK, 0,0.058,-0.098);   // top flat
  // Rear face
  a(0.070,0.076,0.026,PL, 0,0.014,0.122);
  // Front nose
  a(0.066,0.054,0.026,PL, 0,0.008,-0.354);
  // Underside tapers to grip
  a(0.068,0.026,0.240,PL, 0,-0.024,-0.098);

  // ── Translucent top-loading helical magazine ──
  a(0.066,0.019,0.352,TR, 0,0.057,-0.100);
  // Visible round indicator ribs
  for(let i=0;i<13;i++) a(0.070,0.002,0.007,DK, 0,0.057,-0.266+i*0.028);
  // Mag catch front
  a(0.030,0.010,0.016,DK, 0,0.044,-0.272);

  // ── Ejection port (P90 ejects downward) ──
  a(0.028,0.005,0.036,BL, 0,-0.034,-0.058);

  // ── Integrated pistol grip ──
  const pg=box(0.048,0.086,0.060,PL, 0,-0.062,-0.030);
  pg.rotation.x=-0.10; g.add(pg);
  const pf=box(0.048,0.086,0.008,DK, 0,-0.062,-0.052);
  pf.rotation.x=-0.10; g.add(pf);
  for(let i=0;i<4;i++){const s=box(0.050,0.003,0.062,BL, 0,-0.040-i*0.013,-0.031-i*0.001);s.rotation.x=-0.10;g.add(s);}
  // Trigger guard
  a(0.050,0.009,0.044,PL, 0,-0.034,-0.056);
  a(0.050,0.020,0.009,PL, 0,-0.020,-0.077);
  a(0.050,0.020,0.009,PL, 0,-0.020,-0.037);
  a(0.009,0.018,0.011,M, 0,-0.022,-0.057);
  // Selector ring (ambidextrous)
  g.add(cylX(0.013,0.013,0.008,DK, 0,-0.004,-0.020,6));

  // ── Charging handle — top, ambidextrous wings ──
  a(0.020,0.013,0.024,DK, 0,0.080,-0.004);
  a(0.028,0.008,0.018,DK, 0,0.086,-0.004);
  a(0.008,0.008,0.012,DK, 0.014,0.082,-0.002);
  a(0.008,0.008,0.012,DK, -0.014,0.082,-0.002);

  // ── Short barrel inside bullpup ──
  c(0.013,0.013,0.056,M, 0,0.008,-0.340);
  c(0.016,0.013,0.015,DK, 0,0.008,-0.372,12);

  // ── Picatinny rail top ──
  a(0.024,0.009,0.362,DK, 0,0.080,-0.110);
  for(let i=0;i<15;i++) a(0.028,0.005,0.007,BL, 0,0.086,-0.256+i*0.022);

  // ── Sling attachment points ──
  g.add(cylX(0.007,0.007,0.017,DK, 0.040,-0.010,-0.296,6));
  g.add(cylX(0.007,0.007,0.017,DK, 0.040,-0.010,0.096,6));

  // Iron sights
  if(!attach.scope){
    a(0.030,0.012,0.019,BL, 0,0.088,-0.084);
    a(0.008,0.016,0.021,BL,  0.014,0.091,-0.084);
    a(0.008,0.016,0.021,BL, -0.014,0.091,-0.084);
    a(0.020,0.012,0.017,BL, 0,0.088,-0.330);
    a(0.005,0.018,0.008,M, 0,0.088,-0.330);
  }

  group.userData.barrelTip=new THREE.Vector3(0,0.008,-0.384);
  group.userData.basePos=new THREE.Vector3(0.18,-0.20,-0.26);
  group.userData.adsPos=new THREE.Vector3(0,-0.095,-0.30);
  buildHands(group,-0.080,-0.434,false);
  mergeGunGroup(group);
}

// ── SPAS-12 ───────────────────────────────────────────────────────────────────
function buildSPAS(group, attach) {
  if (SPAS12_MODEL) {
    // SPAS-12: barrel at +X in world space → Ry(+90°) maps +X → -Z (forward)
    _gltfGun(SPAS12_MODEL, group, 0.78, 0, Math.PI/2, 0, 0.04, -0.10, -0.42);
    group.userData.barrelTip = new THREE.Vector3(0, 0.028, -0.716);
    group.userData.basePos   = new THREE.Vector3(0.18, -0.20, -0.26);
    group.userData.adsPos    = new THREE.Vector3(0,    -0.055, -0.25);
    buildHands(group, -0.080, -0.490, false);
    mergeGunGroup(group);
    return group;
  }
}

// ── Barrett M82 ───────────────────────────────────────────────────────────────
function buildBarrett(group, attach) {
  const FL=new THREE.MeshStandardMaterial({color:0x262626,roughness:0.82,metalness:0.14});
  const B=VM_MATS.bluedSteel(), BL=VM_MATS.black(),
        PL=VM_MATS.polymer(), DK=VM_MATS.darkmetal(), M=VM_MATS.metal();
  const CH=new THREE.MeshStandardMaterial({color:0x606068,roughness:0.20,metalness:0.94});
  const g=group, a=(...x)=>g.add(box(...x)), c=(...x)=>g.add(cylZ(...x));

  // ── Upper receiver — massive 2-part ──
  a(0.054,0.084,0.456,FL, 0,0.018,-0.166);
  a(0.050,0.016,0.456,DK, 0,0.064,-0.166);   // top flat
  // Full-length Picatinny rail
  a(0.026,0.010,0.480,DK, 0,0.066,-0.178);
  for(let i=0;i<22;i++) a(0.030,0.006,0.007,BL, 0,0.073,-0.380+i*0.021);
  // Charging handle — large T-bar right side
  a(0.020,0.022,0.044,DK, 0.038,0.036,-0.160);
  a(0.028,0.014,0.016,DK, 0.044,0.030,-0.147);
  // Ejection port (very large for .50 BMG)
  a(0.003,0.032,0.086,BL, 0.030,0.016,-0.206);
  // Receiver top corners chamfered
  a(0.050,0.008,0.456,FL, 0,0.008,-0.166);

  // ── Lower receiver / chassis ──
  a(0.052,0.056,0.382,FL, 0,-0.030,-0.166);
  a(0.052,0.010,0.382,FL, 0,-0.058,-0.166);  // lower floor
  // Takedown pins (large diameter)
  g.add(cylX(0.009,0.009,0.056,CH, 0,0.003,-0.136,6));
  g.add(cylX(0.009,0.009,0.056,CH, 0,0.003,-0.276,6));

  // ── Box magazine — large 10-round .50 BMG ──
  const mH=attach.mag==='extmag'?0.160:0.120;
  a(0.046,mH,0.110,BL, 0,-0.086-mH/2,-0.196);
  for(let i=0;i<3;i++) a(0.048,0.006,0.114,DK, 0,-0.096-i*0.026,-0.196);
  a(0.050,0.014,0.114,DK, 0,-0.086-mH+0.007,-0.196);  // floorplate
  a(0.020,0.022,0.016,B, 0.028,-0.068,-0.248);  // mag release

  // ── Pistol grip ──
  const pg=box(0.038,0.116,0.064,PL, 0,-0.084,-0.078);
  pg.rotation.x=-0.40; g.add(pg);
  const pf=box(0.038,0.116,0.010,DK, 0,-0.084,-0.100);
  pf.rotation.x=-0.40; g.add(pf);
  for(let i=0;i<5;i++){const s=box(0.040,0.003,0.066,BL, 0,-0.058-i*0.016,-0.084-i*0.006);s.rotation.x=-0.40;g.add(s);}
  // Trigger guard
  a(0.040,0.009,0.064,PL, 0,-0.048,-0.114);
  a(0.040,0.024,0.009,PL, 0,-0.034,-0.144);
  a(0.040,0.024,0.009,PL, 0,-0.034,-0.090);
  a(0.009,0.024,0.013,CH, 0,-0.036,-0.116);

  // ── Stock — thumbhole skeletal ──
  a(0.042,0.068,0.340,FL, 0,0.008,0.120);
  a(0.040,0.040,0.260,PL, 0,-0.020,0.118);   // lower spine
  a(0.038,0.010,0.200,DK, 0,0.042,0.130);    // top spine
  // Monopod housing at butt
  a(0.028,0.048,0.022,DK, 0,-0.034,0.284);
  c(0.007,0.007,0.058,CH, 0,-0.060,0.284);   // monopod leg
  a(0.046,0.090,0.026,BL, 0,0.005,0.296);    // butt pad rubber

  // ── Bipod — deployed spread ──
  a(0.058,0.022,0.034,DK, 0,0.006,-0.714);   // clamp
  g.add(cylX(0.007,0.007,0.076,DK, 0,0.010,-0.714,6));  // pivot
  const lL=box(0.007,0.128,0.009,M, -0.030,-0.050,-0.714);
  lL.rotation.z= 0.28; g.add(lL);
  const lR=box(0.007,0.128,0.009,M,  0.030,-0.050,-0.714);
  lR.rotation.z=-0.28; g.add(lR);
  a(0.014,0.014,0.009,BL, -0.046,-0.112,-0.714);
  a(0.014,0.014,0.009,BL,  0.046,-0.112,-0.714);

  // ── Handguard / barrel housing ──
  a(0.058,0.058,0.380,FL, 0,0.010,-0.556);
  a(0.044,0.066,0.380,FL, 0,0.010,-0.556);
  // Heat fins
  for(let i=0;i<8;i++) a(0.066,0.003,0.380,DK, 0,-0.010+i*0.009,-0.556);
  // Vents
  for(let i=0;i<7;i++) a(0.066,0.014,0.016,BL, 0,0.010,-0.432-i*0.046);

  // ── Barrel — heavy contour, fluted ──
  c(0.022,0.022,0.158,M, 0,0.024,-0.326);   // breach
  c(0.018,0.018,0.498,M, 0,0.024,-0.674);   // main
  // Fluting (3 grooves)
  for(let a2=0;a2<3;a2++){
    const an=a2*2.094;
    g.add(cylZ(0.004,0.004,0.460,BL, Math.cos(an)*0.016,0.024+Math.sin(an)*0.016,-0.664));
  }
  // Muzzle brake — double chamber
  g.add(cylZ(0.028,0.028,0.030,M, 0,0.024,-0.936,12));
  a(0.056,0.024,0.030,BL, 0,0.024,-0.936);  // top port
  g.add(cylZ(0.026,0.026,0.009,DK, 0,0.024,-0.922,12));
  g.add(cylZ(0.026,0.026,0.009,DK, 0,0.024,-0.950,12));
  g.add(cylZ(0.030,0.030,0.023,DK, 0,0.024,-0.968,12));  // cap
  g.add(cylZ(0.018,0.018,0.012,M, 0,0.024,-0.984,12));   // crown

  // Iron sights
  if(!attach.scope){
    a(0.038,0.020,0.019,DK, 0,0.076,-0.080);
    a(0.010,0.022,0.014,BL,  0.018,0.082,-0.080);
    a(0.010,0.022,0.014,BL, -0.018,0.082,-0.080);
    a(0.028,0.018,0.025,DK, 0,0.074,-0.738);
    a(0.006,0.026,0.008,M, 0,0.085,-0.738);
    a(0.026,0.008,0.025,DK, 0,0.102,-0.738);
  }

  group.userData.barrelTip=new THREE.Vector3(0,0.024,-0.992);
  group.userData.basePos=new THREE.Vector3(0.18,-0.20,-0.26);
  group.userData.adsPos=new THREE.Vector3(0,-0.099,-0.30);
  buildHands(group,-0.060,-0.514,false);
  mergeGunGroup(group);
}

function buildMachete(group) {
  const M=new THREE.MeshStandardMaterial({color:0x9ab0c0,roughness:0.15,metalness:0.94});
  const G=new THREE.MeshStandardMaterial({color:0x2a1a0a,roughness:0.90,metalness:0.0});
  const SK=new THREE.MeshStandardMaterial({color:0xc28860,roughness:0.75});
  // Blade — spine + edge, along Y axis (pointing up) so melee animation works correctly
  group.add(box(0.006,0.242,0.004,M, 0.002,0.130,0.001));
  group.add(box(0.002,0.228,0.002,M, 0.005,0.124,-0.003));
  // Blood groove
  group.add(box(0.001,0.180,0.002,new THREE.MeshStandardMaterial({color:0x7a9aaa,roughness:0.1,metalness:0.9}), 0,0.100,0.001));
  // Guard
  group.add(box(0.046,0.009,0.020,M, 0,0.005,0));
  // Handle — extending downward from guard
  group.add(box(0.018,0.096,0.018,G, 0,-0.048,0));
  group.add(box(0.022,0.012,0.022,M, 0,-0.108,0));  // pommel
  group.add(box(0.060,0.060,0.072,SK, 0.022,-0.048,0.022));  // hand
  group.userData.barrelTip=new THREE.Vector3(0,0.241,0);
  group.userData.basePos=new THREE.Vector3(0.14,-0.18,-0.24);
  group.userData.adsPos=new THREE.Vector3(0.14,-0.18,-0.24);
}
function buildCrowbar(group) {
  const M=new THREE.MeshStandardMaterial({color:0x3a3a50,roughness:0.45,metalness:0.92});
  const SK=new THREE.MeshStandardMaterial({color:0xc28860,roughness:0.75});
  group.add(cylZ(0.010,0.010,0.440,M, 0,0,-0.100));
  group.add(box(0.088,0.017,0.017,M, 0.034,0,-0.318));
  group.add(box(0.060,0.015,0.017,M, 0.016,0,0.122));
  group.add(box(0.060,0.060,0.068,SK, 0,-0.006,0.026));
  group.userData.barrelTip=new THREE.Vector3(0,0,-0.320);
  group.userData.basePos=new THREE.Vector3(0.14,-0.18,-0.24);
  group.userData.adsPos=new THREE.Vector3(0.14,-0.18,-0.24);
}
function buildBat(group) {
  const W=new THREE.MeshStandardMaterial({color:0x9a7040,roughness:0.70,metalness:0.0});
  const T=new THREE.MeshStandardMaterial({color:0x181818,roughness:0.92,metalness:0.0});
  const SK=new THREE.MeshStandardMaterial({color:0xc28860,roughness:0.75});
  group.add(cyl(0.030,0.034,0.182,W, 0,-0.028,0));
  group.add(cyl(0.034,0.056,0.138,W, 0,0.122,0));
  group.add(cyl(0.056,0.062,0.198,W, 0,0.292,0));
  group.add(cyl(0.030,0.042,0.026,W, 0,-0.132,0));
  for(let i=0;i<5;i++) group.add(cyl(0.035,0.035,0.010,T, 0,-0.060+i*0.018,0));
  group.add(box(0.060,0.060,0.072,SK, 0,-0.030,0.022));
  group.userData.barrelTip=new THREE.Vector3(0,0.400,0);
  group.userData.basePos=new THREE.Vector3(0.14,-0.18,-0.24);
  group.userData.adsPos=new THREE.Vector3(0.14,-0.18,-0.24);
}

function buildViewmodel() {
  if (viewmodel) {
    camera.remove(viewmodel);
    viewmodel.traverse(o => {
      if (o.geometry && !o.userData.fromBaked) o.geometry.dispose();
      if (o.material && !o.userData.fromBaked) o.material.dispose();
    });
  }
  viewmodel = new THREE.Group();
  if (!player || !player.weapon) {
    camera.add(viewmodel);
    if (!scene.children.includes(camera)) scene.add(camera);
    return;
  }
  const a = player.attachments[player.weapon] || {};

  // Build the gun-specific geometry
  if (player.weapon === 'pistol') buildPistol(viewmodel, a);
  else if (player.weapon === 'deagle') buildDeagle(viewmodel, a);
  else if (player.weapon === 'ar') buildAR(viewmodel, a);
  else if (player.weapon === 'ak') buildAK(viewmodel, a);
  else if (player.weapon === 'smg') buildSMG(viewmodel, a);
  else if (player.weapon === 'p90') buildP90(viewmodel, a);
  else if (player.weapon === 'sr') buildSniper(viewmodel, a);
  else if (player.weapon === 'barrett') buildBarrett(viewmodel, a);
  else if (player.weapon === 'shotgun') buildShotgun(viewmodel, a);
  else if (player.weapon === 'spas') buildSPAS(viewmodel, a);
  else if (player.weapon === 'machete') buildMachete(viewmodel);
  else if (player.weapon === 'crowbar') buildCrowbar(viewmodel);
  else if (player.weapon === 'bat') buildBat(viewmodel);

  // Attachments common across rifles
  // Foregrip (visual)
  if (a.grip === 'grip' && (player.weapon === 'ar' || player.weapon === 'smg')) {
    const fg = box(0.025, 0.13, 0.04, VM_MATS.polymer(), 0, -0.10, player.weapon === 'ar' ? -0.50 : -0.40);
    viewmodel.add(fg);
  }

  // Muzzle device
  if (a.muzzle) {
    const tip = viewmodel.userData.barrelTip || new THREE.Vector3(0, 0, -0.5);
    const isSilencer = a.muzzle === 'silencer';
    const mLen = isSilencer ? 0.18 : 0.06;
    const mR = isSilencer ? 0.025 : 0.022;
    const m = cylZ(mR, mR, mLen, VM_MATS.black(), tip.x, tip.y, tip.z - mLen/2);
    if (!isSilencer) {
      // small slots
      m.material = VM_MATS.darkmetal();
    }
    viewmodel.add(m);
    // update barrel tip for muzzle flash
    viewmodel.userData.barrelTip = new THREE.Vector3(tip.x, tip.y, tip.z - mLen);
  }

  // Scope / Optic
  if (a.scope) {
    // Each weapon has its own ideal scope mount position (top of receiver, behind front sight)
    let mountZ = -0.16, mountY = 0.075;
    if (player.weapon === 'ar')      { mountZ = -0.30; mountY = 0.065; }
    else if (player.weapon === 'ak') { mountZ = -0.20; mountY = 0.068; }
    else if (player.weapon === 'smg'){ mountZ = -0.22; mountY = 0.060; }
    else if (player.weapon === 'p90'){ mountZ = -0.10; mountY = 0.058; }
    else if (player.weapon === 'sr') { mountZ = -0.20; mountY = 0.075; }
    else if (player.weapon === 'barrett') { mountZ = -0.14; mountY = 0.075; }
    else if (player.weapon === 'shotgun') { mountZ = -0.20; mountY = 0.085; }
    else if (player.weapon === 'spas') { mountZ = -0.18; mountY = 0.080; }
    else if (player.weapon === 'pistol')  { mountZ = -0.04; mountY = 0.062; }
    else if (player.weapon === 'deagle')  { mountZ = -0.04; mountY = 0.062; }

    if (a.scope === 'reddot') {
      // EOTech-style box-frame holographic sight
      // Low flat body that sits right on the rail
      const rdH = 0.028;  // housing height
      const rdW = 0.044;  // housing width (left-right)
      const rdL = 0.068;  // housing length (front-back)
      const rdBot = mountY + 0.002; // bottom of housing flush with rail top
      const rdMid = rdBot + rdH / 2;
      const bk = VM_MATS.black();
      const dk = VM_MATS.darkmetal();

      const housingGroup = new THREE.Group();

      // Main body block
      housingGroup.add(box(rdW, rdH, rdL, bk, 0, rdMid, mountZ));

      // Rear hood overhang (extends back, taller — classic EOTech look)
      housingGroup.add(box(rdW, rdH * 0.6, rdL * 0.22, bk, 0, rdMid + rdH * 0.2, mountZ + rdL * 0.39));

      // Front shroud (smaller raised lip)
      housingGroup.add(box(rdW, rdH * 0.35, rdL * 0.10, bk, 0, rdMid + rdH * 0.18, mountZ - rdL * 0.45));

      // Window cutout visual — very thin dark-tinted plane inside the housing
      const winMat = new THREE.MeshBasicMaterial({
        color: 0x223322, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide
      });
      const winW = rdW * 0.75, winH = rdH * 0.55;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), winMat);
      win.position.set(0, rdMid + rdH * 0.04, mountZ - rdL * 0.50);
      housingGroup.add(win);

      // Picatinny mount base (wider, lower)
      housingGroup.add(box(rdW * 0.85, 0.009, rdL * 0.80, dk, 0, rdBot - 0.005, mountZ));
      // Mount clamp bolt heads on sides
      housingGroup.add(box(rdW + 0.006, 0.008, 0.012, dk, 0, rdBot + 0.004, mountZ - rdL * 0.22));
      housingGroup.add(box(rdW + 0.006, 0.008, 0.012, dk, 0, rdBot + 0.004, mountZ + rdL * 0.22));

      // Battery compartment cap on rear-left
      housingGroup.add(box(0.008, rdH * 0.5, 0.014, dk, -rdW * 0.5 - 0.004, rdMid, mountZ + rdL * 0.28));

      viewmodel.add(housingGroup);
      viewmodel.userData.reddotHousing = housingGroup;

      // No 3D lens needed — the HUD overlay handles the reticle and border
    } else {
      // Telescopic scope - tube length and radius scale with magnification
      const sLen = a.scope === 'scope8x' ? 0.20 : (a.scope === 'scope4x' ? 0.16 : 0.12);
      const sR   = a.scope === 'scope8x' ? 0.028 : (a.scope === 'scope4x' ? 0.025 : 0.022);
      const scopeY = mountY + sR + 0.012; // raised above receiver
      // Tube
      const tube = cyl(sR, sR, sLen, VM_MATS.black(), 0, scopeY, mountZ);
      tube.rotation.x = Math.PI/2;
      viewmodel.add(tube);
      // Front objective bell (slightly larger)
      const bellLen = 0.035;
      const bell = cyl(sR*1.3, sR*1.05, bellLen, VM_MATS.black(), 0, scopeY, mountZ - sLen/2 - bellLen/2);
      bell.rotation.x = Math.PI/2;
      viewmodel.add(bell);
      // Eye bell (rear)
      const eye = cyl(sR*1.05, sR*1.2, 0.03, VM_MATS.black(), 0, scopeY, mountZ + sLen/2 + 0.015);
      eye.rotation.x = Math.PI/2;
      viewmodel.add(eye);
      // Front lens (blue tint)
      const lens = cyl(sR*1.2, sR*1.2, 0.003, VM_MATS.lens(), 0, scopeY, mountZ - sLen/2 - bellLen - 0.002);
      lens.rotation.x = Math.PI/2;
      viewmodel.add(lens);
      // Mount rings (two)
      viewmodel.add(box(0.012, sR*1.6, 0.022, VM_MATS.metal(), 0, scopeY - sR*0.3, mountZ + sLen*0.28));
      viewmodel.add(box(0.012, sR*1.6, 0.022, VM_MATS.metal(), 0, scopeY - sR*0.3, mountZ - sLen*0.28));
      // Picatinny rail under mount
      viewmodel.add(box(0.022, 0.008, sLen*0.7, VM_MATS.darkmetal(), 0, mountY + 0.010, mountZ));
      // Adjustment turrets
      viewmodel.add(cyl(0.013, 0.013, 0.022, VM_MATS.metal(), 0, scopeY + sR + 0.008, mountZ));
      viewmodel.add(cyl(0.013, 0.013, 0.022, VM_MATS.metal(), sR + 0.008, scopeY, mountZ));
    }
  }

  viewmodel.position.copy(viewmodel.userData.basePos);

  attachMuzzleFlashToViewmodel();

  camera.add(viewmodel);
  if (!scene.children.includes(camera)) scene.add(camera);
}

let muzzleFlash = null;
function buildMuzzleFlash() {
  // attach a small light to the camera so the lambert viewmodel materials are lit
  const fillLight = new THREE.PointLight(0xfff2dd, 0.5, 3);
  fillLight.position.set(0, 0.2, 0.1);
  camera.add(fillLight);
  // ambient-ish boost via hemisphere attached to camera
  const hemi = new THREE.HemisphereLight(0xddeeff, 0x222222, 0.45);
  camera.add(hemi);
}
function attachMuzzleFlashToViewmodel() {
  if (muzzleFlash) {
    if (muzzleFlash.parent) muzzleFlash.parent.remove(muzzleFlash);
    muzzleFlash.geometry.dispose();
    muzzleFlash.material.dispose();
  }
  muzzleFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.10, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent:true, opacity:0, depthWrite:false })
  );
  muzzleFlash.visible = false;
  if (player.weapon && WEAPONS[player.weapon] && WEAPONS[player.weapon].melee) {
    viewmodel.add(muzzleFlash); return;
  }
  const tip = viewmodel.userData.barrelTip || new THREE.Vector3(0, 0, -0.5);
  muzzleFlash.position.copy(tip);
  viewmodel.add(muzzleFlash);
}

function updateViewmodel(dt) {
  if (!viewmodel) return;
  // Hide viewmodel in third-person, OR when looking through a magnified scope
  // (the black scope overlay HUD represents that view; the gun model would
  //  show as a giant cylinder right in front of the camera)
  const stats = player.weapon ? player.effectiveStats() : null;
  const lookingThroughScope = player.isAds && stats && stats.scope &&
    (stats.scope === 'scope2x' || stats.scope === 'scope4x' || stats.scope === 'scope8x');
  viewmodel.visible = (settings.view === 'fp') && !lookingThroughScope;
  if (!viewmodel.visible) return;

  // Red-dot: hide housing when ADS so just the lens is visible (cleaner look)
  const adsThroughReddot = player.isAds && stats && stats.scope === 'reddot';
  if (viewmodel.userData.reddotHousing) {
    viewmodel.userData.reddotHousing.visible = !adsThroughReddot;
  }

  // Shoulder switch (mirror across x — flip both position and the gun model)
  const shoulderSign = (settings.shoulder === 'r') ? 1 : -1;
  viewmodel.scale.x = shoulderSign;

  // Target ADS lerp
  const tgt = player.isAds ? viewmodel.userData.adsPos : viewmodel.userData.basePos;
  const adsLerp = Math.min(1, dt * 12);
  viewmodel.position.x = THREE.MathUtils.lerp(viewmodel.position.x, tgt.x * shoulderSign, adsLerp);
  viewmodel.position.y = THREE.MathUtils.lerp(viewmodel.position.y, tgt.y, adsLerp);
  viewmodel.position.z = THREE.MathUtils.lerp(viewmodel.position.z, tgt.z, adsLerp);

  // Sway from movement
  const t = performance.now()/1000;
  const moving = player.vel && player.vel.lengthSq() > 1;
  const sway = moving ? 0.012 : 0;
  if (sway > 0) {
    viewmodel.position.x += Math.sin(t*8) * sway * (player.isAds ? 0.3 : 1);
    viewmodel.position.y += Math.abs(Math.cos(t*8)) * sway * 0.7 * (player.isAds ? 0.3 : 1);
  }

  // Recoil kick
  const kick = player.recoilOffset || 0;
  viewmodel.position.z += kick * 0.015;
  viewmodel.rotation.x = -kick * 0.04;

  // Reload spin (skip for melee)
  if (player.reloading && !(stats && stats.melee)) {
    viewmodel.rotation.z = -0.5;
    viewmodel.position.y -= 0.06;
  } else if (!(stats && stats.melee)) {
    viewmodel.rotation.z = THREE.MathUtils.lerp(viewmodel.rotation.z, 0, dt*8);
  }
  // Melee swing animation
  if (stats && stats.melee) {
    const swingDur = 0.55; // slightly faster
    const elapsed = player._meleeSwing ? (performance.now()/1000 - player._meleeSwingTime) : swingDur + 1;
    if (player._meleeSwing && elapsed > swingDur) {
      player._meleeSwing = false;
      player._meleeEndX = viewmodel.rotation.x;
      player._meleeEndY = viewmodel.rotation.y;
      player._meleeEndZ = viewmodel.rotation.z;
      player._meleeEndPX = viewmodel.position.x;
      player._meleeEndPY = viewmodel.position.y;
    }

    // Smooth step: eases in AND out — no hard jumps
    const smoothstep = t => t * t * (3 - 2 * t);
    // Ease in only (accelerates): good for slashes
    const easeIn = t => t * t;

    if (player._meleeSwing) {
      const t = Math.min(elapsed / swingDur, 1);

      const S1_END_X = -1.6, S1_END_Z = 1.2;

      const cnt = (player._meleeSwingCount || 0);
      if (cnt % 2 === 1) {
        // Swing 1: smooth windup (0→0.35) then smooth slash (0.35→1)
        // Use smoothstep so there's no hard velocity jump at t=0.35
        const windupT  = Math.min(t / 0.22, 1);
        const slashT   = Math.max((t - 0.22) / 0.78, 0);
        const wu = smoothstep(windupT);
        const sl = easeIn(slashT);

        viewmodel.rotation.x = wu * 0.5 + sl * (S1_END_X - 0.5);
        viewmodel.rotation.z = wu * -0.9 + sl * (S1_END_Z + 0.9);
        viewmodel.rotation.y = wu * -0.2 + sl * 0.2;
        viewmodel.position.x = 0.14 + wu * 0.10 - sl * 0.22;
        viewmodel.position.y = -0.20 + wu * 0.08 - sl * 0.08;

      } else {
        // Swing 2: smooth tip-to-flat (0→0.30) then smooth position sweep (0.30→1)
        const startX  = player._meleeEndX  !== undefined ? player._meleeEndX  : S1_END_X;
        const startZ  = player._meleeEndZ  !== undefined ? player._meleeEndZ  : S1_END_Z;
        const startPX = player._meleeEndPX !== undefined ? player._meleeEndPX : 0.02;

        const flatT  = Math.min(t / 0.30, 1);
        const sweepT = Math.max((t - 0.30) / 0.70, 0);
        const fl = smoothstep(flatT);
        const sw = smoothstep(sweepT);

        // x=-PI/2 rotates Y-axis blade to point forward (along -Z), flat and parallel to ground
        // y=PI/2 rotates the blade so the sharp edge faces the enemy (not the flat face)
        const FLAT_X = -Math.PI / 2;
        const FLAT_Y =  Math.PI / 2;
        viewmodel.rotation.x = startX + fl * (FLAT_X - startX);
        viewmodel.rotation.z = startZ - fl * startZ; // zero out z
        viewmodel.rotation.y =           fl * FLAT_Y; // rotate so edge faces out

        // Sweep hand left to right
        const SWEEP_START = -0.15, SWEEP_END = 0.45;
        viewmodel.position.x = (startPX + fl * (SWEEP_START - startPX)) + sw * (SWEEP_END - SWEEP_START);
        viewmodel.position.y = -0.20;
      }

      viewmodel.position.z -= 0.03 * Math.sin(t * Math.PI);
    } else {
      const lerpSpeed = dt * 7;
      viewmodel.rotation.x = THREE.MathUtils.lerp(viewmodel.rotation.x, 0, lerpSpeed);
      viewmodel.rotation.y = THREE.MathUtils.lerp(viewmodel.rotation.y, 0, lerpSpeed);
      viewmodel.rotation.z = THREE.MathUtils.lerp(viewmodel.rotation.z, 0, lerpSpeed);
      viewmodel.position.x = THREE.MathUtils.lerp(viewmodel.position.x, 0.14, lerpSpeed);
      viewmodel.position.y = THREE.MathUtils.lerp(viewmodel.position.y, -0.20, lerpSpeed);
    }
  }

  // Muzzle flash decay (already positioned at barrel tip as child of viewmodel)
  if (muzzleFlash) {
    muzzleFlash.material.opacity *= 0.55;
    if (muzzleFlash.material.opacity < 0.05) {
      muzzleFlash.material.opacity = 0;
      muzzleFlash.visible = false;
    }
    if (muzzleFlash.visible) {
      const flashScale = 0.8 + muzzleFlash.material.opacity * 0.6;
      muzzleFlash.scale.set(flashScale, flashScale, flashScale);
    }
  }
}

// ============================================================================
// PLAYER UPDATE
// ============================================================================
function updatePlayer(dt) {
  if (!player.alive) return;

  // mouse look
  const sens = player.isAds ? 0.0014 : 0.0028;
  player.yaw -= mouse.dx * sens;
  player.pitch -= mouse.dy * sens;
  player.pitch = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, player.pitch));
  mouse.dx = 0; mouse.dy = 0;

  // movement vectors
  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.sin(player.yaw - Math.PI/2), 0, Math.cos(player.yaw - Math.PI/2));
  let move = new THREE.Vector3();
  if (input.KeyW) move.add(forward);
  if (input.KeyS) move.sub(forward);
  if (input.KeyA) move.sub(right);
  if (input.KeyD) move.add(right);
  if (move.lengthSq() > 0) move.normalize();

  // crouch / sprint
  // crouch / sprint — C toggles crouch, Ctrl also works as hold
  if (input.KeyC && !player._cToggleLock) {
    player.crouchToggled = !player.crouchToggled;
    player._cToggleLock = true;
  }
  if (!input.KeyC) player._cToggleLock = false;
  player.crouching = player.crouchToggled || input.ControlLeft || input.ControlRight;

  const isSprinting = input.ShiftLeft && !player.crouching && move.lengthSq() > 0;

  // --- Bunny hop speed accumulation (Krunker-style) ---
  // bhopSpeed builds up when the player jumps while sprinting/moving.
  // It decays when on the ground without jumping, or when crouching/ADS.
  if (player.bhopSpeed === undefined) player.bhopSpeed = 0;

  let baseSpeed = player.crouching ? 3 : (input.ShiftLeft ? 9 : 6);
  if (player.isAds) baseSpeed *= 0.5;
  if (player.reloading) baseSpeed *= 0.7;

  // Decay bhop speed when grounded and not bunny hopping
  if (player.onGround) {
    if (player.crouching || player.isAds || move.lengthSq() === 0) {
      // Hard stop on crouch/ADS/idle
      player.bhopSpeed = Math.max(0, player.bhopSpeed - dt * 18);
    } else {
      // Gradual decay while running on ground
      player.bhopSpeed = Math.max(0, player.bhopSpeed - dt * 8);
    }
  }

  let speed = baseSpeed + player.bhopSpeed;

  // lean
  let targetLean = 0;
  if (input.KeyQ) targetLean = -1;
  if (input.KeyE) targetLean = 1;
  player.lean = THREE.MathUtils.lerp(player.lean, targetLean, dt*8);

  // attempt move with collision
  const newPos = player.pos.clone().add(move.multiplyScalar(speed * dt));
  if (!collidesPos(newPos.x, player.pos.z, 0.4)) player.pos.x = newPos.x;
  if (!collidesPos(player.pos.x, newPos.z, 0.4)) player.pos.z = newPos.z;

  // jump + gravity, with terrain following
  if (player.verticalVel === undefined) player.verticalVel = 0;
  if (player.onGround === undefined) player.onGround = true;
  // Small upward bias (+0.3) prevents clipping through hills where the ground
  // mesh interpolates between grid vertices at a different height than our
  // procedural sample.
  const groundY = sampleTerrainHeight(player.pos.x, player.pos.z) + 1.3;

  // Track if jump key was just pressed (edge detect for bhop)
  if (player._spaceWas === undefined) player._spaceWas = false;
  const spaceJustPressed = input.Space && !player._spaceWas;
  player._spaceWas = input.Space;

  if (spaceJustPressed && player.onGround) {
    player.verticalVel = 8.5;
    player.onGround = false;

    // Bunny hop: grant speed bonus if already moving at sprint pace
    if (isSprinting || player.bhopSpeed > 0) {
      const maxBhop = 18; // max extra speed on top of base sprint
      const gain = 2.2;   // speed added per hop
      player.bhopSpeed = Math.min(player.bhopSpeed + gain, maxBhop);
      playFootstep(0.07); // quick thud on jump
    }
  }

  player.verticalVel -= 22 * dt; // gravity
  player.pos.y += player.verticalVel * dt;
  if (player.pos.y <= groundY) {
    const wasAirborne = !player.onGround;
    player.pos.y = groundY;
    player.verticalVel = 0;
    player.onGround = true;
    // Landing thud
    if (wasAirborne && player.bhopSpeed > 1) {
      playFootstep(0.09);
    }
  }

  // Footstep sounds while running on ground
  if (player.onGround && move.lengthSq() > 0 && !player.crouching) {
    if (player._footTimer === undefined) player._footTimer = 0;
    const stepRate = isSprinting ? (0.32 - player.bhopSpeed * 0.008) : 0.45;
    player._footTimer -= dt;
    if (player._footTimer <= 0) {
      player._footTimer = Math.max(0.18, stepRate);
      playFootstep(isSprinting ? 0.055 : 0.038);
    }
  } else if (!player.onGround || move.lengthSq() === 0) {
    player._footTimer = 0; // reset so next step plays immediately
  }

  // clamp to map
  player.pos.x = Math.max(-MAP.size+2, Math.min(MAP.size-2, player.pos.x));
  player.pos.z = Math.max(-MAP.size+2, Math.min(MAP.size-2, player.pos.z));
  player.vel.copy(move).multiplyScalar(speed);

  // ADS
  player.isAds = input.ads && player.weapon;

  // fire
  if (input.fire && player.weapon) {
    const stats = player.effectiveStats();
    const fired = player.shoot(performance.now()/1000);
    if (fired && !stats.melee) {
      const isSilenced = (player.attachments[player.weapon] || {}).muzzle === 'silencer';
      // Alert bots within earshot — silencer drastically reduces radius
      const baseRadius = stats === WEAPONS.sr ? 200 :
                         stats === WEAPONS.shotgun ? 120 :
                         stats === WEAPONS.ar ? 100 :
                         stats === WEAPONS.smg ? 80 : 70;
      const shotRadius = isSilenced ? Math.round(baseRadius * 0.12) : baseRadius;
      for (const e of entities) {
        if (e.isPlayer || !e.alive) continue;
        if (e.pos.distanceTo(player.pos) < shotRadius) {
          e.aiState = 'engage';
          e.lastSeen = player.pos.clone();
          if (!e.alertTimer || e.alertTimer <= 0) e.alertTimer = e.reactionTime + 0.5;
        }
      }
    }
    if (fired && !stats.auto && !stats.melee) input.fire = false; // semi-auto (not melee)
  }

  // recoil decay
  player.recoilOffset = Math.max(0, player.recoilOffset - dt*12);

  // Recoil recovery — drift camera back down toward original aim between shots
  if (player.recoilRecover && player.recoilRecover > 0) {
    const recover = Math.min(player.recoilRecover, dt * 0.6);
    player.pitch -= recover * 0.5; // half-recovery (real recoil is rarely 100% recovered)
    player.recoilRecover -= recover;
  }
  // Reset shotsFired counter when not shooting (so next burst starts fresh)
  if (!input.fire) player.shotsFired = 0;

  // camera position
  positionCamera();

  // loot prompt
  updateLootPrompt();

  // scope HUD
  const stats = player.weapon ? player.effectiveStats() : null;
  const scopeEl = document.getElementById('scope');
  const reddotEl = document.getElementById('reddotOverlay');
  const cross = document.getElementById('crosshair');
  const r4 = document.getElementById('reticle4x');
  const r2 = document.getElementById('reticle2x');
  const isScoped = player.isAds && stats && stats.scope;
  const scopeType = isScoped ? stats.scope : null;

  // Telescopic scopes (2x/4x/8x) → full black overlay + reticle SVG
  if (scopeType === 'scope4x' || scopeType === 'scope8x' || scopeType === 'scope2x') {
    scopeEl.classList.add('on');
    reddotEl.classList.remove('on');
    cross.classList.add('ads');
    // Swap reticle group
    if (scopeType === 'scope2x') {
      r4.setAttribute('display','none');
      r2.setAttribute('display','inline');
    } else {
      r4.setAttribute('display','inline');
      r2.setAttribute('display','none');
    }
  } else if (scopeType === 'reddot' && player.isAds) {
    // Red dot: no black overlay, just the tiny dot in the centre
    scopeEl.classList.remove('on');
    reddotEl.classList.add('on');
    cross.classList.add('ads');
  } else {
    scopeEl.classList.remove('on');
    reddotEl.classList.remove('on');
    cross.classList.toggle('ads', player.isAds);
  }
}

function positionCamera() {
  const headY = player.crouching ? 1.0 : 1.55;
  const eye = new THREE.Vector3(player.pos.x, player.pos.y - 1 + headY, player.pos.z);
  // lean offset (perp to forward)
  const right = new THREE.Vector3(Math.sin(player.yaw - Math.PI/2), 0, Math.cos(player.yaw - Math.PI/2));
  eye.add(right.clone().multiplyScalar(player.lean * 0.6));
  // lean tilt
  const tiltZ = -player.lean * 0.12;

  if (settings.view === 'fp') {
    camera.position.copy(eye);
    const dir = new THREE.Vector3(
      Math.sin(player.yaw)*Math.cos(player.pitch),
      Math.sin(player.pitch),
      Math.cos(player.yaw)*Math.cos(player.pitch)
    );
    const look = eye.clone().add(dir);
    camera.up.set(Math.sin(tiltZ), Math.cos(tiltZ), 0).applyAxisAngle(new THREE.Vector3(0,1,0), player.yaw);
    camera.lookAt(look);
    // ADS zoom
    let fov = 75;
    if (player.isAds) {
      const stats = player.effectiveStats();
      fov = 75 / stats.adsZoom;
    }
    camera.fov = THREE.MathUtils.lerp(camera.fov, fov, 0.25);
    camera.updateProjectionMatrix();
  } else {
    // third person — over the shoulder
    const back = new THREE.Vector3(-Math.sin(player.yaw)*Math.cos(player.pitch), -Math.sin(player.pitch), -Math.cos(player.yaw)*Math.cos(player.pitch));
    const offset = right.clone().multiplyScalar(settings.shoulder==='r' ? 0.9 : -0.9);
    const camPos = eye.clone().add(offset).add(back.multiplyScalar(2.6));
    camPos.y += 0.35;
    // simple cam collision
    camera.position.copy(camPos);
    const fwd = new THREE.Vector3(Math.sin(player.yaw)*Math.cos(player.pitch), Math.sin(player.pitch), Math.cos(player.yaw)*Math.cos(player.pitch));
    camera.up.set(Math.sin(tiltZ), Math.cos(tiltZ), 0).applyAxisAngle(new THREE.Vector3(0,1,0), player.yaw);
    camera.lookAt(eye.clone().add(fwd.multiplyScalar(50)));
    let fov = 75;
    if (player.isAds) {
      const stats = player.effectiveStats();
      fov = 75 / Math.min(stats.adsZoom, 2.5);
    }
    camera.fov = THREE.MathUtils.lerp(camera.fov, fov, 0.25);
    camera.updateProjectionMatrix();
  }
}

// ============================================================================
// BOTS AI
// ============================================================================
function updateBots(dt) {
  const now = performance.now()/1000;
  for (const b of entities) {
    if (b.isPlayer || !b.alive) continue;
    // pick target = nearest enemy in sight
    // Sight range: 60 normal, 120 when already engaged
    const sight = b.aiState === 'engage' ? 120 : 60;
    const enemies = entities.filter(e => e !== b && e.alive);
    let target = null, td = Infinity;
    const losReady = !b._losNextCheck || now >= b._losNextCheck;
    if (losReady) {
      b._losNextCheck = now + 0.25; // recheck 4x per second
      b._losCache = null;
      for (const e of enemies) {
        const d = b.pos.distanceTo(e.pos);
        if (d < td && d < sight && hasLineOfSight(b.pos, e.pos)) {
          target = e; td = d;
        }
      }
      b._losCache = target ? { target, td } : null;
    } else if (b._losCache) {
      // use cached result but verify target still alive and in range
      const cached = b._losCache.target;
      if (cached && cached.alive) { target = cached; td = b.pos.distanceTo(target.pos); }
    }

    if (target) {
      b.aiState = 'engage';
      b.lastSeen = target.pos.clone();
      if (b.alertTimer <= 0) b.alertTimer = b.reactionTime + 0.1; // brief wind-up on first spot
      b.alertTimer -= dt;

      // face target
      const dx = target.pos.x - b.pos.x;
      const dz = target.pos.z - b.pos.z;
      const targetYaw = Math.atan2(dx, dz);
      b.yaw = lerpAngle(b.yaw, targetYaw, dt * b.trackSpeed);
      const dy = (target.pos.y + 1.4) - (b.pos.y + 1.4);
      const horiz = Math.sqrt(dx*dx + dz*dz);
      b.pitch = THREE.MathUtils.lerp(b.pitch, Math.atan2(dy, horiz), dt * b.trackSpeed);

      // move (kite / approach)
      const idealDist = b.weapon === 'shotgun' ? 12 : (b.weapon === 'sr' ? 60 : 25);
      let moveDir = new THREE.Vector3();
      if (td > idealDist + 5) moveDir.set(dx, 0, dz).normalize();
      else if (td < idealDist - 5) moveDir.set(-dx, 0, -dz).normalize();
      else {
        // strafe
        const strafe = Math.sin(now*1.3 + b.pos.x) > 0 ? 1 : -1;
        moveDir.set(-dz, 0, dx).normalize().multiplyScalar(strafe);
      }
      const moveSpeed = 4.5 * settings.skill * 1.4;
      const np = b.pos.clone().add(moveDir.multiplyScalar(moveSpeed*dt));
      if (!collidesPos(np.x, b.pos.z, 0.5)) b.pos.x = np.x;
      if (!collidesPos(b.pos.x, np.z, 0.5)) b.pos.z = np.z;

      // shoot
      if (b.alertTimer <= 0) {
        // aim error
        const errYaw = (Math.random()-0.5) * b.aimError;
        const errPitch = (Math.random()-0.5) * b.aimError;
        b.yaw += errYaw; b.pitch += errPitch;
        const stats = b.effectiveStats();
        if (stats && b.ammo[b.weapon] > 0 && !b.reloading) {
          if (Math.random() < b.fireChance) {
            b.shoot(now);
            if (b.shotsFired > b.burstLimit && stats.auto) b.shotsFired = 0;
          }
        }
        b.yaw -= errYaw; b.pitch -= errPitch;
      }
      // reload when low
      if (b.ammo[b.weapon] === 0 && b.reserve[b.weapon] > 0) b.reload();
    } else {
      // No target visible
      b.alertTimer = 0; // reset so next sighting triggers reaction delay fresh
      if (b.alertTimer > 0 && b.lastSeen) {
        // investigate
        const dx = b.lastSeen.x - b.pos.x;
        const dz = b.lastSeen.z - b.pos.z;
        const d = Math.sqrt(dx*dx + dz*dz);
        if (d > 3) {
          b.yaw = lerpAngle(b.yaw, Math.atan2(dx, dz), dt*3);
          const np = b.pos.clone().add(new THREE.Vector3(dx,0,dz).normalize().multiplyScalar(4*dt));
          if (!collidesPos(np.x, b.pos.z, 0.5)) b.pos.x = np.x;
          if (!collidesPos(b.pos.x, np.z, 0.5)) b.pos.z = np.z;
        }
      } else {
        b.aiState = 'patrol';
        // If storm is actively shrinking and bot is outside or near the new circle,
        // force them to move toward the next zone center immediately.
        const isShrinking = zone && zone.shrinkTime > 0;
        const outsideNextZone = isShrinking && (() => {
          const ddx = b.pos.x - zone.nextCenter.x;
          const ddz = b.pos.z - zone.nextCenter.z;
          return (ddx*ddx + ddz*ddz) > (zone.nextRadius * zone.nextRadius * 0.85);
        })();

        b.aiTimer -= dt;
        if (outsideNextZone || b.aiTimer <= 0 || b.pos.distanceTo(b.aiTarget) < 4) {
          b.aiTimer = outsideNextZone ? 1 + Math.random()*2 : 5 + Math.random()*8;
          // bias: outside zone = always head in; shrinking = 90% chance; otherwise 60%
          const zoneBias = outsideNextZone ? 1.0 : (isShrinking ? 0.9 : 0.6);
          const towardZone = Math.random() < zoneBias;
          if (towardZone) {
            const targetCenter = (isShrinking && zone.nextCenter) ? zone.nextCenter : zone.center;
            const ang = Math.random()*Math.PI*2;
            // When urgently escaping storm, pick a point well inside the next zone
            const safeRadius = outsideNextZone ? zone.nextRadius * 0.5 : zone.radius * 0.7;
            const r = safeRadius * Math.random();
            b.aiTarget.set(targetCenter.x + Math.cos(ang)*r, 0, targetCenter.z + Math.sin(ang)*r);
          } else {
            b.aiTarget.set(b.pos.x + (Math.random()-0.5)*40, 0, b.pos.z + (Math.random()-0.5)*40);
          }
        }
        const dx = b.aiTarget.x - b.pos.x;
        const dz = b.aiTarget.z - b.pos.z;
        const d = Math.sqrt(dx*dx + dz*dz);
        if (d > 0.5) {
          b.yaw = lerpAngle(b.yaw, Math.atan2(dx, dz), dt*2);
          const sp = 3.5;
          const np = b.pos.clone().add(new THREE.Vector3(dx,0,dz).normalize().multiplyScalar(sp*dt));
          if (!collidesPos(np.x, b.pos.z, 0.5)) b.pos.x = np.x;
          if (!collidesPos(b.pos.x, np.z, 0.5)) b.pos.z = np.z;
        }
      }
    }

    // sync mesh — terrain following + walking animation
    // Track movement speed since last frame for the walk cycle
    if (!b.lastSyncPos) b.lastSyncPos = new THREE.Vector3().copy(b.pos);
    const moved = new THREE.Vector2(b.pos.x - b.lastSyncPos.x, b.pos.z - b.lastSyncPos.z).length();
    b.lastSyncPos.copy(b.pos);
    const moveSpeed = moved / Math.max(dt, 0.0001); // m/s
    const walkRate = THREE.MathUtils.clamp(moveSpeed / 4.0, 0, 1.5); // 0..1.5+

    // Sample terrain height under the bot
    const terrainY = sampleTerrainHeight(b.pos.x, b.pos.z);
    // CRITICAL: update actual pos.y so hitbox detection matches visual position
    b.pos.y = terrainY;

    // Advance walk phase based on movement
    if (moveSpeed > 0.5) {
      b.walkPhase = (b.walkPhase || 0) + dt * (4 + walkRate * 4);
    } else {
      // Idle - settle limbs back toward neutral
      b.walkPhase = (b.walkPhase || 0) * 0.92;
    }
    const swing = Math.sin(b.walkPhase) * 0.5 * walkRate;
    if (b.hipL && b.hipR) {
      b.hipL.rotation.x =  swing;
      b.hipR.rotation.x = -swing;
      // arms swing opposite to legs
      if (b.shoulderL && b.shoulderR) {
        // Bot's "trigger arm" (right) is bent forward holding the gun;
        // we keep it at a forward bias and only let the support arm swing.
        b.shoulderR.rotation.x = -0.9;
        b.shoulderL.rotation.x = -0.6 + swing * 0.6;
      }
      // tiny vertical bob
      b.mesh.position.y = terrainY + Math.abs(Math.sin(b.walkPhase * 2)) * 0.04 * walkRate;
    } else {
      b.mesh.position.y = terrainY;
    }
    b.mesh.position.x = b.pos.x;
    b.mesh.position.z = b.pos.z;
    b.mesh.rotation.y = b.yaw;
  }
}

// Raw procedural noise height (no city flattening) — shared formula
// Value noise + FBM for realistic terrain
function _vnoise(ix, iz) {
  // Hash two integers to [0,1]
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function _smoothNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  // Quintic smoothstep
  const ux = fx*fx*fx*(fx*(fx*6-15)+10);
  const uz = fz*fz*fz*(fz*(fz*6-15)+10);
  return _vnoise(ix,iz)*(1-ux)*(1-uz)
       + _vnoise(ix+1,iz)*ux*(1-uz)
       + _vnoise(ix,iz+1)*(1-ux)*uz
       + _vnoise(ix+1,iz+1)*ux*uz;
}
function _fbm(x, z, octaves) {
  let v=0, amp=1, freq=1, max=0;
  for (let o=0; o<octaves; o++) {
    v   += (_smoothNoise(x*freq, z*freq)*2-1) * amp;
    max += amp;
    amp  *= 0.50;
    freq *= 2.10;
  }
  return v / max;
}
function rawTerrainNoise(x, z) {
  // Large-scale rolling hills — more dramatic amplitude
  const large = _fbm(x*0.0055, z*0.0055, 5) * 14.0;
  // Medium ridges and valleys
  const mid   = _fbm(x*0.018  + 4.3, z*0.016  + 1.7, 4) * 4.5;
  // Fine surface detail
  const fine  = _fbm(x*0.060  + 8.1, z*0.058  + 3.2, 3) * 1.0;
  // Domain-warped ridge lines — stronger warp for more interesting terrain
  const warpX = _fbm(x*0.010  + 2.0, z*0.010  + 5.0, 3) * 18;
  const warpZ = _fbm(x*0.010  + 7.0, z*0.010  + 1.0, 3) * 18;
  const warped= _fbm((x+warpX)*0.012, (z+warpZ)*0.012, 4) * 7.0;
  return large + mid * 0.6 + fine + warped * 0.5;
}

// Sample the world terrain height at (x, z)
// Mirrors exactly the vertex displacement used in buildWorld's ground mesh.
function sampleTerrainHeight(x, z) {
  // Shooting range — perfectly flat floor at y=0
  if (globalThis._rangeMode) return 0;
  // Mirrors ground mesh formula exactly — smoothstep flat zone inside cityRadius
  let cityFlat = 0;
  if (world && world.cityCenter) {
    const d = Math.hypot(x - world.cityCenter.x, z - world.cityCenter.y);
    const blendStart = world.cityRadius + 30;
    const blendEnd   = world.cityRadius + 170;
    if (d <= blendStart) {
      cityFlat = 1.0;
    } else if (d < blendEnd) {
      const t = (d - blendStart) / (blendEnd - blendStart);
      cityFlat = 1.0 - t * t * (3 - 2 * t); // smoothstep
    }
  }
  let h = rawTerrainNoise(x, z) * (1 - cityFlat);
  // Check ground-flagged bboxes (car roofs, sidewalks) — stand on top if inside
  if (world) {
    for (const bd of buildings) {
      if (!bd.userData.ground || !bd.userData.bbox) continue;
      const bb = bd.userData.bbox;
      if (x > bb.min.x && x < bb.max.x && z > bb.min.z && z < bb.max.z) {
        h = Math.max(h, bb.max.y);
      }
    }
  }
  return h;
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI*2;
  while (d < -Math.PI) d += Math.PI*2;
  return a + d * Math.min(1, t);
}

function hasLineOfSight(a, b) {
  // simple raycast against buildings
  const dx = b.x - a.x, dz = b.z - a.z;
  const dist = Math.sqrt(dx*dx + dz*dz);
  if (dist < 1) return true;
  const steps = Math.min(20, Math.floor(dist/3));
  for (let i=1; i<steps; i++) {
    const t = i/steps;
    const px = a.x + dx*t;
    const pz = a.z + dz*t;
    const py = (a.y + (b.y-a.y)*t) + 1;
    for (const bd of buildings) {
      if (bd.userData.bbox && bd.userData.bbox.containsPoint(new THREE.Vector3(px, py, pz))) return false;
    }
  }
  return true;
}

// ============================================================================
// LOOT INTERACTION
// ============================================================================
// ============================================================================
// SEARCH SYSTEM
// ============================================================================
let searchUIOpen = false;
let _reacquiringLock = false; // suppresses "click to play" during lock re-acquire
let _searchingContainer = null; // container being searched
let _searchProgress = null;     // { startTime, duration, raf }
let _pendingAttachment = null;  // attachment item waiting for weapon selection

function nearestGroundLoot() {
  let best = null, bd = 3.5;
  for (const it of lootItems) {
    if (!it.mesh) continue;
    const d = player.pos.distanceTo(it.pos);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

function nearestContainer() {
  let best = null, bd = 4.5;
  for (const obj of searchableObjects) {
    if (obj.searched) continue;
    const dx = player.pos.x - obj.worldX;
    const dz = player.pos.z - obj.worldZ;
    const d = Math.hypot(dx, dz);
    if (d < bd) { bd = d; best = obj; }
  }
  return best;
}

function updateLootPrompt() {
  const el = document.getElementById('lootPrompt');
  const txt = document.getElementById('lootText');
  if (searchUIOpen) { el.style.display='none'; return; }
  // Ground loot (bot drops)
  for (const item of lootItems) {
    if (item.mesh && item.mesh.userData.label)
      item.mesh.userData.label.visible = false;
  }
  const ground = nearestGroundLoot();
  if (ground) {
    if (ground.mesh && ground.mesh.userData.label) ground.mesh.userData.label.visible = true;
    el.style.display = 'block';
    let label = ground.name;
    if (ground.type==='ammo') label += ' ×'+ground.amount;
    txt.textContent = 'PICK UP ' + label;
    return;
  }
  // Container
  const container = nearestContainer();
  if (container) {
    el.style.display = 'block';
    const labels = { dumpster:'SEARCH DUMPSTER', car:'SEARCH CAR', bush:'SEARCH BUSH', garbage_can:'SEARCH GARBAGE', toolbox:'SEARCH TOOLBOX' };
    txt.textContent = labels[container.type] || 'SEARCH';
  } else {
    el.style.display = 'none';
  }
}

let _lootPickupCooldown = 0; // timestamp before which ground loot cannot be picked up
let _requireFRelease = false; // must release F before picking up items dropped by garbage can

function tryLoot() {
  if (searchUIOpen) return;
  // Ground loot: instant pickup (but require F release after garbage can scatter)
  if (performance.now() >= _lootPickupCooldown && !_requireFRelease) {
    const ground = nearestGroundLoot();
    if (ground) {
      if (ground.type === 'attachment') {
        applyItem(ground, ground); // shows picker, removal handled by applyAttachmentToWeapon
      } else {
        applyItem(ground, ground);
        removeGroundLoot(ground);
      }
      return;
    }
  }
  // Container: start search progress bar
  const container = nearestContainer();
  if (!container) return;
  startSearchProgress(container);
}

function startSearchProgress(container) {
  if (_searchProgress) return; // already searching
  const dur = 2250; // 2.25 seconds (reduced 25% from 3s)
  const bar = document.getElementById('searchProgressWrap');
  const fill = document.getElementById('searchProgressFill');
  const label = document.getElementById('searchProgressLabel');
  const labels = { dumpster:'SEARCHING DUMPSTER', car:'SEARCHING CAR', bush:'SEARCHING BUSH', garbage_can:'SEARCHING GARBAGE', toolbox:'SEARCHING TOOLBOX' };
  label.textContent = labels[container.type] || 'SEARCHING';
  bar.style.display = 'block';
  fill.style.width = '0%';
  const start = performance.now();
  function tick() {
    const pct = Math.min(1, (performance.now()-start)/dur);
    fill.style.width = (pct*100).toFixed(1)+'%';
    if (pct < 1) {
      _searchProgress = { raf: requestAnimationFrame(tick) };
    } else {
      cancelSearchProgress();
      if (container.type === 'garbage_can') {
        // Drop items on the ground — set cooldown so holding F doesn't instantly pick them up
        container.searched = true;
        _lootPickupCooldown = performance.now() + 1200; // 1.2s cooldown
        _requireFRelease = true; // prevent pickup until F is released
        for (const item of (container.items || [])) {
          const ox = (Math.random()-0.5)*2.5, oz = (Math.random()-0.5)*2.5;
          if (item.key === 'dobble_golp') {
            spawnDobbleGolp(container.worldX + ox, container.worldZ + oz);
          } else {
            createLootMesh(item, container.worldX + ox, container.worldZ + oz);
          }
        }
        container.items = [];
      } else {
        openSearchUI(container);
      }
    }
  }
  _searchProgress = { raf: requestAnimationFrame(tick) };
}

function cancelSearchProgress() {
  if (_searchProgress) { cancelAnimationFrame(_searchProgress.raf); _searchProgress = null; }
  document.getElementById('searchProgressWrap').style.display = 'none';
}

function openSearchUI(container) {
  _searchingContainer = container;
  searchUIOpen = true;
  _reacquiringLock = true; // suppress hint during lock release
  document.exitPointerLock();
  _reacquiringLock = false;
  const hint = document.getElementById('clickHint');
  if (hint) hint.style.display = 'none';
  document.getElementById('searchUI').style.display = 'flex';
  const labels = { dumpster:'DUMPSTER', car:'CAR TRUNK', bush:'BUSH', garbage_can:'GARBAGE CAN', toolbox:'TOOLBOX' };
  document.getElementById('searchUITitle').textContent = 'SEARCHING: '+(labels[container.type]||'CONTAINER');
  renderSearchUI();
}

function closeSearchUI() {
  searchUIOpen = false;
  _searchingContainer = null;
  _pendingAttachment = null;
  cancelSearchProgress();
  document.getElementById('searchUI').style.display = 'none';
  document.getElementById('attachWeaponPicker').style.display = 'none';
  // Re-acquire pointer lock automatically — hide hint immediately
  if (!gameOver && renderer) {
    const hint = document.getElementById('clickHint');
    if (hint) hint.style.display = 'none';
    _reacquiringLock = true;
    const p = renderer.domElement.requestPointerLock();
    if (p && p.then) p.then(() => { _reacquiringLock = false; }).catch(() => { _reacquiringLock = false; });
    else setTimeout(() => { _reacquiringLock = false; }, 400);
  }
}
document.getElementById('searchUI').addEventListener('click', function(e){ if(e.target===this) closeSearchUI(); });

function renderSearchUI() {
  if (!_searchingContainer) return;
  const C = {weapon:'#ff6622',heal:'#22ee55',ammo:'#ffcc00',attachment:'#33aaff',armor:'#aaaaff'};
  const items = _searchingContainer.items || [];
  const cDiv = document.getElementById('searchContainerItems');
  cDiv.innerHTML = '';
  if (!items.length) {
    cDiv.innerHTML = '<div style="color:#444;font-family:Bebas Neue,sans-serif;font-size:14px;padding:12px 0;">EMPTY</div>';
  }
  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'search-row';
    let name = item.name;
    if (item.type==='ammo') name += ' ×'+item.amount;
    const takeBtn = document.createElement('button');
    takeBtn.className = 'sr-take';
    takeBtn.textContent = 'TAKE';
    takeBtn.addEventListener('click', () => takeContainerItem(idx));
    const nameDiv = document.createElement('div');
    nameDiv.innerHTML = `<div class="sr-name" style="color:${C[item.type]||'#fff'}">${name}<div class="sr-type">${item.type.toUpperCase()}</div></div>`;
    row.appendChild(nameDiv);
    row.appendChild(takeBtn);
    cDiv.appendChild(row);
  });
  // Player side
  const pDiv = document.getElementById('searchPlayerItems');
  pDiv.innerHTML = '';
  for (let s=1;s<=4;s++) {
    const wk = player.inventory[s];
    const row = document.createElement('div');
    row.className = 'search-row';
    if (!wk) {
      row.innerHTML = `<div class="sr-name" style="color:#444">SLOT ${s} — EMPTY</div>`;
    } else {
      const att = player.attachments[wk]||{};
      const attStr = Object.values(att).filter(Boolean).map(a=>ATTACHMENTS[a]?.name||a).join(' · ');
      row.innerHTML = `<div class="sr-name">${WEAPONS[wk].name}<div class="sr-type">${attStr||'no attachments'}</div></div><div class="sr-ammo">${player.ammo[wk]||0}/${player.reserve[wk]||0}</div>`;
    }
    pDiv.appendChild(row);
  }
  if (player.healStash && player.healStash.length) {
    const row = document.createElement('div');
    row.className = 'search-row';
    row.innerHTML = `<div class="sr-name" style="color:#22ee55">HEALS<div class="sr-type">${player.healStash.map(k=>HEAL_ITEMS[k]?.name||k).join(', ')}</div></div>`;
    pDiv.appendChild(row);
  }
  if (player.armor > 0) {
    const row = document.createElement('div');
    row.className = 'search-row';
    row.innerHTML = `<div class="sr-name" style="color:#aaaaff">ARMOR<div class="sr-type">${Math.round(player.armor)}/100</div></div>`;
    pDiv.appendChild(row);
  }
}

function takeContainerItem(idx) {
  if (!_searchingContainer) return;
  const item = _searchingContainer.items[idx];
  if (!item) return;
  if (item.type === 'attachment') {
    // Show weapon picker instead of immediately applying
    _pendingAttachment = { item, idx };
    showAttachWeaponPicker(item);
    return;
  }
  applyItem(item);
  _searchingContainer.items.splice(idx, 1);
  if (_searchingContainer.items.length === 0) _searchingContainer.searched = true;
  renderSearchUI();
}

function showAttachWeaponPicker(item) {
  const picker = document.getElementById('attachWeaponPicker');
  const info = document.getElementById('attachPickerInfo');
  const btns = document.getElementById('attachPickerBtns');
  info.textContent = 'APPLY ' + item.name + ' TO:';
  btns.innerHTML = '';
  let hasWeapon = false;
  for (let s=1;s<=4;s++) {
    const wk = player.inventory[s];
    if (!wk) continue;
    const att = ATTACHMENTS[item.key];
    const w = WEAPONS[wk];
    if (w.melee) continue;
    if (att.type === 'grip' && w.slot === 3) continue;
    if (att.type === 'muzzle' && att.key === 'silencer' && (wk === 'shotgun' || wk === 'spas')) continue;
    hasWeapon = true;
    const btn = document.createElement('button');
    btn.className = 'attach-pick-btn';
    btn.textContent = WEAPONS[wk].name + ' (slot '+s+')';
    btn.onclick = () => { applyAttachmentToWeapon(item, wk); };
    btns.appendChild(btn);
  }
  if (!hasWeapon) {
    btns.innerHTML = '<div style="color:#555;font-size:13px;">No weapons in inventory</div>';
  }
  // Cancel button
  const cancel = document.createElement('button');
  cancel.className = 'attach-pick-btn';
  cancel.style.borderColor = '#555'; cancel.style.color='#555';
  cancel.textContent = 'CANCEL';
  cancel.onclick = () => { _pendingAttachment=null; _closePicker(); };
  btns.appendChild(cancel);
  if (!searchUIOpen) document.exitPointerLock();
  picker.style.display = 'flex';
}

function _closePicker() {
  document.getElementById('attachWeaponPicker').style.display = 'none';
  if (!searchUIOpen && !gameOver && renderer) {
    const hint = document.getElementById('clickHint');
    if (hint) hint.style.display = 'none';
    _reacquiringLock = true;
    const p = renderer.domElement.requestPointerLock();
    if (p && p.then) p.then(() => { _reacquiringLock = false; }).catch(() => { _reacquiringLock = false; });
    else setTimeout(() => { _reacquiringLock = false; }, 400);
  }
}

function applyAttachmentToWeapon(item, wk) {
  const att = ATTACHMENTS[item.key];
  player.attachments[wk] = player.attachments[wk] || {};
  player.attachments[wk][att.type] = item.key;
  addKillFeed('ATTACHED', att.name + ' → ' + WEAPONS[wk].name, null);
  buildViewmodel();
  if (_pendingAttachment) {
    if (_pendingAttachment.ground && _pendingAttachment.groundItem) {
      removeGroundLoot(_pendingAttachment.groundItem);
    } else if (_searchingContainer && _pendingAttachment.idx >= 0) {
      _searchingContainer.items.splice(_pendingAttachment.idx, 1);
      if (_searchingContainer.items.length === 0) _searchingContainer.searched = true;
    }
    _pendingAttachment = null;
  }
  _closePicker();
  renderSearchUI();
  updateHUD();
}

function applyItem(item, groundLootObj) {
  if (item.type==='weapon') {
    const slot=[1,2,3,4].find(s=>!player.inventory[s])||player.activeSlot;
    player.giveWeapon(item.key, slot); player.equip(slot);
    addKillFeed('PICKED UP', WEAPONS[item.key].name, null);
  } else if (item.type==='ammo') {
    const wk=player.weapon;
    if (wk) { player.reserve[wk]=(player.reserve[wk]||0)+item.amount; }
    else { for (const k in player.reserve) player.reserve[k]+=Math.floor(item.amount/3); }
    updateHUD();
  } else if (item.type==='heal') {
    player.healStash=player.healStash||[]; player.healStash.push(item.key);
    const msg = item.key === 'dobble_golp' ? '⭐ 5 TIMES DOBBLE GOLP ⭐' : HEAL_ITEMS[item.key].name;
    addKillFeed('PICKED UP', msg, null);
  } else if (item.type==='attachment') {
    _pendingAttachment = { item, idx: -1, ground: true, groundItem: groundLootObj };
    showAttachWeaponPicker(item);
  } else if (item.type==='armor') {
    player.armor=Math.min(100,(player.armor||0)+item.amount);
    addKillFeed('PICKED UP', 'ARMOR VEST', null); updateHUD();
  }
}

function removeGroundLoot(it) {
  scene.remove(it.mesh);
  if (it.mesh&&it.mesh.userData.label) scene.remove(it.mesh.userData.label);
  lootItems.splice(lootItems.indexOf(it),1);
  updateHUD();
}
function tryHeal() {
  if (!player.healStash || !player.healStash.length) return;
  if (player.hp >= player.maxHp && !HEAL_ITEMS[player.healStash[0]]?.legendary) return;
  if (player._healing) return;
  const k = player.healStash.shift();
  const h = HEAL_ITEMS[k];
  player._healing = true;
  addKillFeed('USING', h.name, null);

  const bar = document.getElementById('healBar');
  const fill = document.getElementById('healBarFill');
  const timeEl = document.getElementById('healBarTime');
  const label = document.getElementById('healBarLabel');
  label.textContent = 'USING ' + h.name;
  bar.style.display = 'block';
  fill.style.width = '0%';
  if (h.legendary) fill.style.background = 'linear-gradient(90deg,#f0a000,#ffe040)';
  else fill.style.background = '';

  const start = performance.now();
  const dur = h.time * 1000;
  function tick() {
    if (!player._healing) { bar.style.display = 'none'; return; }
    const elapsed = performance.now() - start;
    const pct = Math.min(1, elapsed / dur);
    fill.style.width = (pct * 100).toFixed(1) + '%';
    const rem = Math.ceil((dur - elapsed) / 1000);
    timeEl.textContent = rem + 's';
    if (pct < 1) { requestAnimationFrame(tick); }
    else {
      player.hp = Math.min(player.maxHp, player.hp + h.heal);
      if (h.armor) player.armor = Math.min(100, (player.armor||0) + h.armor);
      player._healing = false;
      bar.style.display = 'none';
      fill.style.background = '';
      updateHUD();
    }
  }
  requestAnimationFrame(tick);
}

// ============================================================================
// HUD
// ============================================================================
function updateHUD() {
  const hp = Math.max(0, Math.round(player.hp));
  const armor = Math.max(0, Math.round(player.armor || 0));
  document.getElementById('hpBar').querySelector('.fill').style.width = hp + '%';
  document.getElementById('hpNum').textContent = hp;
  document.getElementById('armorBar').querySelector('.fill').style.width = armor + '%';
  document.getElementById('armorNum').textContent = armor;
  if (player.weapon) {
    const w = WEAPONS[player.weapon];
    document.getElementById('gunName').textContent = w.name;
    const _wDef = WEAPONS[player.weapon];
    if (_wDef && _wDef.melee) {
      document.getElementById('ammoCur').textContent = 'MELEE';
      document.getElementById('ammoRes').textContent = '';
    } else {
      document.getElementById('ammoCur').textContent = player.ammo[player.weapon] ?? 0;
      document.getElementById('ammoRes').textContent = player.reserve[player.weapon] ?? 0;
    }
  } else {
    document.getElementById('gunName').textContent = 'UNARMED';
    document.getElementById('ammoCur').textContent = '--';
    document.getElementById('ammoRes').textContent = '--';
  }
  for (let s=1; s<=4; s++) {
    const el = document.getElementById('slot'+s);
    el.classList.toggle('active', player.activeSlot === s);
    const wk = player.inventory[s];
    el.querySelector('.name').textContent = wk ? WEAPONS[wk].name : '—';
  }

  // Bhop speed indicator
  const bhop = player.bhopSpeed || 0;
  let speedEl = document.getElementById('bhopSpeed');
  if (!speedEl) {
    speedEl = document.createElement('div');
    speedEl.id = 'bhopSpeed';
    speedEl.style.cssText = 'position:absolute;left:24px;bottom:200px;font-family:Bebas Neue,sans-serif;font-size:13px;letter-spacing:3px;color:#ff5028;opacity:0;transition:opacity 0.3s;';
    document.getElementById('hud').appendChild(speedEl);
  }
  if (bhop > 0.5) {
    speedEl.textContent = 'BHOP x' + (1 + bhop/9).toFixed(1);
    speedEl.style.opacity = Math.min(1, bhop / 5);
  } else {
    speedEl.style.opacity = 0;
  }
}
function updateAliveCount() {
  const a = entities.filter(e => e.alive).length;
  document.getElementById('aliveCount').textContent = a;
}
function addKillFeed(actor, target, weapon, dist) {
  const div = document.createElement('div');
  div.className = 'kill';
  const weaponPart = weapon ? ` [${WEAPONS[weapon]?.name || weapon}]` : '';
  const distPart = dist != null ? ` ${dist}m` : '';
  div.textContent = weapon
    ? `${actor} →${weaponPart}${distPart}→ ${target}`
    : `${actor} ${target}`;
  document.getElementById('killfeed').appendChild(div);
  setTimeout(() => div.remove(), 5500);
}
function flashDamage() {
  const d = document.getElementById('damage');
  d.style.opacity = 1;
  setTimeout(() => d.style.opacity = 0, 250);
}
let _hitmarkerTimer = null;
function showHitmarker() {
  const h = document.getElementById('hitmarker');
  h.style.opacity = 1;
  if (_hitmarkerTimer) clearTimeout(_hitmarkerTimer);
  _hitmarkerTimer = setTimeout(() => { h.style.opacity = 0; }, 120);
}
function flashMuzzle() {
  if (muzzleFlash) {
    muzzleFlash.material.opacity = 1.0;
    muzzleFlash.visible = true;
  }
}

// ============================================================================
// INVENTORY PANEL
// ============================================================================
let inventoryOpen = false;
function toggleInventory() {
  if (gameOver) return;
  inventoryOpen ? closeInventory() : openInventory();
}
function openInventory() {
  inventoryOpen = true;
  document.getElementById('inventoryPanel').classList.add('open');
  document.getElementById('clickHint').style.display = 'none';
  document.exitPointerLock();
  renderInventory();
}
function closeInventory() {
  inventoryOpen = false;
  document.getElementById('inventoryPanel').classList.remove('open');
  if (!pointerLocked && !gameOver && !searchUIOpen) {
    _reacquiringLock = true;
    const p = renderer.domElement.requestPointerLock();
    if (p && p.then) p.then(() => { _reacquiringLock = false; }).catch(() => { _reacquiringLock = false; });
    else setTimeout(() => { _reacquiringLock = false; }, 300);
  }
}
document.getElementById('inventoryPanel').addEventListener('click', function(e){ if(e.target===this) closeInventory(); });

const SLOT_LABELS = { 1:'PRIMARY', 2:'SECONDARY', 3:'SIDEARM' };
const ATT_TYPES_ORDER = ['scope', 'muzzle', 'grip', 'mag'];
const ATT_TYPE_LABELS = { scope:'OPTIC', muzzle:'MUZZLE', grip:'GRIP', mag:'MAG' };

function renderInventory() {
  if (!player) return;
  // weapons column
  const wEl = document.getElementById('invWeapons');
  wEl.innerHTML = '';
  for (let s=1; s<=4; s++) {
    const wk = player.inventory[s];
    const div = document.createElement('div');
    div.className = 'inv-weapon' + (player.activeSlot === s ? ' equipped' : '');
    if (!wk) {
      div.innerHTML = `
        <div class="inv-weapon-head">
          <div class="inv-weapon-name"><span class="slot-key">${s}</span> <span style="color:#555">— EMPTY ${SLOT_LABELS[s]} —</span></div>
        </div>
        <div class="inv-empty">No weapon in this slot. Loot one to fill it.</div>
      `;
    } else {
      const w = WEAPONS[wk];
      const att = player.attachments[wk] || {};
      const cur = player.ammo[wk] ?? 0;
      const res = player.reserve[wk] ?? 0;
      let attHtml = '<div class="inv-attachments">';
      for (const t of ATT_TYPES_ORDER) {
        const aKey = att[t];
        if (aKey) {
          attHtml += `
            <div class="inv-att-slot filled" data-weapon="${wk}" data-att-type="${t}" title="Click to remove">
              <div class="att-type">${ATT_TYPE_LABELS[t]}</div>
              <div class="att-name">${ATTACHMENTS[aKey].name}</div>
            </div>`;
        } else {
          attHtml += `
            <div class="inv-att-slot">
              <div class="att-type">${ATT_TYPE_LABELS[t]}</div>
              <div class="att-name">— EMPTY —</div>
            </div>`;
        }
      }
      attHtml += '</div>';
      div.innerHTML = `
        <div class="inv-weapon-head">
          <div class="inv-weapon-name"><span class="slot-key">${s}</span> ${w.name}</div>
          <div class="inv-weapon-ammo"><b>${cur}</b> / ${res} · ${w.dmg} DMG · ${w.rpm} RPM</div>
        </div>
        ${attHtml}
      `;
    }
    wEl.appendChild(div);
  }
  // attachment click -> remove
  wEl.querySelectorAll('.inv-att-slot.filled').forEach(el => {
    el.addEventListener('click', () => {
      const wk = el.dataset.weapon;
      const t = el.dataset.attType;
      if (player.attachments[wk] && player.attachments[wk][t]) {
        const removedKey = player.attachments[wk][t];
        // drop the attachment near the player so they can re-pick
        createLootMesh(
          { type:'attachment', key:removedKey, name:ATTACHMENTS[removedKey].name },
          player.pos.x + (Math.random()-0.5)*1.5,
          player.pos.z + (Math.random()-0.5)*1.5
        );
        delete player.attachments[wk][t];
        if (wk === player.weapon) buildViewmodel();
        renderInventory();
      }
    });
  });

  // supplies column
  const sEl = document.getElementById('invSupplies');
  sEl.innerHTML = '';
  // ammo summary across all weapons
  const ammoLines = [];
  for (let s=1; s<=4; s++) {
    const wk = player.inventory[s];
    if (wk) {
      const cur = player.ammo[wk] ?? 0;
      const res = player.reserve[wk] ?? 0;
      ammoLines.push(`<div class="inv-supply"><div class="s-name">${WEAPONS[wk].name} AMMO</div><div class="s-count">${cur}+${res}</div></div>`);
    }
  }
  sEl.innerHTML += ammoLines.join('');
  // healing items grouped by type
  const heals = {};
  (player.healStash || []).forEach(k => { heals[k] = (heals[k]||0) + 1; });
  Object.keys(HEAL_ITEMS).forEach(k => {
    const count = heals[k] || 0;
    sEl.innerHTML += `<div class="inv-supply"><div class="s-name">${HEAL_ITEMS[k].name}</div><div class="s-count">x${count}</div></div>`;
  });

  // vitals
  const vEl = document.getElementById('invVitals');
  vEl.innerHTML = `
    <div class="inv-vital-row"><div class="v-label">HEALTH</div><div class="v-val hp">${Math.round(Math.max(0, player.hp))} / ${player.maxHp}</div></div>
    <div class="inv-vital-row"><div class="v-label">ARMOR</div><div class="v-val armor">${Math.round(player.armor || 0)} / 100</div></div>
    <div class="inv-vital-row"><div class="v-label">KILLS</div><div class="v-val">${killCount}</div></div>
  `;
}

// ============================================================================
// MINIMAP
// ============================================================================
const miniCtx = document.getElementById('minimap').getContext('2d');
function drawMinimap() {
  const W = 180;
  miniCtx.clearRect(0, 0, W, W);
  miniCtx.fillStyle = '#0a0c10';
  miniCtx.fillRect(0, 0, W, W);
  const scale = W / (MAP.size*2);
  // zone
  miniCtx.strokeStyle = '#00ddff';
  miniCtx.lineWidth = 1.5;
  miniCtx.beginPath();
  miniCtx.arc((zone.center.x+MAP.size)*scale, (zone.center.z+MAP.size)*scale, zone.radius*scale, 0, Math.PI*2);
  miniCtx.stroke();
  if (zone.shrinkTime > 0) {
    miniCtx.strokeStyle = '#ffffff';
    miniCtx.beginPath();
    miniCtx.arc((zone.nextCenter.x+MAP.size)*scale, (zone.nextCenter.z+MAP.size)*scale, zone.nextRadius*scale, 0, Math.PI*2);
    miniCtx.stroke();
  }
  // bots
  miniCtx.fillStyle = '#ff5028';
  for (const e of entities) {
    if (!e.alive || e.isPlayer) continue;
    miniCtx.fillRect((e.pos.x+MAP.size)*scale-1, (e.pos.z+MAP.size)*scale-1, 3, 3);
  }
  // player
  const px = (player.pos.x+MAP.size)*scale;
  const pz = (player.pos.z+MAP.size)*scale;
  miniCtx.fillStyle = '#ffffff';
  miniCtx.beginPath();
  miniCtx.arc(px, pz, 4, 0, Math.PI*2);
  miniCtx.fill();
  // facing
  miniCtx.strokeStyle = '#ffffff';
  miniCtx.beginPath();
  miniCtx.moveTo(px, pz);
  miniCtx.lineTo(px + Math.sin(player.yaw)*8, pz + Math.cos(player.yaw)*8);
  miniCtx.stroke();
}

// ============================================================================
// SOUND (procedural beeps so it works offline)
// ============================================================================
// ============================================================================
// AUDIO SYSTEM — real gun sounds from uploaded files
// ============================================================================
let audioCtx;
const DOBBLE_GOLP_B64 = 'AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAIB1dWlk8n2zBMZ3QNG45fb+d0/241RoaXMgaXMgYSB0ZXN0IGJveCwgcGxlYXNlIGlnbm9yZS4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACGZyZWUAA//zbWRhdCERRQAUUAFG//EKWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaXfsiFLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS8IRFFABRQAUb/8QpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpd+yIUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLwhEUUAFFABRv/xClpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWl37IhS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0vCEak6sWyENgm4Hoi5uskmUkYAa0wxMPwH/APPKxx0KWsNlW2TnCctWYCS3o6CZUGHhU9Hi/MxzsU3HY/j/uwT6wDPPrAAjkAEuwHVB0ZEgMQgQQg0RIi6lYy6il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AAH+AAACAwAAAfwAAAH9AAAB9AAAAgAAAAIFAAAB/wAAAg0AAAIQAAAB+AAAAfwAAAIFAAACAwAAAgQAAAH3AAACCwAAAf8AAAH+AAAB+AAAAgIAAAH+AAACAAAAAfoAAAIUAAACAwAAAgwAAAHvAAAB/QAAAj8AAAH1AAAB+QAAAfcAAAIGAAACHQAAAe8AAAH0AAACOgAAAj8AAAHiAAAB8AAAAiAAAAHfAAAB5gAAAegAAAH4AAAB/wAAAfQAAAIEAAAB6wAAAgQAAAH7AAACDgAAAgUAAAINAAAB5wAAAfUAAAIUAAAB/wAAAg0AAAH3AAAB7gAAAgwAAAH4AAACAQAAAf0AAAIVAAACBAAAAgIAAAH+AAAB5gAAAfUAAAIDAAACAAAAAg0AAAINAAAB8QAAAfsAAAIHAAAB6gAAAhsAAAIRAAACAgAAAfEAAAH9AAACDAAAAfcAAAH/AAAB9wAAAfYAAAIVAAAB/wAAAf0AAAH3AAACEAAAAe4AAAH8AAACGwAAAhEAAAH6AAACBwAAAgIAAAH4AAAB8wAAAgAAAAICAAAB7gAAAhgAAAHzAAAB5wAAAgAAAAH+AAAB/QAAAgsAAAIFAAACCgAAAhoAAAIRAAAB+gAAAfQAAAH2AAACEgAAAf0AAAHrAAAB+gAAAe8AAAH7AAAB/QAAAfMAAAI6AAAB9AAAAf4AAAIgAAAB8gAAAhMAAAHtAAAB+QAAAfgAAAHqAAAB+wAAAfcAAAH/AAAB9gAAAfsAAAIJAAACAQAAAgYAAAIcAAAB+wAAAhMAAAHtAAACLgAAAgsAAAH4AAAB+gAAAfAAAAIOAAAB7AAAAe0AAAIYAAAB8QAAAf8AAAIaAAAB+AAAAfIAAAHxAAAB/QAAAf8AAAH8AAAB/QAAAg8AAAH5AAAB+wAAAfwAAAH5AAAB+AAAAfYAAAINAAAB/gAAAgMAAAIEAAACLgAAAhEAAAHyAAAB8QAAAgsAAAH1AAAB+AAAAi8AAAH3AAAB9AAAAfYAAAIfAAAB7AAAAfsAAAH8AAAB/gAAAfUAAAH2AAACAQAAAfYAAAH4AAACEAAAAfgAAAH8AAACBAAAAgwAAAH5AAAB9gAAAfMAAAH3AAAB/gAAAg4AAAINAAACBQAAAf0AAAHzAAAB9wAAAgsAAAIaAAAB8gAAAggAAAH1AAAB/gAAAjYAAAHzAAAB+wAAAf8AAAHyAAACDAAAAe0AAAHzAAACBwAAAfkAAAH1AAACAQAAAhsAAAIUAAAB8gAAAfUAAAH/AAAB7AAAAf4AAAH2AAACFQAAAfYAAAH4AAACBgAAAhcAAAIEAAAB+QAAAgIAAAH5AAAB+gAAAi8AAAHrAAAB+AAAAfwAAAIKAAACAAAAAfcAAAHtAAAB/AAAAhEAAAH/AAAB8QAAAfoAAAH1AAACAwAAAgIAAAICAAAB/AAAAgYAAAH3AAACAAAAAfcAAAIBAAACTAAAAhQAAAHyAAAB6gAAAf8AAAIoAAAB8QAAAf4AAAH1AAAB9gAAAfMAAAIIAAACCQAAAfwAAAIQAAACEgAAAf8AAAH0AAAB6AAAAeoAAAIRAAAB/QAAAesAAAHvAAACAAAAAg8AAAH5AAACAAAAAh0AAAGmAAAAFHN0Y28AAAAAAAAAAQAAAKwAAAAac2dwZAEAAAByb2xsAAAAAgAAAAH//wAAABxzYmdwAAAAAHJvbGwAAAABAAAB/wAAAAEAAAD5dWR0YQAAAPFtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAMRpbHN0AAAALal0b28AAAAlZGF0YQAAAAEAAAAAaHR0cHM6Ly9jbGlwY2hhbXAuY29tAAAAj6ljbXQAAACHZGF0YQAAAAEAAAAAQ3JlYXRlIHZpZGVvcyB3aXRoIGh0dHBzOi8vY2xpcGNoYW1wLmNvbS9lbi92aWRlby1lZGl0b3IgLSBmcmVlIG9ubGluZSB2aWRlbyBlZGl0b3IsIHZpZGVvIGNvbXByZXNzb3IsIHZpZGVvIGNvbnZlcnRlci4=';
const AUDIO_DATA = {
  'ar_shot': 'data:audio/mp3;base64,//uQBAAAAnUORgUlIABU5XhQpIwADZVvkbkVABmsL2+3MHAAAGCYJhtuiAKBgEwTBMVisVoyMVhgUEiBBCEINg+D4Ph/qBMHwfB8HzhQEAQDInB8HwfBAEAxBMH+CFQIYPg++IHRGH/5d//WD/y5/u//SCAocujb2kCNHIgCgIAgGCQWHAwMDfRHd3dziAYGLd3dzvERC/6/EKgCFu56O/7hxZucQAEAh5cEAxgmfrygIOL1g+faoMQTB8Hwf+X/UGCjuCAIOp2Gw1GwGGw2Gw2Gw2AwMSuF8wIZpoaCuiE+0i5P5kLwWfhfoKnssKQG88m892mBLAvEWNx37EivPGImjEmF4w/noxmehEIMV2P/sr/sODcgJEFYalP/3/jozIiIfnkhGYVf////c0vj+Rj+Bg1+Px+Px+Px+Px+Bx+BxVn0bxESWWbGDYXbs1cOO+7+vMhgartEtwGfPhID8wm38wbkwfiYdU3zFeeN1EUXGL356NxcKCanqQ//9ZMgNFHhhP/3/jKjQeKuNDxox3///+YVJEDyZ41JnkUnjiYA//uSBAAAAvRG2848YABd6SwtwaAAjAkPYHzxgAl5Ia73jFAEAABfG/KKWqq7OZYGXFKp444z61rGx96kMj5pMimKptUcYppnc8uwp+pHS+P47nemyk1K9LWP6xSMznIRT+VvP5xzLPW980uwghGHRhYJP2PYJmKt5q6CymSHaz/9YbACSTiAckkckkbcjlckFEDwmsW0syjokf8XtK1yjd1qnGlV/G23/UpvVyz1Q+2mFZqqJnia1i//72a4iar7Klq2/979o+Z+6pjggQg8Oh5oVEId91k8LqwmNREJ7u1gAJEuCchcqllZW+Hq0eHm+M3+jQFTruDRXeSaGZ6ENa+QhK5/n9UoZ3Cxkf0rOO9hE5SxDrxD/7JP/TyM8m1fy5yRtQEib+OzXpxPRJXUVTOwtfoxBRacr9j/ciLqgu4gMU1tllm2tvBRqOTd+rd72974grqc52U50Joc55GJnsQjLSdTzlV3OVhryd1lU61IfOhI12SzoikYl3dU7zs7Lu9DNR1MEQCbOuHNIy5R4sQs2F6bFCqak2IWphgHWJiCmv/7kgQAAALlUFrRYxgYWOna8jzCTgxtZ2ujGGnpjidsaLMMIRByaSSbKcE71UVKRkIW8FqJbPaopwdnLCoTYkyH9CZWm/+lXKefxxIzDGrdY29jHIp/LGD5ZfVzyhw+TyU27sSFNpAONllmWalcoxEoZ1EnTcwIw21CNzFd3FFguADXg/29ZiI7yxd6hz/SZqJKr9PBusunyjcz4Nd7+tMqAnP9WJ7pqUhm7zeYxpWUzot12JVS7Mh0NfsWjLNIiMtAPfa7XKpWgnsUM8FQ6+Ma+zqpTe/UwqF2BE4imW445MPBUmuVvy5WVG/W2502Np2r693/l6jgaWY1JVfj7rspU8GRTI2kvDspCiQyyUalDkq35c7zjt/MrSiHnY2bVvRWOdM0ySCjmonOfwiPP71+jlq9H99EddDLFYsuhtAISTl1wdRJam+lsBykCLzhi1cB2axiOuflTEkMqTJFr/dyzXMyeaEnPVG62QERN+qQsz+rcI5tb7OGIk0n2FTNyMyMGGMkXaZQyiobcIGN5pBj/uWXel/6n/zKjLGUNYhhSYD/+5IEAACC2ExXmSYZMl4k6uMwwzpMNY9xoYh4IYEx7SgzDBUAlJO4d1tAJBMAkbuAhNjEiDgNYy3jcUo5za/kJsdyI3LQzy1WNF70iPho56FSlV8/Vc8tSutyy8vk33+SdvOXpmf+/TIopA0Jz8Gn99t1jZzRKthurYU3bY1EABSTmXltcLOLRcRWeYMTYqIQTI5SWXcMgSlA5w2y+CdHfLPsOZSrGmak5U54TaABxUHV8F7bF2M3/r+b3Nbp7C0eNl9J9biOdl1kjX9qfACyXSQkWFDW5EmL07maoRALklttlcbfEnXpjFBwGFI6QJeMipQS7O66UhbslIgWitmHc2Wtl3V9T+FxwR4ywYWTVP+IXNOVi+ExZZQ1f/Kedlln9BnlDJ5fLeeW/u+lzJw6HPI90imr1m00fIWYZthmf0kyiTQGF2BpqRQ1iaGmEfkQhGCXh66ZDnEuQLqUvMem1p5divCMj+x4eMsGFjNU/OQuGnKxfky5ZR1P8v3PiyzPwZ5Qy5Ty3nlX935ZScOh9yevIManWbI0fIWZlV/XTEFN//uSBAAIAsFj2dDBHXpZ6lupDCPzzC2TYmSYYMmSsq80MI/PABMQEkog0RMGJXOJc1vMH5Vfdf4t22tJBoU1KJgskxKiJmbuzYqkdXzs2Kgz6m2rEM2y28TAMn/kiLLMiop+f+Srzt64xEbc/yEvZNVOKReWm9MGkmuihYS11NVK84g9sbC5KEDozZnSI7HY8iyaVebDycGNi1SPacPMxzLktGsXls2LRmWoW5sTN5JtRMAyNOZ/IoKcPlkyQj4Z/kSnO3rjEqdY27PKIrXm/r9hgjXRWwAU1Jy4jQBQEaaxp5KoWtTUqfoHQnQydDKRUZrMr08/21RtZoaz9OeXVHj1Gpehm3XKfb+X//nYUYOey02Mr6OutI4ZZL5/JNlpiTFoeOTRTU0ogUxp9Yzyhxmm7EDcegLkGKNptJNIpSuVZQ62iRKqDHpkVPNA6E6GToZSKjNUyvT3/mFESlNDXp6beWDUcQzIjUgWLHKzO6/gZkowc9lc2Mv0Dr2kcMsl8+yRjVTEmLQyHI9R7SogUekWmcPhzkNzIGWelUxBTUUAAP/7kgQAAALjPVcZgytyWuerKiRlbkv5U20kGGD5hqptpICNhwSAglWQYcMWEMoHDy7L0igILaR0wqMoJ70ZczJc1zkPhsVUs+0odhMRT7u96M4YNUeVHZnYpP9tbaZbKzsNmV34y4ufgB7C5zLP+dYCry3fmJdFxPp/zt69t3bggBuMppKKTnhItB6EldJrNgegV6R5iUYpb0l3elmJzOd3MrS/tKfEYiru73oVwwarlR2Z2KT/b201srOUahhO/GXF2wADbhizLP/awFXzc3NF0Xp8P+7furc3fBF1qmpQcMkjLLPo4ko1MNNyQMxJIFWzG6z4l4OYLYWKBx6Ryjz4gwLWw0XeaGV7ucyYmslvl/mv/3+b2VG9G+S9RrEYzlZunFOxvjF6tECBySONrxqupyWhfqu/KFZf2FGVqWlBwfaBct0OKM1srmhAYyQ4ArYgndnxrH5sYqmdI5R5PQYEhXdF3mTjA+7nNITFGt8sj6v/5fN1lRj0b+XqNYTGcrTpxXWNpBX6syBA5IzjLaCmIk4JoXQJZyyhWX/iYgpqKAD/+5IEAAAC6F3Y0GEXll5q2yoZIwNLdWdYZJhjWXivbBiDDA8AYBCUkknQRgQQCcNoTrUpcNjtOS78Jc16pbdzDEjoRIDKLwfNn6mcrE2Up0JqDmIHo0dlT5EG6Uo1P0+2UqrUUnOspn1u4WV0eWsUdUlIOUxSGHLdP1ETmBj16AQEkjUU20ZzhAmMvTKQqTpjNDbtNpd+QLdTciNi8wXDyIqUXMfM/oTrVialF36VTctk5ruVzmTacil5FzG//+f+XqtvRWplehWPlzMKytD/pCnnEksECSq7rNJ/GuvbQAJKSiROKQuYkFuRWDXcoc02EsiycqeyIYL0+ZFrl2qc3cvRYaZfqj9s0zC3hpf1Msw1bM9S1pJy2UiU8/+rbFzLz/LSkZyfPyLM1zy/NratDN/2kI3HUxk+9I4J4CAGgWRDgwU1BozuSFQcJSZZOEnsiGCiJ6ZFrkVq83cjsWOn7VUfrzSGFpw0/6ZZhq2PkRdpFy2eQD5lPt7FPXg/6aVX+Nz/Ld1zy/HN1gXDYPrVlDRFWKb597XhJiCmooGABIQA//uSBAAAAvRb19EjEuZbS3rjPCNuzC1PVmekYtmELmuclIwTACBQkkpp2NEIGCMsxO2iNO6v1FHKG87niOVKoeO5kM0rXd9EO++1vHmeznbKzFWeZFOlnIdimIoVjiqsgc6sqzX++nejo++rJemqaKfnZLYJ51kY4SvWpddjUluvVwABKSdUsicJI2vqR9x8+t4o41aJmCdwGUjCMjul7byIYzE9Vzg+x5G5LqhLd9mtmRk5eVpU/5TpdgrP/z9J58ND8y1KfzLnhK/1ymW4Lj+hOEqYNZuHsaGSNv3oAAkpxlNYpjnAYMBDV1mnqMsgpFx6UbSFSMk7SedQ0Y/uIkRPh7WXilUdjzrUxKM/puXKX5KTG3et5ylzmXJnfyyfPrEa2nRZUnMM2eolbQIVRhMvvkRf9wWtN61/p7XaboMSSUk3VROBQGxEQINrDmqjcaFj0s+TyHJJaTzqGCBDn3EcRPzzsvFKo7Nj0M5jIwv/cilI/JSY21KzzlLhSiJEzv5avnrCNbffvnPPVS6zUih+8hEfl+oltN6x96Zq/q6mAP/7kgQAAALzZddRIRv2XmubnQwjxcvdT1BnmGXRb6tsqDGKfwCAVBBKbmVCoZPoaaxr1e+eZT2AMxFc6mQDUjilPSkwOZFmIc27B9EUOE5Z52y9NGKA6x/If9P8z14X5F/fLK6GV/LBmVzOKpyL2nuKoyNUriUota8XGpBLxNxPM0BAqSqSNNNNObVXuKFCrAE8xlj0jBKbtM+xJYlLlrSnpSYHMisInNiEICukQmHCMs86svdG+0/5/+fwWevC5SX+9LK1GW/RMDmtzPqjyCTOnmdUjvapUWysazhf51deiAABKUoUoTrSxsB2p4Oiqk4w/ouUJl5qC0rYy1F3NEha+JqwxDXVfRmSnDtPfnOZUlg7NDz8lpmzNmZb5Q4uZ5saaQ2i36RnSJX2yK/z/8unIYo6AoZAEbHPCB0zUKxwKs1FFEkmwQJzQFHJkY1aU1uFJa0o9M+UwepIyZZLahjNSChT0ZpR4YOvucOaZUlhzzz8ipuzNXNIB5SRSY9zOSS9C9b+U99v/tulzP2AnyAFceBCxAUq/lsuOzTEFNRQAAD/+5IEAAAC9GVVuMkYJlzrK1oIIxPMHV1lQwxT+XiwKpzDDFoKBBJSbpw4QLoWHY1pIKtInYnqrt1yVLFkmdn4aFmWShyhm0DfN5nO9znaVyIstU0bn1ad8j+kefkZH/pN7VOKujFnT+Hl/mZfxWHL5SdRIEwdc/rORTmWeWeFUEuZ1B+rkkk0nYEGVVZnVDtLds3qr9MlQopRN3hfIuZZVyzORvm7dh3uO0riLBBFS1IgTFJqoW3JabOjbdLL+/53+KvGK9P2bLT2cjsihhy50nVWYGpDs81HNb18Ul7ooXNXFNJJOwMOasRL2Nq2hKGqp29qb5NOkbBQ0aQvUTErIq6XKky08UlC1u6nQSI1S7XYrnryjEWbhp+b7nRzZa1Lex97bJZjnUzud1NJLkXDGvbZhSdX+dgmpqU0L0Pv3wAQJJScpUFg0IACUq9hZTogEkZiN2lvbG8uBWzjImRQiOKTy8fMqectuX07PaosDXMl2i/ST22z/PrU8r5VfhOVyK6zIt6xmbc0+8vhoTF+RNTpsk7clWcBliyQDm1JiCmg//uSBAAAAso511GBGxxZBSs6GCNJjBknSGwYa8GKpSrc8wx/EVkUEkElQah9hLcdfc2sXVZd2ydChWjaSZKZfq/kWYPHpkRcf8YitLll9ePBzp5U5t6I5jG7KT/1F2wglSoALJHRyLq3WBURhJgisJhYCD2OaPWtAq9mynsHuuopJJJ0CRNTA8cw/ApGFmxE0suo/EfUyfq2usI7R6eXI88YlqqhKCpGps4YcCvGqVOB9ImMA4aBwk8ItkHC5VIq5GLxhZrxRTBywOWDNBWZbLE8krfSq4AAp35EIHXLkMyZREI3IZutWlJSIwK4G+IkDrY8vXCFua9rQBexHOqi2OTySGrylnTnN6ywHGSoxnujLObbH85vFKVUz0/UjQpXV0PU0zW+PmNmZwSDBnD4I2BqcHFv/+kE4AIIKh7EedDYKH2g9Mb5iqLTMNg7aTtMImim6BchJER2Q9UxypQ7w5nmuFkmkN+hB1lONWPwRyPFKVU/T9VyKbk8YlNPt4eZZm3XB8NTdWJqDfjdaKY0uraTY3aZ9k+ffOpiCmooGABIQP/7kgQAAALYU1fRAxZcXklad2EjFIu1I0ZsGGXBhiattGGNfgWmuKSSTgwEA3Ixikc17t4RlPVGkOzUponmbbQSSxFNNwST2Zo2CFCtXUkPUVXYCZiZOoK2KJlUWdmReZGZoaZTmiEWMHsMkdapGqmpA9s2fh03CypYyOFaJSsAQJJTkj7ITCsr7gsFpFMVOCh7EC0LGVCNZFmbCjRCaZ3xKVc9GwQoc1qkhkrV4ze08hTsJhQtLNW1Jty2ghpdJD0S4QO5C1Srcnpdj4Is2OkHwuNQoq46/XYvrdr6wAC3vlmC0QdBl7mxg4mPsVSbpQPLY3K0ypLtUmggXIGv4kXU6F2gU1Us2pkJL0NtcLItMlMEbCDRadMmflNNj6eunzOZkRsHDVgLx8jzNj/NYGU82TCY2HBxEgq3KAJSNptNtty6DSCaDvBg/TngjHX5Gkt97E/YZ0QhZSEFKRTUipueRZ5DxwZK2RmXsZ+hU8ya/vMoTxPT49maoOgsemCSnCI9zhedwQRD2TGo9xlw4UrgCSCCAyiWAgknE01JiCmooAD/+5IEAAAC50rRUwkY8F0ri40MI/HL4TdMx5hx+YCna2iDDD8AAgAAEnfUQiq9MFuYAThEUiI0WJ0i7CprOhdBpxHAJUR3pXcHmHVz/KrfwTEatp4KqEaWFKgzxuKe0KeRTu6dqZVZ5Fp4aWmxYOeUhy+V503IEWKgqEHlRCWeO9YLUqUdbkkkvlqogRY6NUzPeEDLYhLU5I1nlaRvjtkXVpWsxa8jZMoSNYD6w1iWNNLpehhBe6MhqmamwS8h9673NPOKZ/nsb2bNPTQ8u2T56OCT5bMxsXJbUe3TpmQTwCIwhw3Xbk5voTjWlo+sQ4m7XhwcD5rX13mUCDmtOwV4bJzfeR99oEEmiDPUGy9yhjV4h68I0etj8UPm08hDZr2ZVmCIXeFCcVYj0jCuvmrNwrr/7bkwKRDrJjpJMwAqpJSKJcODJNOhRI4J8ssxA1GT7EoxIF5qrEprygFOT1FuOXvnjH8EGaES6ltC0OaLXN/EmvkhHCvxFVkRe9yPvZ+Wv36bTlyyg2K1oKYOYFV32GZjZstrX/Lnd2y92CYgpqKA//uSBAAAAulP0RnmGfBcqMqHMSMEzBUzW7RhgDGCKWwqjDAGABSd+EcGUI3arep28SXYo10DSIKmlTpIXpmO2GlHJXQYzI6N+9T6tW15n/8CxmGp1iJnHMlSB9ikrCvX4cPqLD7PniOKHtMz/e/gv8oGpYcOQBdSxDhjtI0elCv1gCAKSclOASDrx/Yidg+0dVLYzrCObWStG/O+peT3IjKqa7GzuVh7Gyn7rw3MlQ38pOCii/RyPcgevn8NS07qbROmrtsMZ3HUTIHfhR5/9Y1Floa2DpTG+u90+/vwEJpRJpJpJuWUkmzkqOtarJ0KG5RDJgiNxwWojNEy6LEk+8jEXsUdnRS3rmFeuxG88mcRV3530c6cHUjVojUoW0HpnRAog1iqyHU7MGTzQiZcrVg4AURSxgViUUb+iRZ9DErVJNppylkEDPYM8r3NuqVDgmKoZG2yCH2piTBnp8MMyIZhHWkqGry0yNjMgRz0mIVZSjX1czzM5/CuR8OCjOddAVbWExznvu1yIEDWuZIKExWTM9ATAJNSYoIc0jo6EJiCmv/7kgQAAALuRFTuLKAAXsi6aseUAAp8kqAckoABR5DVR5KQAAAAAAgMQiIREMxoPQKBSIwHQc+ZnS1vrug29w+XhEPD3Q3IPHKpnXxxxYVWrKX5zC7iaoWan4upCIQc6GU0v9hQrFMq5WKVKG/4vZxJiEUUh0OiyCv/8QgJQ4KsOnQAAMINIhGMxoNgKBPClL6hP6Xexa/tzNqF+HAcrYgDjzFLwxgUhcvngYOjZWUv1Dw8eFjUK2b9yXQSDroZal/h0UKw4YdtUKVKG/51nEmIyilBIdWNO//qOniIiFipVUhCoIillYLAkyRAkGiZ6opFI8RAEOshn+VqG//KUsweYxjGyl6GNKKuCoa+WPA0sNCJR7qBp4KjzqSp0FQ0oGix4SqPA0//ER4FQKCt+Cp0GgEDTgKhUEQyhySJrK6pChgFgScRBom2MY/+lkTVoSXSElZpFqqHVUKGPlKWSl4xxZFiyKRVx4RHoK9Z0S5WCp0seYs6DRYGn/Et3///4lWd6wVg0pMQU1FAwAJCAAEAAAAAAAAAAAAAAAAAAAAAAAA=',
  'ar_reload': 'data:audio/ogg;base64,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',
  'pistol_shot': 'data:audio/mp3;base64,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',
  'shotgun_shot': 'data:audio/mp3;base64,//vQBAAABYdKPg1h4AK8TrfBp8gAGo2XWbmMAAM2s2q3HvAAcBFdTeB30UwRUSIaZH0vC2BgEYhAICPkHNLVODkByCGC4EILgdCgibhsZzlvJ2Ts01GoFAyRP/il/R5TUN+zqxWKx48iU16U8N+xq9Xx6QHjArHjx5Efv379+/fv70pSlKUgPFer2d+/fv37948ePHjx48eP379/e973pSlKUpSl73u/fv37948ePAByMPDw8/wAAAAMPDw8PAAAAAAMfwAAD4AAZ/gAAAB4/gjAR8cewAC2AtgLYKsf66G4GoHAXND0POc0yDiTgXwAGB5QHDADAGJBcBOEwLMEFAtHC0cLnw+cUGM2T5uXy4RQnC4aIIIIJpl8vl8vl9N19aab000zMvk2Rcvm9RgXC4aIIIJppppl8vl9NlIIIai4Rci5fL5fL5fL5fLhcNEG6BfL6aaaaf6kEEGrTL5fL5fTTLiCCCCCCHTTTfZNNPQQQatNNN60y4aINpppoN/TT//oIIG6adSCCCCb0EK00y52ORwPR6Px+P3+xyOxpfqOI+7pBxOZdfxU8I5yx86yzmbB2AONJPt6gQzlBx5hxXWw3/FfrDt/bYvEXodTP/z0/bL7QQhOdkb50TTXE5//n610UH9YPA+38Ygj67ypmo/n/9/4uuuj6ppJp9+lx0k2lA9buf/////ylc7bu5ILauIzF8aWVS2hkFWJ1v///////dyWU77v3jv2uO5F3/V38dl1qHKGKTP/////////85nK7bXIpz5XL6e3zPObnoEjdtwZfUisSlMNWJYd////9XHhUVqFIoFYsFotFotFoFIrWjkC8J+rgCBwVkNdNl2SZ6zj9IREgHg7MsmESlGEATgBtIDlh6+uBbLAc74Z44S6F4j41voxVKgdAcZCUGizxGJ7799i1g3EYqxcEITioMl61KX3373844zTOMcBOEIXSCaNo1VuP3/n/8/yDl7HAwo9vOdHtafcoKNaojg3f////8y2pUK9XxywRedDJsvajf0lZVRBZHX///////mQhrfqxkrSV/Dj+nXKTRlGxUxW56ulauodIP////8+A64MpiCmooGABIQAAgAAAAAAAP/70gQAAAXGaNjvPYAIxY0K3ewwABjhm1dHsTeDPDQqXPexuAaSCUUQSECqpBMFybpmqt0xP2KC3K9OzK2ZiFqG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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  'shotgun_reload': 'data:audio/ogg;base64,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',
  'smg_shot': 'data:audio/mp3;base64,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',
  'ar_suppressed': 'data:audio/mp3;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'smg_suppressed': 'data:audio/mp3;base64,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',
  'sr_shot': 'data:audio/mp3;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+9AEAA/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARMQU1FAwAJCAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'bat_swoosh': 'data:audio/mp3;base64,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',
  'bat_swoosh_2': 'data:audio/mp3;base64,SUQzAwAAAAAAUFRFTkMAAAAVIAAAU291bmQgR3JpbmRlciA0LjAuNABBUElDAAAABCAAAAAAAFRDT1AAAAAZIAAAQ29weXJpZ2h0IEFsYW4gTWNLaW5uZXkA//uUaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAARAAAfCAAJCQkJCSoqKioqKkpKSkpKSl5eXl5eXmtra2tra3t7e3t7e4uLi4uLi5iYmJiYmKmpqamptra2tra2xsbGxsbG1tbW1tbW4+Pj4+Pj8PDw8PDw+Pj4+Pj4/Pz8/Pz8//////8AAABOTEFNRTMuMTAwA7oAAAAAAAAAAPQgJAOpjQAB4AAAHwhSo3I3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//t0aAAAAWoAxnghEAAOQCiACGMACoiJL4UkyIEZC2U9g5g4FWqHVBBE7ZIy0lKhO5qVn1JueQLkHyHP38+z0/+36CWp3yCfJ6/+ERzVW8nlBwB3//////////90gc6NuLvmAP8qgopP9ZzSsBBQShuMBye+02aIgwEQPTQ/7EEHshBBB993l8whnj9sYgcTBBJNBTJh+EQ/D8ELsQYY+UrQK1qMSIgWPwILOSGG2HJeob5RFVodYEEMRRJIDL5Ea1tfoNAcA7et74LXsp+CGHpkAAEFrISTYcCEIGBO/9CneT/6wc+4vDMeqxcIAMoXzBcPmb9Gh6v/l0iphnIjGSSNIFnaMhnk589JpaguRDE5ZBn6rGdqoKWUSV7W3Qjc//vkaBMAB0ZjS3tZZHKy6ZmfaYbWIi1vOe9o08qZn+g9zCW4hV23qmgAMdFTtAfFq68FCC2ZgHUI0oNKF7DPnPPcFtmtkejSKaloBPTWMsNrRecsmytRxUrL2lrof1iag6Ad6XeaYtsHCOAipGHPZQsR+Vb0HFhGcRlorX7rW1h2oP5RYxR0GGOzIrN+qu928LEdk7gILVRwowSDhauOIVwoEgsGZ8VVTKlM4vpRlt52xncsdmVpRZNVkV21dusvj5+G0zuLIIaXYd6BxbHRtfvrIZ3nNrnP3yaV19syfbJYlqed/lABbuamlJF/+rrIDqcEDL06KkCFi8Lf1XbXRdgJknwveda3TzcBR++/bW27OOrYXQXyFBgEBln1b1HDAjzSnSg2Z5sbAgYMS6DY0PAMXUCRfMSFcNojyuWHZjCOYfj8VTccwTAYVKjmH6RY4nOX40q8lpz8/dXv+4sWb92yWTzOx4tM6yWTONaf+cY6hVJ/Ks2zMUYpjPQEEFpSmfEEJeM5+/vd3tIAMQCxiTt3UqABxTv230D3d2UBCLuriAESaYZxZtZ0EeGHW0usYQRlZltk9mYWReYdQ0xirgwmEcDUYfIkZgngRmBeEKYQIMsNsTfoOAHYKW/dVP9RIMABibXkzgcDAoUFBgYpMuLBDkI3pSmWrGaNgk6e8UdI0coQAAAKmnRiB180OM6794Dh/T7xRkwZoiYsSAVZp0JrQa6HWTlMKNNCnBR8tmWXMWBc51VNluvDH4arxZWCUtngJCiShARBO2zEI6qgnQjPStRYM5KhiXETdd956D4Ah9/IYch2W/hxicjjcDv5GYkMY+uieTJEH4wvgjIkEJA9g3Egg1CycYHQknGlOtB9jrl7e77ZbRHeLXv80ve0AwMj7qq4Z4U6ets6qaqiEFv9jRATyjJoVimgNQeIbBhQZhAbMDglQ5aRg4COuAAgHDQwGC5fG8p/CtYwsWYGXY8TlNaSIZy0sRDA54fEagQkiMLOJknIS+EcSebDDDczlCghXp/bcSXbmn6GHQBtwkrtrrVXWe47AGyNseJDKUJzmVE9Qtk+wQLvKMwYSccxcn8jSC66CLVE7fx6OTvcv/5QtgEwIUIrfC0HxZV1TsV9Cmrvl4MAAFUFFgKjADBDMO8zEx62VjP+o1NncY8x3CijNrDHMG4EIwZgHEUBwEwwDAPTA/AiMEkCVDZFEDAJMTbZtl5x9a8YnW3UWfNrENMzXUlWoqmGWZae44OOn2tAvAsUAlNAQCI1SEBViF3x//vkSDcAB6RWUPPYZHLbKqoOewmOG3FNSo1hM8N6r+jxrDH4oaKRsEOAVIy1AQGQHDo9S18y+CejcGiL0lqEtU8UYGzukzZ+7SQkcYK8ky97hzkGzcsfSBG4Oo0Biac2ZLbiYvnweOESAjl8vGBSQCwsZTljGFB++fF0wfoy98S8lvJiyWyWsL50tYZ5QsWPrFjj56+5DZE7kUJ/+x7+P5bSb3MW3WOd5lemvvyaIAAJlBFgVCoAWYFg15oNMgGCywGZ5YHRkoDfGQ+DaYHwJhg+AyIOhcE4CA/mASD4EAxuMuVQZib9QM2OMtvhDLT1lSeGGFWIeVXaSw9ACuu6jm0OKF3F+pbgYJKgyGL4q5QRhg2ZKWIYMkjLYFINzjCc6RacDDJhWRJCMoB1TuIyNrc5EGjwExB0HdkFmjp6KhxlEYsRCdnLdNRkgc+hxYlmJyVQgGDJ7LX8Zwjr55CDn3UurnhO33PZv3Iw9+N57byG3KCrTeKNnA8IAXYSHliblML8v+lMAaBIAQllQUPERsaNwDopTWpzPkC8AknLcRlcbDnHXMpjWhb9OE3sBRmLesZicHMoXAhJXOmm+Csa/IguZcKI4Jedbovm0I10mUrwoiWfdcMEjKQgL+EQXZCkgxLD0y0g0qnif930H2fwyxdKh+XcoICa6ut85K8jW4/IImueJODDVyOwmMvNQNmiCwjsxBu8jeumuTEOXYhJoCoIpGLcvAsByQWFYbKgn7JCoAyMLjzwkjaNJmOsJCVUsTpKU8gQQhi6UOlCae3JYwQFBNDB/QXe5b6pRS1ovxUPwBkoAAAACDogUIFBQ3gU4gE4Jc1K8zIhchELBABqCn2jLHbI0mDJFD0BPlKozKplYZicOLQasXtYmsO4jQ2oRxO5bqP5jib2kpzWMOSpJaheks2+6Xyb6yEJBbxJAwOlLcRUaXbDqBHNQdJOQNZe9dkrvRBlDiw3BUonx/LCUQyYNK7C/ElKyw9EAAmg0AHPzsuSmPKoh7LxUdZjOy2ZsVj9tfRiFDLa+2vZduG6xhst/CribhfonX7uUjp14HOMFmKV52rLkMCxilIthX/dfLxgspZ+MG1HHBkubvuTtoMIIyAAAAAbMXCTCSEwsoMeDzOIo6ZKNRbjk4IIEgMFKKggBY6j266dNVWBn8DxqDWmu06cNtCiztytpzA3ecMSEWgyQuHAiUKFiSyJ6OkSelXymQNA0u0t20fR31GkBJQKw1HEfY2sMqg7gCkWAh5ECMGwnmhEBq5R6UIQJ8m8//u0aEAAB5BgVPNvZzKjq8qLZeluET13be3kwci9Aq09lKQILavErbX5wsKiX2w/DsSqnPxPrlkLAS5SMrsxEsSvSjXS2k1W1R3B4r+5LlkdFOzKCdwfMUNSWun0OhLpiH1yMJ2y9pIOS8Q3y5ZScwdHG0lK6EudOC4eH7xeMTdSjcaX3UXjhs/GwU2VD0dT6/e6iq/9YN9IIAAiS6F8oUHMZI4jAckX2KIwiZ/VS4auuMrJLPtrmhS7j7vTw3KVG0jLudKshPmdCl6IhzMoUcwxmeK3hwrCTQ1KF+QpiVw8URqkBFbliE6zK2WyVIrK4wehRV2S6xKKUzISWKIzDRDSaS7NynleqV049Hm0staJKKRp7VnibIJPXQY0ZvkPYarU02L286aUdXYVlfjGMr2pZG3SfTWuj0/pRMurojJBScwHuhIeMlA2JiSAwmznTQPRLEYZMCxFWvTOmVQLFoiwxyBvRDquTABAOMOCdUaBJuqgWDDwQkiElmHLIz8+S2ESgPmTVz8xcqyYZSUPGZVTiqaHddU/3LTem1nVtZSnuYkx5T+tldzNMMhl/LtvieU2/G/+/o7Wds+blTun795npZuAh2Q0RUQCU3ApIupEEzgyPituIWe8a1qGKevvJD897dv/+6136LIv3Ki+vf/RpsskqqhmVMpoJ4FEL0ogCGDWgYRIKcFlM9UJh9hzaK2SxxGUTb1xMODJpguh1LUc5rdVcsQBuK0F2MzU0MH7GNIkTKJap8xJnWmGJELn//uUaCaABAVbXfsJHGg2IisfZeIIDrDZa+0wbMkggqw9lKQIXsxRkbUlQSVPUqxLeE5UvjzuwoLFcjzIkjwj7KmVVMk6Z5Q+yERdp5GG9SthkpoC2niUnDAFOIoQwAAkmFLj6qlqRC1PsBqRqNb9VqMAHv26EIFHIoTzrDww7u/+ralK79P9d/fd/6/Vu2RdmZDI0CCUnTwHTDEn6MWCamn+DAwjAqyOwzdNXCXsieDp4moTp8hGTJOZRrs5QUYZscCIx21jgAWAI2DB1pqRDGLI3MgOYeKDsleA1eL8INOBfAjLMYz9W7dtAY1/vO/yvSRwXhBg92t7sMqVZe8IsK/Bt2iAEEyAAIAIKUD3WlasCwSnQ2YCAVPNfvZQGz5o0EWrRBxDywQxOxL8v6k10quixq1MmKmqawcaWMqQCZMYB10hRbrwMzykvXXpCGZ2MiRJSUmPolONh48xRAY0WvVI6QiDakzOkZWwoAIOEyYEotQzUaHZFUWpLPgrbKEz//ukaBoAA9lWWnspG3JiCosvYYM4T+jdYeywzQlwK209gI39OU6bZ6sVnTycE0pssWj2XCABB4ww5tHPeE6MpQcgpimzmTKQPkprkfgngj2dDP5M8zk6a5wya5UF8//P4dZsSCO+e0ms3u3sHDSaOaMoKKTAJLJJUvlqjoKXuKlHIkN2yndZWDNaD4pNKtWKfOX9Tcg32KeReR0v/3L//t489bSpqUP7qR6F/5fkaV6bXThYDshEswTkjb9CY6Sz8uzn4AAHle83ljH9bXUkw8KRCCiEU6ZTBnbmUSaZojCV0WbTpXiWZSpWipahckaeA1EdsakZ4Th7WRKVxyoLVcyPhQSFmwTYUQosiEE7SO3bH3bmmANFU01ly8qauncFgmaa6bftWQdr5n+ZvdL8vQbZblGkgLgI9F69Zrvdpi7MXxKQ3ylVfnvmCrSdLRUvJmQCSaKoDuv6mfZ9GBLruRJ33vqY1tVbcpE/Yq58oV9EaMyGmRteyKrE7Prhn+p27lIboeUaSraRs+1P8/z8vNvP3MYyXpsdzIpXyLX7yL+cFKxd5BV/fUp3FYhCMAIIASceZSpGMmIhiDrDbHuFlpBpDJrO+8KwpXbA4JRTJrqiFpPmrfVNt6044ZJNO0Zp//ukaBuABDhMVvsMM2JSYZr/ZeYID40rX+wYdUkQBir9nBgQVKvWJEaMsx3XNDDwWIMAXNL2XII6S4QjzZxqp0Mbcye/6ZhMwanLbpBLE6NrkrfpVS3m4r7ezso5T7nvu8TlTsqECIqYgfPKY73FLbzM45SYZotkRSIARSdJw4tDWwJ4lZ0HqyoaPgFiCJAy2qizAkLPRDobTVpAbDWOPHQ05Uc5jEryNdmXcTKn0KLoDMwo3Ir9hGRgJaUhsV63JA7tDZt1l4iwzoZGSAUlcPTeJDmp90iRY92Am4rAlumdLXycdxIAopdInQlU9XqyCZl3afyh0SkEgcETVpRpk9ZqM76aa7qRRKm5IxP58+vy6HMk/hKvted0wR1NFLbN3mqmsyNI7yJ5LwpWlcCdHgoIKZag+/QdmBKNqO47gbsz/AX03M1ESAAAkAwpTkqeBk29aHEXxDVFHdVgtTr9pRTCKngRJUqaOHQ2HxoAsJsU8yE819PWc0c7+jNK5HN9v8wrRTqLLrdJeUZ0EoAkp0p1ZGSjwkACE4v0WsWINEJmMQXBP7Xi/6yYaf1uE5G4DnWLuhUUIsOIBCqZGzkUIumT5nhQEd1ubU4T8o/GPPLRm5E7GDzZyaBfaZ0skZXv//uUaCyAA7dG1nsGHNJLwYqOZeYMD1EvVeykcQEpiOq9nBgo6lMvvZ8p8ZOr5X4Oqpor4VhNblbFVnWfVZWXV/X27ArJLoQAACwS9DLUblkyC1LAcRcGKEfgsZOUepSbueNKpM7I11jXlRK84keVHGw4dT0pX5VAk2dNxxizjjp2GrGD2oKuYEaL1mNQvrmbqqGYkEElyCfc6IyUIUGxQJC7SeiSCm73uq1pSy/DDrRa009cIBoiRpnlmmHkhxqCGJHjVCKbkKiiWHGmmyCTAAEOagIcYEFF0Qp1kt6aLoinqqkrHdTIqZUn6Rr0Y4UGzzOrk+0UisOlg/IhNdECS41oGYXH2Wt1ZBlmQxkcACJUp0oMsfQinD8Z70AEU0S/gF5nxcQnAfW2Y3vsZsQxiR0zVnkb0WpJBVUt6Ov7/63aEcXGhQAl1B1Vh5yGvL0u1yqa1iW1c0IiQAGXR46Cxe0vc/oQFEZDNChE5m602WJfRqtAbzxmMv2ROswD0Yg2//ukaBaAA7hVVHsGHEJFQoqfYYIqD2VRT+wYcYkpJel1kwh4KQmHXRouCcRiS5SLnYjhaM4xUiFzUmOig0PzhbdVSN/UvSpjCwAzBhkDul+Qq+v9uXlf5ms2OpenDWd/Gyk+GYgxNWCF0C/Qh4+dZXk2ZTaJDTcG0WUJJXtrLFSjA4W1wR2+8vo0Zy2IRrrleoOmOojDIuVxhAkOeEn/rhVRDH969fxmxYybFkrTnV1qd0ItViGdEMiAS25VCWPM8T7XGahmciEpAO1tRyfUBVM3d1ZNeljxS4yCJ+EKBVIpYTPPKRHNBiQ4CudRLl3+kzE3rYvirdqw7w1qm8mIxguRTREDhwQZ5SxwxHPhbVeMxEdxS8WLvwuczh/1zmsuEp8LOmgoadbzdHWXzVT/AONOsgANJwr0m4Cj7VTQp5NUbETLMBDyItS1tUTprZTIW+bWt9+v9E8x0Z1ci2YlJ3TmLTp+/fYv2LYtWRKPpqsdEJ02PvVUv10pSGhkUhKIJLd70GiTEbInyCsJJyhQ1hqaDY5W+NK0rN+Zc9hizi40s1YiaLQDwIxO6MCukfBV7ItOXKgtNepZpcbB8IurMhYUZbnNiWmdlvw9j7amfC6oVFbjUOV1ZyN3mZufmvsx//uUaDOAA7hVUvsGHGJHQXo/YeMWEbF3Sewk0QmBqCk9kKJ5+XPPMj8xXhzwa4vqo7sf2lxEmCETAAAEJQfzSq3A862xNLkwDFa2DOqyVSYGGaakhwvNxVBpw0nW+j+A1qcF0+lHfMzyCSFYgC9SUNelGTFLQKDdy766ppXe4ViUpAtuUm+ouABEFXABEii40IQBclCaj25S63UcF+XquUjNXQeXBYBxKOEUk0L4ojy2tJvIkUIGqkoLoVZfDSiXg3FpJsbHo5RmS3OzUD6EyzGYuTcnofZNUci6WEueSWU2ZReO8X5lslmXh5PJKVlp32r1tl7LbHYiVvvvp2oQ0deXHz3sfXUIziYuZmUYyyCkrA1GHn4dssAgYRWMdEljoOVagGftO9SRnt3PHC3GZuHisu2QySYQ0SP65Mny6y7X+R5tmQJO8AU4qbZp++te9enSdjigW2sIPpqleHj0Fix2qdtBZ3Lb/qp1EoZCIhAABhtJzUVi7zbjoiETXgKK//ukaAsABE9Xz3MsM3BQ4PovPY8yDt1RQ+ywa0mDKmf9lIlQpNN5lTApFGI1ALisrO4vYfaNn33nlHLbXO1BkxC3FKHDRsrQ8sOl7LqSKslUxhqgXBrouUeS2juz6Sd+SU1vWuVS/zHeNsxJ55s3qXz22flv6b5m53RrZI4aFXDzCGfHk2oicnnazttHJHpOXJ2Zi6yS29E0kwsIBEkAmTKAsrRNBAmsnQmxduBk8uJMzp8MhuLqryqDZJ7pY05rW9jULZUkCkqjIJBm76Xvu03oSJRYu4FSZ0VArQm6LMuUSMoJoai0OEptoenhENEFJJwHjMIddLpCeX5VMOAoixYt6x4L1wDDknA8fkB45MXi9Zb8CH2cesSHAQe+uJLhsDVmIzIE1BQ8+A4SOxKQ/kqtkYYBHJQR2WZn6n1fBp3Tq/njS3DZL7jw1xJJZyUvZVgo+Gt5g80vVUP5Y+Ox7Nxd5EOiBhmImDda7mQMHR5RuDEkKAKJG0g1LQsoBk8DwVQnDcg5nZjE7JUEFENBm/Zlo7qVjkPK3VffKrMMxIcrIjTtvZEzavo7nVP7u9/mLZp9rf++3pdwZlDlCl88ZRVbi6pVQyaVB11Sg04DlCiRQRmRdT7MAXiR1azDr/SF//ukaA+AA/dXznMJG/BQqtn/YGJqUgFzK8wkz8EGhWc9hiQQpMMA8IecFJUWWyS8fiKa62MEaeEj0RC35IlckOokNwirGMJl2F5QlMhYjc1Hr67wmTQEKR/pGTecrIk/ILlQc7Jz6X28+0U6VChnVX/Izw+XCMEQMoxyjB0moYFZMO/e05eTamjVhFlOkWsrNpDiSCdSBlnTc5Ds2y14qoYs+qrDBqIPgtYUauXPTSv0dv1/9DvQzpTPL6Lp/b6v+qp318uJKyIlUpz2m0LdbqaM6jujVXmHUgEAAAGmRmGLgVYlmvoimAmiA40RuDxXoq1nGMDAabqSIQmBG2KhSrRZuaZdJFM4SumMhqSQrQX5Iz69LIpmzT8V1mbxMO0t8mspQ+fZfJUSlytnJdtlZ3VLd6KSqzuBvHg0CvVW3qSqZFK7ad6JVHNcIvLXj/rfZVubPYp4OSZ59PLs3OZEugyNYhC3h6eriDJEpJBwTFZMroZ08AEiogYBYeBll6ZzVnFbd7LXFv0hSzvs/J0oSsl4pX/9NhJkTFpWBDx54lFG3INHnrWqQ3eIZnYqVUQfU1c4tpCmDWVsHp0KaNT8YaUSgMhcBEeCahQKUB56Jx5/0TpykX3cXrB+a8sfGTYV//uUaByABCFKSvMsM1JW6Jk8JCOMDb0zLewkZ8D5AqUwcIwA45o0mBUSJ0xxGJj2cxKHtE6vdpRkc0QXXRvLbkXVCFMtqnEmjc5SH/T/qmnG3s85WzD70oLNpqVtss1DKOT8+UldE5/+1g5abviuBSWZ1IAIBSjXROpChjCg0nUrgk3ghJjTkZz5oyibO6DmIhGvEQj73RtsOHKxmyrwjCkR1P3L0LO6F6+RufcspT8aMFSFbyQ/wMBDKgZZLjVqLlWh11cWNFZnh4VIWm0ESdNXWVexPzJCuQpgBEAl0BmwsmKJqNsNOxVrFWUDOdIkjGFsNh0IUGBrWirDzZVm4rDAWgEKZHAY7aMAzfGCr+eIzUGsl6sz5z4f59PNtNVJ46h82jECjRhki28+BrFtxQs3xtwamu1aZpRQZeqRCgrgmdEqHtaLdKmuAR2quwkbOgEMjpKBlFYp8mOJDySjKwA/rXmpBKCoo1+ywbfZqa6v9FUyRzfb2NpEEgqqVk0L//uUaAaAA3Y3yWpJMMJBhZkdKCN+DMT7I+aEw8CtCKR0EAg4TcdugqkUJpAxRJqOSSAyAMDhIFSagYBct6DHI2YUsFUclnZLOf0USiJKr/8UXM67W20c3qVWpG/Fqi2iHyGyZ7OjhNBk215qV0nis2zWLRXTo80gbiFXYoZU/P7qk3uc7mzk3LPLEUmSCB3ZNrv03PD1C1GjMN14uEsO4fKjv8xNSM2rEBCyGARdBFCmixKwVYWIgsG5qBk3/r3vigpdcK0/+sCM2NUVY10jRJB9dGGZuaaELDFCCJFBQrOUS+FQahR5icG8sDRWlRcEQ3x4pZTnhiRLe25LdRLeWtrnS8lSM6mzaf23O+ag9N33c7fs9fpKiUtnkDAtC4sOAoq0qG3qm3pIY+ptXUAAAALvY3ECD0TSzWjEwu1JgNuQK9bTBZ/CkDC9odQMNnpX0JT/p+y7u3dKASAAk3/kjaASvslZ5F/C1PEMGZ6bgIkNIJzJaHGZFii39Deoo1Wz//tkaBOAgiobSGjgGbI3I0j9HCNOCEi5HaCMVMBygKR0UIgEAyq9Qs1KazyK19ExSaM1z7Iv+tDnj33aKOsC93r5hLZrtbf7G2UDa1Wtlnsj+/efbCobdScBFCDLg1RE2x9ifMKRXlXbNLcyIkwMIxUV+grt+pnHfUEHhGLd/7Yk215P6y+B9l8h0KV3UGg9QySemHXDhmDV9WKzNS1ysnKs3CuIsCglYWHCI8SPX/27EJ4uzDUfK1gr71jgDfYMEgG/o/h6hokFxZCEatJL/t27//9f/7NSqgZ4l2l3ff+xosVOKYXWu5q7KqkjDNdP//skSAuF4TkBSPhBGAgIYBjSACIBgRADGaCEQCAxgB6MEQm8qAL9sW7u1nb6N/6f+3/u9RAAB//9QFGAUCgAYAG67//qAGH////////////ilUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sUaBMP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVEFHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8=',
  'bat_swoosh_3': 'data:audio/mp3;base64,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',
  'bat_swoosh_4': 'data:audio/mp3;base64,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',
  'bat_swoosh_5': 'data:audio/mp3;base64,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',
  'bat_swoosh_6': 'data:audio/mp3;base64,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',
};

// Weapon -> sound key mapping
const WEAPON_SOUNDS = {
  ar: 'ar_shot', ak: 'ar_shot',
  smg: 'smg_shot', p90: 'smg_shot',
  pistol: 'pistol_shot', deagle: 'shotgun_shot',
  sr: 'sr_shot', rem700: 'sr_shot', barrett: 'sr_shot',
  shotgun: 'shotgun_shot', spas: 'shotgun_shot'
};
const MELEE_SWOOSH_KEYS = ['bat_swoosh','bat_swoosh_2','bat_swoosh_3','bat_swoosh_4','bat_swoosh_5','bat_swoosh_6'];
function playSwingSound() {
  const key = MELEE_SWOOSH_KEYS[Math.floor(Math.random()*MELEE_SWOOSH_KEYS.length)];
  playBuffer(key, 0.4, 0.92 + Math.random()*0.16);
}
const RELOAD_SOUNDS = {
  ar: 'ar_reload', shotgun: 'shotgun_reload'
};

// Decoded AudioBuffer cache
const _audioBuffers = {};
async function getAudioBuffer(key) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioBuffers[key]) return _audioBuffers[key];
  const url = AUDIO_DATA[key];
  if (!url) return null;
  try {
    const resp = await fetch(url);
    const arr = await resp.arrayBuffer();
    _audioBuffers[key] = await audioCtx.decodeAudioData(arr);
    return _audioBuffers[key];
  } catch(e) { console.warn('Audio decode failed:', key, e); return null; }
}

// Preload all sounds at game start
async function preloadAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  for (const key of Object.keys(AUDIO_DATA)) {
    if (key === 'dobble_golp') continue; // decoded lazily on first kill
    await getAudioBuffer(key);
  }
}

// Play a decoded buffer with volume based on distance
function playBuffer(key, vol = 0.7, rate = 1.0) {
  if (!audioCtx || !_audioBuffers[key]) return;
  try {
    const src = audioCtx.createBufferSource();
    src.buffer = _audioBuffers[key];
    src.playbackRate.value = rate;
    const gain = audioCtx.createGain();
    gain.gain.value = Math.min(2.0, vol);
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start(0);
  } catch(e) {}
}

// ============================================================================
// FOOTSTEP SOUND (procedural)
// ============================================================================
function playFootstep(vol = 0.12) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;

    // Low thud: short noise burst filtered to heavy bass (ground impact feel)
    const bufLen = Math.floor(audioCtx.sampleRate * 0.07);
    const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      const env = Math.exp(-i / (bufLen * 0.18));
      data[i] = (Math.random() * 2 - 1) * env;
    }

    // Main thud layer (low-pass filtered noise)
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160 + Math.random() * 60;
    lp.Q.value = 1.2;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(lp); lp.connect(g); g.connect(audioCtx.destination);
    src.start(t); src.stop(t + 0.13);

    // Soft click layer (adds crispness, like boot on dirt)
    const src2 = audioCtx.createBufferSource();
    src2.buffer = buf;
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g2 = audioCtx.createGain();
    g2.gain.setValueAtTime(vol * 0.35, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src2.connect(hp); hp.connect(g2); g2.connect(audioCtx.destination);
    src2.start(t); src2.stop(t + 0.05);
  } catch(e) {}
}

// Noise buffer for procedural fallback sounds (hit, dryfire)
let _noiseBuffer = null;
function getNoiseBuffer() {
  if (_noiseBuffer) return _noiseBuffer;
  const sr = audioCtx.sampleRate;
  const len = sr * 0.3;
  _noiseBuffer = audioCtx.createBuffer(1, len, sr);
  const data = _noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return _noiseBuffer;
}

function playSound(type, pos, weaponKey, silenced = false) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let dist = 1;
    if (pos && player) dist = Math.max(1, player.pos.distanceTo(pos));
    // Distance-based volume: opponents only audible within ~100u, player at full vol
    const isOwn = !pos || (player && pos === player.pos);
    const maxDist = 100;
    if (!isOwn && dist > maxDist) return; // too far, skip entirely
    const vol = isOwn ? 1.8 : Math.min(1.8, 32 / dist);
    const t = audioCtx.currentTime;

    if (type === 'shoot') {
      if (silenced) {
        const wk2 = weaponKey || (player && player.weapon) || 'ar';
        const supKey = wk2 === 'ar' ? 'ar_suppressed' : wk2 === 'smg' ? 'smg_suppressed' : null;
        if (wk2 === 'sr') {
          // Suppressed sniper: use the sniper's own audio buffer, heavily filtered and attenuated
          // Louder than suppressed AR/pistol, but clearly suppressed (not the full crack)
          const srSoundKey = WEAPON_SOUNDS['sr'] || 'ar_shot';
          if (_audioBuffers[srSoundKey]) {
            const sniperSrc = audioCtx.createBufferSource();
            sniperSrc.buffer = _audioBuffers[srSoundKey];
            sniperSrc.playbackRate.value = 0.70 + Math.random() * 0.06; // pitch down for suppressed thump
            const lpFilter = audioCtx.createBiquadFilter();
            lpFilter.type = 'lowpass';
            lpFilter.frequency.value = 900; // cut the sharp crack, keep the low thump
            lpFilter.Q.value = 0.8;
            const sniperG = audioCtx.createGain();
            sniperG.gain.setValueAtTime(Math.min(vol * 0.38, 0.55), t); // noticeably louder than suppressed AR
            sniperG.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
            sniperSrc.connect(lpFilter); lpFilter.connect(sniperG); sniperG.connect(audioCtx.destination);
            sniperSrc.start(t); sniperSrc.stop(t + 0.40);
          } else {
            // Fallback: procedural suppressed sniper thump (deeper/longer than AR thwip)
            const srate = audioCtx.sampleRate;
            const bLen = Math.floor(srate * 0.22);
            const sBuf = audioCtx.createBuffer(1, bLen, srate);
            const sd = sBuf.getChannelData(0);
            for (let i = 0; i < bLen; i++) sd[i] = (Math.random()*2-1) * Math.exp(-i/(bLen*0.18));
            const sSrc = audioCtx.createBufferSource(); sSrc.buffer = sBuf;
            const sLP = audioCtx.createBiquadFilter(); sLP.type = 'lowpass'; sLP.frequency.value = 800;
            const sG = audioCtx.createGain(); sG.gain.setValueAtTime(Math.min(vol*0.40, 0.50), t);
            sG.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
            sSrc.connect(sLP); sLP.connect(sG); sG.connect(audioCtx.destination);
            sSrc.start(t); sSrc.stop(t + 0.28);
          }
        } else if (supKey && _audioBuffers[supKey]) {
          // Use real suppressed audio for AR/SMG
          const rate = 0.96 + Math.random() * 0.08;
          playBuffer(supKey, vol * 0.5, rate);
        } else {
          // Generic procedural thwip for other weapons
          const sr = audioCtx.sampleRate;
          const bLen = Math.floor(sr * 0.09);
          const sBuf = audioCtx.createBuffer(1, bLen, sr);
          const sd = sBuf.getChannelData(0);
          for (let i = 0; i < bLen; i++) sd[i] = (Math.random()*2-1) * Math.exp(-i/(bLen*0.12));
          const sSrc = audioCtx.createBufferSource(); sSrc.buffer = sBuf;
          const sLP = audioCtx.createBiquadFilter(); sLP.type = 'lowpass'; sLP.frequency.value = 600;
          const sG = audioCtx.createGain(); sG.gain.setValueAtTime(Math.min(vol*0.18, 0.22), t);
          sG.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
          sSrc.connect(sLP); sLP.connect(sG); sG.connect(audioCtx.destination);
          sSrc.start(t); sSrc.stop(t + 0.11);
        }
      } else {
        // Use the real gun sound for the weapon
        const wk = weaponKey || (player && player.weapon) || 'ar';
        const soundKey = WEAPON_SOUNDS[wk] || 'ar_shot';
        const rate = 0.96 + Math.random() * 0.08;
        // Sniper is naturally louder recording - attenuate it
        const wepVolMul = wk === 'sr' ? 1.2 : wk === 'shotgun' ? 0.6 : 1.0;
        playBuffer(soundKey, vol * wepVolMul, rate);
      }
    } else if (type === 'reload') {
      const wk = weaponKey || (player && player.weapon) || 'ar';
      const soundKey = RELOAD_SOUNDS[wk] || 'ar_reload';
      playBuffer(soundKey, 0.5);

    } else if (type === 'dryfire') {
      const o = audioCtx.createOscillator();
      o.type = 'triangle'; o.frequency.value = 1200;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + 0.04);

    } else if (type === 'hit') {
      const imp = audioCtx.createBufferSource();
      imp.buffer = getNoiseBuffer();
      const impLP = audioCtx.createBiquadFilter();
      impLP.type = 'lowpass'; impLP.frequency.value = 250;
      const impG = audioCtx.createGain();
      impG.gain.setValueAtTime(0.3, t);
      impG.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      imp.connect(impLP); impLP.connect(impG); impG.connect(audioCtx.destination);
      imp.start(t); imp.stop(t + 0.1);
    }
  } catch (e) {}
}

// ============================================================================
// END / WIN
// ============================================================================
function checkWin() {
  const aliveBots = entities.filter(e => !e.isPlayer && e.alive).length;
  if (aliveBots === 0 && player.alive && !gameOver) endGame(true);
}
function endGame(won) {
  gameOver = true;
  document.exitPointerLock();
  const es = document.getElementById('endScreen');
  es.style.display = 'flex';
  es.classList.add(won ? 'win' : 'lose');
  document.getElementById('endTitle').textContent = won ? 'WINNER WINNER' : 'ELIMINATED';
  document.getElementById('endStats').textContent = `KILLS: ${killCount}   ·   PLACEMENT: ${won ? '#1' : '#'+(entities.filter(e=>e.alive).length+1)}`;
}

// ============================================================================
// POST-PROCESSING
// ============================================================================
function setupComposer(w, h) {
  composer = new EffectComposer(renderer);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.30, 0.55, 0.88);
  composer.addPass(bloom);

  const vignette = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec4 color = texture2D(tDiffuse, vUv);
        vec2 uv = (vUv - 0.5) * 2.0;
        float d = dot(uv, uv);
        float vign = 1.0 - smoothstep(0.7, 2.0, d) * 0.40;
        gl_FragColor = vec4(color.rgb * vign, color.a);
      }
    `,
  });
  composer.addPass(vignette);

  // Material shaders already apply ACESFilmic + toneMappingExposure (via renderer.toneMapping).
  // All we need here is linear → sRGB gamma encoding so the canvas displays correctly.
  // Using OutputPass would re-apply tone mapping a second time, making the scene very dark.
  const gammaPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        c.rgb = pow(max(c.rgb, 0.0), vec3(1.0 / 2.2));
        gl_FragColor = c;
      }
    `,
  });
  composer.addPass(gammaPass);

  // FXAA replaces native MSAA lost when rendering to EffectComposer framebuffers
  fxaaPass = new ShaderPass(FXAAShader);
  fxaaPass.material.uniforms['resolution'].value.set(1 / (w * renderer.getPixelRatio()), 1 / (h * renderer.getPixelRatio()));
  composer.addPass(fxaaPass);
}

// ============================================================================
// MAIN LOOP
// ============================================================================
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  if (gameOver) { composer.render(); return; }
  updatePlayer(dt);
  updateViewmodel(dt);
  updateBots(dt);
  // Animate Dobble Golp items
  for (let i = dobbleGolpGroups.length-1; i >= 0; i--) {
    const g = dobbleGolpGroups[i];
    if (!g.parent) { dobbleGolpGroups.splice(i,1); continue; }
    const a = g.userData.dobbleAnim;
    const t = (performance.now() - a.startT) / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    a.glow.intensity = 2.0 + pulse * 2.5;
    a.ringMat.opacity = 0.5 + pulse * 0.35;
    a.haloMat.opacity = 0.15 + pulse * 0.25;
    g.rotation.y = t * 1.2;
    g.position.y = a.baseY + Math.sin(t * 2) * 0.06;
  }
  // Animate loot pickups: float + spin
  const _lt = performance.now() / 1000;
  for (const it of lootItems) {
    if (!it.mesh) continue;
    const mm = it.mesh.userData.modelMesh;
    if (mm) {
      mm.position.y = 0.55 + Math.sin(_lt * 1.8 + it.pos.x) * 0.08;
      mm.rotation.y = _lt * 1.2;
    }
    const rng = it.mesh.userData.ring;
    if (rng) rng.material.opacity = 0.35 + Math.sin(_lt * 2.5 + it.pos.z) * 0.20;
  }
  updateBullets(dt);
  updateZone(dt);
  // Move sun + shadow target to follow the player so shadows render only near the camera
  if (globalThis._sunLight && player) {
    const sun = globalThis._sunLight;
    sun.target.position.set(player.pos.x, 0, player.pos.z);
    sun.position.set(player.pos.x + 140, 240, player.pos.z + 90);
  }
  drawMinimap();
  composer.render();
}
