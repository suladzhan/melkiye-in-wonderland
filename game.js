// =============================================================
// Мелкие в мире чудес — мульти-персонажный 3D-раннер на Three.js
// Один файл логики, без сборки. Игроки: Мухаммад (Дубай-капибара),
// Аклима (стол-летун в конфетном мире), Аниса (рожок мороженого),
// Осман (мальчик на метле в небе у Хогвартса, собирает золотые слитки),
// Абдулла & Арслан (двое в красном Mercedes-кабриолете по Стамбулу,
// режим только-смена-полосы, собирают пачки денег).
// Каждый персонаж задаёт собственное небо, землю, скайлайн, модель,
// собираемый предмет и три типа препятствий.
// =============================================================

import * as THREE from 'three';

// ---------- Геймплейные константы (одинаковы для всех героев) ----------
const LANES = [-2.2, 0, 2.2];
const PLAYER_BASE_Y = 0.55;
const JUMP_HEIGHT = 2.0;
const JUMP_DURATION = 0.55;
const SLIDE_DURATION = 0.55;
const LANE_LERP = 12;
const START_SPEED = 14;
const MAX_SPEED = 32;
const SPEED_GROWTH = 0.25;
const SPAWN_AHEAD = 90;
const DESPAWN_BEHIND = 18;
const ROW_SPACING = 11;
const ORANGE_CHAIN_CHANCE = 0.25;

// ---------- Аудио (фоновая музыка + звук Game Over) ----------
const audio = {
  bg:       null,
  gameover: null,
  volume:   parseFloat(localStorage.getItem('mukashik_volume') ?? '0.6'),
  muted:    localStorage.getItem('mukashik_muted') === '1',
  shouldPlayBg: false,

  init() {
    this.bg = document.getElementById('bg-music');
    this.gameover = document.getElementById('sfx-gameover');
    this.bg.loop = true;
    this.bg.playsInline = true;
    this.bg.setAttribute('playsinline', '');
    this.applyVolume();
  },
  applyVolume() {
    if (this.bg) {
      if (this.muted) {
        this.bg.volume = 0;
        if (!this.bg.paused) this.bg.pause();
      } else {
        this.bg.volume = this.volume;
        if (this.shouldPlayBg && this.bg.paused) {
          const p = this.bg.play();
          if (p && p.catch) p.catch(() => {});
        }
      }
    }
    if (this.gameover) this.gameover.volume = this.muted ? 0 : Math.min(1, this.volume * 1.2);
  },
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('mukashik_volume', String(this.volume));
    if (this.volume > 0 && this.muted) {
      this.muted = false;
      localStorage.setItem('mukashik_muted', '0');
      const cb = document.getElementById('mute-checkbox');
      if (cb) cb.checked = false;
    }
    this.applyVolume();
  },
  setMuted(m) {
    this.muted = !!m;
    localStorage.setItem('mukashik_muted', m ? '1' : '0');
    this.applyVolume();
  },
  setSources(bgSrc, gameoverSrc) {
    if (!this.bg || !this.gameover) return;
    if (this.bg.getAttribute('src') !== bgSrc) {
      this.bg.src = bgSrc;
      this.bg.load();
    }
    // gameoverSrc может быть null/undefined — у героя нет звука поражения
    if (gameoverSrc) {
      if (this.gameover.getAttribute('src') !== gameoverSrc) {
        this.gameover.src = gameoverSrc;
        this.gameover.load();
      }
    } else {
      // Очищаем src, чтобы playGameover ничего не воспроизводил
      this.gameover.removeAttribute('src');
      this.gameover.load();
    }
    this.applyVolume();
  },
  startBg() {
    if (!this.bg) return;
    this.shouldPlayBg = true;
    if (this.muted) return;
    const p = this.bg.play();
    if (p && p.catch) p.catch(() => {});
  },
  stopBg() {
    this.shouldPlayBg = false;
    if (this.bg && !this.bg.paused) this.bg.pause();
  },
  pauseBg() {
    if (this.bg && !this.bg.paused) this.bg.pause();
  },
  resumeBg() {
    if (!this.bg || !this.shouldPlayBg || this.muted) return;
    if (this.bg.paused) {
      const p = this.bg.play();
      if (p && p.catch) p.catch(() => {});
    }
  },
  duckBg() {
    if (!this.bg || this.muted) return;
    this.bg.volume = this.volume * 0.25;
  },
  unduckBg() { this.applyVolume(); },
  playGameover() {
    if (!this.gameover) return;
    if (!this.gameover.getAttribute('src')) return; // у героя нет звука поражения
    this.gameover.currentTime = 0;
    const p = this.gameover.play();
    if (p && p.catch) p.catch(() => {});
  },
};

// ---------- Конфиг персонажей ----------
// Звук Game Over только у Мухаммеда; у остальных героев его нет —
// проигрывание тихо пропускается в audio.playGameover.
const CHARACTERS = {
  muhammad: {
    id: 'muhammad', name: 'Мухаммад',
    locked: false, bestKey: 'best_muhammad', theme: 'dubai',
    audio: {
      bg: 'Characters/Мухаммад/muhammad_main_sound.mp3',
      gameover: 'Characters/Мухаммад/muhammad_gameover_sound.mp3',
    },
    collect: { icon: '🍊' },
  },
  aklima: {
    id: 'aklima', name: 'Аклима',
    locked: false, bestKey: 'best_aklima', theme: 'candy', vehicle: 'table',
    audio: {
      bg: 'Characters/Аклима/aklima_main_sound.mp3',
    },
    collect: { icon: '🍉' },
  },
  anisa: {
    id: 'anisa', name: 'Аниса',
    locked: false, bestKey: 'best_anisa', theme: 'candy', vehicle: 'cone',
    audio: {
      bg: 'Characters/Аниса/anisa_main_sound.mp3',
    },
    collect: { icon: '🍦' },
  },
  osman: {
    id: 'osman', name: 'Осман',
    locked: false, bestKey: 'best_osman', theme: 'hogwarts',
    audio: {
      bg: 'Characters/Осман/osman_main_sound.mp3',
    },
    collect: { icon: '🪙' },
  },
  arslan_abdulla: {
    id: 'arslan_abdulla', name: 'Абдулла и Арслан',
    locked: false, bestKey: 'best_arslan_abdulla', theme: 'istanbul',
    mode: 'lanes-only',
    audio: {
      bg: 'Characters/Абдулла и Арслан/Abdulla&Arslan_mainsound.mp3',
    },
    collect: { icon: '💵' },
  },
};
const CHARACTER_ORDER = ['muhammad', 'aklima', 'anisa', 'osman', 'arslan_abdulla'];

// ---------- Глобальное состояние ----------
let scene, camera, renderer, clock;
let player;
let playerLane = 1;
let playerTargetX = LANES[1];
let isJumping = false, jumpTime = 0;
let isSliding = false, slideTime = 0;
let speed = START_SPEED;
let distance = 0;
let oranges = 0;          // имя историческое — теперь общий счётчик «собранного»
let bestScore = 0;
let gameState = 'menu';   // 'menu' | 'character-select' | 'playing' | 'paused' | 'gameover'
let currentCharacter = null;

const activeObstacles = [];
const activeOranges = [];
const sideBuildings = [];
const particles = [];
let farthestRowZ = 0;
let farthestBuildingZ = 0;
let groundTexture = null;

// Шаблоны под текущего персонажа — пересоздаются в applyCharacter
const templates = {
  player: null,
  collect: null,
  obstacleLow: null,    // прыжок (cone / шоколадный пик)
  obstacleMid: null,    // подкат или прыжок (барьер)
  obstacleWide: null,   // менять полосу (машина / тортик)
  side: [],             // массив фабрик окружения по бокам (ф-ции, возвращающие Group)
};

// Ссылки на тематические объекты сцены (чтобы удалять при смене героя)
const themeRefs = {
  sky: null,
  groundMeshes: [],
  skylineGroup: null,
  lights: [],
  shadow: null,
};

// ---------- Старт ----------
init();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a0e22); // нейтральный фон до выбора героя

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 260);
  camera.position.set(0, 4.2, 6.6);
  camera.lookAt(0, 1.0, -5);

  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('game-canvas'),
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  migrateLegacyBest();

  audio.init();
  setupInput();
  setupUI();
  setupSettings();
  setupPause();
  setupVisibility();
  buildCharacterGrid();

  // Лучший балл на стартовом — максимум по всем разблокированным героям
  document.getElementById('best-score-start').textContent = maxBestScore();

  clock = new THREE.Clock();
  window.addEventListener('resize', onResize);

  animate();
}

// Перенос старого ключа лучшего счёта Мухаммеда на новую схему
function migrateLegacyBest() {
  const legacy = localStorage.getItem('mukashik_best');
  if (legacy && !localStorage.getItem('best_muhammad')) {
    localStorage.setItem('best_muhammad', legacy);
  }
}
function maxBestScore() {
  let max = 0;
  for (const c of Object.values(CHARACTERS)) {
    if (!c.bestKey) continue;
    const v = parseInt(localStorage.getItem(c.bestKey) || '0', 10);
    if (v > max) max = v;
  }
  return max;
}

// =============================================================
// Применение персонажа: пересобирает сцену под выбранного героя
// =============================================================
function applyCharacter(char) {
  // Очищаем предыдущую тему
  removeThemeFromScene();
  clearActiveSpawns();
  if (player) { scene.remove(player); player = null; }

  currentCharacter = char;
  bestScore = parseInt(localStorage.getItem(char.bestKey) || '0', 10);
  document.getElementById('hud-collect-icon').textContent = char.collect.icon;
  document.getElementById('best-score-start').textContent = maxBestScore();

  // Свет/небо/туман — зависят от темы
  buildLights(char);
  themeRefs.sky = buildSky(char);
  if (char.theme === 'dubai') {
    scene.background = new THREE.Color(0xf6c98e);
    scene.fog = new THREE.Fog(0xf2c98c, 45, 130);
  } else if (char.theme === 'hogwarts') {
    scene.background = new THREE.Color(0x2c3360);
    scene.fog = new THREE.Fog(0x3a4078, 60, 150);
  } else if (char.theme === 'istanbul') {
    scene.background = new THREE.Color(0xb8d8f0);
    scene.fog = new THREE.Fog(0xcce0ee, 55, 145);
  } else {
    scene.background = new THREE.Color(0xffd0e8);
    scene.fog = new THREE.Fog(0xfddbe9, 50, 140);
  }

  // Земля + скайлайн
  if (char.theme === 'dubai') {
    themeRefs.groundMeshes = buildHighway();
    themeRefs.skylineGroup = buildDubaiSkyline();
  } else if (char.theme === 'hogwarts') {
    themeRefs.groundMeshes = buildHogwartsPath();
    themeRefs.skylineGroup = buildHogwartsSkyline();
  } else if (char.theme === 'istanbul') {
    themeRefs.groundMeshes = buildIstanbulHighway();
    themeRefs.skylineGroup = buildIstanbulSkyline();
  } else {
    themeRefs.groundMeshes = buildCandyPath();
    themeRefs.skylineGroup = buildCandySkyline();
  }
  scene.add(themeRefs.skylineGroup);

  // Шаблоны спавнов под выбранного героя
  buildTemplatesForCharacter(char);

  // Игрок и его тень
  buildPlayer(char);

  // Музыка и звук поражения
  audio.setSources(char.audio.bg, char.audio.gameover);

  localStorage.setItem('mukashik_last_char', char.id);
}

function removeThemeFromScene() {
  if (themeRefs.sky) { scene.remove(themeRefs.sky); themeRefs.sky = null; }
  for (const m of themeRefs.groundMeshes) scene.remove(m);
  themeRefs.groundMeshes.length = 0;
  if (themeRefs.skylineGroup) { scene.remove(themeRefs.skylineGroup); themeRefs.skylineGroup = null; }
  for (const l of themeRefs.lights) scene.remove(l);
  themeRefs.lights.length = 0;
  if (themeRefs.shadow) { scene.remove(themeRefs.shadow); themeRefs.shadow = null; }
  groundTexture = null;
}
function clearActiveSpawns() {
  for (const o of activeObstacles) scene.remove(o.mesh);
  for (const o of activeOranges) scene.remove(o.mesh);
  for (const b of sideBuildings) scene.remove(b.mesh);
  for (const p of particles) { scene.remove(p.mesh); p.mesh.material.dispose?.(); }
  activeObstacles.length = 0;
  activeOranges.length = 0;
  sideBuildings.length = 0;
  particles.length = 0;
}

// =============================================================
// Свет — отдельный под каждую тему
// =============================================================
function buildLights(char) {
  if (char.theme === 'dubai') {
    const sun = new THREE.DirectionalLight(0xffd6a0, 1.4);
    sun.position.set(-15, 8, -25);
    scene.add(sun); themeRefs.lights.push(sun);
    const hemi = new THREE.HemisphereLight(0xffd9b3, 0xc9a070, 0.85);
    scene.add(hemi); themeRefs.lights.push(hemi);
    const rim = new THREE.DirectionalLight(0xff8c4a, 0.55);
    rim.position.set(10, 5, 10);
    scene.add(rim); themeRefs.lights.push(rim);
  } else if (char.theme === 'hogwarts') {
    // Хогвартс: яркий лунный свет сверху + тёплый «оконный» контр от замка.
    // Сцена сумеречная, но достаточно светлая для комфортной игры.
    const moon = new THREE.DirectionalLight(0xc8d2ff, 1.45);
    moon.position.set(12, 22, -10);
    scene.add(moon); themeRefs.lights.push(moon);
    const hemi = new THREE.HemisphereLight(0x7a86b0, 0x3a3858, 1.05);
    scene.add(hemi); themeRefs.lights.push(hemi);
    const windowRim = new THREE.DirectionalLight(0xffc080, 0.6);
    windowRim.position.set(-8, 4, -15);
    scene.add(windowRim); themeRefs.lights.push(windowRim);
  } else if (char.theme === 'istanbul') {
    // Стамбул: ясный солнечный день у Босфора. Тёплый sun сверху,
    // прохладный hemi от моря, прохладный «отражённый» rim от стекла зданий.
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
    sun.position.set(-10, 18, -8);
    scene.add(sun); themeRefs.lights.push(sun);
    const hemi = new THREE.HemisphereLight(0xb8d8f0, 0x9ab098, 1.0);
    scene.add(hemi); themeRefs.lights.push(hemi);
    const seaRim = new THREE.DirectionalLight(0x9ac0e8, 0.5);
    seaRim.position.set(10, 4, 6);
    scene.add(seaRim); themeRefs.lights.push(seaRim);
  } else {
    // Конфетный мир: мягкий розовый свет, бирюзовый «контр» от облаков
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(-10, 12, -20);
    scene.add(sun); themeRefs.lights.push(sun);
    const hemi = new THREE.HemisphereLight(0xffd9ec, 0xfff0e4, 1.05);
    scene.add(hemi); themeRefs.lights.push(hemi);
    const rim = new THREE.DirectionalLight(0xffb0d0, 0.6);
    rim.position.set(12, 6, 12);
    scene.add(rim); themeRefs.lights.push(rim);
  }
}

// =============================================================
// Небо — sphere shader gradient, цвета зависят от темы
// =============================================================
function buildSky(char) {
  const skyGeo = new THREE.SphereGeometry(150, 24, 16);
  const colors = char.theme === 'dubai'
    ? { top: 0x6fb6ff, mid: 0xffb265, bottom: 0xffe0a0 }
    : char.theme === 'hogwarts'
    ? { top: 0x1a2658, mid: 0x4a3e80, bottom: 0x7a6ab0 }
    : char.theme === 'istanbul'
    ? { top: 0x3a82be, mid: 0x8ec0e0, bottom: 0xe6f0f6 }
    : { top: 0xfde0eb, mid: 0xffc8d8, bottom: 0xfff5f1 };
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top:    { value: new THREE.Color(colors.top) },
      mid:    { value: new THREE.Color(colors.mid) },
      bottom: { value: new THREE.Color(colors.bottom) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
      void main(){
        float h = normalize(vWorldPos).y;
        vec3 col = h > 0.0
          ? mix(mid, top, smoothstep(0.0, 0.6, h))
          : mix(mid, bottom, smoothstep(0.0, 0.4, -h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(mesh);
  return mesh;
}

// =============================================================
// Шоссе на 3 полосы (Дубай) — асфальт + разметка
// =============================================================
function buildHighway() {
  const refs = [];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 1024;
  const g = c.getContext('2d');

  g.fillStyle = '#2c2e30'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height;
    const r = 0.5 + Math.random() * 1.5, v = Math.random();
    g.fillStyle = v < 0.4 ? 'rgba(60,60,62,0.6)'
              : v < 0.75 ? 'rgba(85,87,90,0.45)'
                         : 'rgba(115,118,120,0.35)';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 25; i++) {
    g.fillStyle = `rgba(15,15,18,${0.10 + Math.random() * 0.18})`;
    g.beginPath();
    g.ellipse(Math.random() * c.width, Math.random() * c.height,
      8 + Math.random() * 28, 3 + Math.random() * 12,
      Math.random() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  drawRoadLines(g, c.width, c.height, '#f1ead6');

  groundTexture = new THREE.CanvasTexture(c);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.wrapS = THREE.ClampToEdgeWrapping;
  groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(1, 50);
  groundTexture.anisotropy = 8;

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 400),
    new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.9, color: 0xffffff }),
  );
  road.rotation.x = -Math.PI / 2;
  scene.add(road); refs.push(road);

  // Бетонные обочины
  const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x8e8a80, roughness: 0.95 });
  for (const sx of [-4.5, 4.5]) {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 400), shoulderMat);
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(sx, -0.005, 0);
    scene.add(sh); refs.push(sh);
  }

  // Песок/пустыня вокруг
  const sand = makeDuneMesh();
  scene.add(sand); refs.push(sand);
  return refs;
}

function drawRoadLines(g, w, h, color) {
  const PX_X = w / 8, PX_Y = h / 8;
  const LINE_W = Math.max(2, 0.18 * PX_X);
  g.fillStyle = color;
  for (const ex of [-3.7, 3.7]) {
    const px = (ex + 4) * PX_X;
    g.fillRect(px - LINE_W / 2, 0, LINE_W, h);
  }
  const DASH = 2 * PX_Y, GAP = 2 * PX_Y;
  for (const lx of [-1.1, 1.1]) {
    const px = (lx + 4) * PX_X;
    for (let y = 0; y < h; y += DASH + GAP) g.fillRect(px - LINE_W / 2, y, LINE_W, DASH);
  }
}

function makeDuneMesh() {
  const sandCanvas = document.createElement('canvas');
  sandCanvas.width = 512; sandCanvas.height = 512;
  const sg = sandCanvas.getContext('2d');
  sg.fillStyle = '#d9b072'; sg.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 1 + Math.random() * 3;
    const v = Math.random();
    sg.fillStyle = v < 0.33 ? 'rgba(180,140,90,0.45)'
              : v < 0.66 ? 'rgba(238,205,150,0.4)'
                         : 'rgba(120,90,60,0.25)';
    sg.beginPath(); sg.arc(x, y, r, 0, Math.PI * 2); sg.fill();
  }
  const sandTex = new THREE.CanvasTexture(sandCanvas);
  sandTex.colorSpace = THREE.SRGBColorSpace;
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
  sandTex.repeat.set(8, 40); sandTex.anisotropy = 4;
  const dunes = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 400),
    new THREE.MeshStandardMaterial({ map: sandTex, color: 0xc99a5e, roughness: 1.0 }),
  );
  dunes.rotation.x = -Math.PI / 2;
  dunes.position.y = -0.04;
  return dunes;
}

// =============================================================
// Конфетная дорожка (Аклима/Аниса) — розовый путь + сахарная разметка
// =============================================================
function buildCandyPath() {
  const refs = [];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 1024;
  const g = c.getContext('2d');

  // Розовая база с лёгким кремовым переливом
  const grad = g.createLinearGradient(0, 0, c.width, 0);
  grad.addColorStop(0, '#ffb5d0');
  grad.addColorStop(0.5, '#ffc8d8');
  grad.addColorStop(1, '#ffb5d0');
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);

  // Сахарная зернистость (мелкие светлые точки)
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height;
    const r = 0.5 + Math.random() * 1.4;
    g.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.35})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Мелкие конфетные присыпки случайных цветов (как на торте)
  const sprinkleColors = ['#ff7aa9', '#ff6464', '#a4eaff', '#fff4a4', '#c4a4ff'];
  for (let i = 0; i < 90; i++) {
    g.fillStyle = sprinkleColors[Math.floor(Math.random() * sprinkleColors.length)];
    g.save();
    g.translate(Math.random() * c.width, Math.random() * c.height);
    g.rotate(Math.random() * Math.PI);
    g.fillRect(-3, -0.7, 6, 1.4);
    g.restore();
  }
  drawRoadLines(g, c.width, c.height, '#ffffff');

  groundTexture = new THREE.CanvasTexture(c);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.wrapS = THREE.ClampToEdgeWrapping;
  groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(1, 50);
  groundTexture.anisotropy = 8;

  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 400),
    new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.85, color: 0xffffff }),
  );
  path.rotation.x = -Math.PI / 2;
  scene.add(path); refs.push(path);

  // Молочные обочины-крем
  const cream = new THREE.MeshStandardMaterial({ color: 0xfff0f4, roughness: 0.9 });
  for (const sx of [-4.5, 4.5]) {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 400), cream);
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(sx, -0.005, 0);
    scene.add(sh); refs.push(sh);
  }

  // Пухлая «ватная» земля вокруг — большой розовый «зефирный» план
  const fluffy = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 400),
    new THREE.MeshStandardMaterial({ color: 0xffc7da, roughness: 1.0 }),
  );
  fluffy.rotation.x = -Math.PI / 2;
  fluffy.position.y = -0.04;
  scene.add(fluffy); refs.push(fluffy);

  return refs;
}

// =============================================================
// Магическая облачная дорожка (Осман / Хогвартс) — Осман летит ПО НЕБУ,
// под ним — мягкая периwinкл-облачная подложка с белыми бликами
// и тёплой золотисто-голубой руной-разметкой полос
// =============================================================
function buildHogwartsPath() {
  const refs = [];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 1024;
  const g = c.getContext('2d');

  // Светлая лилово-голубая облачная база с яркой центральной полосой
  const grad = g.createLinearGradient(0, 0, c.width, 0);
  grad.addColorStop(0,   '#6e72a8');   // мягкие края
  grad.addColorStop(0.2, '#9498c4');
  grad.addColorStop(0.5, '#bcc0e0');   // светящийся центр пути
  grad.addColorStop(0.8, '#9498c4');
  grad.addColorStop(1,   '#6e72a8');
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);

  // Пухлые облачные клочки — мягкие белые радиальные градиенты
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height;
    const r = 25 + Math.random() * 55;
    const cg = g.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(0, `rgba(255,255,255,${0.14 + Math.random() * 0.18})`);
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Сияющие звёздочки-блики
  for (let i = 0; i < 220; i++) {
    g.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.5})`;
    g.beginPath();
    g.arc(Math.random() * c.width, Math.random() * c.height,
      0.5 + Math.random() * 0.9, 0, Math.PI * 2);
    g.fill();
  }
  // Разметка полос на небесной дорожке намеренно отсутствует —
  // под Османа это «открытое небо», без линий.

  groundTexture = new THREE.CanvasTexture(c);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.wrapS = THREE.ClampToEdgeWrapping;
  groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(1, 50);
  groundTexture.anisotropy = 8;

  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 400),
    new THREE.MeshStandardMaterial({
      map: groundTexture, roughness: 0.75, color: 0xffffff,
      emissive: 0x5862a8, emissiveIntensity: 0.28,
    }));
  path.rotation.x = -Math.PI / 2;
  scene.add(path); refs.push(path);

  // Облачные «обочины» — чуть бледнее основной полосы
  const cloudEdge = new THREE.MeshStandardMaterial({
    color: 0xa8acd0, roughness: 0.95,
    emissive: 0x4a5290, emissiveIntensity: 0.15 });
  for (const sx of [-4.5, 4.5]) {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 400), cloudEdge);
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(sx, -0.005, 0);
    scene.add(sh); refs.push(sh);
  }

  // Дальняя ватная «бездна» вокруг — гораздо светлее, чтоб не было «дыры» в чёрное
  const mist = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 400),
    new THREE.MeshStandardMaterial({ color: 0x3a4078, roughness: 1.0 }));
  mist.rotation.x = -Math.PI / 2;
  mist.position.y = -0.04;
  scene.add(mist); refs.push(mist);

  return refs;
}

// =============================================================
// Шоссе по набережной Стамбула (Абдулла и Арслан) —
// современный асфальт с пунктирной разметкой, бетонные обочины,
// слева — синяя гладь Босфора, справа — зелёная парковая полоса
// =============================================================
function buildIstanbulHighway() {
  const refs = [];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 1024;
  const g = c.getContext('2d');

  // Свежий тёмно-серый асфальт чуть светлее дубайского
  g.fillStyle = '#3a3e46'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 5500; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height;
    const r = 0.5 + Math.random() * 1.4, v = Math.random();
    g.fillStyle = v < 0.4 ? 'rgba(70,72,78,0.55)'
              : v < 0.75 ? 'rgba(95,100,108,0.42)'
                         : 'rgba(130,134,140,0.3)';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Лёгкие масляные пятна / следы шин
  for (let i = 0; i < 18; i++) {
    g.fillStyle = `rgba(15,15,18,${0.10 + Math.random() * 0.16})`;
    g.beginPath();
    g.ellipse(Math.random() * c.width, Math.random() * c.height,
      6 + Math.random() * 22, 2 + Math.random() * 8,
      Math.random() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  drawRoadLines(g, c.width, c.height, '#f4f6fa');

  groundTexture = new THREE.CanvasTexture(c);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.wrapS = THREE.ClampToEdgeWrapping;
  groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(1, 50);
  groundTexture.anisotropy = 8;

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 400),
    new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.85, color: 0xffffff }));
  road.rotation.x = -Math.PI / 2;
  scene.add(road); refs.push(road);

  // Бетонные обочины-бордюр
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xc0c4cc, roughness: 0.85 });
  for (const sx of [-4.5, 4.5]) {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 400), curbMat);
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(sx, -0.005, 0);
    scene.add(sh); refs.push(sh);
  }

  // Слева (sx = -1) — синяя гладь Босфора с мягким переливом
  const seaMat = new THREE.MeshStandardMaterial({
    color: 0x3a86b8, roughness: 0.5, metalness: 0.1,
    emissive: 0x1a4a6a, emissiveIntensity: 0.15 });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(80, 400), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-45, -0.06, 0);
  scene.add(sea); refs.push(sea);
  // Светлая «пенная» полоса вдоль набережной
  const foam = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 400),
    new THREE.MeshStandardMaterial({ color: 0xd8e8f4, roughness: 0.7 }));
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(-5.45, -0.02, 0);
  scene.add(foam); refs.push(foam);

  // Справа (sx = +1) — зелёная парковая лужайка
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x6a9658, roughness: 1.0 });
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(80, 400), grassMat);
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(45, -0.06, 0);
  scene.add(grass); refs.push(grass);
  // Бордюрная плитка между обочиной и газоном
  const tile = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 400),
    new THREE.MeshStandardMaterial({ color: 0xd4d8de, roughness: 0.85 }));
  tile.rotation.x = -Math.PI / 2;
  tile.position.set(5.6, -0.02, 0);
  scene.add(tile); refs.push(tile);

  return refs;
}

// =============================================================
// Скайлайн: Дубай (по силуэтам известных башен)
// =============================================================
function buildDubaiSkyline() {
  const skyline = new THREE.Group();
  skyline.position.set(0, 0, -110);

  const glassMat = (color, metalness = 0.55, roughness = 0.35) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness });

  // Бурдж-Халифа (ярусная)
  const burj = new THREE.Group();
  const burjMat = glassMat(0xb8d4e6, 0.7, 0.25);
  const tiers = [
    [10, 6, 3],   [8.5, 7, 9.5],  [7, 7, 16.5],
    [5.7, 7, 23], [4.6, 7, 29.5], [3.6, 7, 36],
    [2.8, 6, 42], [2.1, 5, 47.5], [1.5, 4, 52.5],
    [1.0, 3, 56.5],
  ];
  for (const [w, h, y] of tiers) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), burjMat);
    tier.position.y = y; tier.rotation.y = (y / 60) * 0.2;
    burj.add(tier);
  }
  const spire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.45, 14, 8), glassMat(0xe8eef5, 0.8, 0.2));
  spire.position.y = 67; burj.add(spire);
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.05, 3, 6), glassMat(0xffffff, 0.3, 0.1));
  tip.position.y = 75.5; burj.add(tip);
  burj.position.set(-8, 0, 0); skyline.add(burj);

  // Бурдж-аль-Араб (парус)
  const sailGroup = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.8, 28, 1.6), glassMat(0xfaf6ee, 0.3, 0.4));
  mast.position.y = 14; sailGroup.add(mast);
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0);
  sailShape.bezierCurveTo(8, 6, 9, 18, 0, 28);
  sailShape.lineTo(0, 0);
  const sail = new THREE.Mesh(
    new THREE.ExtrudeGeometry(sailShape, { depth: 0.4, bevelEnabled: false }),
    glassMat(0xeaf2fa, 0.4, 0.3));
  sail.position.set(0.4, 0, -0.2); sailGroup.add(sail);
  sailGroup.position.set(38, 0, -8); sailGroup.scale.setScalar(0.85);
  skyline.add(sailGroup);

  // Музей будущего
  const museum = new THREE.Group();
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(4.5, 1.6, 16, 32), glassMat(0xc8b88a, 0.7, 0.35));
  torus.rotation.x = Math.PI / 2; torus.scale.set(1, 1.4, 1); torus.position.y = 7;
  museum.add(torus);
  const ped = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 3.2, 2.5, 16), glassMat(0x7a6a4a, 0.2, 0.7));
  ped.position.y = 1.2; museum.add(ped);
  museum.position.set(20, 0, -6); museum.scale.setScalar(0.8);
  skyline.add(museum);

  // Cayan Tower
  const cayan = new THREE.Group();
  const cayanMat = glassMat(0xd5e0ee, 0.55, 0.3);
  for (let i = 0; i < 18; i++) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 2.2), cayanMat);
    slab.position.y = i * 1.4 + 0.75; slab.rotation.y = (i / 18) * (Math.PI / 2);
    cayan.add(slab);
  }
  cayan.position.set(-22, 0, -2); skyline.add(cayan);

  // Кластер высоток
  for (let i = 0; i < 12; i++) {
    const w = 1.6 + Math.random() * 1.5, h = 10 + Math.random() * 16;
    const t = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w),
      glassMat(new THREE.Color().setHSL(0.55 + Math.random() * 0.1, 0.18, 0.55 + Math.random() * 0.18), 0.5, 0.35));
    t.position.set(-50 + i * 3.2 + Math.random() * 1.5, h / 2, 6 + Math.random() * 4);
    skyline.add(t);
  }
  for (let i = 0; i < 10; i++) {
    const w = 1.4 + Math.random() * 1.3, h = 9 + Math.random() * 14;
    const t = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w),
      glassMat(new THREE.Color().setHSL(0.08 + Math.random() * 0.05, 0.25, 0.6 + Math.random() * 0.15), 0.3, 0.5));
    t.position.set(8 + i * 3 + Math.random() * 1.5, h / 2, 7 + Math.random() * 4);
    skyline.add(t);
  }
  for (let i = 0; i < 18; i++) {
    const w = 1 + Math.random() * 2, h = 5 + Math.random() * 16;
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, w),
      new THREE.MeshBasicMaterial({ color: 0xa78a64 }));
    t.position.set(-60 + i * 7 + Math.random() * 4, h / 2, -10);
    skyline.add(t);
  }
  return skyline;
}

// =============================================================
// Скайлайн: конфетный мир — пряничные домики, леденцы, облака
// =============================================================
function buildCandySkyline() {
  const skyline = new THREE.Group();
  skyline.position.set(0, 0, -100);

  const houseRoofMats = [0xff6a8a, 0xff89a6, 0xc24a78, 0xff9b8a];
  const houseWallMats = [0xffd6c3, 0xffcab8, 0xffe2cf, 0xfdb89e];

  // Пряничные домики
  for (let i = 0; i < 14; i++) {
    const house = new THREE.Group();
    const w = 4 + Math.random() * 3.5, d = 4 + Math.random() * 3.5, h = 4 + Math.random() * 3;
    const wallC = houseWallMats[Math.floor(Math.random() * houseWallMats.length)];
    const roofC = houseRoofMats[Math.floor(Math.random() * houseRoofMats.length)];
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: wallC, roughness: 0.9 }));
    walls.position.y = h / 2; house.add(walls);
    // Крыша — наклонная призма
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(w, d) * 0.7, 2.5, 4),
      new THREE.MeshStandardMaterial({ color: roofC, roughness: 0.8 }));
    roof.position.y = h + 1.25; roof.rotation.y = Math.PI / 4;
    house.add(roof);
    // Окно (карамельное)
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.35, h * 0.3, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xffd86b, emissive: 0xffaa44, emissiveIntensity: 0.3 }));
    win.position.set(0, h * 0.55, d / 2 + 0.03); house.add(win);
    house.position.set(-44 + i * 6.5 + (Math.random() - 0.5) * 2, 0, 1 + Math.random() * 6);
    house.rotation.y = (Math.random() - 0.5) * 0.6;
    skyline.add(house);
  }

  // Гигантские леденцы
  for (let i = 0; i < 6; i++) {
    const lolly = new THREE.Group();
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 11, 10),
      new THREE.MeshStandardMaterial({ color: 0xfff5e0, roughness: 0.5 }));
    stick.position.y = 5.5; lolly.add(stick);
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.4, 0.3, 24),
      new THREE.MeshStandardMaterial({ color: 0xff6aa6, roughness: 0.4 }));
    disc.rotation.x = Math.PI / 2; disc.position.y = 11.5;
    lolly.add(disc);
    // Спираль на леденце — белый кольцевой контраст
    const spiral = new THREE.Mesh(
      new THREE.TorusGeometry(1.4, 0.35, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    spiral.position.y = 11.6; spiral.rotation.x = Math.PI / 2;
    lolly.add(spiral);
    lolly.position.set(-30 + i * 12 + (Math.random() - 0.5) * 4, 0, -4 + Math.random() * 6);
    skyline.add(lolly);
  }

  // Розовые «зефирные» холмы вдалеке
  for (let i = 0; i < 12; i++) {
    const r = 4 + Math.random() * 6;
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffc4dc, roughness: 1 }));
    hill.position.set(-60 + i * 11 + (Math.random() - 0.5) * 3, 0, -8 - Math.random() * 4);
    skyline.add(hill);
  }

  // Пушистые облака (сферы с лёгким параллаксом)
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.95 });
    for (let j = 0; j < 5; j++) {
      const r = 1.2 + Math.random() * 1.3;
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
      s.position.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.5);
      cloud.add(s);
    }
    cloud.position.set(-50 + i * 8 + (Math.random() - 0.5) * 4, 9 + Math.random() * 8, 4 + Math.random() * 6);
    cloud.scale.setScalar(0.7 + Math.random() * 0.5);
    skyline.add(cloud);
  }

  return skyline;
}

// =============================================================
// Скайлайн: Хогвартс (Осман) — замок с башнями, луна, звёзды, лес
// =============================================================
function buildHogwartsSkyline() {
  const skyline = new THREE.Group();
  skyline.position.set(0, 0, -110);

  // Большая луна с гало
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(7, 24, 18),
    new THREE.MeshBasicMaterial({ color: 0xfff5d6 }));
  moon.position.set(28, 36, -10);
  skyline.add(moon);
  // Тёмные «кратеры» — пятна на луне
  for (let i = 0; i < 4; i++) {
    const crater = new THREE.Mesh(
      new THREE.SphereGeometry(0.9 + Math.random() * 0.6, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xd8c8a0, transparent: true, opacity: 0.5 }));
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 2.5;
    crater.position.set(28 + Math.cos(a) * r * 0.7,
                         36 + Math.sin(a) * r * 0.7, -9.5);
    skyline.add(crater);
  }
  // Гало
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(9.5, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.16 }));
  halo.position.copy(moon.position);
  skyline.add(halo);

  // Звёзды — россыпь маленьких базовых сфер по фону
  for (let i = 0; i < 90; i++) {
    const star = new THREE.Mesh(
      new THREE.SphereGeometry(0.12 + Math.random() * 0.22, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    star.position.set(
      -65 + Math.random() * 130,
      14 + Math.random() * 38,
      -16 + Math.random() * 8,
    );
    skyline.add(star);
  }

  // Замок Хогвартс — кластер каменных башен (на тон светлее для читаемости)
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4868, roughness: 0.9 });
  const roofMat  = new THREE.MeshStandardMaterial({ color: 0x2a2848, roughness: 0.85 });
  const winMat   = new THREE.MeshStandardMaterial({
    color: 0xffd070, emissive: 0xffa040, emissiveIntensity: 1.4 });

  function makeTower(x, baseR, baseH, topR, spireH) {
    const t = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(topR, baseR, baseH, 12), stoneMat);
    body.position.y = baseH / 2; t.add(body);
    const spire = new THREE.Mesh(
      new THREE.ConeGeometry(topR * 1.15, spireH, 12), roofMat);
    spire.position.y = baseH + spireH / 2; t.add(spire);
    // Светящиеся окна
    const rings = Math.max(2, Math.floor(baseH / 2.2));
    for (let i = 1; i <= rings; i++) {
      const y = (i / (rings + 1)) * baseH;
      for (let a = 0; a < 4; a++) {
        if (Math.random() > 0.55) continue;
        const ang = (a / 4) * Math.PI * 2 + Math.random() * 0.3;
        const r = topR + (baseR - topR) * (1 - y / baseH) + 0.02;
        const win = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.45, 0.1), winMat);
        win.position.set(Math.cos(ang) * r, y, Math.sin(ang) * r);
        win.rotation.y = ang;
        t.add(win);
      }
    }
    t.position.set(x, 0, 0);
    return t;
  }

  // Главный «корпус» замка
  const hall = new THREE.Mesh(
    new THREE.BoxGeometry(34, 8, 6), stoneMat);
  hall.position.set(0, 4, 0); skyline.add(hall);
  const hallRoof = new THREE.Mesh(
    new THREE.BoxGeometry(34.4, 0.6, 6.4), roofMat);
  hallRoof.position.set(0, 8.3, 0); skyline.add(hallRoof);
  // Длинный ряд светящихся окон главного зала
  for (let i = 0; i < 11; i++) {
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 1.4, 0.1), winMat);
    win.position.set(-14 + i * 2.8, 4.1, 3.05); skyline.add(win);
  }

  // Башни разной высоты вокруг главного корпуса
  const towers = [
    [-14, 1.5, 14, 1.2, 4.5],
    [-9,  1.7, 19, 1.3, 5.5],
    [-4,  2.0, 26, 1.5, 7],
    [1,   1.8, 22, 1.4, 6],
    [6,   2.2, 30, 1.6, 8],   // главная астрономическая башня
    [11,  1.6, 18, 1.2, 5],
    [16,  1.4, 14, 1.1, 4.5],
  ];
  for (const [x, br, bh, tr, sh] of towers) {
    skyline.add(makeTower(x, br, bh, tr, sh));
  }

  // Силуэт гор за замком (вершины с покрытием снега ловят лунный свет)
  for (let i = 0; i < 7; i++) {
    const h = 12 + Math.random() * 8;
    const r = 7 + Math.random() * 4;
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a3258, roughness: 1.0 }));
    m.position.set(-32 + i * 10 + (Math.random() - 0.5) * 3, h / 2, -8);
    skyline.add(m);
    // Снежная шапка
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.55, h * 0.32, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8ecf8, roughness: 0.9 }));
    cap.position.set(m.position.x, h - h * 0.16, -8);
    skyline.add(cap);
  }

  // Облачные «острова» вместо мрачного леса — гирлянды пушистых сфер
  // на разных глубинах, чтобы передать ощущение полёта по небу.
  const skyCloudMat = new THREE.MeshStandardMaterial({
    color: 0xe6e6f5, roughness: 1.0,
    emissive: 0x4a5290, emissiveIntensity: 0.15 });
  for (let i = 0; i < 16; i++) {
    const cluster = new THREE.Group();
    const side = i < 8 ? -1 : 1;
    const idx = i % 8;
    for (let j = 0; j < 4; j++) {
      const r = 1.0 + Math.random() * 1.2;
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(r, 10, 8), skyCloudMat);
      puff.position.set(
        (Math.random() - 0.5) * 2.4,
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 1.4);
      puff.scale.set(1, 0.7, 1);
      cluster.add(puff);
    }
    cluster.position.set(
      side * (14 + Math.random() * 16) + (Math.random() - 0.5) * 3,
      6 + Math.random() * 12,
      3 + idx * 0.6 + Math.random() * 3);
    skyline.add(cluster);
  }

  return skyline;
}

// =============================================================
// Скайлайн: Стамбул (Абдулла и Арслан) — современные жилые башни,
// мечеть с куполом и двумя минаретами, силуэт босфорского моста
// =============================================================
function buildIstanbulSkyline() {
  const skyline = new THREE.Group();
  skyline.position.set(0, 0, -110);

  // Современные жилые башни — стекло/бетон, разной высоты, тонкие пропорции
  const glassMat = (color, metalness = 0.55, roughness = 0.35) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness });
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.85 });

  // Левый кластер (за морем)
  for (let i = 0; i < 9; i++) {
    const w = 2.4 + Math.random() * 1.4;
    const d = 1.8 + Math.random() * 1.2;
    const h = 16 + Math.random() * 18;
    const hue = 0.55 + Math.random() * 0.08;
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      glassMat(new THREE.Color().setHSL(hue, 0.12, 0.62 + Math.random() * 0.12), 0.55, 0.3));
    tower.position.set(-44 + i * 3.4 + (Math.random() - 0.5) * 1.5,
                       h / 2,
                       3 + Math.random() * 3);
    skyline.add(tower);
    // Кантик/карниз сверху
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.2, 0.4, d + 0.2), concreteMat);
    cap.position.set(tower.position.x, h + 0.2, tower.position.z);
    skyline.add(cap);
  }
  // Правый кластер
  for (let i = 0; i < 8; i++) {
    const w = 2.2 + Math.random() * 1.5;
    const d = 1.8 + Math.random() * 1.2;
    const h = 14 + Math.random() * 16;
    const hue = 0.08 + Math.random() * 0.06;
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      glassMat(new THREE.Color().setHSL(hue, 0.18, 0.68 + Math.random() * 0.12), 0.4, 0.4));
    tower.position.set(8 + i * 3.6 + (Math.random() - 0.5) * 1.5,
                       h / 2,
                       3 + Math.random() * 3);
    skyline.add(tower);
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.2, 0.4, d + 0.2), concreteMat);
    cap.position.set(tower.position.x, h + 0.2, tower.position.z);
    skyline.add(cap);
  }

  // Мечеть — справа, отдельно
  const mosque = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xeae0ce, roughness: 0.95 });
  const domeMat  = new THREE.MeshStandardMaterial({ color: 0x4a86b8, roughness: 0.5, metalness: 0.25 });
  const tipMat   = new THREE.MeshStandardMaterial({ color: 0xc6a448, roughness: 0.3, metalness: 0.7 });
  // Основание
  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), stoneMat);
  base.position.y = 2.5; mosque.add(base);
  // Главный купол
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.y = 5; mosque.add(dome);
  // Барабан под куполом
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.6, 16), stoneMat);
  drum.position.y = 5.3; mosque.add(drum);
  // Пик-полумесяц
  const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 1.4, 8), tipMat);
  finial.position.y = 8.8; mosque.add(finial);
  // Малые купола по углам
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const sd = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    sd.position.set(sx * 3.0, 5.2, sz * 3.0); mosque.add(sd);
  }
  // Минареты — два тонких высоких столба слева и справа
  for (const sx of [-1, 1]) {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.42, 12, 12), stoneMat);
    shaft.position.set(sx * 4.6, 6, -3.6);
    mosque.add(shaft);
    // Балкон-кольцо на минарете
    const balcony = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.08, 6, 18), stoneMat);
    balcony.position.set(sx * 4.6, 10.5, -3.6);
    balcony.rotation.x = Math.PI / 2;
    mosque.add(balcony);
    // Конический шпиль
    const spire = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 2.0, 12), domeMat);
    spire.position.set(sx * 4.6, 13.0, -3.6); mosque.add(spire);
    // Маленький пик
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.08, 0.8, 6), tipMat);
    tip.position.set(sx * 4.6, 14.4, -3.6); mosque.add(tip);
  }
  mosque.position.set(30, 0, -8);
  mosque.scale.setScalar(0.95);
  skyline.add(mosque);

  // Босфорский мост — два пилона с натянутыми вантами вдалеке
  const bridge = new THREE.Group();
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xd4a45a, roughness: 0.7 });
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x6e5238, roughness: 0.85 });
  for (const sx of [-1, 1]) {
    const pylon = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 14, 0.8), bridgeMat);
    pylon.position.set(sx * 6, 7, 0); bridge.add(pylon);
    // Vантовые тросы — наклонные тонкие цилиндры
    for (let i = 0; i < 4; i++) {
      const cable = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 10 + i * 1.5, 5), cableMat);
      cable.position.set(sx * 6 - sx * (1 + i * 0.6), 6 + i * 0.4, 0);
      cable.rotation.z = -sx * 0.6;
      bridge.add(cable);
    }
  }
  // Полотно моста
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(14, 0.3, 1.2), bridgeMat);
  deck.position.set(0, 5, 0); bridge.add(deck);
  bridge.position.set(-20, 0, -10);
  bridge.scale.setScalar(0.9);
  skyline.add(bridge);

  // Далёкие холмы за городом
  for (let i = 0; i < 5; i++) {
    const h = 7 + Math.random() * 4;
    const r = 8 + Math.random() * 4;
    const hill = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 12),
      new THREE.MeshStandardMaterial({ color: 0x8aa888, roughness: 1.0 }));
    hill.position.set(-30 + i * 14 + (Math.random() - 0.5) * 3, h / 2, -14);
    skyline.add(hill);
  }

  return skyline;
}

// =============================================================
// Шаблоны (player + collect + 3 препятствия + side-окружение)
// =============================================================
function buildTemplatesForCharacter(char) {
  if (char.theme === 'dubai') {
    templates.player = buildCapybaraWithKid();
    templates.collect = buildOrange();
    templates.obstacleLow = buildTrafficCone();
    templates.obstacleMid = buildBarrier();
    templates.obstacleWide = buildCar();
    templates.side = [buildPalmTree, buildVilla, buildCactus];
  } else if (char.theme === 'hogwarts') {
    // Хогвартс — мальчик на метле летит по небу, золотые слитки,
    // препятствия: магическая сфера (прыжок), высокое облако (подкат),
    // грозовая туча (смена полосы).
    templates.player = buildOsmanOnBroom();
    templates.collect = buildGoldBar();
    templates.obstacleLow = buildGlowingOrb();
    templates.obstacleMid = buildHighCloud();
    templates.obstacleWide = buildStormCloud();
    templates.side = [buildHogwartsCandle, buildFloatingIsland, buildHogwartsTurret];
  } else if (char.theme === 'istanbul') {
    // Стамбул — двое мальчиков в красном Mercedes-кабриолете на шоссе
    // вдоль Босфора. Режим только-смена-полосы: low/mid не спавнятся,
    // wide — фабрика случайных моделей машин.
    templates.player = buildMercedesWithBoys();
    templates.collect = buildMoneyStack();
    templates.obstacleLow = null;          // не используется в режиме lanes-only
    templates.obstacleMid = null;
    templates.obstacleWide = buildIstanbulCar;   // фабрика — рандомная машина каждый спавн
    templates.side = [buildIstanbulApartment, buildPlaneTree, buildPromenadeLamp];
  } else {
    // Конфетный мир — общие препятствия и окружение
    templates.player = char.vehicle === 'cone' ? buildAnisaOnCone() : buildAklimaOnTable();
    templates.collect = char.id === 'anisa' ? buildEskimo() : buildWatermelonSlice();
    templates.obstacleLow = buildChocolateSpike();
    templates.obstacleMid = buildCandyBarrier();
    templates.obstacleWide = buildCake();
    templates.side = [buildCandyHouse, buildLollipop, buildCottonCandyBush];
  }
}

// =============================================================
// Игрок: Мухаммад (капибара + пацанчик)
// =============================================================
function buildCapybaraWithKid() {
  const cap = new THREE.Group();
  const furBase = new THREE.MeshStandardMaterial({ color: 0x9b6b3e, roughness: 1.0 });
  const furDark = new THREE.MeshStandardMaterial({ color: 0x6c4a28, roughness: 1.0 });
  const skin    = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 18, 14), furBase);
  body.scale.set(1.0, 0.9, 1.55); body.position.set(0, 0.65, 0); cap.add(body);
  const rump = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), furBase);
  rump.position.set(0, 0.7, 0.7); cap.add(rump);
  const neck = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), furBase);
  neck.scale.set(1, 0.9, 1.1); neck.position.set(0, 0.78, -0.65); cap.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 14), furBase);
  head.scale.set(1.0, 0.95, 1.1); head.position.set(0, 0.92, -1.05); cap.add(head);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), furDark);
  muzzle.scale.set(0.95, 0.78, 1.1); muzzle.position.set(0, 0.78, -1.42); cap.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), skin);
  nose.position.set(0, 0.86, -1.66); cap.add(nose);

  for (const sx of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xfff8e8, roughness: 0.4 }));
    eyeWhite.position.set(sx * 0.18, 1.05, -1.18); cap.add(eyeWhite);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skin);
    pupil.position.set(sx * 0.18, 1.05, -1.25); cap.add(pupil);
  }
  for (const sx of [-1, 1]) {
    const earOuter = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), furDark);
    earOuter.scale.set(0.9, 0.6, 0.7); earOuter.position.set(sx * 0.32, 1.32, -0.85);
    cap.add(earOuter);
    const earInner = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a2515, roughness: 1 }));
    earInner.scale.set(0.7, 0.5, 0.5); earInner.position.set(sx * 0.32, 1.34, -0.82);
    cap.add(earInner);
  }
  for (const [lx, lz] of [[-0.38, -0.55], [0.38, -0.55], [-0.38, 0.55], [0.38, 0.55]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.55, 10), furBase);
    leg.position.set(lx, 0.28, lz); cap.add(leg);
    const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.1, 10), skin);
    hoof.position.set(lx, 0.05, lz); cap.add(hoof);
  }
  for (const sx of [-1, 1]) for (const dy of [0.04, -0.02]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.25, 4),
      new THREE.MeshBasicMaterial({ color: 0x2a1810 }));
    w.rotation.z = Math.PI / 2; w.rotation.y = sx * 0.3;
    w.position.set(sx * 0.28, 0.78 + dy, -1.5); cap.add(w);
  }

  // Пацанчик
  const kid = new THREE.Group();
  const skinMat   = new THREE.MeshStandardMaterial({ color: 0xf2c79b, roughness: 0.85 });
  const shirtMat  = new THREE.MeshStandardMaterial({ color: 0x2f5fa3, roughness: 0.7 });
  const shirtAcc  = new THREE.MeshStandardMaterial({ color: 0x5a8ed1, roughness: 0.65 });
  const shortsMat = new THREE.MeshStandardMaterial({ color: 0x274569, roughness: 0.85 });
  const hairMat   = new THREE.MeshStandardMaterial({ color: 0x6e3e1f, roughness: 0.95 });

  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 12), shirtMat);
  torso.scale.set(1.0, 1.1, 0.85); torso.position.set(0, 1.4, 0.1); kid.add(torso);
  const wave = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), shirtAcc);
  wave.scale.set(1.4, 0.4, 0.2); wave.position.set(0, 1.42, -0.18); kid.add(wave);
  const neckK = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.13, 10), skinMat);
  neckK.position.set(0, 1.7, 0.08); kid.add(neckK);
  const headK = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 14), skinMat);
  headK.scale.set(1.0, 1.05, 1.0); headK.position.set(0, 1.95, 0.1); kid.add(headK);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), hairMat);
  hair.scale.set(1.05, 0.7, 1.05); hair.position.set(0, 2.07, 0.07); kid.add(hair);
  const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), hairMat);
  bangs.scale.set(1.6, 0.4, 0.6); bangs.position.set(0, 2.0, -0.13); kid.add(bangs);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), hairMat);
    side.scale.set(0.6, 0.9, 0.7); side.position.set(sx * 0.24, 1.97, 0.05); kid.add(side);
  }
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a1810 }));
    eye.position.set(sx * 0.085, 1.97, -0.16); kid.add(eye);
  }
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xc24a4a }));
  smile.rotation.x = Math.PI; smile.position.set(0, 1.86, -0.18); kid.add(smile);

  for (const sx of [-1, 1]) {
    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.32, 10), shirtMat);
    upperArm.position.set(sx * 0.32, 1.42, 0.0);
    upperArm.rotation.z = sx * 0.3; upperArm.rotation.x = -0.5;
    kid.add(upperArm);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.28, 10), skinMat);
    forearm.position.set(sx * 0.42, 1.22, -0.28);
    forearm.rotation.z = sx * 0.4; forearm.rotation.x = -1.0;
    kid.add(forearm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), skinMat);
    hand.position.set(sx * 0.32, 1.05, -0.5); kid.add(hand);
  }
  for (const sx of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.3, 10), shortsMat);
    thigh.position.set(sx * 0.32, 1.13, 0.25); thigh.rotation.z = sx * 0.25;
    kid.add(thigh);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.32, 10), skinMat);
    shin.position.set(sx * 0.5, 0.83, 0.32); shin.rotation.z = sx * 0.15;
    kid.add(shin);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), skinMat);
    foot.scale.set(1, 0.7, 1.4); foot.position.set(sx * 0.55, 0.66, 0.4);
    kid.add(foot);
  }
  cap.add(kid);
  return cap;
}

// =============================================================
// Игрок: Аклима — летающий диск (без ножек) + девочка СИДИТ сверху
// со свешенными вперёд ногами. Габариты компактные: голова ≈ y 1.05,
// чтобы при подкате гарантированно проходить под шлагбаумом.
// =============================================================
function buildAklimaOnTable() {
  const root = new THREE.Group();

  // ---- Летающий диск (никаких ножек/колёс — только сам диск) ----
  const disc = new THREE.Group();

  // Тело диска — толстый цилиндр с радиусом 0.78
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.78, 0.78, 0.13, 32),
    new THREE.MeshStandardMaterial({ color: 0xffb5c8, roughness: 0.5 }));
  top.position.y = 0.065; disc.add(top);

  // Верхняя крем-окантовка (тор)
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.78, 0.05, 10, 36),
    new THREE.MeshStandardMaterial({ color: 0xfff5fa, roughness: 0.45 }));
  rim.position.y = 0.135; rim.rotation.x = Math.PI / 2; disc.add(rim);

  // Розово-белые радиальные сектора на верхней грани (как карамель/конфетные дольки)
  const sliceCount = 12;
  for (let i = 0; i < sliceCount; i++) {
    if (i % 2) continue; // через одну — оставляем основной розовый
    const wedge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.78, 0.78, 0.005, 18, 1, false,
        (i / sliceCount) * Math.PI * 2, (Math.PI * 2) / sliceCount),
      new THREE.MeshStandardMaterial({ color: 0xfff0f4, roughness: 0.5 }));
    wedge.position.y = 0.131; disc.add(wedge);
  }

  // Нижняя кружевная юбочка диска (видна снизу-сбоку при наклоне)
  const lace = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.78, 0.08, 32),
    new THREE.MeshStandardMaterial({ color: 0xfff5fa, roughness: 0.6 }));
  lace.position.y = -0.005; disc.add(lace);
  // Зубчатые «капельки» по нижнему краю — кружево
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const drop = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xfff5fa, roughness: 0.6 }));
    drop.position.set(Math.cos(a) * 0.85, -0.045, Math.sin(a) * 0.85);
    disc.add(drop);
  }

  // Звёздочки-«пыльца» на верхней грани — намёк на волшебный полёт
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 6, 5),
      new THREE.MeshStandardMaterial({
        color: 0xffe6f0, emissive: 0xffaad0, emissiveIntensity: 0.5 }));
    const a = Math.random() * Math.PI * 2;
    const r = 0.3 + Math.random() * 0.4;
    sp.position.set(Math.cos(a) * r, 0.135, Math.sin(a) * r);
    disc.add(sp);
  }
  root.add(disc);

  // ---- Девочка (компактная, явно сидит) ----
  const girl = new THREE.Group();
  const skinMat   = new THREE.MeshStandardMaterial({ color: 0xf2c79b, roughness: 0.85 });
  const dressMat  = new THREE.MeshStandardMaterial({ color: 0xffaecb, roughness: 0.65 });
  const dressAcc  = new THREE.MeshStandardMaterial({ color: 0xfff5fa, roughness: 0.55 });
  const hairMat   = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.95 });
  const shoeMat   = new THREE.MeshStandardMaterial({ color: 0xfff5fa, roughness: 0.6 });
  const lipMat    = new THREE.MeshStandardMaterial({ color: 0xc24a78, roughness: 0.5 });
  const cheekMat  = new THREE.MeshStandardMaterial({
    color: 0xff9bb9, transparent: true, opacity: 0.55, roughness: 0.6 });

  // База: бёдра/попа на диске — расплющенная сфера (поза «сидя»)
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), dressMat);
  hips.scale.set(1.1, 0.7, 1.0); hips.position.set(0, 0.27, 0.1);
  girl.add(hips);

  // Юбка-«колокольчик», подол лежит на диске
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.32, 16), dressMat);
  skirt.position.set(0, 0.34, 0.1); girl.add(skirt);
  // Кружевной подол — тонкий тор у нижней кромки
  const skirtHem = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.025, 6, 22), dressAcc);
  skirtHem.position.set(0, 0.21, 0.1); skirtHem.rotation.x = Math.PI / 2;
  girl.add(skirtHem);

  // Лиф
  const bodice = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), dressMat);
  bodice.scale.set(1.0, 0.95, 0.85); bodice.position.set(0, 0.55, 0.05);
  girl.add(bodice);

  // Кружевной воротничок
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 18), dressAcc);
  collar.position.set(0, 0.7, 0.05); collar.rotation.x = Math.PI / 2;
  girl.add(collar);

  // Шея + голова
  const neckG = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.08, 10), skinMat);
  neckG.position.set(0, 0.74, 0.05); girl.add(neckG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 18, 14), skinMat);
  head.scale.set(1.0, 1.05, 1.0); head.position.set(0, 0.92, 0.05); girl.add(head);

  // Тёмные волосы: основная шапка + чёлка + длинные пряди по бокам/сзади
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.225, 16, 12), hairMat);
  hairTop.scale.set(1.05, 0.78, 1.05); hairTop.position.set(0, 1.0, 0.03);
  girl.add(hairTop);
  // Чёлка
  const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), hairMat);
  bangs.scale.set(1.6, 0.4, 0.55); bangs.position.set(0, 0.93, -0.13);
  girl.add(bangs);
  // Пряди-локоны до плеч
  for (const sx of [-1, 1]) {
    const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.32, 8), hairMat);
    lock.position.set(sx * 0.18, 0.78, 0.07); lock.rotation.z = sx * 0.18;
    girl.add(lock);
    const lockTip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), hairMat);
    lockTip.position.set(sx * 0.21, 0.62, 0.07); girl.add(lockTip);
  }
  // Задняя «копна» — длинные волосы за спиной
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), hairMat);
  back.scale.set(0.85, 1.2, 0.45); back.position.set(0, 0.78, 0.22);
  girl.add(back);

  // Лицо: глаза + ресницы + румянец + улыбка
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a0e08 }));
    eye.position.set(sx * 0.065, 0.92, -0.18); girl.add(eye);
    // Лёгкая «ресничка»-полоска под глазом
    const lash = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.005, 0.005),
      new THREE.MeshStandardMaterial({ color: 0x1a0e08 }));
    lash.position.set(sx * 0.065, 0.94, -0.19); girl.add(lash);
    // Румянец
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), cheekMat);
    cheek.scale.set(1, 0.6, 0.4);
    cheek.position.set(sx * 0.11, 0.88, -0.18); girl.add(cheek);
  }
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.04, 0.009, 6, 12, Math.PI), lipMat);
  smile.rotation.x = Math.PI; smile.position.set(0, 0.85, -0.19);
  girl.add(smile);

  // Руки — лежат на коленях
  for (const sx of [-1, 1]) {
    const upperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.045, 0.25, 10), dressMat);
    upperArm.position.set(sx * 0.2, 0.55, 0.0);
    upperArm.rotation.z = sx * 0.4; upperArm.rotation.x = -0.55;
    girl.add(upperArm);
    // Манжет
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 4, 12), dressAcc);
    cuff.position.set(sx * 0.27, 0.42, -0.1);
    cuff.rotation.z = sx * 0.4; cuff.rotation.y = Math.PI / 2;
    girl.add(cuff);
    // Кисти на коленях
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skinMat);
    hand.position.set(sx * 0.18, 0.32, -0.15); girl.add(hand);
  }

  // Ноги — свисают вперёд (явная «сидящая» поза)
  // Бедро: от попы (z=0.1, y=0.27) идёт вперёд-вниз. Колено впереди и ниже.
  for (const sx of [-1, 1]) {
    // Бедро
    const thigh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.06, 0.32, 10), dressMat);
    thigh.position.set(sx * 0.11, 0.24, -0.05);
    thigh.rotation.x = Math.PI / 2 - 0.25; // лежит почти горизонтально
    girl.add(thigh);
    // Колено
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), skinMat);
    knee.position.set(sx * 0.11, 0.2, -0.22); girl.add(knee);
    // Голень — свисает вниз с переднего края диска
    const shin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.05, 0.36, 10), skinMat);
    shin.position.set(sx * 0.11, 0.02, -0.28);
    shin.rotation.x = -0.15;
    girl.add(shin);
    // Ботиночек
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), shoeMat);
    shoe.scale.set(1, 0.55, 1.4);
    shoe.position.set(sx * 0.11, -0.16, -0.32); girl.add(shoe);
    // Розовый ремешок-носочек
    const sockTrim = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.012, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0xffaecb }));
    sockTrim.scale.set(1, 0.5, 1);
    sockTrim.position.set(sx * 0.11, -0.13, -0.3);
    sockTrim.rotation.x = Math.PI / 2;
    girl.add(sockTrim);
  }

  root.add(girl);
  root.userData.hover = true;
  return root;
}

// Процедурная текстура вафельного узора для рожка Анисы — ромбовая сетка
// с лёгким объёмом за счёт радиального градиента и тёмных точек на узлах.
function makeWaffleTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  // Базовый кремовый цвет вафли
  g.fillStyle = '#d9a45c';
  g.fillRect(0, 0, c.width, c.height);
  // Лёгкий градиент для глубины
  const grad = g.createRadialGradient(128, 128, 30, 128, 128, 200);
  grad.addColorStop(0, 'rgba(255, 220, 170, 0.35)');
  grad.addColorStop(1, 'rgba(110, 70, 30, 0.35)');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  // Сетка ромбов (две системы диагоналей)
  g.strokeStyle = 'rgba(95, 60, 25, 0.85)';
  g.lineWidth = 2.5;
  const step = 32;
  for (let i = -c.width; i < c.width * 2; i += step) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + c.height, c.height); g.stroke();
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i - c.height, c.height); g.stroke();
  }
  // Тёмные точки на пересечениях
  g.fillStyle = 'rgba(70, 40, 15, 0.7)';
  for (let x = 0; x <= c.width; x += step) {
    for (let y = 0; y <= c.height; y += step) {
      g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// =============================================================
// Игрок: Аниса — ГОРИЗОНТАЛЬНЫЙ рожок (как «летающая метла»)
// Конус лежит вдоль Z: тип в +Z (хвост сзади), широкая сторона с шариком
// мороженого спереди (-Z, по ходу движения). Девочка сидит сверху на
// шарике, корпус компактный (голова ≈ y 1.3, проходит под шлагбаумом).
// =============================================================
function buildAnisaOnCone() {
  const root = new THREE.Group();

  // ---- Горизонтальный рожок ----
  // Вафельный узор делаем через процедурную текстуру — она ложится прямо
  // на коническую поверхность по UV и естественно сужается к острию.
  const wafMat = new THREE.MeshStandardMaterial({
    map: makeWaffleTexture(),
    roughness: 0.85,
  });
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1.1, 32, 8, true), wafMat);
  cone.rotation.x = Math.PI / 2;   // тип → +Z, база → -Z
  root.add(cone);

  // ---- Белый ванильный «твист» спереди (нос корабля) ----
  const creamMat = new THREE.MeshStandardMaterial({
    color: 0xfff8f0, roughness: 0.45,
    emissive: 0xfff0e8, emissiveIntensity: 0.06 });
  const swirlLayers = 6;
  for (let i = 0; i < swirlLayers; i++) {
    const t = i / (swirlLayers - 1);
    const r = 0.5 - t * 0.30;          // 0.5 → 0.20
    const zi = -0.55 - t * 0.55;       // -0.55 (внутри базы) → -1.10 (передний край)
    const ang = t * Math.PI * 1.6;
    const layer = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), creamMat);
    layer.scale.z = 0.85;
    layer.position.set(Math.cos(ang) * 0.04 * (1 - t),
                        Math.sin(ang) * 0.04 * (1 - t),
                        zi);
    root.add(layer);
  }
  // Маленький конус-«пик» твиста на самом носу
  const noseTip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 12), creamMat);
  noseTip.rotation.x = -Math.PI / 2;   // острие → -Z (вперёд)
  noseTip.position.z = -1.22;
  root.add(noseTip);

  // ---- Девочка (СИДИТ на шарике сверху, лицом вперёд / в -Z) ----
  // Все локальные координаты девочки выставлены в root frame.
  // Шарик мороженого: центр (0, 0, -0.55), радиус 0.5 → верх y ≈ 0.5.
  // Делаем «бёдра» (butt) в (0, 0.5, -0.55), всё остальное — выше.
  const girl = new THREE.Group();
  const skinMat   = new THREE.MeshStandardMaterial({ color: 0xf2c79b, roughness: 0.85 });
  const dressMat  = new THREE.MeshStandardMaterial({ color: 0xd17a8e, roughness: 0.7 });
  const dressAcc  = new THREE.MeshStandardMaterial({ color: 0xe89aac, roughness: 0.65 });
  const hairMat   = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.95 });
  const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xf48aa6, roughness: 0.55 });
  const shoeMat   = new THREE.MeshStandardMaterial({ color: 0xf6a8be, roughness: 0.6 });
  const lipMat    = new THREE.MeshStandardMaterial({ color: 0xc24a78, roughness: 0.5 });
  const cheekMat  = new THREE.MeshStandardMaterial({
    color: 0xff9bb9, transparent: true, opacity: 0.55, roughness: 0.6 });

  const HZ = -0.55; // глобальное Z, на котором сидит девочка (центр шарика)

  // Бёдра/попа на шарике
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), dressMat);
  hips.scale.set(1.15, 0.7, 1.0); hips.position.set(0, 0.55, HZ + 0.05);
  girl.add(hips);

  // Юбка
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.28, 16), dressMat);
  skirt.position.set(0, 0.62, HZ + 0.05); girl.add(skirt);
  const skirtHem = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.022, 6, 22), dressAcc);
  skirtHem.position.set(0, 0.5, HZ + 0.05); skirtHem.rotation.x = Math.PI / 2;
  girl.add(skirtHem);

  // Лиф
  const bodice = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), dressMat);
  bodice.scale.set(1.0, 0.95, 0.85); bodice.position.set(0, 0.83, HZ + 0.02);
  girl.add(bodice);

  // Воротник кружевной
  for (const dz of [-0.13, 0.13]) {
    const flap = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      dressAcc);
    flap.scale.set(1, 0.5, 0.6);
    flap.position.set(0, 0.96, HZ + 0.02 + dz);
    flap.rotation.x = dz > 0 ? 0 : Math.PI;
    girl.add(flap);
  }

  // Шея + голова
  const neckG = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.08, 10), skinMat);
  neckG.position.set(0, 1.0, HZ + 0.02); girl.add(neckG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 18, 14), skinMat);
  head.scale.set(1.0, 1.05, 1.0); head.position.set(0, 1.18, HZ + 0.02);
  girl.add(head);

  // Тёмные волосы + чёлка
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.225, 16, 12), hairMat);
  hairTop.scale.set(1.05, 0.78, 1.05); hairTop.position.set(0, 1.27, HZ - 0.02);
  girl.add(hairTop);
  const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), hairMat);
  bangs.scale.set(1.55, 0.4, 0.55); bangs.position.set(0, 1.20, HZ - 0.18);
  girl.add(bangs);

  // Два хвостика с розовыми резинками-бантами
  for (const sx of [-1, 1]) {
    const tieBall = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), ribbonMat);
    tieBall.position.set(sx * 0.22, 1.20, HZ - 0.02); girl.add(tieBall);
    for (const sy of [-1, 1]) {
      const bow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), ribbonMat);
      bow.scale.set(1.2, 0.5, 0.5);
      bow.position.set(sx * 0.28, 1.20 + sy * 0.07, HZ - 0.02);
      bow.rotation.z = sx * sy * 0.4;
      girl.add(bow);
    }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.42, 10), hairMat);
    tail.position.set(sx * 0.3, 1.0, HZ - 0.02);
    tail.rotation.z = sx * 0.5;
    girl.add(tail);
    const tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), hairMat);
    tailTip.position.set(sx * 0.42, 0.78, HZ - 0.02); girl.add(tailTip);
  }

  // Лицо: глаза, реснички, румянец, улыбка (смотрит в -Z, вперёд)
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a0e08 }));
    eye.position.set(sx * 0.065, 1.18, HZ - 0.18); girl.add(eye);
    const lash = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.005, 0.005),
      new THREE.MeshStandardMaterial({ color: 0x1a0e08 }));
    lash.position.set(sx * 0.065, 1.20, HZ - 0.19); girl.add(lash);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), cheekMat);
    cheek.scale.set(1, 0.6, 0.4);
    cheek.position.set(sx * 0.11, 1.14, HZ - 0.18); girl.add(cheek);
  }
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.04, 0.009, 6, 12, Math.PI), lipMat);
  smile.rotation.x = Math.PI; smile.position.set(0, 1.11, HZ - 0.19);
  girl.add(smile);

  // Руки — впереди, как держит «руль» (передний край шарика)
  for (const sx of [-1, 1]) {
    const upperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.045, 0.25, 10), dressMat);
    upperArm.position.set(sx * 0.18, 0.83, HZ - 0.08);
    upperArm.rotation.z = sx * 0.4; upperArm.rotation.x = -0.65;
    girl.add(upperArm);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 4, 12), dressAcc);
    cuff.position.set(sx * 0.24, 0.7, HZ - 0.27);
    cuff.rotation.z = sx * 0.4; cuff.rotation.y = Math.PI / 2;
    girl.add(cuff);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skinMat);
    hand.position.set(sx * 0.16, 0.6, HZ - 0.4); girl.add(hand);
  }

  // Ноги — вперёд по бокам шарика, голени свисают, ступни смотрят вперёд
  for (const sx of [-1, 1]) {
    const thigh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.06, 0.3, 10), dressMat);
    thigh.position.set(sx * 0.13, 0.5, HZ - 0.16);
    thigh.rotation.x = Math.PI / 2 - 0.2;
    girl.add(thigh);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skinMat);
    knee.position.set(sx * 0.13, 0.45, HZ - 0.32); girl.add(knee);
    const shin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.045, 0.32, 10), skinMat);
    shin.position.set(sx * 0.13, 0.28, HZ - 0.36);
    shin.rotation.x = -0.15;
    girl.add(shin);
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), shoeMat);
    shoe.scale.set(1, 0.55, 1.4);
    shoe.position.set(sx * 0.13, 0.12, HZ - 0.42);
    girl.add(shoe);
    const strap = new THREE.Mesh(
      new THREE.TorusGeometry(0.062, 0.011, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
    strap.scale.set(1, 0.4, 1.1);
    strap.position.set(sx * 0.13, 0.15, HZ - 0.42);
    strap.rotation.x = Math.PI / 2;
    girl.add(strap);
  }

  root.add(girl);
  root.userData.hover = true;
  return root;
}

// =============================================================
// Игрок: Осман — мальчик в тёмно-синем пиджаке на летающей метле.
// Метла — горизонтальный деревянный стержень: ручка (грипп) спереди (-Z),
// связка прутьев сзади (+Z). Мальчик сидит сверху, лицом по ходу (-Z),
// руки впереди держат ручку. Габариты компактные — голова ≈ y 1.25.
// =============================================================
function buildOsmanOnBroom() {
  const root = new THREE.Group();

  // ---- Метла ----
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e4a26, roughness: 0.85 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x4a2f16, roughness: 0.9 });
  const bindMat = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.8 });
  const twigLight = new THREE.MeshStandardMaterial({ color: 0x9a7440, roughness: 1.0 });
  const twigDark  = new THREE.MeshStandardMaterial({ color: 0x6a4820, roughness: 1.0 });

  // Древко вдоль Z
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.06, 1.7, 12), woodMat);
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, 0.32, 0.05);
  root.add(handle);

  // Передний скруглённый набалдашник (за -Z)
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 12, 10), woodDark);
  knob.position.set(0, 0.32, -0.85);
  root.add(knob);

  // Тёмная кожаная обвязка перед прутьями
  const binding = new THREE.Mesh(
    new THREE.CylinderGeometry(0.105, 0.095, 0.14, 14), bindMat);
  binding.rotation.x = Math.PI / 2;
  binding.position.set(0, 0.32, 0.7);
  root.add(binding);
  // Узелок-ремешок поверх обвязки
  const knot = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 6), bindMat);
  knot.position.set(0.1, 0.4, 0.7);
  root.add(knot);

  // Прутья — расходящаяся «метёлка» назад (+Z)
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    const r0 = 0.04 + Math.random() * 0.05;
    const len = 0.5 + Math.random() * 0.25;
    const twig = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.004, len, 5),
      Math.random() < 0.5 ? twigLight : twigDark);
    // Локально: цилиндр вдоль Y. Опускаем основание в обвязку, а кончик уезжает назад.
    twig.position.set(
      Math.cos(a) * r0,
      0.32 + Math.sin(a) * r0,
      0.78 + len * 0.5);
    twig.rotation.x = Math.PI / 2;            // вдоль Z
    twig.rotation.y = -Math.cos(a) * (0.25 + Math.random() * 0.18);
    twig.rotation.z = -Math.sin(a) * (0.25 + Math.random() * 0.18);
    root.add(twig);
  }
  // Несколько коротких пучков-«хохолков» по самому концу для объёма
  for (let i = 0; i < 8; i++) {
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.04 + Math.random() * 0.02, 6, 5),
      Math.random() < 0.5 ? twigLight : twigDark);
    tip.position.set(
      (Math.random() - 0.5) * 0.22,
      0.32 + (Math.random() - 0.5) * 0.22,
      1.18 + Math.random() * 0.12);
    root.add(tip);
  }

  // ---- Мальчик (СИДИТ на метле, лицом в -Z) ----
  const boy = new THREE.Group();
  const skinMat   = new THREE.MeshStandardMaterial({ color: 0xf2c79b, roughness: 0.85 });
  const jacketMat = new THREE.MeshStandardMaterial({ color: 0x1a2548, roughness: 0.75 });
  const shirtMat  = new THREE.MeshStandardMaterial({ color: 0xfff8e8, roughness: 0.7 });
  const pantsMat  = new THREE.MeshStandardMaterial({ color: 0x1a2548, roughness: 0.85 });
  const hairMat   = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.95 });
  const shoeMat   = new THREE.MeshStandardMaterial({ color: 0x14182a, roughness: 0.85 });
  const lipMat    = new THREE.MeshStandardMaterial({ color: 0xc24a4a });

  // Бёдра — на ручке, чуть смещены назад
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), pantsMat);
  hips.scale.set(1.1, 0.7, 0.95);
  hips.position.set(0, 0.5, 0.05);
  boy.add(hips);

  // Торс — пиджак
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), jacketMat);
  torso.scale.set(1.0, 1.15, 0.85);
  torso.position.set(0, 0.78, -0.02);
  boy.add(torso);

  // Лацканы пиджака (две тёмные капли по сторонам груди)
  for (const sx of [-1, 1]) {
    const lap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x10182f, roughness: 0.75 }));
    lap.scale.set(0.4, 1.2, 0.25);
    lap.position.set(sx * 0.08, 0.82, -0.21);
    lap.rotation.z = sx * 0.2;
    boy.add(lap);
  }

  // Белая футболка треугольником у горла
  const shirtV = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), shirtMat);
  shirtV.scale.set(1, 1.15, 0.3);
  shirtV.position.set(0, 0.95, -0.22);
  boy.add(shirtV);

  // Шея
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.08, 10), skinMat);
  neck.position.set(0, 1.05, -0.02);
  boy.add(neck);

  // Голова
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 18, 14), skinMat);
  head.scale.set(1.0, 1.05, 1.0);
  head.position.set(0, 1.24, -0.02);
  boy.add(head);

  // Светлые волосы — короткая «ёжиком» причёска
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.215, 16, 12), hairMat);
  hairTop.scale.set(1.05, 0.6, 1.05);
  hairTop.position.set(0, 1.36, -0.04);
  boy.add(hairTop);
  // Лёгкие «иголочки» сверху для эффекта взъерошенности
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 5), hairMat);
    spike.position.set(
      (Math.random() - 0.5) * 0.22,
      1.45 + Math.random() * 0.03,
      -0.06 + (Math.random() - 0.5) * 0.15);
    spike.rotation.z = (Math.random() - 0.5) * 0.4;
    boy.add(spike);
  }
  // Чёлка
  const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), hairMat);
  bangs.scale.set(1.45, 0.35, 0.55);
  bangs.position.set(0, 1.32, -0.17);
  boy.add(bangs);
  // Височные пряди
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), hairMat);
    side.scale.set(0.55, 0.7, 0.65);
    side.position.set(sx * 0.18, 1.28, -0.04);
    boy.add(side);
  }

  // Глаза
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a0e08 }));
    eye.position.set(sx * 0.065, 1.25, -0.22);
    boy.add(eye);
  }

  // Лёгкая улыбка
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.01, 6, 12, Math.PI), lipMat);
  smile.rotation.x = Math.PI;
  smile.position.set(0, 1.16, -0.23);
  boy.add(smile);

  // Руки — обе вытянуты вперёд, держат ручку метлы
  for (const sx of [-1, 1]) {
    const upperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.05, 0.3, 10), jacketMat);
    upperArm.position.set(sx * 0.22, 0.78, -0.16);
    upperArm.rotation.z = sx * 0.3;
    upperArm.rotation.x = -0.9;
    boy.add(upperArm);
    // Манжет рубашки выглядывает из рукава
    const cuff = new THREE.Mesh(
      new THREE.TorusGeometry(0.062, 0.012, 4, 12), shirtMat);
    cuff.position.set(sx * 0.18, 0.55, -0.3);
    cuff.rotation.z = sx * 0.3;
    cuff.rotation.y = Math.PI / 2;
    boy.add(cuff);
    // Кисть, обхватывающая ручку
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skinMat);
    hand.position.set(sx * 0.1, 0.4, -0.4);
    boy.add(hand);
  }

  // Ноги — свисают по обеим сторонам метлы
  for (const sx of [-1, 1]) {
    const thigh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.07, 0.36, 10), pantsMat);
    thigh.position.set(sx * 0.15, 0.34, 0.0);
    thigh.rotation.z = sx * 0.12;
    thigh.rotation.x = -0.25;
    boy.add(thigh);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), pantsMat);
    knee.position.set(sx * 0.19, 0.17, 0.07);
    boy.add(knee);
    const shin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.055, 0.4, 10), pantsMat);
    shin.position.set(sx * 0.21, -0.02, 0.1);
    shin.rotation.z = sx * 0.06;
    shin.rotation.x = -0.08;
    boy.add(shin);
    // Ботинок (тёмно-синий, низкий)
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), shoeMat);
    shoe.scale.set(1, 0.55, 1.4);
    shoe.position.set(sx * 0.21, -0.23, 0.16);
    boy.add(shoe);
    // Подошва — чуть светлее
    const sole = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.02, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xeae3d4, roughness: 0.7 }));
    sole.position.set(sx * 0.21, -0.28, 0.16);
    boy.add(sole);
  }

  root.add(boy);
  root.userData.hover = true;
  return root;
}

// =============================================================
// Игрок: Абдулла и Арслан — двое в красном Mercedes-кабриолете SL.
// Без hover (наземный транспорт), без жалюзи: открытый кокпит, два
// сиденья, лобовое стекло, фары, четыре колеса, звезда на капоте.
// Габариты компактные, чтобы влезать в полосу (ширина ~1.7).
// =============================================================
function buildMercedesWithBoys() {
  const root = new THREE.Group();

  // ---- Кузов ----
  const redMat = new THREE.MeshStandardMaterial({
    color: 0xc02528, roughness: 0.32, metalness: 0.6 });
  const redDark = new THREE.MeshStandardMaterial({
    color: 0x7a181b, roughness: 0.45, metalness: 0.5 });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe8eaee, roughness: 0.2, metalness: 0.95 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x2a3a4a, roughness: 0.15, metalness: 0.6,
    transparent: true, opacity: 0.55 });
  const blackMat = new THREE.MeshStandardMaterial({
    color: 0x101010, roughness: 0.6 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xc8cad0, roughness: 0.35, metalness: 0.85 });
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d8, emissive: 0xffe2a0, emissiveIntensity: 0.6 });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff3030, emissive: 0xa01010, emissiveIntensity: 0.6 });

  // Нижняя основа кузова (плоское «днище»)
  const lower = new THREE.Mesh(
    new THREE.BoxGeometry(1.65, 0.42, 3.2), redMat);
  lower.position.y = 0.35; root.add(lower);

  // Верхняя «талия» — чуть уже, имитация литой формы
  const upper = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.32, 3.0), redMat);
  upper.position.y = 0.7; root.add(upper);

  // Капот — слегка наклонная плоскость спереди
  const hood = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.06, 1.0), redMat);
  hood.position.set(0, 0.86, -1.05); root.add(hood);

  // Боковины (фартуки)
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.36, 2.8), redDark);
    side.position.set(sx * 0.83, 0.6, 0);
    root.add(side);
  }

  // Лобовое стекло — наклонное прямоугольное
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.7, 0.05), glassMat);
  windshield.position.set(0, 1.1, -0.55);
  windshield.rotation.x = -0.35;
  root.add(windshield);
  // Рамка лобового стекла
  const wsFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.78, 0.07), blackMat);
  wsFrame.position.set(0, 1.08, -0.57);
  wsFrame.rotation.x = -0.35;
  root.add(wsFrame);
  // Сделать стекло «спереди» рамки видимым
  windshield.position.z -= 0.005;

  // Сиденья — два сиденья за стеклом
  for (const sx of [-1, 1]) {
    const seatBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.1, 0.6), blackMat);
    seatBase.position.set(sx * 0.38, 0.92, 0.1); root.add(seatBase);
    const seatBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.55, 0.12), blackMat);
    seatBack.position.set(sx * 0.38, 1.18, 0.42);
    seatBack.rotation.x = -0.18;
    root.add(seatBack);
    // Подголовник
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.22, 0.12), blackMat);
    head.position.set(sx * 0.38, 1.46, 0.5); root.add(head);
  }

  // Решётка радиатора — чёрная вертикальная панель спереди
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.32, 0.05), blackMat);
  grille.position.set(0, 0.62, -1.605); root.add(grille);
  // Хром вокруг решётки
  const grilleRim = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.38, 0.02), chromeMat);
  grilleRim.position.set(0, 0.62, -1.61); root.add(grilleRim);
  // Звезда Mercedes на капоте — три луча
  const star = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const ray = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.008, 0.16, 8), chromeMat);
    ray.rotation.z = (i / 3) * Math.PI * 2;
    star.add(ray);
  }
  const starRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.085, 0.012, 6, 18), chromeMat);
  star.add(starRing);
  star.position.set(0, 0.92, -1.45);
  star.rotation.x = -0.2;
  root.add(star);

  // Фары — два овала
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 10), lightMat);
    lamp.scale.set(1.0, 0.6, 0.5);
    lamp.position.set(sx * 0.5, 0.7, -1.62); root.add(lamp);
  }
  // Задние фонари
  for (const sx of [-1, 1]) {
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.1, 0.04), tailMat);
    tail.position.set(sx * 0.45, 0.7, 1.6); root.add(tail);
  }

  // Боковые зеркала
  for (const sx of [-1, 1]) {
    const stem = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.12), redDark);
    stem.position.set(sx * 0.84, 1.03, -0.4); root.add(stem);
    const mirror = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.1, 0.06), blackMat);
    mirror.position.set(sx * 0.95, 1.03, -0.4); root.add(mirror);
  }

  // Колёса (4 шт)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14), tireMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx * 0.86, 0.32, sz * 1.1); root.add(wheel);
    // Диск
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.23, 14), rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(sx * 0.86, 0.32, sz * 1.1); root.add(rim);
    // Спицы (3 линии)
    for (let s = 0; s < 3; s++) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.36, 0.01), chromeMat);
      spoke.position.set(sx * 0.87, 0.32, sz * 1.1);
      spoke.rotation.z = (s / 3) * Math.PI;
      root.add(spoke);
    }
  }

  // Руль перед сиденьем водителя (левое сиденье в RHD/LHD неважно — берём левое)
  const wheelRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.14, 0.025, 6, 18), blackMat);
  wheelRim.position.set(-0.38, 1.04, -0.32);
  wheelRim.rotation.x = 0.6;
  root.add(wheelRim);
  // Спицы руля
  for (let i = 0; i < 3; i++) {
    const sp = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.12, 0.018), blackMat);
    sp.position.copy(wheelRim.position);
    sp.rotation.x = 0.6;
    sp.rotation.z = (i / 3) * Math.PI;
    root.add(sp);
  }

  // ---- Два мальчика на сиденьях ----
  const skinMat   = new THREE.MeshStandardMaterial({ color: 0xf2c79b, roughness: 0.85 });
  const blazerMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.7 });
  const shirtMat  = new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.75 });
  const hairMat   = new THREE.MeshStandardMaterial({ color: 0x6e4626, roughness: 0.95 });
  const shadeMat  = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a, roughness: 0.2, metalness: 0.5 });
  const lipMat    = new THREE.MeshStandardMaterial({ color: 0xc24a4a });
  const chainMat  = new THREE.MeshStandardMaterial({
    color: 0xe8c850, roughness: 0.35, metalness: 0.85 });

  function makeBoy(parent, x, isDriver) {
    const boy = new THREE.Group();
    // Торс — пиджак
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), blazerMat);
    torso.scale.set(1.0, 1.1, 0.85);
    torso.position.set(0, 1.18, 0.18); boy.add(torso);
    // Лацканы
    for (const sx of [-1, 1]) {
      const lap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.7 }));
      lap.scale.set(0.4, 1.1, 0.25);
      lap.position.set(sx * 0.08, 1.22, 0.0);
      lap.rotation.z = sx * 0.18;
      boy.add(lap);
    }
    // Тёмная рубашка / поло
    const shirtV = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), shirtMat);
    shirtV.scale.set(1, 1.15, 0.3);
    shirtV.position.set(0, 1.32, -0.05);
    boy.add(shirtV);
    // Золотая цепь у пассажира (как на фото)
    if (!isDriver) {
      const chain = new THREE.Mesh(
        new THREE.TorusGeometry(0.06, 0.012, 6, 18), chainMat);
      chain.position.set(0, 1.36, -0.04);
      chain.rotation.x = Math.PI / 2;
      chain.scale.set(1.2, 1, 1);
      boy.add(chain);
    }
    // Шея
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.06, 0.08, 10), skinMat);
    neck.position.set(0, 1.45, -0.02); boy.add(neck);
    // Голова
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), skinMat);
    head.scale.set(1.0, 1.05, 1.0);
    head.position.set(0, 1.63, -0.02); boy.add(head);
    // Волосы — короткие, тёмно-русые
    const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.205, 16, 12), hairMat);
    hairTop.scale.set(1.05, 0.55, 1.05);
    hairTop.position.set(0, 1.73, -0.03); boy.add(hairTop);
    const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), hairMat);
    bangs.scale.set(1.45, 0.35, 0.55);
    bangs.position.set(0, 1.69, -0.17); boy.add(bangs);
    // Солнцезащитные очки — тёмная горизонтальная «маска»
    const shades = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.07, 0.05), shadeMat);
    shades.position.set(0, 1.63, -0.2); boy.add(shades);
    // Дужки очков
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.012, 0.07), shadeMat);
      arm.position.set(sx * 0.13, 1.63, -0.16); boy.add(arm);
    }
    // Лёгкая улыбка
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.009, 6, 12, Math.PI), lipMat);
    smile.rotation.x = Math.PI;
    smile.position.set(0, 1.54, -0.21); boy.add(smile);
    // Руки на руле (только водитель) или вдоль кузова (пассажир)
    if (isDriver) {
      for (const sx of [-1, 1]) {
        const upperArm = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.05, 0.26, 10), blazerMat);
        upperArm.position.set(sx * 0.18, 1.18, -0.04);
        upperArm.rotation.z = sx * 0.2;
        upperArm.rotation.x = -0.55;
        boy.add(upperArm);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skinMat);
        hand.position.set(sx * 0.12, 1.0, -0.28);
        boy.add(hand);
      }
    } else {
      // Пассажир — одна рука положена на дверь, другая опущена
      const armOnDoor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.05, 0.32, 10), blazerMat);
      armOnDoor.position.set(0.22, 1.05, 0.12);
      armOnDoor.rotation.z = 0.5;
      boy.add(armOnDoor);
      const lapHand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skinMat);
      lapHand.position.set(0.35, 0.95, 0.12);
      boy.add(lapHand);
      const otherArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.05, 0.28, 10), blazerMat);
      otherArm.position.set(-0.12, 1.08, 0.22);
      otherArm.rotation.z = -0.2;
      boy.add(otherArm);
    }
    boy.position.x = x;
    parent.add(boy);
  }
  // Водитель — слева (отрицательный X), пассажир — справа
  makeBoy(root, -0.38, true);
  makeBoy(root, 0.38, false);

  // Без hover — машина едет по земле
  root.userData.hover = false;
  return root;
}

// =============================================================
// Собираемые: апельсин (Мухаммад), долька арбуза (Аклима), эскимо (Аниса)
// =============================================================
function buildOrange() {
  const orange = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xff8c1a, roughness: 0.55,
      emissive: 0x6a2400, emissiveIntensity: 0.35 }));
  orange.add(body);
  const leaf = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.18, 6),
    new THREE.MeshStandardMaterial({ color: 0x4d7a2e, roughness: 0.7 }));
  leaf.position.set(0.05, 0.32, 0); leaf.rotation.z = -0.6; orange.add(leaf);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.02, 0.06, 6),
    new THREE.MeshStandardMaterial({ color: 0x3d2a14 }));
  stem.position.set(0, 0.34, 0); orange.add(stem);
  return orange;
}

function buildWatermelonSlice() {
  // Полноценная D-образная долька: толстый зелёный «корпус», на передней
  // и задней гранях — концентрические слои (светло-зелёная прослойка,
  // белая, красная мякоть с семечками).
  const slice = new THREE.Group();
  const DEPTH = 0.20;

  // Половинка-диск (плоская грань = диаметр, дуга = корка)
  function halfDiscShape(radius) {
    const s = new THREE.Shape();
    s.moveTo(-radius, 0);
    s.lineTo(radius, 0);
    s.absarc(0, 0, radius, 0, Math.PI, false);
    return s;
  }
  function makeLayer(radius, color, z, depth) {
    const geo = new THREE.ExtrudeGeometry(halfDiscShape(radius),
      { depth, bevelEnabled: false, curveSegments: 24 });
    const m = new THREE.Mesh(geo,
      new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
    m.position.z = z;
    return m;
  }

  // Зелёная корка — основной 3D-блок (виден со всех сторон, включая бок)
  slice.add(makeLayer(0.36, 0x2c5e1a, -DEPTH / 2, DEPTH));
  // На передней и задней гранях — концентрические венчики:
  // светло-зелёная прослойка → белая → красная мякоть.
  const FRONT_Z = DEPTH / 2 + 0.001;
  const BACK_Z  = -DEPTH / 2 - 0.006;
  slice.add(makeLayer(0.33, 0x8fc962, FRONT_Z,         0.005));
  slice.add(makeLayer(0.30, 0xfff2d8, FRONT_Z + 0.005, 0.005));
  slice.add(makeLayer(0.275, 0xff4760, FRONT_Z + 0.010, 0.005));
  slice.add(makeLayer(0.33, 0x8fc962, BACK_Z,          0.005));
  slice.add(makeLayer(0.30, 0xfff2d8, BACK_Z - 0.005,  0.005));
  slice.add(makeLayer(0.275, 0xff4760, BACK_Z - 0.010, 0.005));

  // Семечки на ОБОИХ красных лицах
  const seedMat = new THREE.MeshStandardMaterial({ color: 0x1a0e08, roughness: 0.6 });
  for (const zSign of [-1, 1]) {
    const zPos = zSign === 1 ? FRONT_Z + 0.018 : BACK_Z - 0.018;
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.18 + (i / 6) * Math.PI * 0.64;
      const r = 0.10 + (i % 2) * 0.08;
      const seed = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), seedMat);
      seed.scale.set(0.7, 1.5, 0.5);
      seed.position.set(Math.cos(a) * r, Math.sin(a) * r, zPos);
      slice.add(seed);
    }
  }

  // Лёгкий наклон вперёд — при спине вокруг Y слой видится чуть «нависающим»
  slice.rotation.x = -0.25;
  return slice;
}

function buildEskimo() {
  // Шоколадное эскимо в стиле «магнум»: вытянутый закруглённый эллипсоид
  // тёмного шоколада + деревянная палочка снизу + блики и подтёки глазури.
  const esk = new THREE.Group();
  const choco = new THREE.MeshStandardMaterial({
    color: 0x4a230f, roughness: 0.45,
    emissive: 0x2a1208, emissiveIntensity: 0.15,
  });
  const chocoLight = new THREE.MeshStandardMaterial({
    color: 0x6e3a1c, roughness: 0.35,
  });

  // Тело — эллипсоид (вытянутая по Y сфера, плоская по Z)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.20, 24, 18), choco);
  body.scale.set(0.92, 1.55, 0.5);
  esk.add(body);

  // Глянцевый блик слева — тонкая вертикальная светлая «капля»
  const shine = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 14, 10), chocoLight);
  shine.scale.set(0.35, 4.5, 0.14);
  shine.position.set(-0.07, 0.05, 0.085);
  esk.add(shine);

  // Подтёки шоколада на нижнем крае (для текстурности)
  for (let i = 0; i < 4; i++) {
    const drip = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 10, 8), choco);
    drip.scale.set(1.2, 1.6, 0.6);
    const x = -0.1 + i * 0.07;
    drip.position.set(x, -0.27 + Math.random() * 0.04, 0.07);
    esk.add(drip);
  }

  // Деревянная палочка
  const stickMat = new THREE.MeshStandardMaterial({
    color: 0xd9b58a, roughness: 0.95,
  });
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.022, 0.22, 10), stickMat);
  stick.position.y = -0.42;
  esk.add(stick);
  // Закруглённый кончик палочки
  const stickTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.026, 10, 8), stickMat);
  stickTip.scale.set(1, 0.55, 1);
  stickTip.position.y = -0.535;
  esk.add(stickTip);

  return esk;
}

// Собираемый Османа — золотой слиток (трапеция со скосом)
function buildGoldBar() {
  const bar = new THREE.Group();
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xf4c850, roughness: 0.28, metalness: 0.85,
    emissive: 0x5a3e08, emissiveIntensity: 0.28,
  });
  const goldHi = new THREE.MeshStandardMaterial({
    color: 0xfff0b0, roughness: 0.22, metalness: 0.9,
  });

  // Корпус — трапециевидная призма (узкий верх, широкое основание)
  const shape = new THREE.Shape();
  shape.moveTo(-0.34, -0.10);
  shape.lineTo(0.34, -0.10);
  shape.lineTo(0.27, 0.10);
  shape.lineTo(-0.27, 0.10);
  shape.lineTo(-0.34, -0.10);
  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.18, bevelEnabled: true,
      bevelSize: 0.02, bevelThickness: 0.018, bevelSegments: 2,
    }),
    goldMat);
  body.position.z = -0.09;
  bar.add(body);

  // Светлая «фаска» на верхнем ребре
  const shineTop = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.014, 0.14), goldHi);
  shineTop.position.set(0, 0.105, 0); bar.add(shineTop);
  // Светлая линия по переднему ребру
  const shineFront = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.018, 0.012), goldHi);
  shineFront.position.set(0, 0.0, 0.1); bar.add(shineFront);
  // Тонкое клеймо на верхней грани (тёмная точка-печать)
  const stamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.005, 12),
    new THREE.MeshStandardMaterial({
      color: 0x8a5a10, roughness: 0.6, metalness: 0.5 }));
  stamp.position.set(0, 0.112, 0);
  bar.add(stamp);

  return bar;
}

// Собираемое Абдуллы и Арслана — пачка денег с бумажной обёрткой
function buildMoneyStack() {
  const stack = new THREE.Group();
  // Зеленоватая «купюрная» текстура — простой плоский цвет с лёгким emissive
  const billMat = new THREE.MeshStandardMaterial({
    color: 0x6ea868, roughness: 0.75,
    emissive: 0x1a4a18, emissiveIntensity: 0.2 });
  const billEdge = new THREE.MeshStandardMaterial({
    color: 0xe2e8d0, roughness: 0.85 });
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0xe8c264, roughness: 0.5, metalness: 0.2,
    emissive: 0x6a4810, emissiveIntensity: 0.25 });
  const stampMat = new THREE.MeshStandardMaterial({ color: 0x2a4218, roughness: 0.6 });

  // Корпус пачки — плоский параллелепипед
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.18, 0.26), billMat);
  body.position.y = 0; stack.add(body);
  // Светлые торцы — намёк на «бок пачки» из множества купюр
  for (const sx of [-1, 1]) {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.165, 0.245), billEdge);
    edge.position.set(sx * 0.255, 0, 0); stack.add(edge);
  }
  for (const sz of [-1, 1]) {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.485, 0.165, 0.012), billEdge);
    edge.position.set(0, 0, sz * 0.131); stack.add(edge);
  }
  // Бумажная лента-обёртка по центру
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.085, 0.28), bandMat);
  band.position.y = 0; stack.add(band);
  // Печать на ленте — маленький тёмный квадрат
  const stamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.087, 0.02), stampMat);
  stamp.position.set(0, 0, 0.14); stack.add(stamp);
  // Тонкие линии-полоски сверху для имитации печати на купюре
  for (const dy of [0.092, -0.092]) {
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.005, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x4a8045, roughness: 0.7 }));
    top.position.y = dy; stack.add(top);
  }
  return stack;
}

// =============================================================
// Препятствия: дорожный конус, шлагбаум, машина (Дубай)
// =============================================================
function buildTrafficCone() {
  const cone = new THREE.Group();
  const coneBody = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 0.95, 16),
    new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.7 }));
  coneBody.position.y = 0.475; cone.add(coneBody);
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: 0xfff5d8 }));
  stripe.position.y = 0.55; cone.add(stripe);
  const baseSq = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.08, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x222222 }));
  baseSq.position.y = 0.04; cone.add(baseSq);
  return cone;
}
function buildBarrier() {
  const barrier = new THREE.Group();
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.35, 0.25),
    new THREE.MeshStandardMaterial({ color: 0xd13d2e, roughness: 0.7 }));
  bar.position.y = 1.85; barrier.add(bar);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 2.05, 8),
      new THREE.MeshStandardMaterial({ color: 0x222222 }));
    post.position.set(sx * 1.05, 1.0, 0);
    barrier.add(post);
  }
  return barrier;
}
function buildCar() {
  const car = new THREE.Group();
  const carBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.85, 3.0),
    new THREE.MeshStandardMaterial({ color: 0x2c6fb5, roughness: 0.55, metalness: 0.4 }));
  carBody.position.y = 0.5; car.add(carBody);
  const carTop = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.6, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x9bc7f5, roughness: 0.3 }));
  carTop.position.set(0, 1.1, 0.1); car.add(carTop);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x111111 }));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx * 0.85, 0.28, sz * 1.0);
    car.add(wheel);
  }
  return car;
}

// =============================================================
// Препятствия конфетного мира: шоколадный пик, конфетный шлагбаум, тортик
// =============================================================
function buildChocolateSpike() {
  // Красный «леденцовый» пик с глянцем (по запросу пользователя — красный, не шоколадный).
  const sp = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 1.0, 16),
    new THREE.MeshStandardMaterial({
      color: 0xd9202e, roughness: 0.3, metalness: 0.05,
      emissive: 0x4a0810, emissiveIntensity: 0.2,
    }));
  body.position.y = 0.5; sp.add(body);
  // Светлый блик на верхней капле для глянцевости
  const drop = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xff5a5a, roughness: 0.2 }));
  drop.position.y = 1.05; sp.add(drop);
  // Подставка-блюдце (золотисто-кремовая, остаётся как контраст)
  const baseSq = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.55, 0.08, 16),
    new THREE.MeshStandardMaterial({ color: 0xffd58a, roughness: 0.6 }));
  baseSq.position.y = 0.04; sp.add(baseSq);
  return sp;
}

function buildCandyBarrier() {
  // Барьер в стиле леденца: бело-розовая полосатая балка на двух «карамельных тростях»
  const b = new THREE.Group();
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 2.4, 16),
    new THREE.MeshStandardMaterial({ color: 0xff6aa6, roughness: 0.5 }));
  bar.rotation.z = Math.PI / 2; bar.position.y = 1.85;
  b.add(bar);
  // Белые поясочки на балке
  for (let i = -1; i <= 1; i++) {
    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.225, 0.225, 0.15, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
    stripe.rotation.z = Math.PI / 2;
    stripe.position.set(i * 0.7, 1.85, 0);
    b.add(stripe);
  }
  // Стойки — карамельные трости (просто белые цилиндры)
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 2.05, 10),
      new THREE.MeshStandardMaterial({ color: 0xfff0f4, roughness: 0.6 }));
    post.position.set(sx * 1.1, 1.0, 0);
    b.add(post);
  }
  return b;
}

function buildCake() {
  // Двухъярусный розовый тортик с кремом и вишенкой — широкое препятствие
  const cake = new THREE.Group();
  // Подложка (тарелка)
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 1.05, 0.08, 24),
    new THREE.MeshStandardMaterial({ color: 0xfff5fa, roughness: 0.6 }));
  plate.position.y = 0.04; cake.add(plate);
  // Нижний ярус
  const tier1 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.85, 0.6, 24),
    new THREE.MeshStandardMaterial({ color: 0xffb5c8, roughness: 0.6 }));
  tier1.position.y = 0.38; cake.add(tier1);
  // Кремовая «капельная» окантовка
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const drop = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xfff0f4, roughness: 0.5 }));
    drop.position.set(Math.cos(a) * 0.85, 0.68, Math.sin(a) * 0.85);
    drop.scale.set(1, 1.4, 1);
    cake.add(drop);
  }
  // Верхний ярус (поменьше)
  const tier2 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.45, 22),
    new THREE.MeshStandardMaterial({ color: 0xfff0f4, roughness: 0.6 }));
  tier2.position.y = 0.93; cake.add(tier2);
  // Вишенка сверху
  const cherry = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd02a3a, roughness: 0.4,
      emissive: 0x551018, emissiveIntensity: 0.3 }));
  cherry.position.y = 1.27; cake.add(cherry);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6),
    new THREE.MeshStandardMaterial({ color: 0x3d6b1a }));
  stem.position.y = 1.4; stem.rotation.z = -0.3; cake.add(stem);
  // Ягодки/конфетки на боку нижнего яруса
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const candy = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff6464, roughness: 0.5 }));
    candy.position.set(Math.cos(a) * 0.85, 0.4, Math.sin(a) * 0.85);
    cake.add(candy);
  }
  return cake;
}

// =============================================================
// Препятствия Хогвартса: светящаяся магическая сфера, высокое облако, грозовая туча
// =============================================================
function buildGlowingOrb() {
  // Препятствие «прыжок» (hb h=1.0): магическая светящаяся сфера в воздухе.
  // Аналог конуса у Мухаммеда — низкое и компактное.
  const g = new THREE.Group();

  // Внешний мягкий ореол
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.46, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xc8e6ff, transparent: true, opacity: 0.22 }));
  halo.position.y = 0.55; g.add(halo);

  // Средний слой свечения
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0x80b8ff, transparent: true, opacity: 0.4 }));
  glow.position.y = 0.55; g.add(glow);

  // Сердцевина сферы — сильно эмиссивная (выглядит как лампа)
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 20, 16),
    new THREE.MeshStandardMaterial({
      color: 0xeaf4ff,
      emissive: 0x6aa8ff, emissiveIntensity: 2.2,
      roughness: 0.25,
    }));
  core.position.y = 0.55; g.add(core);

  // Яркая «лампочка» внутри для контраста
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  spark.position.y = 0.55; g.add(spark);

  // Хороводящие искорки на орбите вокруг центра
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = 0.4;
    const sp = new THREE.Mesh(
      new THREE.SphereGeometry(0.025 + Math.random() * 0.012, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xfff8e0 }));
    sp.position.set(
      Math.cos(a) * r,
      0.55 + Math.sin(a) * 0.08,
      Math.sin(a) * r * 0.4);
    g.add(sp);
  }

  // Тонкое экваториальное кольцо — добавляет «магичности»
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.38, 0.012, 6, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff8c0, transparent: true, opacity: 0.75 }));
  ring.position.y = 0.55;
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  return g;
}

function buildHighCloud() {
  // Препятствие «подкат» (hb yMin=1.55, h=0.5, w=2.0): пухлое облако,
  // нависающее на уровне головы — нужно пригнуться/подкатиться.
  const g = new THREE.Group();

  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xf6f0ff, roughness: 1.0,
    emissive: 0x8088c0, emissiveIntensity: 0.22 });
  const cloudHi = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.9,
    emissive: 0xc0c8e8, emissiveIntensity: 0.3 });

  // Кластер мягких сфер, тянется по X — занимает ~2 единиц ширины
  const positions = [
    [-0.9, 1.75, 0.0],
    [-0.5, 1.92, 0.08],
    [-0.15, 1.85, -0.05],
    [0.25, 1.95, 0.05],
    [0.6, 1.88, -0.05],
    [0.9, 1.78, 0.05],
    [-0.7, 2.02, -0.08],
    [0.1, 2.0, -0.1],
    [0.75, 2.0, -0.08],
  ];
  for (const [x, y, z] of positions) {
    const r = 0.26 + Math.random() * 0.1;
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(r, 14, 10),
      Math.random() < 0.3 ? cloudHi : cloudMat);
    puff.position.set(x, y, z);
    puff.scale.y = 0.75;
    g.add(puff);
  }

  // Лёгкие «дождинки» искорками под облаком — чтобы было ясно, что это нависает
  for (let i = 0; i < 5; i++) {
    const sparkle = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    sparkle.position.set(-0.8 + i * 0.4, 1.55 + Math.random() * 0.05, 0.06);
    g.add(sparkle);
  }

  return g;
}

function buildStormCloud() {
  // Препятствие «менять полосу» (hb w=1.7, h=1.5, d=3.0): тёмная грозовая туча с молнией
  const g = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0x3a3850, roughness: 1.0,
    emissive: 0x1a1838, emissiveIntensity: 0.35 });
  const cloudHi = new THREE.MeshStandardMaterial({
    color: 0x5a5878, roughness: 1.0 });

  // Кластер сфер — тело тучи в верхней половине hitbox (y 0.9..1.5)
  const cloudPos = [
    [-0.65, 1.15, -1.0], [0.0, 1.32, -0.85],
    [0.6,  1.18, -0.95], [-0.3, 1.4, -0.2],
    [0.35, 1.4, 0.2],    [-0.55, 1.1, 1.0],
    [0.1,  1.25, 1.0],   [0.55, 1.0, 0.75],
    [-0.75, 1.2, 0.25],
  ];
  for (const [x, y, z] of cloudPos) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.58, 12, 10),
      Math.random() < 0.3 ? cloudHi : cloudMat);
    s.position.set(x, y, z);
    s.scale.setScalar(0.85 + Math.random() * 0.35);
    g.add(s);
  }

  // Молния — зигзаг из светящихся «брусков» под тучей (y 0.0..0.95)
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xfff080 });
  const boltSeg = [
    [0.0,  0.92,  0.1,  0.6],
    [0.1,  0.6,  -0.18, 0.28],
    [-0.18, 0.28, 0.05, -0.0],
    [0.05, -0.0, -0.1,  -0.3],
  ];
  for (const [x0, y0, x1, y1] of boltSeg) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(len, 0.07, 0.04), boltMat);
    seg.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    seg.rotation.z = ang;
    g.add(seg);
  }
  // Сияющий ореол вокруг молнии
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0xfff080, transparent: true, opacity: 0.28 }));
  halo.position.set(0, 0.4, 0); g.add(halo);

  // Дождевые штрихи (несколько вертикальных капель)
  const rainMat = new THREE.MeshBasicMaterial({
    color: 0x9ab6e0, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 10; i++) {
    const r = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.35, 5), rainMat);
    r.position.set(
      -0.75 + Math.random() * 1.5,
      0.55 + Math.random() * 0.3,
      -1.1 + Math.random() * 2.2);
    g.add(r);
  }

  return g;
}

// =============================================================
// Препятствия Стамбула — другие машины разных моделей.
// buildIstanbulCar — фабрика: возвращает свежую модель каждый спавн.
// Hitbox wide стандартный (1.7 × 1.5 × 3.0), так что любая модель
// должна вписываться в эти габариты по «средней» массе.
// =============================================================
function buildIstanbulCar() {
  const variants = [
    'sedan', 'sedan', 'suv', 'hatchback', 'sport', 'taxi', 'pickup',
  ];
  const v = variants[Math.floor(Math.random() * variants.length)];
  const bodyColors = [
    0xffffff, 0x101012, 0xb0b0b6, 0x2a3a5e, 0x6e2e2e,
    0xc4862a, 0x2c6fb5, 0x2a6a3a, 0xcfcfd2,
  ];
  let color = bodyColors[Math.floor(Math.random() * bodyColors.length)];
  if (v === 'taxi') color = 0xffd040;

  const bodyMat = new THREE.MeshStandardMaterial({
    color, roughness: 0.5, metalness: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x2a3a4a, roughness: 0.15, metalness: 0.6,
    transparent: true, opacity: 0.55 });
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.85 });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe6e8ea, roughness: 0.25, metalness: 0.9 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d8, emissive: 0xffe2a0, emissiveIntensity: 0.5 });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff3030, emissive: 0xa01010, emissiveIntensity: 0.5 });

  const car = new THREE.Group();

  // Параметры варианта
  let dims;
  if (v === 'suv') {
    dims = { len: 2.8, w: 1.6, lowerH: 0.55, upperH: 0.85, upperLen: 1.8 };
  } else if (v === 'hatchback') {
    dims = { len: 2.4, w: 1.5, lowerH: 0.45, upperH: 0.55, upperLen: 1.5 };
  } else if (v === 'sport') {
    dims = { len: 2.9, w: 1.55, lowerH: 0.42, upperH: 0.42, upperLen: 1.1 };
  } else if (v === 'pickup') {
    dims = { len: 3.0, w: 1.6, lowerH: 0.5, upperH: 0.55, upperLen: 0.9 };
  } else {
    // sedan и taxi
    dims = { len: 2.85, w: 1.55, lowerH: 0.48, upperH: 0.55, upperLen: 1.4 };
  }

  // Нижний корпус
  const lower = new THREE.Mesh(
    new THREE.BoxGeometry(dims.w, dims.lowerH, dims.len), bodyMat);
  lower.position.y = 0.36; car.add(lower);

  // Верхняя кабина (со смещением вперёд для sport, по центру для остальных)
  const upperZ = v === 'sport' ? -0.05 : (v === 'pickup' ? -0.5 : 0.1);
  const upper = new THREE.Mesh(
    new THREE.BoxGeometry(dims.w - 0.1, dims.upperH, dims.upperLen), bodyMat);
  upper.position.set(0, 0.36 + dims.lowerH / 2 + dims.upperH / 2, upperZ);
  car.add(upper);

  // Стёкла — пара плоскостей по бокам кабины
  for (const sx of [-1, 1]) {
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, dims.upperH * 0.7, dims.upperLen * 0.85), glassMat);
    win.position.set(sx * (dims.w / 2 - 0.05), upper.position.y, upperZ);
    car.add(win);
  }
  // Лобовое и заднее стекло
  for (const sz of [-1, 1]) {
    const ws = new THREE.Mesh(
      new THREE.BoxGeometry(dims.w - 0.16, dims.upperH * 0.65, 0.05), glassMat);
    ws.position.set(0, upper.position.y, upperZ + sz * (dims.upperLen / 2 - 0.025));
    car.add(ws);
  }

  // Кузов pickup — открытый багажник сзади
  if (v === 'pickup') {
    const bedFloor = new THREE.Mesh(
      new THREE.BoxGeometry(dims.w - 0.08, 0.04, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.85 }));
    bedFloor.position.set(0, 0.36 + dims.lowerH / 2 + 0.02, 0.65);
    car.add(bedFloor);
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.25, 1.0), bodyMat);
      wall.position.set(sx * (dims.w / 2 - 0.03), 0.36 + dims.lowerH / 2 + 0.12, 0.65);
      car.add(wall);
    }
  }

  // Фары спереди (-Z)
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 10), lampMat);
    lamp.scale.set(1.0, 0.55, 0.5);
    lamp.position.set(sx * (dims.w / 2 - 0.18), 0.55, -dims.len / 2 - 0.005);
    car.add(lamp);
  }
  // Задние фонари (+Z)
  for (const sx of [-1, 1]) {
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.1, 0.03), tailMat);
    tail.position.set(sx * (dims.w / 2 - 0.22), 0.6, dims.len / 2 + 0.005);
    car.add(tail);
  }

  // Решётка спереди
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(dims.w * 0.6, 0.18, 0.04), blackMat);
  grille.position.set(0, 0.42, -dims.len / 2 - 0.005); car.add(grille);

  // Бампер
  const bumper = new THREE.Mesh(
    new THREE.BoxGeometry(dims.w + 0.05, 0.12, 0.08), chromeMat);
  bumper.position.set(0, 0.22, -dims.len / 2 + 0.03); car.add(bumper);
  const bumperRear = bumper.clone();
  bumperRear.position.z = dims.len / 2 - 0.03;
  car.add(bumperRear);

  // Колёса
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const rimMat  = new THREE.MeshStandardMaterial({
    color: 0xb0b6c0, roughness: 0.45, metalness: 0.8 });
  const wheelR = v === 'suv' ? 0.34 : v === 'sport' ? 0.3 : 0.32;
  const wheelOffsetZ = dims.len / 2 - 0.55;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(wheelR, wheelR, 0.22, 14), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(sx * (dims.w / 2 - 0.02), wheelR, sz * wheelOffsetZ);
    car.add(tire);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(wheelR * 0.6, wheelR * 0.6, 0.23, 14), rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.copy(tire.position);
    car.add(rim);
  }

  // Шашечки для такси — пара жёлто-чёрных квадратиков на дверях
  if (v === 'taxi') {
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const sq = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.12, 0.02),
          new THREE.MeshStandardMaterial({
            color: i % 2 ? 0x101010 : 0xffd040, roughness: 0.55 }));
        sq.position.set(sx * (dims.w / 2 - 0.005),
                         0.5 + (i % 2) * 0.12,
                         -0.4 + i * 0.14);
        sq.rotation.y = Math.PI / 2;
        car.add(sq);
      }
    }
    // «TAXI» табличка на крыше
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.2, 0.25),
      new THREE.MeshStandardMaterial({
        color: 0xffd040, emissive: 0xff9020, emissiveIntensity: 0.4 }));
    sign.position.set(0, upper.position.y + dims.upperH / 2 + 0.12, upperZ);
    car.add(sign);
  }

  return car;
}

// =============================================================
// Боковая среда: Дубай (пальма / вилла / кактус)
// =============================================================
function buildPalmTree() {
  const palm = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18 - i * 0.015, 0.22 - i * 0.015, 0.9, 8), trunkMat);
    seg.position.set(i * 0.05, 0.45 + i * 0.85, 0); seg.rotation.z = -0.04;
    palm.add(seg);
  }
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4d7a2e, roughness: 0.9 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.4, 6), leafMat);
    leaf.position.set(Math.cos(a) * 0.55 + 0.25, 4.6, Math.sin(a) * 0.55);
    leaf.rotation.z = Math.cos(a) * 0.9; leaf.rotation.x = Math.sin(a) * 0.9;
    leaf.scale.set(1, 1, 0.4);
    palm.add(leaf);
  }
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a2614, roughness: 0.95 }));
    c.position.set(0.25 + Math.cos(i * 2) * 0.18, 4.35, Math.sin(i * 2) * 0.18);
    palm.add(c);
  }
  return palm;
}
function buildVilla() {
  const w = 2.5 + Math.random() * 2.5;
  const h = 2.5 + Math.random() * 3.5;
  const d = 2.5 + Math.random() * 3;
  const colors = [0xeed7a6, 0xe2c181, 0xd4a877, 0xc99a5e, 0xeae0c8];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const villa = new THREE.Group();
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  walls.position.y = h / 2; villa.add(walls);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.2, 0.2, d + 0.2),
    new THREE.MeshStandardMaterial({ color: 0xb89868, roughness: 0.9 }));
  roof.position.y = h + 0.1; villa.add(roof);
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.4, h * 0.35, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x6dabd6, metalness: 0.6, roughness: 0.2,
      emissive: 0x223a55, emissiveIntensity: 0.2 }));
  win.position.set(0, h * 0.55, d / 2 + 0.03); villa.add(win);
  return villa;
}
function buildCactus() {
  const bush = new THREE.Group();
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x6a8a4a, roughness: 0.9 });
  const main = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.9, 8), bushMat);
  main.position.y = 0.45; bush.add(main);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.4, 6), bushMat);
    arm.position.set(sx * 0.18, 0.55, 0); arm.rotation.z = sx * 0.5;
    bush.add(arm);
  }
  return bush;
}

// =============================================================
// Боковая среда: конфетный мир (мини-домик / маленький леденец / зефир)
// =============================================================
function buildCandyHouse() {
  const w = 2.3 + Math.random() * 1.8;
  const h = 2.3 + Math.random() * 2;
  const d = 2.3 + Math.random() * 1.8;
  const wallC = [0xffd6c3, 0xffcab8, 0xffe2cf, 0xfdb89e][Math.floor(Math.random() * 4)];
  const roofC = [0xff6a8a, 0xff89a6, 0xc24a78, 0xff9b8a][Math.floor(Math.random() * 4)];
  const house = new THREE.Group();
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: wallC, roughness: 0.9 }));
  walls.position.y = h / 2; house.add(walls);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(w, d) * 0.7, 1.4, 4),
    new THREE.MeshStandardMaterial({ color: roofC, roughness: 0.8 }));
  roof.position.y = h + 0.7; roof.rotation.y = Math.PI / 4;
  house.add(roof);
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.35, h * 0.3, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xffd86b, emissive: 0xffaa44, emissiveIntensity: 0.3 }));
  win.position.set(0, h * 0.55, d / 2 + 0.03); house.add(win);
  return house;
}
function buildLollipop() {
  const lolly = new THREE.Group();
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 2.2, 10),
    new THREE.MeshStandardMaterial({ color: 0xfff5e0, roughness: 0.5 }));
  stick.position.y = 1.1; lolly.add(stick);
  const colors = [0xff6aa6, 0xa8e6ff, 0xfff4a4, 0xc4a4ff];
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 0.12, 18),
    new THREE.MeshStandardMaterial({
      color: colors[Math.floor(Math.random() * colors.length)], roughness: 0.4 }));
  disc.rotation.x = Math.PI / 2; disc.position.y = 2.3;
  lolly.add(disc);
  const spiral = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.07, 6, 18),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
  spiral.position.y = 2.32; spiral.rotation.x = Math.PI / 2;
  lolly.add(spiral);
  return lolly;
}
function buildCottonCandyBush() {
  const bush = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffb5d0, roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const r = 0.4 + Math.random() * 0.4;
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
    s.position.set((Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.2,
                   (Math.random() - 0.5) * 0.6);
    bush.add(s);
  }
  return bush;
}

// =============================================================
// Боковая среда: Хогвартс (парящая свеча / гнутое дерево / башенка)
// =============================================================
function buildHogwartsCandle() {
  const g = new THREE.Group();
  const waxMat = new THREE.MeshStandardMaterial({ color: 0xf4e4c4, roughness: 0.7 });
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xffc070, emissive: 0xff8a20, emissiveIntensity: 1.9,
    transparent: true, opacity: 0.9 });
  // Кластер из 3-4 парящих свечей на разной высоте
  const n = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) {
    const x = (Math.random() - 0.5) * 0.7;
    const z = (Math.random() - 0.5) * 0.6;
    const y = 1.3 + i * 0.6 + Math.random() * 0.3;
    const candle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.1, 0.6, 12), waxMat);
    candle.position.set(x, y, z); g.add(candle);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), flameMat);
    flame.scale.set(1, 1.8, 1);
    flame.position.set(x, y + 0.38, z); g.add(flame);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffc070, transparent: true, opacity: 0.22 }));
    halo.position.set(x, y + 0.38, z); g.add(halo);
  }
  return g;
}

function buildFloatingIsland() {
  // Парящий скальный обломок с мини-башенкой — заменяет дерево,
  // потому что мы летим в небе и наземные деревья не вяжутся
  const g = new THREE.Group();
  const rockMat  = new THREE.MeshStandardMaterial({ color: 0x4a4868, roughness: 0.95 });
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x3a5e6e, roughness: 1.0 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4868, roughness: 0.9 });
  const roofMat  = new THREE.MeshStandardMaterial({ color: 0x2a2848, roughness: 0.85 });
  const winMat   = new THREE.MeshStandardMaterial({
    color: 0xffd070, emissive: 0xffa040, emissiveIntensity: 1.4 });

  // Скальное основание — конус остриём вниз
  const rock = new THREE.Mesh(
    new THREE.ConeGeometry(1.05, 1.8, 8), rockMat);
  rock.position.y = 1.6; rock.rotation.x = Math.PI;
  g.add(rock);
  // Травянистая «шапка» сверху
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 0.95, 0.32, 12), grassMat);
  cap.position.y = 2.6; g.add(cap);
  // Мини-башенка на острове
  const towerBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.42, 1.4, 10), stoneMat);
  towerBody.position.y = 3.45; g.add(towerBody);
  // Шпиль
  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 0.9, 10), roofMat);
  spire.position.y = 4.6; g.add(spire);
  // Светящееся окно
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.28, 0.1), winMat);
  win.position.set(0, 3.45, 0.4); g.add(win);

  // Отколовшиеся камешки парят под основанием
  for (let i = 0; i < 5; i++) {
    const bit = new THREE.Mesh(
      new THREE.SphereGeometry(0.14 + Math.random() * 0.1, 8, 6), rockMat);
    bit.position.set(
      (Math.random() - 0.5) * 1.1,
      0.2 + Math.random() * 0.7,
      (Math.random() - 0.5) * 1.1);
    g.add(bit);
  }
  return g;
}

function buildHogwartsTurret() {
  // Парящая башня — каменный шпиль на пухлой облачной подушке
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4868, roughness: 0.9 });
  const roofMat  = new THREE.MeshStandardMaterial({ color: 0x2a2848, roughness: 0.85 });
  const winMat   = new THREE.MeshStandardMaterial({
    color: 0xffd070, emissive: 0xffa040, emissiveIntensity: 1.4 });
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xe6e6f5, roughness: 1.0,
    emissive: 0x4a5290, emissiveIntensity: 0.18 });

  // Облачная подушка-основание (видно, что башня парит)
  for (let i = 0; i < 7; i++) {
    const r = 0.5 + Math.random() * 0.4;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), cloudMat);
    puff.position.set(
      (Math.random() - 0.5) * 1.4,
      0.4 + Math.random() * 0.3,
      (Math.random() - 0.5) * 1.4);
    puff.scale.y = 0.6;
    g.add(puff);
  }

  const baseY = 1.0;
  const h = 3.4 + Math.random() * 1.6;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.9, h, 10), stoneMat);
  body.position.y = baseY + h / 2; g.add(body);
  // Зубчатый венец под крышу
  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(0.78, 0.78, 0.22, 10), stoneMat);
  crown.position.y = baseY + h + 0.11; g.add(crown);
  // Шпиль
  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(0.85, 1.6, 10), roofMat);
  spire.position.y = baseY + h + 1.02; g.add(spire);
  // Окошки
  for (let i = 0; i < 2; i++) {
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.42, 0.1), winMat);
    win.position.set(0, baseY + 1.1 + i * 1.4, 0.82);
    g.add(win);
    const win2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.42, 0.1), winMat);
    win2.position.set(0.82, baseY + 1.1 + i * 1.4, 0);
    win2.rotation.y = Math.PI / 2;
    g.add(win2);
  }
  return g;
}

// =============================================================
// Боковая среда: Стамбул (современный жилой дом / платан / фонарь)
// =============================================================
function buildIstanbulApartment() {
  // Современная жилая башня — прямоугольная коробка с поэтажными окнами
  const g = new THREE.Group();
  const w = 2.4 + Math.random() * 1.6;
  const d = 2.0 + Math.random() * 1.4;
  const h = 8 + Math.random() * 8;
  const wallC = [0xeae0c8, 0xd6cdb2, 0xc8c0a0, 0xe2d8c0][Math.floor(Math.random() * 4)];
  const accent = [0x6e92a8, 0x8aa098, 0xa07a5a, 0x3a4858][Math.floor(Math.random() * 4)];

  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: wallC, roughness: 0.85 }));
  walls.position.y = h / 2; g.add(walls);
  // Плоская крыша
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.2, 0.18, d + 0.2),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 }));
  roof.position.y = h + 0.09; g.add(roof);

  // Балконы рядами
  const floors = Math.floor(h / 1.6);
  for (let f = 1; f <= floors; f++) {
    const y = f * (h / (floors + 1));
    const balcony = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.85, 0.06, 0.18),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 }));
    balcony.position.set(0, y, d / 2 + 0.09); g.add(balcony);
    // Окно за балконом
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.6, 0.55, 0.05),
      new THREE.MeshStandardMaterial({
        color: 0xa8c8e0, metalness: 0.6, roughness: 0.25,
        emissive: 0x1a3a55, emissiveIntensity: 0.15 }));
    win.position.set(0, y + 0.2, d / 2 + 0.025); g.add(win);
  }
  return g;
}

function buildPlaneTree() {
  // Платан / уличное дерево — широкая зелёная крона, серый ствол
  const tree = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a6e58, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4e7a3c, roughness: 0.9 });
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 2.2, 8), trunkMat);
  trunk.position.y = 1.1; tree.add(trunk);
  for (let i = 0; i < 5; i++) {
    const r = 0.7 + Math.random() * 0.4;
    const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), leafMat);
    blob.position.set(
      (Math.random() - 0.5) * 1.0,
      2.4 + Math.random() * 0.6,
      (Math.random() - 0.5) * 1.0);
    tree.add(blob);
  }
  return tree;
}

function buildPromenadeLamp() {
  // Декоративный набережный фонарь — высокий тонкий столб с двумя плафонами
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.85 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d0, emissive: 0xffd060, emissiveIntensity: 0.6 });
  // База
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.28, 0.32, 12), poleMat);
  base.position.y = 0.16; g.add(base);
  // Столб
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 3.6, 8), poleMat);
  pole.position.y = 2.0; g.add(pole);
  // Поперечина
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.05, 0.05), poleMat);
  arm.position.y = 3.6; g.add(arm);
  // Два плафона
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 10), lampMat);
    lamp.position.set(sx * 0.6, 3.45, 0); g.add(lamp);
    // Хомутик
    const clip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.12, 6), poleMat);
    clip.position.set(sx * 0.6, 3.6, 0); g.add(clip);
  }
  return g;
}

// =============================================================
// Игрок: общая обёртка (кладёт модель в holder + создаёт тень)
// =============================================================
function buildPlayer(char) {
  player = new THREE.Group();
  const modelHolder = new THREE.Group();
  modelHolder.add(templates.player.clone(true));
  player.add(modelHolder);
  player.userData.modelHolder = modelHolder;
  player.userData.hover = !!templates.player.userData.hover;
  player.userData.char = char.id;

  const shadowColor = char.theme === 'dubai'
    ? 0x2a1a0a
    : char.theme === 'hogwarts'
      ? 0x0a1230
      : char.theme === 'istanbul'
        ? 0x2a3a4a
        : 0xc06080;
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 24),
    new THREE.MeshBasicMaterial({ color: shadowColor, transparent: true, opacity: 0.32 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  scene.add(shadow);
  player.userData.shadow = shadow;
  themeRefs.shadow = shadow;

  player.position.set(LANES[playerLane], PLAYER_BASE_Y, 0);
  scene.add(player);
}

// =============================================================
// Частицы при сборе предмета
// =============================================================
function spawnPickupParticles(x, y, z) {
  const theme = currentCharacter && currentCharacter.theme;
  const baseColor = theme === 'dubai' ? 0xffa840
                  : theme === 'hogwarts' ? 0xffd860
                  : theme === 'istanbul' ? 0x7ad080
                  : 0xff8aaa;
  const mat = new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 1 });
  const geo = new THREE.SphereGeometry(0.08, 6, 5);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.position.set(x, y, z); scene.add(m);
    const a = Math.random() * Math.PI * 2;
    particles.push({
      mesh: m,
      vx: Math.cos(a) * (1.5 + Math.random() * 1.5),
      vy: 1.5 + Math.random() * 2.5,
      vz: Math.sin(a) * (1.5 + Math.random() * 1.5),
      life: 0, maxLife: 0.5 + Math.random() * 0.2,
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      scene.remove(p.mesh); p.mesh.material.dispose();
      particles.splice(i, 1); continue;
    }
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.vy -= 8 * dt;
    p.mesh.material.opacity = 1 - (p.life / p.maxLife);
    p.mesh.scale.setScalar(1 + p.life * 1.5);
  }
}

// =============================================================
// UI / события
// =============================================================
function setupUI() {
  document.getElementById('btn-start').addEventListener('click', openCharacterSelect);
  document.getElementById('btn-restart').addEventListener('click', restartGame);
  document.getElementById('btn-character-back').addEventListener('click', backToMenu);
  document.getElementById('btn-go-menu').addEventListener('click', backToMenu);
}

function buildCharacterGrid() {
  const grid = document.getElementById('character-grid');
  grid.innerHTML = '';
  for (const id of CHARACTER_ORDER) {
    const c = CHARACTERS[id];
    const card = document.createElement('button');
    card.className = 'char-card' + (c.locked ? ' locked' : '');
    card.dataset.id = c.id;
    card.innerHTML = `<span class="char-name">${c.name}</span>`;
    if (!c.locked) card.addEventListener('click', () => pickCharacter(c.id));
    grid.appendChild(card);
  }
}

function openCharacterSelect() {
  gameState = 'character-select';
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('character-screen').classList.remove('hidden');
}

function pickCharacter(id) {
  const char = CHARACTERS[id];
  if (!char || char.locked) return;
  // Если уже играли этим — не пересобираем сцену
  if (!currentCharacter || currentCharacter.id !== id) applyCharacter(char);
  document.getElementById('character-screen').classList.add('hidden');
  startGame();
}

function restartGame() {
  // Перезапуск с тем же героем
  if (!currentCharacter) { backToMenu(); return; }
  startGame();
}

function setupPause() {
  const panel    = document.getElementById('pause-panel');
  const btnPause = document.getElementById('btn-pause');
  const btnResume  = document.getElementById('btn-resume');
  const btnRestart = document.getElementById('btn-pause-restart');
  const btnMenu    = document.getElementById('btn-pause-menu');

  btnPause.addEventListener('click', () => {
    if (gameState === 'playing') pauseGame();
  });
  btnResume.addEventListener('click', resumeGame);
  btnRestart.addEventListener('click', () => {
    document.getElementById('pause-panel').classList.add('hidden');
    restartGame();
  });
  btnMenu.addEventListener('click', () => {
    document.getElementById('pause-panel').classList.add('hidden');
    backToMenu();
  });
  panel.addEventListener('click', (e) => {
    if (e.target === panel) resumeGame();
  });
}

function pauseGame() {
  if (gameState !== 'playing') return;
  gameState = 'paused';
  document.getElementById('pause-panel').classList.remove('hidden');
  audio.pauseBg();
}
function resumeGame() {
  if (gameState !== 'paused') return;
  document.getElementById('pause-panel').classList.add('hidden');
  gameState = 'playing';
  if (clock) clock.getDelta();
  audio.resumeBg();
}
function backToMenu() {
  gameState = 'menu';
  audio.stopBg();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('btn-pause').classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('pause-panel').classList.add('hidden');
  document.getElementById('character-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
  document.getElementById('best-score-start').textContent = maxBestScore();
}

function setupVisibility() {
  const onHide = () => {
    audio.pauseBg();
    if (gameState === 'playing') pauseGame();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onHide();
  });
  window.addEventListener('pagehide', onHide);
  window.addEventListener('blur', onHide);
}

function setupSettings() {
  const panel = document.getElementById('settings-panel');
  const btnOpen  = document.getElementById('btn-settings');
  const btnClose = document.getElementById('btn-close-settings');
  const slider   = document.getElementById('vol-slider');
  const valLabel = document.getElementById('vol-value');
  const muteCb   = document.getElementById('mute-checkbox');

  slider.value = Math.round(audio.volume * 100);
  valLabel.textContent = `${slider.value}%`;
  muteCb.checked = audio.muted;

  btnOpen.addEventListener('click', () => {
    if (gameState === 'playing') {
      pauseGame();
      document.getElementById('pause-panel').classList.add('hidden');
    }
    panel.classList.remove('hidden');
  });
  const closeSettings = () => {
    panel.classList.add('hidden');
    if (gameState === 'paused') {
      document.getElementById('pause-panel').classList.remove('hidden');
    }
  };
  btnClose.addEventListener('click', closeSettings);
  panel.addEventListener('click', (e) => {
    if (e.target === panel) closeSettings();
  });

  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10) / 100;
    audio.setVolume(v);
    valLabel.textContent = `${slider.value}%`;
    if (audio.muted && v > 0) muteCb.checked = false;
  });
  const onMuteToggle = () => audio.setMuted(muteCb.checked);
  muteCb.addEventListener('change', onMuteToggle);
  muteCb.addEventListener('click', onMuteToggle);
}

function setupInput() {
  let sx = 0, sy = 0, tracking = false;
  const SWIPE_MIN = 30;

  const canvas = document.getElementById('game-canvas');
  canvas.addEventListener('touchstart', (e) => {
    if (gameState !== 'playing') return;
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY; tracking = true;
  }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    if (!tracking || gameState !== 'playing') return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      dx > 0 ? moveLane(+1) : moveLane(-1);
    } else {
      dy < 0 ? doJump() : doSlide();
    }
  }, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (gameState === 'playing') pauseGame();
      else if (gameState === 'paused') resumeGame();
      return;
    }
    if (gameState !== 'playing') return;
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': moveLane(-1); break;
      case 'ArrowRight': case 'KeyD': moveLane(+1); break;
      case 'ArrowUp': case 'KeyW': case 'Space': doJump(); break;
      case 'ArrowDown': case 'KeyS': doSlide(); break;
    }
  });
}

function moveLane(dir) {
  const next = Math.max(0, Math.min(2, playerLane + dir));
  if (next === playerLane) return;
  playerLane = next;
  playerTargetX = LANES[playerLane];
}
function doJump() {
  // В режиме «только смена полосы» (Абдулла и Арслан в кабриолете) прыжков нет
  if (currentCharacter && currentCharacter.mode === 'lanes-only') return;
  if (isJumping || isSliding) return;
  isJumping = true; jumpTime = 0;
}
function doSlide() {
  // В режиме «только смена полосы» подкатов тоже нет
  if (currentCharacter && currentCharacter.mode === 'lanes-only') return;
  if (isSliding || isJumping) return;
  isSliding = true; slideTime = 0;
}

// =============================================================
// Запуск / перезапуск раунда
// =============================================================
function startGame() {
  oranges = 0;
  distance = 0;
  speed = START_SPEED;
  playerLane = 1;
  playerTargetX = LANES[1];
  isJumping = false; isSliding = false; jumpTime = 0; slideTime = 0;
  if (player) {
    player.position.set(LANES[1], PLAYER_BASE_Y, 0);
    player.scale.set(1, 1, 1);
  }

  clearActiveSpawns();
  farthestRowZ = -ROW_SPACING * 2;
  farthestBuildingZ = -10;

  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('character-screen').classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('pause-panel').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('btn-pause').classList.remove('hidden');
  updateHUD();

  audio.unduckBg();
  audio.startBg();

  gameState = 'playing';
}

function gameOver() {
  gameState = 'gameover';
  if (oranges > bestScore) {
    bestScore = oranges;
    if (currentCharacter) localStorage.setItem(currentCharacter.bestKey, String(bestScore));
  }
  document.getElementById('final-score').textContent = oranges;
  document.getElementById('final-distance').textContent = Math.floor(distance);
  document.getElementById('best-score-end').textContent = bestScore;
  document.getElementById('best-score-start').textContent = maxBestScore();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('btn-pause').classList.add('hidden');
  document.getElementById('gameover-screen').classList.remove('hidden');

  audio.duckBg();
  audio.playGameover();
}

// =============================================================
// Спавн рядов препятствий и собираемых
// =============================================================
function spawnRow(z) {
  // Режим «только смена полосы» (Абдулла и Арслан): только wide-машины,
  // 1-2 полосы заблокированы, одна гарантированно свободна — игрок маневрирует.
  if (currentCharacter && currentCharacter.mode === 'lanes-only') {
    const lanes = [0, 1, 2];
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    const numCars = Math.random() < 0.45 ? 2 : 1;
    const blocked = new Set(lanes.slice(0, numCars));
    for (const lane of blocked) spawnObstacle('wide', lane, z);
    for (let lane = 0; lane < 3; lane++) {
      if (blocked.has(lane)) continue;
      if (Math.random() < ORANGE_CHAIN_CHANCE) {
        const n = 4 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) spawnOrange(lane, z + i * 1.4);
      } else if (Math.random() < 0.6) {
        spawnOrange(lane, z);
      }
    }
    return;
  }

  const blockedLanes = new Set();
  const wideLane = (Math.random() < 0.18) ? Math.floor(Math.random() * 3) : -1;
  if (wideLane >= 0) blockedLanes.add(wideLane);
  const numOther = 1 + (Math.random() < 0.35 ? 1 : 0);
  for (let i = 0; i < numOther; i++) {
    if (blockedLanes.size >= 2) break;
    const lane = Math.floor(Math.random() * 3);
    if (blockedLanes.has(lane)) continue;
    blockedLanes.add(lane);
    const type = Math.random() < 0.55 ? 'low' : 'mid';
    spawnObstacle(type, lane, z);
  }
  if (wideLane >= 0) spawnObstacle('wide', wideLane, z);

  for (let lane = 0; lane < 3; lane++) {
    if (blockedLanes.has(lane)) continue;
    if (Math.random() < ORANGE_CHAIN_CHANCE) {
      const n = 5 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) spawnOrange(lane, z + i * 1.4);
    } else if (Math.random() < 0.65) {
      spawnOrange(lane, z);
    }
  }
}

function spawnObstacle(type, lane, z) {
  const tplKey = type === 'low' ? 'obstacleLow' : type === 'mid' ? 'obstacleMid' : 'obstacleWide';
  const tpl = templates[tplKey];
  // Шаблон может быть фабрикой (для рандомных моделей машин в Стамбуле) или Object3D.
  const mesh = typeof tpl === 'function' ? tpl() : tpl.clone(true);
  mesh.position.set(LANES[lane], 0, z);
  scene.add(mesh);
  // Хитбоксы как у дубайских аналогов — гарантирует одинаковую сложность для всех тем
  let hitbox;
  if (type === 'low')      hitbox = { w: 0.7, h: 1.0, d: 0.7 };
  else if (type === 'mid') hitbox = { w: 2.0, h: 0.5, d: 0.4, yMin: 1.55 };
  else                     hitbox = { w: 1.7, h: 1.5, d: 3.0 };
  activeObstacles.push({ mesh, type, lane, hitbox });
}

function spawnOrange(lane, z) {
  const mesh = templates.collect.clone(true);
  mesh.position.set(LANES[lane], 1.0, z);
  scene.add(mesh);
  activeOranges.push({ mesh, baseY: 1.0 });
}

// =============================================================
// Боковая среда: на каждый шаг spawn'а — выбираем шаблон случайно
// =============================================================
function spawnSideBuildings(z) {
  for (const side of [-1, 1]) {
    const factories = templates.side;
    if (!factories.length) continue;
    const factory = factories[Math.floor(Math.random() * factories.length)];
    const obj = factory();
    const offset = 5.5 + Math.random() * 3;
    obj.position.set(side * offset, 0, z + (Math.random() - 0.5) * 2);
    obj.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.85 + Math.random() * 0.35;
    obj.scale.setScalar(s);
    scene.add(obj);
    sideBuildings.push({ mesh: obj });
  }
}

// =============================================================
// Коллизии
// =============================================================
function checkCollision() {
  const px = player.position.x, py = player.position.y, pz = player.position.z;
  const playerW = 0.9, playerD = 1.4;
  const playerH = isSliding ? 0.5 : 1.5;
  const playerYCenter = isSliding ? 0.25 : (py + 0.4);
  const pMinX = px - playerW / 2, pMaxX = px + playerW / 2;
  const pMinZ = pz - playerD / 2, pMaxZ = pz + playerD / 2;
  const pMinY = playerYCenter - playerH / 2, pMaxY = playerYCenter + playerH / 2;

  for (const o of activeObstacles) {
    const ox = o.mesh.position.x, oz = o.mesh.position.z;
    const hb = o.hitbox;
    const oMinX = ox - hb.w / 2, oMaxX = ox + hb.w / 2;
    const oMinZ = oz - hb.d / 2, oMaxZ = oz + hb.d / 2;
    let oMinY, oMaxY;
    if (hb.yMin !== undefined) { oMinY = hb.yMin; oMaxY = hb.yMin + hb.h; }
    else { oMinY = 0; oMaxY = hb.h; }
    if (pMaxX < oMinX || pMinX > oMaxX) continue;
    if (pMaxZ < oMinZ || pMinZ > oMaxZ) continue;
    if (pMaxY < oMinY || pMinY > oMaxY) continue;
    return true;
  }
  return false;
}
function checkOrangePickup() {
  const px = player.position.x, pz = player.position.z;
  for (let i = activeOranges.length - 1; i >= 0; i--) {
    const o = activeOranges[i];
    if (Math.abs(o.mesh.position.x - px) < 0.8 && Math.abs(o.mesh.position.z - pz) < 0.9) {
      spawnPickupParticles(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z);
      scene.remove(o.mesh);
      activeOranges.splice(i, 1);
      oranges += 1;
      pulseHUD(); updateHUD();
    }
  }
}

// =============================================================
// HUD
// =============================================================
function updateHUD() {
  document.getElementById('hud-oranges').textContent = oranges;
  document.getElementById('hud-distance').textContent = Math.floor(distance);
}
function pulseHUD() {
  const pill = document.getElementById('hud-oranges');
  if (!pill) return;
  pill.parentElement.classList.remove('pulse');
  void pill.parentElement.offsetWidth;
  pill.parentElement.classList.add('pulse');
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// =============================================================
// Игровой цикл
// =============================================================
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (gameState === 'playing') update(dt);
  renderer.render(scene, camera);
}

function update(dt) {
  speed = Math.min(MAX_SPEED, speed + SPEED_GROWTH * dt);
  const advance = speed * dt;
  distance += advance;

  for (const o of activeObstacles) o.mesh.position.z += advance;
  for (const o of activeOranges) {
    o.mesh.position.z += advance;
    o.mesh.rotation.y += dt * 3;
  }
  for (const b of sideBuildings) b.mesh.position.z += advance;
  farthestRowZ += advance;
  farthestBuildingZ += advance;

  if (groundTexture) groundTexture.offset.y -= advance / 8;

  pruneBehind(activeObstacles);
  pruneBehind(activeOranges);
  pruneBehind(sideBuildings);

  while (farthestRowZ > -SPAWN_AHEAD) {
    farthestRowZ -= ROW_SPACING;
    spawnRow(farthestRowZ);
  }
  while (farthestBuildingZ > -SPAWN_AHEAD) {
    farthestBuildingZ -= 6 + Math.random() * 5;
    spawnSideBuildings(farthestBuildingZ);
  }

  // Сглаженная смена дорожки
  player.position.x += (playerTargetX - player.position.x) * Math.min(1, dt * LANE_LERP);

  // Прыжок
  if (isJumping) {
    jumpTime += dt;
    const t = jumpTime / JUMP_DURATION;
    if (t >= 1) { isJumping = false; player.position.y = PLAYER_BASE_Y; }
    else        player.position.y = PLAYER_BASE_Y + JUMP_HEIGHT * (4 * t * (1 - t));
  } else {
    player.position.y = PLAYER_BASE_Y;
  }

  // Подкат — приплющиваем
  if (isSliding) {
    slideTime += dt;
    if (slideTime >= SLIDE_DURATION) {
      isSliding = false; player.scale.set(1, 1, 1);
    } else {
      player.scale.set(1, 0.45, 1.1);
    }
  } else {
    player.scale.set(1, 1, 1);
  }

  // Покачивание модели + у летающих героев — медленный «парящий» подъём
  const bob = currentCharacter && currentCharacter.id === 'arslan_abdulla'
  ? 0
  : Math.sin(performance.now() * 0.012) * 0.05;
  if (player.userData.modelHolder) {
    const hover = player.userData.hover ? 0.3 + Math.sin(performance.now() * 0.0028) * 0.06 : 0;
    player.userData.modelHolder.position.y = bob + hover;
    player.userData.modelHolder.rotation.z = Math.sin(performance.now() * 0.012) * 0.05;
  }

  // Тень
  if (player.userData.shadow) {
    const sh = player.userData.shadow;
    sh.position.x = player.position.x;
    sh.position.z = player.position.z;
    const heightAbove = Math.max(0, player.position.y - PLAYER_BASE_Y);
    const f = Math.max(0, 1 - heightAbove / 2.2);
    sh.material.opacity = 0.08 + 0.26 * f;
    sh.scale.setScalar(0.7 + 0.45 * f);
  }

  updateParticles(dt);

  // Параллакс скайлайна
  if (themeRefs.skylineGroup) {
    themeRefs.skylineGroup.position.x = Math.sin(distance * 0.002) * 1.5;
  }

  checkOrangePickup();
  if (checkCollision()) { gameOver(); return; }
  updateHUD();
}

function pruneBehind(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr[i].mesh;
    if (m.position.z > DESPAWN_BEHIND) {
      scene.remove(m);
      arr.splice(i, 1);
    }
  }
}
