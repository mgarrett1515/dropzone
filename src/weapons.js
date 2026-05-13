// Pure-data definitions for weapons, attachments, and healing items.
// Imported by main.js; safe to import anywhere (no side effects, no THREE).

export const WEAPONS = {
  pistol: { name:'P92',     dmg:18, rpm:380, mag:15, reserve:30,  recoil:0.6, spread:0.025, range:80,  adsZoom:1.4, auto:false, slot:3, color:0x666666 },
  deagle: { name:'DEAGLE',  dmg:55, rpm:80,  mag:7,  reserve:14,  recoil:2.5, spread:0.012, range:150, adsZoom:2.3, auto:false, slot:3, color:0x888888 },
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
  bat:    { name:'BAT',     dmg:15, rpm:110, mag:1,  reserve:0,   recoil:0,   spread:0,     range:2.5, adsZoom:1.0, auto:false, slot:4, color:0xc8a060, melee:true },
};

export const ATTACHMENTS = {
  reddot:   { name:'RED DOT',    type:'scope',  zoom:1.3 },
  holo:     { name:'HOLO SIGHT', type:'scope',  zoom:1.5 },
  scope2x:  { name:'2x SCOPE',   type:'scope',  zoom:2.2 },
  scope4x:  { name:'4x SCOPE',   type:'scope',  zoom:4.0 },
  scope8x:  { name:'8x SCOPE',   type:'scope',  zoom:8.0 },
  grip:     { name:'V-GRIP',     type:'grip',   recoilMul:0.7 },
  extmag:   { name:'EXT MAG',    type:'mag',    magMul:1.5 },
  comp:     { name:'COMP',       type:'muzzle', recoilMul:0.85, spreadMul:0.85 },
  silencer: { name:'SILENCER',   type:'muzzle', recoilMul:0.95, silent:true },
};

export const HEAL_ITEMS = {
  bandage:     { name:'BANDAGE',             heal:15,  time:3 },
  medkit:      { name:'MEDKIT',              heal:75,  time:6 },
  dobble_golp: { name:'5 TIMES DOBBLE GOLP', heal:100, armor:100, time:5, legendary:true },
};
