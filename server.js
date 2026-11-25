'use strict';
// Tank Wars - game server.
// Runs the whole game (physics, bullets, bots, scores) so all phones see the same thing.
// Phones connect over Wi-Fi and only send their joystick/button input.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');
const { exec } = require('child_process');

let PORT = Number(process.env.PORT) || 5050;

// ===== Game tuning (change these to tweak the feel) =====
const W = 1280, H = 720, T = 20;          // arena size, wall thickness
const TANK_R = 23;                         // bigger tanks are easier to see on phones
const TANK_SPEED = 230, TURN_SPEED = 16, TURRET_TURN = 10;
const ACCEL = 16, ICE_ACCEL = 2.2;
const BOOST_SPEED = 600, BOOST_TIME = 0.25, BOOST_CD = 2.5;
const PAD_SPEED = 680, PAD_TIME = 0.35;
const BULLET_SPEED = 520, BULLET_R = 7, BULLET_BOUNCES = 3, BULLET_LIFE = 4;
const MISSILE_SPEED = 380, MISSILE_TURN = 3.6, MISSILE_LIFE = 5, MISSILE_BOUNCES = 2, MISSILE_DMG = 60;
const LASER_DMG = 60, LASER_LEN = 1500, LASER_BOUNCES = 2;
const MINE_DMG = 70, MINE_BLAST = 75, MINE_TRIGGER = 30, MINE_ARM = 0.7, MINE_LIFE = 45;
const FREEZE_DMG = 20, FREEZE_TIME = 1.6;
const RESPAWN_TIME = 2, SPAWN_SHIELD = 2;
const MAX_PLAYERS = 12, COLOR_COUNT = 12;
const POWERUP_EVERY = 5, MAX_POWERUPS = 4, POWERUP_R = 16;
const TRIPLE_TIME = 10, GHOST_TIME = 6, HEAL_AMOUNT = 50;
const ROUND_BREAK = 15;                    // seconds on the results screen
const POWERUP_TYPES = ['triple', 'shield', 'homing', 'heal', 'mine', 'laser', 'ghost', 'freeze'];
const TIME_CHOICES = [60, 120, 180, 300, 600];
const MODES = ['ffa', 'teams', 'koth', 'lms'];
const LMS_LIVES = 3;
const HILL_R = 75, HILL_MOVE = 30;
const ZONE_DPS = 15, LAVA_DPS = 35, ZONE_MIN = 150;
const CRATE_SIZE = 36, CRATE_HP = 3;
const ON_FIRE_STREAK = 3;

// Tank types: speed multiplier, health, bullet speed multiplier, damage, reload, max bullets
const CLASSES = [
  { id: 'medium', speed: 1, hp: 100, bspeed: 1, dmg: 34, cd: 0.2, max: 4 },
  { id: 'light', speed: 1.22, hp: 70, bspeed: 1.05, dmg: 28, cd: 0.16, max: 4 },
  { id: 'heavy', speed: 0.8, hp: 160, bspeed: 0.9, dmg: 45, cd: 0.32, max: 3 },
  { id: 'sniper', speed: 0.95, hp: 80, bspeed: 1.7, dmg: 55, cd: 0.6, max: 2 },
];

// Cosmetics unlocked by lifetime stats (the phone shows the same rules)
const UNLOCKS = {
  hat: { 6: { kills: 25 }, 7: { wins: 5 }, 8: { matches: 10 } },
  pt: { 4: { kills: 50 }, 5: { wins: 10 } },
};

// ===== Maps =====
const BORDER = [
  { x: 0, y: 0, w: W, h: T }, { x: 0, y: H - T, w: W, h: T },
  { x: 0, y: 0, w: T, h: H }, { x: W - T, y: 0, w: T, h: H },
];
const EDGE_SPAWNS = [
  { x: 70, y: 70 }, { x: 1210, y: 70 }, { x: 70, y: 650 }, { x: 1210, y: 650 },
  { x: 70, y: 360 }, { x: 1210, y: 360 }, { x: 640, y: 50 }, { x: 640, y: 670 },
];
const PI = Math.PI;
const MAPS = {
  classic: {
    name: 'Classic',
    theme: { floor: '#1f2250', tile: '#23275a', wall: '#7b61ff', top: '#b3a4ff', border: '#4b3fb0', borderTop: '#6a5be0' },
    walls: [
      { x: 180, y: 150, w: 180, h: T }, { x: 180, y: 150, w: T, h: 120 },
      { x: 920, y: 150, w: 180, h: T }, { x: 1080, y: 150, w: T, h: 120 },
      { x: 180, y: 550, w: 180, h: T }, { x: 180, y: 450, w: T, h: 120 },
      { x: 920, y: 550, w: 180, h: T }, { x: 1080, y: 450, w: T, h: 120 },
      { x: 590, y: 310, w: 100, h: 100 },
      { x: 630, y: 90, w: T, h: 130 }, { x: 630, y: 500, w: T, h: 130 },
      { x: 430, y: 350, w: 90, h: T }, { x: 760, y: 350, w: 90, h: T },
      { x: 470, y: 200, w: 36, h: 36 }, { x: 774, y: 200, w: 36, h: 36 },
      { x: 470, y: 484, w: 36, h: 36 }, { x: 774, y: 484, w: 36, h: 36 },
    ],
    crates: [{ x: 300, y: 342 }, { x: 944, y: 342 }],
    spawns: EDGE_SPAWNS,
  },
  maze: {
    name: 'Maze',
    theme: { floor: '#162433', tile: '#1b2c3f', wall: '#2ec4b6', top: '#9ff5ea', border: '#1b7f78', borderTop: '#3fb3a8' },
    walls: [
      { x: 120, y: 140, w: 240, h: T }, { x: 920, y: 140, w: 240, h: T },
      { x: 120, y: 560, w: 240, h: T }, { x: 920, y: 560, w: 240, h: T },
      { x: 480, y: 20, w: T, h: 180 }, { x: 780, y: 20, w: T, h: 180 },
      { x: 480, y: 520, w: T, h: 180 }, { x: 780, y: 520, w: T, h: 180 },
      { x: 560, y: 140, w: 160, h: T }, { x: 560, y: 560, w: 160, h: T },
      { x: 400, y: 340, w: 180, h: T }, { x: 700, y: 340, w: 180, h: T },
      { x: 630, y: 240, w: T, h: 240 },
      { x: 300, y: 260, w: T, h: 200 }, { x: 960, y: 260, w: T, h: 200 },
    ],
    crates: [{ x: 380, y: 440 }, { x: 864, y: 244 }],
    spawns: [
      { x: 60, y: 60 }, { x: 1220, y: 60 }, { x: 60, y: 660 }, { x: 1220, y: 660 },
      { x: 60, y: 360 }, { x: 1220, y: 360 }, { x: 640, y: 70 }, { x: 640, y: 650 },
    ],
  },
  open: {
    name: 'Open Field',
    theme: { floor: '#2a1f3d', tile: '#31244a', wall: '#ff8c42', top: '#ffd0a8', border: '#b35a12', borderTop: '#d9782f' },
    walls: [
      { x: 300, y: 180, w: 60, h: 60 }, { x: 920, y: 180, w: 60, h: 60 },
      { x: 300, y: 480, w: 60, h: 60 }, { x: 920, y: 480, w: 60, h: 60 },
      { x: 610, y: 330, w: 60, h: 60 },
    ],
    crates: [{ x: 450, y: 120 }, { x: 794, y: 564 }, { x: 450, y: 564 }, { x: 794, y: 120 }, { x: 622, y: 200 }, { x: 622, y: 484 }],
    spawns: EDGE_SPAWNS,
  },
  ice: {
    name: 'Ice Rink',
    ice: true,
    theme: { floor: '#cfe8ff', tile: '#bcdcfb', wall: '#5aa9e6', top: '#e6f4ff', border: '#2f6fa8', borderTop: '#4b8cc4' },
    walls: [
      { x: 200, y: 200, w: 80, h: 80 }, { x: 1000, y: 200, w: 80, h: 80 },
      { x: 200, y: 440, w: 80, h: 80 }, { x: 1000, y: 440, w: 80, h: 80 },
      { x: 560, y: 120, w: 160, h: T }, { x: 560, y: 580, w: 160, h: T },
      { x: 460, y: 300, w: T, h: 120 }, { x: 800, y: 300, w: T, h: 120 },
    ],
    crates: [{ x: 622, y: 220 }, { x: 622, y: 464 }],
    spawns: EDGE_SPAWNS,
  },
  fortress: {
    name: 'Fortress',
    theme: { floor: '#1f2e1c', tile: '#253822', wall: '#8bc34a', top: '#d4f0b0', border: '#4e7a24', borderTop: '#6f9e3c' },
    walls: [
      { x: 120, y: 220, w: 160, h: T }, { x: 120, y: 480, w: 160, h: T },
      { x: 260, y: 220, w: T, h: 90 }, { x: 260, y: 410, w: T, h: 90 },
      { x: 1000, y: 220, w: 160, h: T }, { x: 1000, y: 480, w: 160, h: T },
      { x: 1000, y: 220, w: T, h: 90 }, { x: 1000, y: 410, w: T, h: 90 },
      { x: 610, y: 280, w: 60, h: 160 },
      { x: 440, y: 100, w: T, h: 140 }, { x: 820, y: 100, w: T, h: 140 },
      { x: 440, y: 480, w: T, h: 140 }, { x: 820, y: 480, w: T, h: 140 },
    ],
    crates: [{ x: 540, y: 330 }, { x: 704, y: 330 }],
    spawns: [
      { x: 60, y: 120 }, { x: 60, y: 600 }, { x: 190, y: 360 },
      { x: 1220, y: 120 }, { x: 1220, y: 600 }, { x: 1090, y: 360 },
      { x: 640, y: 60 }, { x: 640, y: 660 },
    ],
  },
  jungle: {
    name: 'Jungle',
    theme: { floor: '#1d3320', tile: '#223b25', wall: '#6d4c2f', top: '#a07a52', border: '#3e2a17', borderTop: '#5a3d22' },
    walls: [
      { x: 300, y: 120, w: T, h: 160 }, { x: 960, y: 440, w: T, h: 160 },
      { x: 300, y: 440, w: T, h: 160 }, { x: 960, y: 120, w: T, h: 160 },
      { x: 560, y: 350, w: 160, h: T },
    ],
    bushes: [
      { x: 200, y: 360, r: 62 }, { x: 1080, y: 360, r: 62 }, { x: 640, y: 150, r: 75 }, { x: 640, y: 570, r: 75 },
      { x: 450, y: 250, r: 52 }, { x: 830, y: 470, r: 52 }, { x: 450, y: 470, r: 52 }, { x: 830, y: 250, r: 52 },
    ],
    crates: [{ x: 622, y: 280 }, { x: 622, y: 404 }],
    spawns: EDGE_SPAWNS,
  },
  lava: {
    name: 'Lava',
    theme: { floor: '#2b1512', tile: '#331a16', wall: '#5c3a3a', top: '#9b6b6b', border: '#3a1f1f', borderTop: '#5a2f2f' },
    walls: [
      { x: 240, y: 160, w: 120, h: T }, { x: 920, y: 540, w: 120, h: T },
      { x: 240, y: 540, w: 120, h: T }, { x: 920, y: 160, w: 120, h: T },
      { x: 620, y: 60, w: 40, h: 120 }, { x: 620, y: 540, w: 40, h: 120 },
    ],
    lava: [{ x: 520, y: 260, w: 240, h: 200 }, { x: 140, y: 300, w: 110, h: 120 }, { x: 1030, y: 300, w: 110, h: 120 }],
    crates: [{ x: 430, y: 342 }, { x: 814, y: 342 }],
    spawns: [
      { x: 70, y: 70 }, { x: 1210, y: 70 }, { x: 70, y: 650 }, { x: 1210, y: 650 },
      { x: 70, y: 220 }, { x: 1210, y: 500 }, { x: 420, y: 60 }, { x: 860, y: 660 },
    ],
  },
  portal: {
    name: 'Portals',
    theme: { floor: '#14122b', tile: '#1a1736', wall: '#c86bff', top: '#ecc4ff', border: '#6a2f9b', borderTop: '#8e4bc4' },
    walls: [
      { x: 400, y: 20, w: T, h: 220 }, { x: 860, y: 480, w: T, h: 220 },
      { x: 400, y: 480, w: T, h: 220 }, { x: 860, y: 20, w: T, h: 220 },
      { x: 560, y: 300, w: 160, h: T }, { x: 560, y: 400, w: 160, h: T },
    ],
    portals: [{ a: { x: 130, y: 130 }, b: { x: 1150, y: 590 } }, { a: { x: 1150, y: 130 }, b: { x: 130, y: 590 } }],
    pads: [{ x: 260, y: 360, a: 0 }, { x: 1020, y: 360, a: PI }, { x: 520, y: 200, a: 0 }, { x: 760, y: 520, a: PI }],
    crates: [{ x: 622, y: 342 }, { x: 480, y: 600 }, { x: 764, y: 84 }],
    spawns: EDGE_SPAWNS,
  },
};
const MAP_IDS = Object.keys(MAPS);

// ===== Helpers =====
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const rand = (a, b) => a + Math.random() * (b - a);

let mapId = 'classic', MAP = MAPS.classic;
let crates = [], WALLS = [];
function rebuildWalls() { WALLS = [...BORDER, ...MAP.walls, ...crates.filter(c => c.hp > 0)]; }

function circleRect(cx, cy, r, w) {
  const nx = clamp(cx, w.x, w.x + w.w), ny = clamp(cy, w.y, w.y + w.h);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}
function wallAt(x, y, r) {
  for (const w of WALLS) if (circleRect(x, y, r, w)) return w;
  return null;
}
function pushOutOfWalls(o, r) {
  for (const w of WALLS) {
    const nx = clamp(o.x, w.x, w.x + w.w), ny = clamp(o.y, w.y, w.y + w.h);
    const dx = o.x - nx, dy = o.y - ny, d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      o.x = nx + (dx / d) * r; o.y = ny + (dy / d) * r;
    } else {
      const left = o.x - w.x, right = w.x + w.w - o.x, top = o.y - w.y, bottom = w.y + w.h - o.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) o.x = w.x - r; else if (m === right) o.x = w.x + w.w + r;
      else if (m === top) o.y = w.y - r; else o.y = w.y + w.h + r;
    }
  }
}
function losClear(x1, y1, x2, y2) {
  const d = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(d / 12);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (wallAt(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 4)) return false;
  }
  return true;
}
const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// ===== Lifetime stats (saved on this laptop) =====
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');
let stats = { players: {} };
try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); if (!stats.players) stats.players = {}; } catch (e) {}
let statsDirty = false;
setInterval(() => {
  if (!statsDirty) return;
  statsDirty = false;
  fs.mkdir(path.dirname(STATS_FILE), { recursive: true }, () => {
    fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 1), () => {});
  });
}, 3000);
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
function statsFor(name) {
  const key = String(name || '').trim().toLowerCase();
  return stats.players[key] || { name, kills: 0, deaths: 0, wins: 0, matches: 0, bestStreak: 0, weeks: {} };
}
function isUnlocked(st, rule) { return Object.entries(rule).every(([k, v]) => (st[k] || 0) >= v); }
function weeklyTop(n = 5) {
  const wk = weekKey();
  return Object.values(stats.players)
    .map(p => ({ name: p.name, ...(p.weeks && p.weeks[wk] ? p.weeks[wk] : { kills: 0, wins: 0, matches: 0 }) }))
    .filter(p => p.matches > 0)
    .sort((a, b) => b.wins - a.wins || b.kills - a.kills)
    .slice(0, n);
}
function recordMatch(p, won) {
  const key = p.name.trim().toLowerCase();
  const s = stats.players[key] || (stats.players[key] = { name: p.name, kills: 0, deaths: 0, wins: 0, matches: 0, bestStreak: 0, weeks: {} });
  s.name = p.name;
  s.kills += p.kills; s.deaths += p.deaths; s.matches++; if (won) s.wins++;
  s.bestStreak = Math.max(s.bestStreak, p.bestStreak);
  const wk = weekKey();
  const w = s.weeks[wk] || (s.weeks[wk] = { kills: 0, wins: 0, matches: 0 });
  w.kills += p.kills; w.matches++; if (won) w.wins++;
  statsDirty = true;
}

// ===== Game state =====
const players = new Map();
let bullets = [], powerups = [], mines = [], events = [];
let nextId = 1;
let phase = 'lobby';                       // 'lobby' | 'playing' | 'over'
const cfg = { time: 180, mode: 'ffa', map: 'classic', zone: false };
let matchT = cfg.time, overT = 0, winner = null, draw = false, awards = [];
let teamKills = [0, 0];
let hostId = null, leaderId = null;
let powerupT = 3;
let hill = null, hillT = 0;
let zoneR = 9999;
let matchId = 0, lmsStarted = 0;
const reconnects = new Map();             // token -> saved player progress

const isTeams = () => cfg.mode === 'teams';
const enemies = (a, b) => a !== b && (!isTeams() || a.team !== b.team);
const humans = () => [...players.values()].filter(p => !p.bot);

function score(p) {
  if (cfg.mode === 'koth') return p.hillPts + p.kills - p.deaths + p.bonus;
  if (cfg.mode === 'lms') return p.kills;
  return p.kills - p.deaths + p.bonus;
}

function mapInfo() {
  return {
    id: mapId, name: MAP.name, walls: [...BORDER, ...MAP.walls], theme: MAP.theme, ice: !!MAP.ice,
    crates: crates.map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h })),
    bushes: MAP.bushes || [], lava: MAP.lava || [], portals: MAP.portals || [], pads: MAP.pads || [],
  };
}

function resetCrates() {
  crates = (MAP.crates || []).map((c, i) => ({ id: i, x: c.x, y: c.y, w: CRATE_SIZE, h: CRATE_SIZE, hp: CRATE_HP, crate: true }));
  rebuildWalls();
}

function setMap(id) {
  mapId = id; MAP = MAPS[id];
  resetCrates();
  bullets = []; powerups = []; mines = [];
  broadcastAll({ t: 'map', map: mapInfo() });
  for (const p of players.values()) if (!p.out) spawnPlayer(p);
}

function pickSpawn(p) {
  let list = MAP.spawns;
  if (isTeams()) {
    const side = MAP.spawns.filter(s => (p.team === 0 ? s.x < W / 2 - 1 : s.x > W / 2 + 1));
    if (side.length) list = side;
  }
  const free = list.filter(s => !wallAt(s.x, s.y, TANK_R));
  if (free.length) list = free;
  const others = [...players.values()].filter(o => o.alive && o !== p);
  if (!others.length) return list[Math.floor(Math.random() * list.length)];
  const distTo = (x, y) => { let d = Infinity; for (const o of others) d = Math.min(d, Math.hypot(o.x - x, o.y - y)); return d; };
  let best = list[0], bestD = -1;
  for (const s of list) {
    const d = distTo(s.x, s.y) + Math.random() * 60;
    if (d > bestD) { bestD = d; best = s; }
  }
  // with many players all spawn points can be busy: find a free open spot instead
  if (distTo(best.x, best.y) < 90) {
    for (let i = 0; i < 80; i++) {
      const x = rand(T + 40, W - T - 40), y = rand(T + 40, H - T - 40);
      if (wallAt(x, y, TANK_R + 6) || (MAP.lava || []).some(r => inRect(x, y, { x: r.x - 30, y: r.y - 30, w: r.w + 60, h: r.h + 60 }))) continue;
      if (isTeams() && (p.team === 0 ? x > W / 2 : x < W / 2)) continue;
      const d = distTo(x, y);
      if (d > bestD) { bestD = d; best = { x, y }; }
      if (d > 200) break;
    }
  }
  return best;
}

function spawnPlayer(p) {
  const s = pickSpawn(p);
  const cl = CLASSES[p.cls];
  p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0;
  p.a = Math.atan2(H / 2 - s.y, W / 2 - s.x); p.ta = p.a;
  p.alive = true; p.hp = cl.hp; p.maxHp = cl.hp;
  p.spawnShield = SPAWN_SHIELD; p.boostT = 0; p.padT = 0; p.frozenT = 0;
  events.push({ e: 'spawn', i: p.id, x: r1(p.x), y: r1(p.y), c: p.color });
}

function clearPowers(p) {
  p.shield = false; p.tripleT = 0; p.missiles = 0; p.mines = 0; p.lasers = 0; p.freezeShots = 0; p.ghostT = 0;
}

// ----- shooting -----
function fireLaser(p, sx, sy) {
  let x = sx, y = sy, dx = Math.cos(p.ta), dy = Math.sin(p.ta), left = LASER_LEN, bounces = 0;
  const pts = [[r1(x), r1(y)]];
  const hitSet = new Set();
  const step = 5;
  while (left > 0) {
    const nx = x + dx * step, ny = y + dy * step;
    const w = wallAt(nx, ny, 2);
    if (w) {
      if (w.crate) { damageCrate(w, 3); pts.push([r1(x), r1(y)]); break; }
      if (bounces >= LASER_BOUNCES) { pts.push([r1(x), r1(y)]); break; }
      if (wallAt(x + dx * step, y, 2)) dx = -dx; else dy = -dy;
      bounces++; pts.push([r1(x), r1(y)]);
      continue;
    }
    x = nx; y = ny; left -= step;
    for (const o of players.values()) {
      if (!o.alive || hitSet.has(o.id) || !enemies(p, o)) continue;
      if ((o.x - x) ** 2 + (o.y - y) ** 2 < (TANK_R + 4) ** 2) { hitSet.add(o.id); damage(o, LASER_DMG, p, { kind: 'laser', bounced: bounces > 0 }); }
    }
  }
  if (pts.length < 2 || pts[pts.length - 1][0] !== r1(x)) pts.push([r1(x), r1(y)]);
  events.push({ e: 'laser', i: p.id, c: p.color, pts });
}

function tryFire(p) {
  if (p.fireCd > 0 || p.frozenT > 0) return;
  const cl = CLASSES[p.cls];
  let owned = 0;
  for (const b of bullets) if (b.owner === p.id) owned++;
  const special = p.missiles > 0 || p.lasers > 0 || p.mines > 0;
  if (owned >= cl.max && !special) return;
  const onFire = p.streak >= ON_FIRE_STREAK;
  p.fireCd = cl.cd * (onFire ? 0.8 : 1) * (p.missiles > 0 || p.lasers > 0 ? 2 : 1);
  p.spawnShield = 0;
  p.lastFireAt = now;
  if (p.mines > 0) { // drop a mine behind the tank
    p.mines--;
    const mx = p.x - Math.cos(p.a) * 30, my = p.y - Math.sin(p.a) * 30;
    mines.push({ id: nextId++, owner: p.id, team: p.team, c: p.color, x: mx, y: my, arm: MINE_ARM, life: MINE_LIFE });
    events.push({ e: 'mine', i: p.id, x: r1(mx), y: r1(my) });
    return;
  }
  const sx = p.x + Math.cos(p.ta) * (TANK_R + 12), sy = p.y + Math.sin(p.ta) * (TANK_R + 12);
  if (wallAt(sx, sy, BULLET_R)) { events.push({ e: 'puff', x: r1(sx), y: r1(sy) }); return; }
  p.shots++;
  if (p.lasers > 0) { p.lasers--; fireLaser(p, sx, sy); return; }
  const make = (ang, type) => {
    const speed = type === 'm' ? MISSILE_SPEED : BULLET_SPEED * cl.bspeed;
    bullets.push({
      id: nextId++, owner: p.id, c: p.color, type, x: sx, y: sy,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      bounces: 0, maxB: type === 'm' ? MISSILE_BOUNCES : BULLET_BOUNCES,
      life: type === 'm' ? MISSILE_LIFE : BULLET_LIFE, age: 0,
      dmg: type === 'm' ? MISSILE_DMG : type === 'f' ? FREEZE_DMG : cl.dmg,
    });
  };
  let kind = 'b';
  if (p.missiles > 0) { p.missiles--; make(p.ta, 'm'); kind = 'm'; }
  else if (p.freezeShots > 0) { p.freezeShots--; make(p.ta, 'f'); kind = 'f'; }
  else if (p.tripleT > 0) { for (const d of [-0.22, 0, 0.22]) make(p.ta + d, 'b'); kind = 't'; }
  else make(p.ta, 'b');
  events.push({ e: 'fire', i: p.id, x: r1(sx), y: r1(sy), c: p.color, k: kind });
}

// ----- damage, kills -----
function damage(v, amount, attacker, info) {
  if (!v.alive) return;
  const env = info.kind === 'lava' || info.kind === 'zone';
  if (v.spawnShield > 0) { if (!env) events.push({ e: 'deflect', x: r1(v.x), y: r1(v.y) }); return; }
  if (v.shield && !env) { v.shield = false; events.push({ e: 'shield', i: v.id, x: r1(v.x), y: r1(v.y) }); return; }
  v.hp -= amount;
  if (attacker && attacker !== v) { attacker.dmgDealt += amount; if (info.kind !== 'mine') attacker.hits++; }
  if (!env) events.push({ e: 'hit', i: v.id, o: attacker ? attacker.id : 0, x: r1(v.x), y: r1(v.y), d: Math.round(amount), c: v.color });
  if (info.kind === 'freeze') { v.frozenT = FREEZE_TIME; events.push({ e: 'frozen', i: v.id, x: r1(v.x), y: r1(v.y) }); }
  if (v.hp <= 0) killTank(v, attacker, info);
}

function killTank(victim, killer, info) {
  victim.alive = false;
  victim.respawnT = RESPAWN_TIME;
  victim.deaths++;
  const shutdown = victim.streak >= ON_FIRE_STREAK && killer && killer !== victim;
  victim.streak = 0; victim.multi = 0;
  clearPowers(victim);
  if (cfg.mode === 'lms') { victim.lives--; if (victim.lives <= 0) { victim.out = true; events.push({ e: 'out', i: victim.id, n: victim.name }); } }
  let bounty = false;
  if (killer && killer !== victim) {
    killer.kills++;
    killer.streak++; killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
    killer.multi = now - killer.lastKillAt < 4 ? killer.multi + 1 : 1;
    killer.lastKillAt = now;
    if (victim.id === leaderId && cfg.mode !== 'lms') { bounty = true; killer.bonus++; }
    if (isTeams()) teamKills[killer.team] += bounty ? 2 : 1;
    if (killer.multi >= 2) events.push({ e: 'multi', i: killer.id, n: killer.name, v: killer.multi });
    if (killer.streak === ON_FIRE_STREAK) events.push({ e: 'onfire', i: killer.id, n: killer.name, c: killer.color });
  }
  events.push({ e: 'boom', i: victim.id, x: r1(victim.x), y: r1(victim.y), c: victim.color });
  events.push({
    e: 'kill', k: killer ? killer.id : null, kn: killer ? killer.name : '', kc: killer ? killer.color : 0,
    v: victim.id, vn: victim.name, vc: victim.color, vg: victim.look[0],
    how: info.kind, trick: !!info.bounced, bounty, shutdown,
  });
}

function damageCrate(c, amount) {
  if (c.hp <= 0) return;
  c.hp -= amount;
  events.push({ e: 'crate', x: r1(c.x + c.w / 2), y: r1(c.y + c.h / 2), d: c.hp <= 0 ? 1 : 0 });
  if (c.hp <= 0) rebuildWalls();
}

// ----- bots -----
const BOT_NAMES = ['Bolt', 'Rusty', 'Tinker', 'Byte', 'Sparky', 'Gizmo', 'Turbo', 'Pixel', 'Rocket', 'Nova', 'Zippy', 'Blaze'];
function addBot() {
  if (players.size >= MAX_PLAYERS) return;
  const taken = new Set([...players.values()].map(p => p.color));
  let color = 0; while (taken.has(color) && color < COLOR_COUNT) color++;
  const used = new Set([...players.values()].map(p => p.name));
  const name = '🤖 ' + (BOT_NAMES.find(n => !used.has('🤖 ' + n)) || 'Bot');
  const look = [Math.floor(rand(0, 3)), Math.floor(rand(0, 5)), Math.floor(rand(0, 6)), Math.floor(rand(0, 6)), Math.floor(rand(0, 6)), Math.floor(rand(0, 4))];
  const p = makePlayer(name, color, look, Math.floor(rand(0, 4)));
  p.bot = true;
  players.set(p.id, p);
  spawnPlayer(p);
  events.push({ e: 'join', n: name, c: color });
  broadcastLobby();
}
function removeBot() {
  const bots = [...players.values()].filter(p => p.bot);
  const b = bots[bots.length - 1];
  if (!b) return;
  players.delete(b.id);
  bullets = bullets.filter(x => x.owner !== b.id);
  events.push({ e: 'leave', n: b.name, c: b.color });
  broadcastLobby();
}

function canSee(viewer, o) {
  const d = Math.hypot(viewer.x - o.x, viewer.y - o.y);
  if (o.ghostT > 0 && d > 70) return false;
  if (o.inBush && now - o.lastFireAt > 0.8 && d > 110) return false;
  return true;
}

function botThink(p, dt) {
  p.botT -= dt; p.noiseT -= dt;
  if (p.noiseT <= 0) { p.noiseT = 0.5; p.aimNoise = rand(-0.14, 0.14); if (Math.random() < 0.3) p.strafe = -p.strafe; }
  let target = null, best = Infinity;
  for (const o of players.values()) {
    if (!o.alive || !enemies(p, o) || !canSee(p, o)) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < best) { best = d; target = o; }
  }
  let mx = 0, my = 0, fire = false, aim = null;
  if (target) {
    const dx = target.x - p.x, dy = target.y - p.y, d = best;
    const los = losClear(p.x, p.y, target.x, target.y);
    const cl = CLASSES[p.cls], tt = d / (BULLET_SPEED * cl.bspeed);
    aim = Math.atan2(target.y + target.vy * tt - p.y, target.x + target.vx * tt - p.x) + p.aimNoise;
    if (los && d < 760) fire = true;
    if (!los || d > 330) { mx = dx / d; my = dy / d; }
    else if (d < 150) { mx = -dx / d; my = -dy / d; }
    else { mx = -dy / d * p.strafe; my = dx / d * p.strafe; }
    if (p.hp < p.maxHp * 0.35 && d < 220 && p.boostCd <= 0 && Math.random() < 0.03) p.boostQueued = true;
  }
  // go for nearby power-ups, the hill, or wander
  let goal = null;
  for (const u of powerups) { const d = Math.hypot(u.x - p.x, u.y - p.y); if (d < 230 && (!goal || d < goal.d)) goal = { x: u.x, y: u.y, d }; }
  if (!goal && cfg.mode === 'koth' && hill && (!target || best > 260)) goal = { x: hill.x, y: hill.y };
  if (!goal && !target) {
    if (!p.wander || p.botT <= 0 || Math.hypot(p.wander.x - p.x, p.wander.y - p.y) < 40) {
      p.botT = 3; p.wander = { x: rand(80, W - 80), y: rand(80, H - 80) };
    }
    goal = p.wander;
  }
  if (goal && (!target || goal.d !== undefined)) {
    const dx = goal.x - p.x, dy = goal.y - p.y, d = Math.hypot(dx, dy) || 1;
    mx = dx / d; my = dy / d;
  }
  if (cfg.zone && Math.hypot(p.x - W / 2, p.y - H / 2) > zoneR - 60) { // get back in the zone
    const dx = W / 2 - p.x, dy = H / 2 - p.y, d = Math.hypot(dx, dy) || 1; mx = dx / d; my = dy / d;
  }
  // avoid walls and lava ahead
  if (mx || my) {
    const blocked = (ax, ay) => wallAt(p.x + ax * 42, p.y + ay * 42, TANK_R - 2) || (MAP.lava || []).some(r => inRect(p.x + ax * 50, p.y + ay * 50, r));
    if (blocked(mx, my)) {
      const left = [my, -mx], right = [-my, mx];
      if (!blocked(...left)) [mx, my] = left; else if (!blocked(...right)) [mx, my] = right; else { mx = -mx; my = -my; }
    }
  }
  // unstick
  p.stuckT -= dt;
  if (p.stuckT <= 0) {
    p.stuckT = 0.6;
    if (Math.hypot(p.x - p.lastPos.x, p.y - p.lastPos.y) < 10 && (mx || my)) { p.unstickT = 0.7; p.unstickA = rand(-PI, PI); }
    p.lastPos = { x: p.x, y: p.y };
  }
  if (p.unstickT > 0) { p.unstickT -= dt; mx = Math.cos(p.unstickA); my = Math.sin(p.unstickA); }
  p.input.x = mx; p.input.y = my; p.input.fire = fire; p.aim = aim;
}

// ----- per-player update -----
function updatePlayer(p, dt) {
  p.fireCd = Math.max(0, p.fireCd - dt);
  p.boostCd = Math.max(0, p.boostCd - dt);
  p.boostT = Math.max(0, p.boostT - dt);
  p.padT = Math.max(0, p.padT - dt);
  p.tripleT = Math.max(0, p.tripleT - dt);
  p.ghostT = Math.max(0, p.ghostT - dt);
  p.frozenT = Math.max(0, p.frozenT - dt);
  p.tpCd = Math.max(0, p.tpCd - dt);
  p.spawnShield = Math.max(0, p.spawnShield - dt);
  if (p.out) return;
  if (!p.alive) {
    p.boostQueued = false;
    p.respawnT -= dt;
    if (p.respawnT <= 0) spawnPlayer(p);
    return;
  }
  if (p.bot && phase !== 'over') botThink(p, dt);
  const cl = CLASSES[p.cls];
  const speedMul = cl.speed * (p.streak >= ON_FIRE_STREAK ? 1.12 : 1);

  let ix = p.input.x, iy = p.input.y, mag = Math.hypot(ix, iy);
  if (mag > 1) { ix /= mag; iy /= mag; mag = 1; }
  if (p.frozenT > 0) { ix = iy = mag = 0; p.boostQueued = false; }

  if (p.boostQueued) {
    p.boostQueued = false;
    if (p.boostCd <= 0) { p.boostT = BOOST_TIME; p.boostCd = BOOST_CD; events.push({ e: 'boost', i: p.id, x: r1(p.x), y: r1(p.y) }); }
  }
  if (mag > 0.2) {
    const target = Math.atan2(iy, ix), diff = wrapAngle(target - p.a), step = TURN_SPEED * dt;
    p.a = Math.abs(diff) <= step ? target : wrapAngle(p.a + Math.sign(diff) * step);
  }
  // turret: aims where the player aims, otherwise follows the tank
  if (p.aim !== null && p.aim !== undefined && p.frozenT <= 0) p.ta = p.aim;
  else { const diff = wrapAngle(p.a - p.ta), step = TURRET_TURN * dt; p.ta = Math.abs(diff) <= step ? p.a : wrapAngle(p.ta + Math.sign(diff) * step); }

  let tx = 0, ty = 0;
  if (p.padT > 0) { p.vx = Math.cos(p.padA) * PAD_SPEED; p.vy = Math.sin(p.padA) * PAD_SPEED; }
  else if (p.boostT > 0) { p.vx = Math.cos(p.a) * BOOST_SPEED; p.vy = Math.sin(p.a) * BOOST_SPEED; }
  else {
    if (mag > 0.2) { tx = ix * TANK_SPEED * speedMul; ty = iy * TANK_SPEED * speedMul; }
    const k = Math.min(1, (MAP.ice ? ICE_ACCEL : ACCEL) * dt);
    p.vx += (tx - p.vx) * k; p.vy += (ty - p.vy) * k;
  }
  const ox = p.x, oy = p.y;
  p.x += p.vx * dt; p.y += p.vy * dt;
  pushOutOfWalls(p, TANK_R); pushOutOfWalls(p, TANK_R);
  p.x = clamp(p.x, T + TANK_R, W - T - TANK_R);
  p.y = clamp(p.y, T + TANK_R, H - T - TANK_R);
  if (dt > 0 && p.boostT <= 0 && p.padT <= 0) { p.vx = (p.x - ox) / dt; p.vy = (p.y - oy) / dt; }

  // map features
  for (const pr of MAP.portals || []) {
    if (p.tpCd > 0) break;
    for (const [from, to] of [[pr.a, pr.b], [pr.b, pr.a]]) {
      if (Math.hypot(p.x - from.x, p.y - from.y) < 24) {
        events.push({ e: 'tp', i: p.id, x: r1(p.x), y: r1(p.y), x2: to.x, y2: to.y });
        p.x = to.x; p.y = to.y; p.tpCd = 1.3; pushOutOfWalls(p, TANK_R);
        break;
      }
    }
  }
  for (const pad of MAP.pads || []) {
    if (p.padT <= 0 && Math.hypot(p.x - pad.x, p.y - pad.y) < 26) { p.padT = PAD_TIME; p.padA = pad.a; events.push({ e: 'pad', i: p.id, x: pad.x, y: pad.y }); }
  }
  p.inBush = (MAP.bushes || []).some(b => Math.hypot(p.x - b.x, p.y - b.y) < b.r);
  if (phase === 'playing') {
    if ((MAP.lava || []).some(r => inRect(p.x, p.y, r))) damage(p, LAVA_DPS * dt, null, { kind: 'lava' });
    if (p.alive && cfg.zone && Math.hypot(p.x - W / 2, p.y - H / 2) > zoneR) damage(p, ZONE_DPS * dt, null, { kind: 'zone' });
  }
  if (p.alive && p.input.fire && phase === 'playing') tryFire(p);
}

function separateTanks() {
  const list = [...players.values()].filter(p => p.alive);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = TANK_R * 2;
    if (d > 0 && d < min) {
      const push = (min - d) / 2, ux = dx / d, uy = dy / d;
      a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
      pushOutOfWalls(a, TANK_R); pushOutOfWalls(b, TANK_R);
    }
  }
}

function steerMissile(b, dt) {
  const owner = players.get(b.owner);
  let target = null, best = Infinity;
  for (const p of players.values()) {
    if (!p.alive || p.id === b.owner || p.spawnShield > 0) continue;
    if (owner && (!enemies(owner, p) || !canSee(b, p))) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < best) { best = d; target = p; }
  }
  if (!target) return;
  const cur = Math.atan2(b.vy, b.vx), want = Math.atan2(target.y - b.y, target.x - b.x);
  const diff = wrapAngle(want - cur), step = MISSILE_TURN * dt, ang = cur + clamp(diff, -step, step);
  b.vx = Math.cos(ang) * MISSILE_SPEED; b.vy = Math.sin(ang) * MISSILE_SPEED;
}

function moveBullet(b, dt) {
  b.x += b.vx * dt;
  let w = wallAt(b.x, b.y, BULLET_R);
  if (w) {
    b.x -= b.vx * dt;
    if (w.crate) { damageCrate(w, b.type === 'm' ? 3 : 1); b.dead = true; return; }
    b.vx = -b.vx; b.bounces++;
  }
  b.y += b.vy * dt;
  w = wallAt(b.x, b.y, BULLET_R);
  if (w) {
    b.y -= b.vy * dt;
    if (w.crate) { damageCrate(w, b.type === 'm' ? 3 : 1); b.dead = true; return; }
    b.vy = -b.vy; b.bounces++;
  }
}

function updateBullets(dt) {
  for (const b of bullets) {
    if (b.dead) continue;
    b.life -= dt; b.age += dt;
    if (b.type === 'm' && b.age > 0.2) steerMissile(b, dt);
    moveBullet(b, dt);
    if (b.dead) continue;
    if (b.bounces > b.maxB || b.life <= 0) { b.dead = true; events.push({ e: 'puff', x: r1(b.x), y: r1(b.y) }); continue; }
    const rr = TANK_R + BULLET_R + (b.type === 'm' ? 3 : 0);
    const owner = players.get(b.owner);
    for (const p of players.values()) {
      if (!p.alive || p.id === b.owner) continue;          // your own bullets never hurt you
      if (owner && !enemies(owner, p)) continue;           // teammates: bullets pass through
      const dx = p.x - b.x, dy = p.y - b.y;
      if (dx * dx + dy * dy < rr * rr) {
        b.dead = true;
        damage(p, b.dmg, owner, { kind: b.type === 'm' ? 'missile' : b.type === 'f' ? 'freeze' : 'bullet', bounced: b.bounces > 0 });
        break;
      }
    }
  }
  bullets = bullets.filter(b => !b.dead);
}

function updateMines(dt) {
  for (const m of mines) {
    m.arm -= dt; m.life -= dt;
    if (m.life <= 0) { m.dead = true; continue; }
    if (m.arm > 0) continue;
    const owner = players.get(m.owner);
    let trigger = false;
    for (const p of players.values()) {
      if (!p.alive || p.id === m.owner || (isTeams() && p.team === m.team)) continue;
      if (Math.hypot(p.x - m.x, p.y - m.y) < MINE_TRIGGER + TANK_R) { trigger = true; break; }
    }
    if (!trigger) continue;
    m.dead = true;
    events.push({ e: 'mineboom', x: r1(m.x), y: r1(m.y), c: m.c });
    for (const p of players.values()) {
      if (!p.alive || p.id === m.owner || (isTeams() && p.team === m.team)) continue;
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < MINE_BLAST + TANK_R) damage(p, MINE_DMG * (d < 40 ? 1 : 0.6), owner, { kind: 'mine' });
    }
  }
  mines = mines.filter(m => !m.dead);
}

function spawnPowerup() {
  for (let tries = 0; tries < 60; tries++) {
    const x = rand(T + 40, W - T - 40), y = rand(T + 40, H - T - 40);
    if (wallAt(x, y, 34) || (MAP.lava || []).some(r => inRect(x, y, { x: r.x - 20, y: r.y - 20, w: r.w + 40, h: r.h + 40 }))) continue;
    if ((MAP.portals || []).some(pr => Math.hypot(pr.a.x - x, pr.a.y - y) < 60 || Math.hypot(pr.b.x - x, pr.b.y - y) < 60)) continue;
    if (cfg.zone && Math.hypot(x - W / 2, y - H / 2) > zoneR - 40) continue;
    let ok = true;
    for (const p of players.values()) if (p.alive && Math.hypot(p.x - x, p.y - y) < 140) ok = false;
    for (const u of powerups) if (Math.hypot(u.x - x, u.y - y) < 120) ok = false;
    if (!ok) continue;
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    powerups.push({ id: nextId++, type, x, y });
    events.push({ e: 'pu', x: r1(x), y: r1(y), k: type });
    return;
  }
}

function updatePowerups(dt) {
  if (phase !== 'playing') return;
  powerupT -= dt;
  if (powerupT <= 0) { powerupT = POWERUP_EVERY; if (powerups.length < MAX_POWERUPS) spawnPowerup(); }
  for (const u of powerups) {
    for (const p of players.values()) {
      if (!p.alive || Math.hypot(p.x - u.x, p.y - u.y) > TANK_R + POWERUP_R) continue;
      clearSpecial(p);
      if (u.type === 'triple') p.tripleT = TRIPLE_TIME;
      else if (u.type === 'shield') p.shield = true;
      else if (u.type === 'homing') p.missiles = 2;
      else if (u.type === 'heal') p.hp = Math.min(p.maxHp, p.hp + HEAL_AMOUNT);
      else if (u.type === 'mine') p.mines = 3;
      else if (u.type === 'laser') p.lasers = 2;
      else if (u.type === 'ghost') p.ghostT = GHOST_TIME;
      else if (u.type === 'freeze') p.freezeShots = 3;
      p.pickups++;
      u.dead = true;
      events.push({ e: 'pick', i: p.id, x: r1(u.x), y: r1(u.y), k: u.type });
      break;
    }
  }
  powerups = powerups.filter(u => !u.dead);
}
// only one special ammo at a time (missiles / mines / laser / freeze)
function clearSpecial(p) { p.missiles = 0; p.mines = 0; p.lasers = 0; p.freezeShots = 0; }

function pickHillSpot() {
  for (let i = 0; i < 80; i++) {
    const x = rand(160, W - 160), y = rand(140, H - 140);
    if (wallAt(x, y, 55) || (MAP.lava || []).some(r => inRect(x, y, { x: r.x - 40, y: r.y - 40, w: r.w + 80, h: r.h + 80 }))) continue;
    if (hill && Math.hypot(hill.x - x, hill.y - y) < 300) continue;
    return { x, y };
  }
  return { x: W / 2, y: 120 };
}
function updateHill(dt) {
  if (cfg.mode !== 'koth' || phase !== 'playing') return;
  hillT -= dt;
  if (!hill || hillT <= 0) { hill = pickHillSpot(); hillT = HILL_MOVE; events.push({ e: 'hill', x: r1(hill.x), y: r1(hill.y) }); }
  const inside = [...players.values()].filter(p => p.alive && Math.hypot(p.x - hill.x, p.y - hill.y) < HILL_R);
  hill.owner = inside.length === 1 ? inside[0].id : inside.length > 1 ? -1 : 0;
  if (inside.length === 1) {
    const p = inside[0];
    p.hillAcc += dt;
    if (p.hillAcc >= 1) { p.hillAcc -= 1; p.hillPts++; }
  }
}

function updateZone() {
  if (!cfg.zone || phase !== 'playing') { zoneR = 9999; return; }
  const total = cfg.time, elapsed = total - matchT, r0 = Math.hypot(W / 2, H / 2) + 30;
  const start = cfg.mode === 'lms' ? total * 0.25 : Math.max(total * 0.4, total - 60);
  const f = clamp((elapsed - start) / Math.max(1, total - start), 0, 1);
  zoneR = r0 + (ZONE_MIN - r0) * f;
}

function updateLeader() {
  if (cfg.mode === 'lms' || phase !== 'playing') { leaderId = null; return; }
  let best = null, tie = false;
  for (const p of players.values()) {
    const s = score(p);
    if (!best || s > score(best)) { best = p; tie = false; } else if (s === score(best)) tie = true;
  }
  const newId = best && !tie && score(best) > 0 ? best.id : null;
  if (newId && newId !== leaderId) events.push({ e: 'leader', i: newId, n: best.name });
  leaderId = newId;
}

// ===== Match flow =====
function computeAwards() {
  const list = [...players.values()];
  const out = [];
  const add = (icon, title, p, val) => { if (p) out.push({ icon, title, n: p.name, c: p.color, val }); };
  const top = (fn, filter = () => true) => list.filter(filter).sort((a, b) => fn(b) - fn(a))[0];
  const acc = p => (p.shots ? p.hits / p.shots : 0);
  const sharp = top(acc, p => p.shots >= 8);
  if (sharp) add('🎯', 'Sharpshooter', sharp, `${Math.round(acc(sharp) * 100)}% accuracy`);
  const streak = top(p => p.bestStreak, p => p.bestStreak >= 2);
  if (streak) add('🔥', 'Hot Streak', streak, `${streak.bestStreak} kills in a row`);
  const dmg = top(p => p.dmgDealt, p => p.dmgDealt > 0);
  if (dmg) add('💥', 'Destroyer', dmg, `${Math.round(dmg.dmgDealt)} damage`);
  const surv = list.filter(p => p.kills > 0).sort((a, b) => a.deaths - b.deaths || b.kills - a.kills)[0];
  if (surv) add('🛡️', 'Survivor', surv, `only ${surv.deaths} deaths`);
  const coll = top(p => p.pickups, p => p.pickups >= 2);
  if (coll) add('🎁', 'Collector', coll, `${coll.pickups} power-ups`);
  const target = top(p => p.deaths, p => p.deaths >= 3);
  if (target) add('🎯', 'Target Practice', target, `destroyed ${target.deaths} times 😅`);
  return out.slice(0, 5);
}

function endMatch() {
  phase = 'over'; overT = ROUND_BREAK; bullets = []; mines = [];
  if (isTeams()) {
    draw = teamKills[0] === teamKills[1];
    winner = draw ? null : { team: teamKills[0] > teamKills[1] ? 0 : 1 };
  } else if (cfg.mode === 'lms') {
    const alive = [...players.values()].sort((a, b) => (b.out ? 0 : 1) - (a.out ? 0 : 1) || b.lives - a.lives || b.kills - a.kills);
    const top = alive[0], second = alive[1];
    draw = !top || (second && !second.out && !top.out && second.lives === top.lives && second.kills === top.kills);
    winner = draw ? null : { id: top.id, n: top.name, c: top.color };
  } else {
    const list = [...players.values()].sort((a, b) => score(b) - score(a) || b.kills - a.kills);
    const top = list[0], second = list[1];
    draw = !top || (second && score(second) === score(top) && second.kills === top.kills);
    winner = draw ? null : { id: top.id, n: top.name, c: top.color };
  }
  awards = computeAwards();
  for (const p of players.values()) {
    if (p.bot) continue;
    const won = !!winner && (winner.team !== undefined ? p.team === winner.team : winner.id === p.id);
    recordMatch(p, won);
  }
  events.push({ e: 'win', i: winner && winner.id, team: winner && winner.team, n: winner && winner.n, draw });
}

function goLobby() {
  phase = 'lobby'; bullets = []; powerups = []; mines = []; hill = null; zoneR = 9999;
  resetCrates();
  broadcastAll({ t: 'map', map: mapInfo() });
  for (const p of players.values()) { p.out = false; clearPowers(p); spawnPlayer(p); }
  events.push({ e: 'lobby' });
}

function resetStatsForMatch(p) {
  p.kills = 0; p.deaths = 0; p.bonus = 0; p.streak = 0; p.bestStreak = 0; p.multi = 0;
  p.shots = 0; p.hits = 0; p.dmgDealt = 0; p.pickups = 0; p.hillPts = 0; p.hillAcc = 0;
  p.lives = LMS_LIVES; p.out = false;
}

function startMatch() {
  if (cfg.map === 'random') {
    const choices = MAP_IDS.filter(id => id !== mapId);
    setMap(choices[Math.floor(Math.random() * choices.length)]);
  } else if (cfg.map !== mapId) setMap(cfg.map);
  else resetCrates();
  broadcastAll({ t: 'map', map: mapInfo() });
  phase = 'playing'; winner = null; draw = false; overT = 0; awards = [];
  matchT = cfg.time; teamKills = [0, 0]; matchId++;
  bullets = []; powerups = []; mines = []; powerupT = 3; hill = null; hillT = 0;
  reconnects.clear();
  for (const p of players.values()) { resetStatsForMatch(p); clearPowers(p); spawnPlayer(p); }
  lmsStarted = players.size;
  events.push({ e: 'round', map: MAP.name, mode: cfg.mode });
}

let now = 0; // seconds since server start (game clock)
function update(dt) {
  now += dt;
  if (humans().length === 0) {
    if (phase !== 'lobby') { phase = 'lobby'; bullets = []; powerups = []; mines = []; }
    for (const p of [...players.values()]) if (p.bot) players.delete(p.id); // no humans: bots leave
    return;
  }
  if (phase === 'over') { overT -= dt; if (overT <= 0) goLobby(); }
  else if (phase === 'playing') {
    matchT -= dt;
    if (matchT <= 0) { matchT = 0; endMatch(); }
    else if (cfg.mode === 'lms' && lmsStarted >= 2 && [...players.values()].filter(p => !p.out).length <= 1) endMatch();
  }
  updateZone();
  for (const p of players.values()) updatePlayer(p, dt);
  separateTanks();
  updateBullets(dt);
  updateMines(dt);
  updatePowerups(dt);
  updateHill(dt);
  updateLeader();
}

// ===== Teams =====
function teamCounts() {
  const c = [0, 0];
  for (const p of players.values()) c[p.team]++;
  return c;
}
function balanceTeams() {
  const list = [...players.values()].sort(() => Math.random() - 0.5);
  list.forEach((p, i) => { p.team = i % 2; });
  if (phase === 'lobby') for (const p of players.values()) spawnPlayer(p);
}

// ===== Addresses phones can use (best first) =====
function getAddresses() {
  const out = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      if (/vpn|virtual|vethernet|wsl|docker|tap/i.test(iface)) continue;
      let label = iface, rank = 3;
      if (a.address.startsWith('192.168.137.')) { label = 'Laptop hotspot'; rank = 0; }
      else if (/wi-?fi|wlan|wireless/i.test(iface)) { label = 'Wi-Fi'; rank = 1; }
      else if (/ethernet/i.test(iface)) { label = 'Router (Ethernet cable)'; rank = 2; }
      out.push({ url: `http://${a.address}:${PORT}`, label, rank });
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const PAGE_STYLE = `body{margin:0;min-height:100vh;font-family:system-ui,Segoe UI,sans-serif;color:#fff;text-align:center;
    background:radial-gradient(circle at 20% 10%,#4b3bb5 0,transparent 45%),radial-gradient(circle at 85% 95%,#b8336a 0,transparent 40%),#12142b;}
  h1{font-size:56px;margin:24px 0 4px;font-weight:900;letter-spacing:2px} h1 span{color:#ffd23f} a{color:#ffd23f}`;

// Big QR codes for the LAPTOP screen: friends scan them with their phone camera
async function qrPage() {
  const addrs = getAddresses();
  const cards = await Promise.all(addrs.map(async (a, i) => {
    const svg = await QRCode.toString(a.url, { type: 'svg', margin: 1, color: { dark: '#12142b', light: '#ffffff' } });
    return `<div class="card${i === 0 ? ' best' : ''}"><div class="qr">${svg}</div>
      <div class="lbl">${i === 0 ? '⭐ ' : ''}${a.label}</div><div class="url">${a.url}</div></div>`;
  }));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Tank Wars - Scan to join</title>
<meta http-equiv="refresh" content="15">
<style>${PAGE_STYLE}
  .sub{font-size:22px;opacity:.9;margin-bottom:20px}
  .row{display:flex;gap:28px;justify-content:center;flex-wrap:wrap;padding:0 20px}
  .card{background:rgba(20,22,55,.85);border:3px solid #3a3f7a;border-radius:24px;padding:18px;width:300px}
  .card.best{border-color:#ffd23f;width:380px}
  .qr{background:#fff;border-radius:14px;padding:10px} .qr svg{display:block;width:100%;height:auto}
  .lbl{font-size:22px;font-weight:900;margin-top:12px} .url{font-size:16px;opacity:.75;margin-top:4px;font-family:monospace}
  .steps{font-size:18px;opacity:.85;margin:24px auto;max-width:760px;line-height:1.7}
  .links a{display:inline-block;margin:6px 10px;padding:10px 18px;border-radius:12px;background:#3a2f8f;color:#fff;text-decoration:none;font-weight:800}
</style></head><body>
<h1>TANK<span>WARS</span></h1>
<div class="sub">📱 Point your phone camera at the code and tap the link</div>
<div class="row">${cards.join('') || '<div class="card">No network found. Turn on the laptop hotspot or connect to Wi-Fi.</div>'}</div>
<div class="steps">Your phone must be on the <b>same network</b> as this laptop (⭐ = best choice).<br>
Tip: on the phone, tap <b>Share → Add to Home Screen</b> to play fullscreen like an app.</div>
<div class="links"><a href="/">🎮 Play on this laptop</a><a href="/?tv=1">📺 TV view (watch the whole map)</a><a href="/board">🏆 Leaderboard</a></div>
</body></html>`;
}

function boardPage() {
  const all = Object.values(stats.players).sort((a, b) => b.wins - a.wins || b.kills - a.kills);
  const week = weeklyTop(10);
  const row = (p, i, cols) => `<tr><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td class="n">${esc(p.name)}</td>${cols.map(c => `<td>${p[c] || 0}</td>`).join('')}</tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Tank Wars - Leaderboard</title>
<meta http-equiv="refresh" content="20">
<style>${PAGE_STYLE}
  .wrap{display:flex;gap:30px;justify-content:center;flex-wrap:wrap;padding:10px 20px 40px}
  .box{background:rgba(20,22,55,.85);border:3px solid #3a3f7a;border-radius:20px;padding:16px 22px;min-width:380px}
  h2{color:#ffd23f;margin:4px 0 10px} table{width:100%;border-collapse:collapse;font-size:18px}
  td,th{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.08)} th{opacity:.6;font-size:13px;text-transform:uppercase}
  td.n{text-align:left;font-weight:800}
</style></head><body><h1>🏆 LEADER<span>BOARD</span></h1>
<div class="wrap">
 <div class="box"><h2>This week (${weekKey()})</h2><table><tr><th></th><th>Player</th><th>Wins</th><th>Kills</th><th>Matches</th></tr>
 ${week.map((p, i) => row(p, i, ['wins', 'kills', 'matches'])).join('') || '<tr><td colspan=5>No matches yet this week</td></tr>'}</table></div>
 <div class="box"><h2>All time</h2><table><tr><th></th><th>Player</th><th>Wins</th><th>Kills</th><th>Deaths</th><th>Best streak</th></tr>
 ${all.slice(0, 15).map((p, i) => row(p, i, ['wins', 'kills', 'deaths', 'bestStreak'])).join('') || '<tr><td colspan=6>No matches yet</td></tr>'}</table></div>
</div><a href="/qr">← Back</a></body></html>`;
}

// ===== Networking =====
const STATIC = { '/manifest.json': 'application/manifest+json', '/icon-180.png': 'image/png', '/icon-512.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  const [url, query] = req.url.split('?');
  const html = (body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(body); };
  try {
    if (url === '/join-qr.svg') {
      const host = String(req.headers.host || '').replace(/[^\w.:-]/g, '');
      const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'; // online links use https
      const svg = await QRCode.toString(`${proto}://${host}`, { type: 'svg', margin: 1 });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
      return res.end(svg);
    }
    if (url === '/qr') return html(await qrPage());
    if (url === '/board') return html(boardPage());
    if (url === '/stats') {
      const name = new URLSearchParams(query || '').get('name') || '';
      const s = statsFor(name);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify({ kills: s.kills, deaths: s.deaths, wins: s.wins, matches: s.matches, bestStreak: s.bestStreak, unlocks: UNLOCKS }));
    }
    if (STATIC[url]) {
      return fs.readFile(path.join(__dirname, 'public', url), (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': STATIC[url], 'Cache-Control': 'max-age=3600' });
        res.end(data);
      });
    }
    if (url === '/' || url === '/index.html') {
      return fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
        if (err) { res.writeHead(500); return res.end('Missing public/index.html'); }
        html(data);
      });
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) { res.writeHead(500); res.end('Error: ' + e.message); }
});

const wss = new WebSocketServer({ server, perMessageDeflate: false });

function send(ws, obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcastAll(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) if ((ws.pid || ws.spec) && ws.readyState === WebSocket.OPEN) ws.send(msg);
}
function lobbyInfo() {
  return { t: 'l', taken: [...players.values()].map(p => p.color), n: players.size, max: MAX_PLAYERS };
}
function broadcastLobby() {
  const msg = lobbyInfo();
  for (const ws of wss.clients) send(ws, msg);
}

// Character look: [gender, skin, hair style, hair color, hat, tank style]
const LOOK_LIMITS = [3, 5, 6, 6, 9, 6];
function cleanLook(l, name) {
  const keys = ['g', 'sk', 'hr', 'hc', 'hat', 'pt'];
  const o = l && typeof l === 'object' ? l : {};
  const look = keys.map((k, i) => (Number.isInteger(o[k]) && o[k] >= 0 && o[k] < LOOK_LIMITS[i] ? o[k] : 0));
  const st = statsFor(name);
  if (UNLOCKS.hat[look[4]] && !isUnlocked(st, UNLOCKS.hat[look[4]])) look[4] = 0;
  if (UNLOCKS.pt[look[5]] && !isUnlocked(st, UNLOCKS.pt[look[5]])) look[5] = 0;
  return look;
}

function makePlayer(name, color, look, cls) {
  const counts = teamCounts();
  const p = {
    id: nextId++, name, color, look, cls, team: counts[0] <= counts[1] ? 0 : 1,
    x: 0, y: 0, vx: 0, vy: 0, a: 0, ta: 0, aim: null, alive: false, respawnT: 0, hp: 100, maxHp: 100,
    spawnShield: 0, fireCd: 0, boostT: 0, boostCd: 0, boostQueued: false, padT: 0, padA: 0, tpCd: 0, frozenT: 0,
    inBush: false, lastFireAt: -9, lastKillAt: -9, emoteAt: -9, seq: 0,
    input: { x: 0, y: 0, fire: false },
    // bot brain
    botT: 0, noiseT: 0, aimNoise: 0, strafe: 1, stuckT: 0, unstickT: 0, unstickA: 0, lastPos: { x: 0, y: 0 }, wander: null,
  };
  clearPowers(p);
  resetStatsForMatch(p);
  return p;
}

function join(ws, m) {
  if (ws.pid) return;
  if (players.size >= MAX_PLAYERS) {
    // make room by removing a bot
    if ([...players.values()].some(p => p.bot)) removeBot(); else { send(ws, { t: 'full' }); return; }
  }
  const taken = new Set([...players.values()].map(p => p.color));
  let color = Number.isInteger(m.color) && m.color >= 0 && m.color < COLOR_COUNT ? m.color : 0;
  if (taken.has(color)) for (let c = 0; c < COLOR_COUNT; c++) if (!taken.has(c)) { color = c; break; }
  let name = String(m.name || '').replace(/[\u0000-\u001f]/g, '').replace(/🤖/g, '').trim().slice(0, 12);
  if (!name) name = 'Tank ' + (players.size + 1);
  const cls = Number.isInteger(m.cls) && m.cls >= 0 && m.cls < CLASSES.length ? m.cls : 0;
  const p = makePlayer(name, color, cleanLook(m.look, name), cls);
  const token = typeof m.token === 'string' ? m.token.slice(0, 40) : null;
  p.token = token;
  players.set(p.id, p);
  ws.pid = p.id;
  if (hostId === null || !players.has(hostId) || players.get(hostId).bot) hostId = p.id;
  // reconnecting during the same match? restore progress
  const saved = token && reconnects.get(token);
  if (saved && saved.matchId === matchId && phase !== 'lobby') {
    Object.assign(p, saved.data);
    reconnects.delete(token);
    events.push({ e: 'rejoin', n: name, c: p.color });
  } else events.push({ e: 'join', n: name, c: color });
  if (phase === 'playing' && cfg.mode === 'lms' && !saved) { p.lives = 1; } // late joiners get one life
  if (!p.out) spawnPlayer(p);
  sendWelcome(ws, p.id);
  broadcastLobby();
  console.log(`+ ${name} joined (${players.size}/${MAX_PLAYERS})`);
}

function sendWelcome(ws, id) {
  send(ws, {
    t: 'w', id, W, H, tankR: TANK_R, map: mapInfo(),
    phys: { T, TANK_R, TANK_SPEED, TURN_SPEED, ACCEL, ICE_ACCEL, BOOST_SPEED, BOOST_TIME, BOOST_CD },
    classes: CLASSES, times: TIME_CHOICES, modes: MODES, unlocks: UNLOCKS, maxPlayers: MAX_PLAYERS,
    maps: MAP_IDS.map(mid => ({ id: mid, name: MAPS[mid].name })),
  });
}

function handle(ws, m) {
  if (m.t === 'join') return join(ws, m);
  if (m.t === 'spec') { ws.spec = true; sendWelcome(ws, null); return; }
  const p = players.get(ws.pid);
  if (!p) return;
  if (m.t === 'i') {
    p.input.x = clamp(Number(m.x) || 0, -1, 1);
    p.input.y = clamp(Number(m.y) || 0, -1, 1);
    p.input.fire = !!m.f;
    const ax = Number(m.ax) || 0, ay = Number(m.ay) || 0;
    p.aim = ax || ay ? Math.atan2(ay, ax) : null;
    if (m.b) p.boostQueued = true;
    if (Number.isInteger(m.s)) p.seq = m.s;
    return;
  }
  if (m.t === 'emote') {
    if (now - p.emoteAt > 1 && Number.isInteger(m.v) && m.v >= 0 && m.v < 8) { p.emoteAt = now; events.push({ e: 'emote', i: p.id, v: m.v }); }
    return;
  }
  if (phase !== 'lobby') return;
  if (m.t === 'team' && (m.v === 0 || m.v === 1) && isTeams()) { p.team = m.v; spawnPlayer(p); return; }
  if (p.id !== hostId) return; // only the host changes match settings
  if (m.t === 'set') {
    if (m.k === 'time' && TIME_CHOICES.includes(m.v)) cfg.time = m.v;
    else if (m.k === 'mode' && MODES.includes(m.v)) {
      const wasTeams = isTeams();
      cfg.mode = m.v;
      if (m.v === 'teams' && !wasTeams) balanceTeams();
    } else if (m.k === 'map' && (m.v === 'random' || MAP_IDS.includes(m.v))) {
      cfg.map = m.v;
      if (m.v !== 'random' && m.v !== mapId) setMap(m.v);
    } else if (m.k === 'zone') cfg.zone = !!m.v;
  } else if (m.t === 'balance' && isTeams()) balanceTeams();
  else if (m.t === 'addbot') addBot();
  else if (m.t === 'rmbot') removeBot();
  else if (m.t === 'start') startMatch();
}

wss.on('connection', ws => {
  ws.pid = null; ws.spec = false;
  send(ws, lobbyInfo());
  ws.on('message', data => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (m && typeof m === 'object') handle(ws, m);
  });
  ws.on('close', () => {
    const p = players.get(ws.pid);
    if (!p) return;
    if (p.token && phase === 'playing') { // keep progress for 2 minutes in case they reconnect
      const keep = ['kills', 'deaths', 'bonus', 'team', 'streak', 'bestStreak', 'shots', 'hits', 'dmgDealt', 'pickups', 'hillPts', 'lives', 'out'];
      const data = {}; for (const k of keep) data[k] = p[k];
      reconnects.set(p.token, { matchId, data, at: Date.now() });
      setTimeout(() => { const r = reconnects.get(p.token); if (r && Date.now() - r.at >= 119000) reconnects.delete(p.token); }, 120000);
    }
    players.delete(p.id);
    bullets = bullets.filter(b => b.owner !== p.id);
    if (hostId === p.id) { const h = humans()[0]; hostId = h ? h.id : null; }
    events.push({ e: 'leave', n: p.name, c: p.color });
    broadcastLobby();
    console.log(`- ${p.name} left (${players.size}/${MAX_PLAYERS})`);
  });
});

function broadcastState() {
  const ps = [];
  for (const p of players.values()) {
    ps.push({
      i: p.id, n: p.name, c: p.color, lk: p.look, cl: p.cls, te: p.team, bot: p.bot ? 1 : 0,
      x: r1(p.x), y: r1(p.y), a: r2(p.a), ta: r2(p.ta),
      al: p.alive ? 1 : 0, k: p.kills, d: p.deaths, sc: score(p), hp: Math.max(0, Math.round(p.hp)), mh: p.maxHp,
      sh: p.shield ? 1 : 0, ss: p.spawnShield > 0 ? 1 : 0, tr: Math.ceil(p.tripleT), mi: p.missiles, mn: p.mines,
      lz: p.lasers, fz: p.freezeShots, gh: p.ghostT > 0 ? 1 : 0, bu: p.inBush && now - p.lastFireAt > 0.8 ? 1 : 0,
      fr: p.frozenT > 0 ? 1 : 0, bo: p.boostT > 0 || p.padT > 0 ? 1 : 0, bc: r2(p.boostCd / BOOST_CD),
      rt: r2(Math.max(0, p.respawnT)), sq: p.seq || 0, st: p.streak, lv: p.lives, out: p.out ? 1 : 0, hl: p.hillPts,
    });
  }
  broadcastAll({
    t: 's', now: Math.round(performance.now()), ph: phase, ot: r2(overT), w: winner, dr: draw ? 1 : 0, tm: Math.ceil(matchT),
    cfg, host: hostId, ts: teamKills, map: mapId, ldr: leaderId, p: ps,
    b: bullets.map(b => [b.id, r1(b.x), r1(b.y), b.c, b.type === 'm' ? 1 : b.type === 'f' ? 2 : 0, r2(Math.atan2(b.vy, b.vx))]),
    u: powerups.map(u => [u.id, u.type, r1(u.x), r1(u.y)]),
    mn: mines.map(m => [m.id, r1(m.x), r1(m.y), m.c, m.owner, m.team, m.arm <= 0 ? 1 : 0]),
    ch: crates.map(c => c.hp),
    zr: cfg.zone && phase === 'playing' ? Math.round(zoneR) : 0,
    hl: hill && phase === 'playing' && cfg.mode === 'koth' ? { x: r1(hill.x), y: r1(hill.y), r: HILL_R, o: hill.owner || 0, t: Math.ceil(hillT) } : null,
    aw: phase === 'over' ? awards : null,
    top: phase === 'lobby' ? weeklyTop(3) : null,
    ev: events,
  });
  events = [];
}

resetCrates();
let last = process.hrtime.bigint();
setInterval(() => {
  const t = process.hrtime.bigint();
  const dt = Math.min(Number(t - last) / 1e9, 0.05);
  last = t;
  update(dt);
  broadcastState(); // ~60 per second
}, 1000 / 60);

// If the port is taken by another app, try the next one
let portTries = 0;
wss.on('error', () => {});
server.on('error', err => {
  if (err.code === 'EADDRINUSE' && portTries < 20) {
    console.log(`  Port ${PORT} is busy (another app is using it), trying ${PORT + 1}...`);
    PORT++; portTries++;
    setTimeout(() => server.listen(PORT, '0.0.0.0'), 100);
  } else {
    console.error('  Could not start the server:', err.message);
    process.exit(1);
  }
});

server.listen(PORT, '0.0.0.0');
server.on('listening', async () => {
  console.log('\n  TANK WARS server is running!\n');
  const addrs = getAddresses();
  if (addrs.length) {
    console.log('  Scan this with your phone camera to join:\n');
    try { console.log(await QRCode.toString(addrs[0].url, { type: 'terminal', small: true })); } catch (e) {}
    console.log('  Or open one of these on the phone:\n');
    for (const a of addrs) console.log(`     ${a.url}    <- ${a.label}`);
  } else console.log('  No network found: turn on the laptop hotspot or connect to Wi-Fi.');
  const qrUrl = `http://localhost:${PORT}/qr`;
  console.log(`\n  Big QR code page (show it on the laptop screen):  ${qrUrl}`);
  console.log(`  TV view (whole map):  http://localhost:${PORT}/?tv=1`);
  console.log(`  Leaderboard:          http://localhost:${PORT}/board`);
  console.log(`  Play on this laptop:  http://localhost:${PORT}`);
  console.log('  Press Ctrl+C to stop.\n');
  if (!process.env.NO_OPEN && process.platform === 'win32') exec(`start "" "${qrUrl}"`);
});
