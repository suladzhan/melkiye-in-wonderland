// =============================================================
// Приключения Мухаммада в Дубае — Capybara Dubai Runner
// 3D-раннер на Three.js. Один файл логики, без сборки.
//
// Замена арта:
//   • Положи модель в assets/ с правильным именем (см. ASSET_PATHS).
//   • Код сам подхватит .glb вместо placeholder'а.
//   • Если файла нет — рисуется заглушка из примитивов.
// =============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------- Пути к арту (заменишь файлы — код подхватит автоматически) ----------
const ASSET_PATHS = {
  capybara: 'assets/capybara.glb',
  orange:   'assets/orange.glb',     // .glb или замени логику на texture для PNG
  cone:     'assets/obstacles/cone.glb',
  barrier:  'assets/obstacles/barrier.glb',
  car:      'assets/obstacles/car.glb',
  burj:     'assets/buildings/burj_khalifa.glb',
};

// ---------- Геймплейные константы ----------
const LANES = [-2.2, 0, 2.2];          // X-координаты трёх дорожек
const PLAYER_BASE_Y = 0.55;            // Высота центра капибары над землёй
const JUMP_HEIGHT = 2.0;
const JUMP_DURATION = 0.55;            // секунд
const SLIDE_DURATION = 0.55;
const LANE_LERP = 12;                  // скорость сглаживания смены дорожки
const START_SPEED = 14;                // ед./сек
const MAX_SPEED = 32;
const SPEED_GROWTH = 0.25;             // прирост в сек
const SPAWN_AHEAD = 90;                // насколько вперёд генерируем
const DESPAWN_BEHIND = 18;             // удаляем, когда уехали за камеру на столько
const ROW_SPACING = 11;                // расстояние между рядами препятствий
const ORANGE_CHAIN_CHANCE = 0.25;      // шанс «цепочки» апельсинов в свободной полосе

// ---------- Аудио (фоновая музыка + звук Game Over) ----------
const audio = {
  bg:       null,
  gameover: null,
  // Сохраняемые настройки (loсalStorage)
  volume:   parseFloat(localStorage.getItem('mukashik_volume') ?? '0.6'),
  muted:    localStorage.getItem('mukashik_muted') === '1',

  init() {
    this.bg = document.getElementById('bg-music');
    this.gameover = document.getElementById('sfx-gameover');
    this.bg.loop = true;
    this.bg.playsInline = true;
    this.bg.setAttribute('playsinline', '');
    this.applyVolume();
  },
  // Какие состояния хотят, чтобы фон звучал. Меняется снаружи (game/pause/visibility).
  shouldPlayBg: false,
  applyVolume() {
    // На iOS Safari volume=0 НЕ останавливает воспроизведение —
    // трек продолжает идти и удерживает аудио-сессию даже при сворачивании.
    // Поэтому при mute делаем настоящий pause(), при unmute — play() (если игра идёт).
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
      // двинул слайдер — авто-снять mute
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
  // Запуск фонового трека (требует user gesture — вызывать с кнопки)
  startBg() {
    if (!this.bg) return;
    this.shouldPlayBg = true;
    if (this.muted) return;
    const p = this.bg.play();
    if (p && p.catch) p.catch(() => { /* браузер запретил — продолжим без музыки */ });
  },
  // Полная остановка фона (выход в меню / сворачивание Safari)
  stopBg() {
    this.shouldPlayBg = false;
    if (this.bg && !this.bg.paused) this.bg.pause();
  },
  // Временно поставить на паузу, не сбрасывая «намерение играть»
  pauseBg() {
    if (this.bg && !this.bg.paused) this.bg.pause();
  },
  // Возобновить, если в принципе хотим, чтобы играло
  resumeBg() {
    if (!this.bg || !this.shouldPlayBg || this.muted) return;
    if (this.bg.paused) {
      const p = this.bg.play();
      if (p && p.catch) p.catch(() => {});
    }
  },
  // Приглушаем фон во время Game Over, восстанавливаем при рестарте
  duckBg() {
    if (!this.bg || this.muted) return;
    this.bg.volume = this.volume * 0.25;
  },
  unduckBg() { this.applyVolume(); },
  playGameover() {
    if (!this.gameover) return;
    this.gameover.currentTime = 0;
    const p = this.gameover.play();
    if (p && p.catch) p.catch(() => {});
  },
};

// ---------- Глобальное состояние ----------
let scene, camera, renderer, clock;
let player;                            // Group: содержит модель + хитбокс
let playerLane = 1;                    // 0 / 1 / 2
let playerTargetX = LANES[1];
let isJumping = false, jumpTime = 0;
let isSliding = false, slideTime = 0;
let speed = START_SPEED;
let distance = 0;                      // пройденная дистанция (метры)
let oranges = 0;
let bestScore = parseInt(localStorage.getItem('mukashik_best') || '0', 10);
let gameState = 'menu';                // 'menu' | 'playing' | 'paused' | 'gameover'

const activeObstacles = [];            // {mesh, type, hitbox}
const activeOranges = [];              // {mesh}
const sideBuildings = [];              // {mesh, lastZ}
const particles = [];                  // {mesh, vx, vy, vz, life, maxLife}
let farthestRowZ = 0;                  // самый дальний ряд (минимум Z), от него идём к -SPAWN_AHEAD
let farthestBuildingZ = 0;
let road, roadTexture;

// Шаблоны (созданы один раз — потом cloneSkeleton/clone)
const templates = {};

// ---------- Старт ----------
init();

function init() {
  // Сцена и фон (закат Дубая)
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6c98e);
  scene.fog = new THREE.Fog(0xf2c98c, 45, 130);

  // Камера: третье лицо, сзади-сверху
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

  buildLights();
  buildSky();
  buildRoad();
  buildSkyline();
  buildTemplates();          // плейсхолдеры — сразу
  tryLoadAssets();           // .glb асинхронно, заменят шаблоны если найдутся

  audio.init();
  buildPlayer();
  setupInput();
  setupUI();
  setupSettings();
  setupPause();
  setupVisibility();

  clock = new THREE.Clock();
  window.addEventListener('resize', onResize);

  animate();
}

// ---------- Свет (золотой час над Дубаем) ----------
function buildLights() {
  // Солнце — низкое, тёплое, светит сбоку-сзади (имитирует закат)
  const sun = new THREE.DirectionalLight(0xffd6a0, 1.4);
  sun.position.set(-15, 8, -25);
  scene.add(sun);
  // Заливающий тёплый свет от неба к песку
  const hemi = new THREE.HemisphereLight(0xffd9b3, 0xc9a070, 0.85);
  scene.add(hemi);
  // Лёгкий контровой свет, чтобы силуэты «отрывались» от фона
  const rim = new THREE.DirectionalLight(0xff8c4a, 0.55);
  rim.position.set(10, 5, 10);
  scene.add(rim);
}

// ---------- Небо: градиент через большую сферу ----------
function buildSky() {
  const skyGeo = new THREE.SphereGeometry(150, 24, 16);
  // Градиент через шейдер
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top:    { value: new THREE.Color(0x6fb6ff) },  // верх — голубой
      mid:    { value: new THREE.Color(0xffb265) },  // середина — оранжевый
      bottom: { value: new THREE.Color(0xffe0a0) },  // низ — песочный
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
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

// ---------- Песочный путь через пустыню ----------
function buildRoad() {
  // Процедурная текстура песка — шум из эллипсов разных оттенков
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  // базовая заливка
  g.fillStyle = '#d9b072';
  g.fillRect(0, 0, c.width, c.height);
  // мелкие пятна песка
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    const r = 1 + Math.random() * 3;
    const v = Math.random();
    g.fillStyle = v < 0.33 ? 'rgba(180,140,90,0.45)'
              : v < 0.66 ? 'rgba(238,205,150,0.4)'
                         : 'rgba(120,90,60,0.25)';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // редкие следы / трещины
  g.strokeStyle = 'rgba(120,90,60,0.15)';
  g.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    g.moveTo(Math.random() * c.width, Math.random() * c.height);
    g.bezierCurveTo(
      Math.random() * c.width, Math.random() * c.height,
      Math.random() * c.width, Math.random() * c.height,
      Math.random() * c.width, Math.random() * c.height,
    );
    g.stroke();
  }
  roadTexture = new THREE.CanvasTexture(c);
  roadTexture.colorSpace = THREE.SRGBColorSpace;
  roadTexture.wrapS = THREE.RepeatWrapping;
  roadTexture.wrapT = THREE.RepeatWrapping;
  roadTexture.repeat.set(2, 32);
  roadTexture.anisotropy = 8;

  // Дорожка-тропинка — чуть утоптанная, светлее краёв
  const pathGeo = new THREE.PlaneGeometry(8, 400);
  const pathMat = new THREE.MeshStandardMaterial({
    map: roadTexture, roughness: 1.0, color: 0xefd0a0,
  });
  road = new THREE.Mesh(pathGeo, pathMat);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0;
  scene.add(road);

  // Дюны / пустыня вокруг — отдельная текстура темнее, с неровностями
  const sandTex = roadTexture.clone();
  sandTex.needsUpdate = true;
  sandTex.repeat.set(8, 40);
  const dunesMat = new THREE.MeshStandardMaterial({
    map: sandTex, color: 0xc99a5e, roughness: 1.0,
  });
  const dunesGeo = new THREE.PlaneGeometry(160, 400, 1, 1);
  const dunes = new THREE.Mesh(dunesGeo, dunesMat);
  dunes.rotation.x = -Math.PI / 2;
  dunes.position.y = -0.03;
  scene.add(dunes);

  // Лёгкие «колеи» по краям дорожки — тёмные полоски
  const rutMat = new THREE.MeshBasicMaterial({ color: 0xa67a48, transparent: true, opacity: 0.35 });
  for (const sx of [-3.4, 3.4]) {
    const rut = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 400), rutMat);
    rut.rotation.x = -Math.PI / 2;
    rut.position.set(sx, 0.001, 0);
    scene.add(rut);
  }
}

// ---------- Скайлайн Дубая на горизонте ----------
// Все башни строятся из примитивов и собираются в одну Group, которую кладём
// далеко по Z. Двигается медленно с параллаксом — создаёт ощущение реального города.
function buildSkyline() {
  const skyline = new THREE.Group();
  skyline.position.set(0, 0, -110);
  scene.add(skyline);
  templates.skylineGroup = skyline;

  // Материалы со стеклянным отблеском (металличность для зеркальности окон)
  const glassMat = (color, metalness = 0.55, roughness = 0.35) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness });

  // ----- Бурдж-Халифа: ступенчатая, сужающаяся, со шпилем -----
  // Силуэт настоящей башни: широкое основание → ярусы уменьшаются → длинный шпиль.
  const burj = new THREE.Group();
  const burjMat = glassMat(0xb8d4e6, 0.7, 0.25);
  // ярусы: [width, height, yOffset]
  const tiers = [
    [10, 6, 3],   [8.5, 7, 9.5],  [7, 7, 16.5],
    [5.7, 7, 23], [4.6, 7, 29.5], [3.6, 7, 36],
    [2.8, 6, 42], [2.1, 5, 47.5], [1.5, 4, 52.5],
    [1.0, 3, 56.5],
  ];
  for (const [w, h, y] of tiers) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), burjMat);
    tier.position.y = y + h / 2 - h / 2; // центр у y
    tier.position.y = y;
    // лёгкое вращение каждого яруса для эффекта «спирали»
    tier.rotation.y = (y / 60) * 0.2;
    burj.add(tier);
  }
  // длинный шпиль
  const spire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.45, 14, 8),
    glassMat(0xe8eef5, 0.8, 0.2),
  );
  spire.position.y = 60 + 7;
  burj.add(spire);
  // антенна на самой верхушке
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.05, 3, 6),
    glassMat(0xffffff, 0.3, 0.1),
  );
  tip.position.y = 60 + 14 + 1.5;
  burj.add(tip);
  burj.position.set(-8, 0, 0);
  burj.scale.setScalar(1.0);
  skyline.add(burj);

  // ----- Бурдж-аль-Араб: парус -----
  const sailGroup = new THREE.Group();
  // вертикальная мачта
  const mast = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 28, 1.6),
    glassMat(0xfaf6ee, 0.3, 0.4),
  );
  mast.position.y = 14;
  sailGroup.add(mast);
  // «парус» — большой вытянутый плоский треугольник, выгнутый
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0);
  sailShape.bezierCurveTo(8, 6, 9, 18, 0, 28);
  sailShape.lineTo(0, 0);
  const sailGeo = new THREE.ExtrudeGeometry(sailShape, { depth: 0.4, bevelEnabled: false });
  const sail = new THREE.Mesh(sailGeo, glassMat(0xeaf2fa, 0.4, 0.3));
  sail.position.set(0.4, 0, -0.2);
  sailGroup.add(sail);
  sailGroup.position.set(38, 0, -8);
  sailGroup.scale.setScalar(0.85);
  skyline.add(sailGroup);

  // ----- Музей Будущего: овальный «глаз» -----
  const museum = new THREE.Group();
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(4.5, 1.6, 16, 32),
    glassMat(0xc8b88a, 0.7, 0.35),
  );
  torus.rotation.x = Math.PI / 2;
  torus.scale.set(1, 1.4, 1);
  torus.position.y = 7;
  museum.add(torus);
  // подставка
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 3.2, 2.5, 16),
    glassMat(0x7a6a4a, 0.2, 0.7),
  );
  pedestal.position.y = 1.2;
  museum.add(pedestal);
  museum.position.set(20, 0, -6);
  museum.scale.setScalar(0.8);
  skyline.add(museum);

  // ----- Cayan Tower: закрученная башня -----
  const cayan = new THREE.Group();
  const slabs = 18;
  const cayanMat = glassMat(0xd5e0ee, 0.55, 0.3);
  for (let i = 0; i < slabs; i++) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 2.2), cayanMat);
    slab.position.y = i * 1.4 + 0.75;
    slab.rotation.y = (i / slabs) * (Math.PI / 2); // поворот на 90° по высоте
    cayan.add(slab);
  }
  cayan.position.set(-22, 0, -2);
  skyline.add(cayan);

  // ----- Emirates Towers: две треугольные башни -----
  for (const [sx, h] of [[-30, 26], [-34, 22]]) {
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 2.4, h, 3), // 3-гранная пирамида
      glassMat(0xa9c4dd, 0.7, 0.25),
    );
    tower.position.set(sx, h / 2, 4);
    skyline.add(tower);
  }

  // ----- Капитал Гейт: «падающая» башня -----
  const capital = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 18, 2.4),
    glassMat(0xeadcb8, 0.5, 0.4),
  );
  capital.position.set(28, 9, 5);
  capital.rotation.z = -0.18;
  skyline.add(capital);

  // ----- Принцесс Тауэр / Марина: кластер однотипных башен -----
  const cluster = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const w = 1.6 + Math.random() * 1.5;
    const h = 10 + Math.random() * 16;
    const t = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w),
      glassMat(new THREE.Color().setHSL(0.55 + Math.random() * 0.1, 0.18, 0.55 + Math.random() * 0.18), 0.5, 0.35),
    );
    t.position.set(-50 + i * 3.2 + Math.random() * 1.5, h / 2, 6 + Math.random() * 4);
    cluster.add(t);
  }
  for (let i = 0; i < 10; i++) {
    const w = 1.4 + Math.random() * 1.3;
    const h = 9 + Math.random() * 14;
    const t = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w),
      glassMat(new THREE.Color().setHSL(0.08 + Math.random() * 0.05, 0.25, 0.6 + Math.random() * 0.15), 0.3, 0.5),
    );
    t.position.set(8 + i * 3 + Math.random() * 1.5, h / 2, 7 + Math.random() * 4);
    cluster.add(t);
  }
  skyline.add(cluster);

  // Дальняя дымка/паралакс — пара тёмных силуэтов сильно сзади
  for (let i = 0; i < 18; i++) {
    const w = 1 + Math.random() * 2;
    const h = 5 + Math.random() * 16;
    const t = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w),
      new THREE.MeshBasicMaterial({ color: 0xa78a64 }),
    );
    t.position.set(-60 + i * 7 + Math.random() * 4, h / 2, -10);
    skyline.add(t);
  }
}

// ---------- Капибара + пацанчик (органические формы из сфер/капсул) ----------
function buildCapybaraWithKid() {
  const cap = new THREE.Group();

  // Цвета шерсти
  const furBase = new THREE.MeshStandardMaterial({ color: 0x9b6b3e, roughness: 1.0 });
  const furDark = new THREE.MeshStandardMaterial({ color: 0x6c4a28, roughness: 1.0 });
  const skin    = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.9 });

  // Тело — толстая бочка из сферы, сплющенная и вытянутая по Z
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 18, 14), furBase);
  body.scale.set(1.0, 0.9, 1.55);
  body.position.set(0, 0.65, 0);
  cap.add(body);
  // Зад — чуть приподнят (как у настоящей капибары)
  const rump = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), furBase);
  rump.scale.set(1.0, 1.0, 1.0);
  rump.position.set(0, 0.7, 0.7);
  cap.add(rump);

  // Шея/плечо — небольшой переход к голове
  const neck = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), furBase);
  neck.scale.set(1, 0.9, 1.1);
  neck.position.set(0, 0.78, -0.65);
  cap.add(neck);

  // Голова — чуть приплюснутая сфера
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 14), furBase);
  head.scale.set(1.0, 0.95, 1.1);
  head.position.set(0, 0.92, -1.05);
  cap.add(head);

  // Морда — вытянутая вперёд
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), furDark);
  muzzle.scale.set(0.95, 0.78, 1.1);
  muzzle.position.set(0, 0.78, -1.42);
  cap.add(muzzle);

  // Нос
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), skin);
  nose.position.set(0, 0.86, -1.66);
  cap.add(nose);

  // Глаза — белок + зрачок
  for (const sx of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xfff8e8, roughness: 0.4 }),
    );
    eyeWhite.position.set(sx * 0.18, 1.05, -1.18);
    cap.add(eyeWhite);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skin);
    pupil.position.set(sx * 0.18, 1.05, -1.25);
    cap.add(pupil);
  }

  // Уши — маленькие округлые
  for (const sx of [-1, 1]) {
    const earOuter = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), furDark);
    earOuter.scale.set(0.9, 0.6, 0.7);
    earOuter.position.set(sx * 0.32, 1.32, -0.85);
    cap.add(earOuter);
    const earInner = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a2515, roughness: 1 }),
    );
    earInner.scale.set(0.7, 0.5, 0.5);
    earInner.position.set(sx * 0.32, 1.34, -0.82);
    cap.add(earInner);
  }

  // Лапы — короткие толстые цилиндры с «копытцами»
  const legPositions = [[-0.38, -0.55], [0.38, -0.55], [-0.38, 0.55], [0.38, 0.55]];
  for (const [lx, lz] of legPositions) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.18, 0.55, 10),
      furBase,
    );
    leg.position.set(lx, 0.28, lz);
    cap.add(leg);
    const hoof = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.16, 0.1, 10),
      skin,
    );
    hoof.position.set(lx, 0.05, lz);
    cap.add(hoof);
  }

  // Усы — тонкие цилиндры по бокам морды
  for (const sx of [-1, 1]) for (const dy of [0.04, -0.02]) {
    const whisker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.25, 4),
      new THREE.MeshBasicMaterial({ color: 0x2a1810 }),
    );
    whisker.rotation.z = Math.PI / 2;
    whisker.rotation.y = sx * 0.3;
    whisker.position.set(sx * 0.28, 0.78 + dy, -1.5);
    cap.add(whisker);
  }

  // ---- Пацанчик на спине (по фото: каштановые волосы, синяя футболка, шорты) ----
  const kid = new THREE.Group();

  const skinMat   = new THREE.MeshStandardMaterial({ color: 0xf2c79b, roughness: 0.85 });
  const shirtMat  = new THREE.MeshStandardMaterial({ color: 0x2f5fa3, roughness: 0.7 });
  const shirtAcc  = new THREE.MeshStandardMaterial({ color: 0x5a8ed1, roughness: 0.65 });
  const shortsMat = new THREE.MeshStandardMaterial({ color: 0x274569, roughness: 0.85 });
  const hairMat   = new THREE.MeshStandardMaterial({ color: 0x6e3e1f, roughness: 0.95 });

  // Торс — слегка коническая капсула
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 12), shirtMat);
  torso.scale.set(1.0, 1.1, 0.85);
  torso.position.set(0, 1.4, 0.1);
  kid.add(torso);
  // Декор-волна на футболке (как принт волны на фото) — пара тонких сплющенных сфер
  const wave = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), shirtAcc);
  wave.scale.set(1.4, 0.4, 0.2);
  wave.position.set(0, 1.42, -0.18);
  kid.add(wave);

  // Шея
  const neckK = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.13, 10), skinMat);
  neckK.position.set(0, 1.7, 0.08);
  kid.add(neckK);

  // Голова
  const headK = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 14), skinMat);
  headK.scale.set(1.0, 1.05, 1.0);
  headK.position.set(0, 1.95, 0.1);
  kid.add(headK);

  // Каштановая шапка волос (несколько сфер сверху)
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), hairMat);
  hair.scale.set(1.05, 0.7, 1.05);
  hair.position.set(0, 2.07, 0.07);
  kid.add(hair);
  // Чёлка
  const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), hairMat);
  bangs.scale.set(1.6, 0.4, 0.6);
  bangs.position.set(0, 2.0, -0.13);
  kid.add(bangs);
  // Боковые пряди
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), hairMat);
    side.scale.set(0.6, 0.9, 0.7);
    side.position.set(sx * 0.24, 1.97, 0.05);
    kid.add(side);
  }

  // Глаза-точки
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a1810 }),
    );
    eye.position.set(sx * 0.085, 1.97, -0.16);
    kid.add(eye);
  }
  // Улыбка — тонкий тор
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xc24a4a }),
  );
  smile.rotation.x = Math.PI;
  smile.position.set(0, 1.86, -0.18);
  kid.add(smile);

  // Руки — гнутся вперёд (держится за капибару)
  for (const sx of [-1, 1]) {
    const upperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.06, 0.32, 10),
      shirtMat,
    );
    upperArm.position.set(sx * 0.32, 1.42, 0.0);
    upperArm.rotation.z = sx * 0.3;
    upperArm.rotation.x = -0.5;
    kid.add(upperArm);
    const forearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.055, 0.28, 10),
      skinMat,
    );
    forearm.position.set(sx * 0.42, 1.22, -0.28);
    forearm.rotation.z = sx * 0.4;
    forearm.rotation.x = -1.0;
    kid.add(forearm);
    // ладошки на капибаре
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), skinMat);
    hand.position.set(sx * 0.32, 1.05, -0.5);
    kid.add(hand);
  }

  // Ноги (свисают по бокам капибары) — синие шорты + кожа
  for (const sx of [-1, 1]) {
    const thigh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.09, 0.3, 10),
      shortsMat,
    );
    thigh.position.set(sx * 0.32, 1.13, 0.25);
    thigh.rotation.z = sx * 0.25;
    kid.add(thigh);
    const shin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.06, 0.32, 10),
      skinMat,
    );
    shin.position.set(sx * 0.5, 0.83, 0.32);
    shin.rotation.z = sx * 0.15;
    kid.add(shin);
    // ступня
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), skinMat);
    foot.scale.set(1, 0.7, 1.4);
    foot.position.set(sx * 0.55, 0.66, 0.4);
    kid.add(foot);
  }

  cap.add(kid);
  return cap;
}

// ---------- Пальма (для боковин) ----------
function buildPalmTree() {
  const palm = new THREE.Group();
  // Ствол — наклонённый тонкий цилиндр, сегментирован
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18 - i * 0.015, 0.22 - i * 0.015, 0.9, 8),
      trunkMat,
    );
    seg.position.set(i * 0.05, 0.45 + i * 0.85, 0);
    seg.rotation.z = -0.04;
    palm.add(seg);
  }
  // Листья — конусы расходятся радиально
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4d7a2e, roughness: 0.9 });
  const leafCount = 9;
  for (let i = 0; i < leafCount; i++) {
    const a = (i / leafCount) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.4, 6), leafMat);
    leaf.position.set(Math.cos(a) * 0.55 + 0.25, 4.6 + Math.sin(i) * 0.05, Math.sin(a) * 0.55);
    leaf.rotation.z = Math.cos(a) * 0.9;
    leaf.rotation.x = Math.sin(a) * 0.9;
    leaf.scale.set(1, 1, 0.4);
    palm.add(leaf);
  }
  // Кокосы
  const coconutMat = new THREE.MeshStandardMaterial({ color: 0x3a2614, roughness: 0.95 });
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), coconutMat);
    c.position.set(0.25 + Math.cos(i * 2) * 0.18, 4.35, Math.sin(i * 2) * 0.18);
    palm.add(c);
  }
  return palm;
}

// ---------- Шаблоны (placeholder'ы) ----------
function buildTemplates() {
  templates.capybara = buildCapybaraWithKid();
  templates.palm = buildPalmTree();

  // Апельсин — сочный, с листиком и характерной «пористой» поверхностью
  const orange = new THREE.Group();
  const orangeBody = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xff8c1a, roughness: 0.55,
      emissive: 0x6a2400, emissiveIntensity: 0.35,
    }),
  );
  orange.add(orangeBody);
  // Листик
  const leaf = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.18, 6),
    new THREE.MeshStandardMaterial({ color: 0x4d7a2e, roughness: 0.7 }),
  );
  leaf.position.set(0.05, 0.32, 0);
  leaf.rotation.z = -0.6;
  orange.add(leaf);
  // Стебелёк
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.02, 0.06, 6),
    new THREE.MeshStandardMaterial({ color: 0x3d2a14 }),
  );
  stem.position.set(0, 0.34, 0);
  orange.add(stem);
  templates.orange = orange;

  // Конус (низкое препятствие — прыжок)
  const cone = new THREE.Group();
  const coneBody = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 0.95, 16),
    new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.7 }),
  );
  coneBody.position.y = 0.475;
  cone.add(coneBody);
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: 0xfff5d8 }),
  );
  stripe.position.y = 0.55;
  cone.add(stripe);
  const baseSq = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.08, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x222222 }),
  );
  baseSq.position.y = 0.04;
  cone.add(baseSq);
  templates.cone = cone;

  // Шлагбаум / висящий баннер (высокое — подкат)
  const barrier = new THREE.Group();
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.35, 0.25),
    new THREE.MeshStandardMaterial({ color: 0xd13d2e, roughness: 0.7 }),
  );
  bar.position.y = 1.85;
  barrier.add(bar);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 2.05, 8),
      new THREE.MeshStandardMaterial({ color: 0x222222 }),
    );
    post.position.set(sx * 1.05, 1.0, 0);
    barrier.add(post);
  }
  templates.barrier = barrier;

  // Машина (широкое — менять дорожку)
  const car = new THREE.Group();
  const carBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.85, 3.0),
    new THREE.MeshStandardMaterial({ color: 0x2c6fb5, roughness: 0.55, metalness: 0.4 }),
  );
  carBody.position.y = 0.5;
  car.add(carBody);
  const carTop = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.6, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x9bc7f5, roughness: 0.3 }),
  );
  carTop.position.set(0, 1.1, 0.1);
  car.add(carTop);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx * 0.85, 0.28, sz * 1.0);
    car.add(wheel);
  }
  templates.car = car;
}

// ---------- Попытка загрузить .glb из assets/, заменяет templates если успех ----------
function tryLoadAssets() {
  const loader = new GLTFLoader();
  function tryLoad(key, path, onSuccess) {
    loader.load(
      path,
      (gltf) => {
        const obj = gltf.scene;
        onSuccess(obj);
        console.log(`[assets] загружена модель: ${path}`);
      },
      undefined,
      () => { /* нет файла — продолжаем с placeholder'ом, ничего не делаем */ },
    );
  }
  tryLoad('capybara', ASSET_PATHS.capybara, (obj) => {
    templates.capybara = obj;
    // если уже есть player, поменяем его модель
    if (player && player.userData.modelHolder) {
      player.userData.modelHolder.clear();
      player.userData.modelHolder.add(obj.clone(true));
    }
  });
  tryLoad('orange', ASSET_PATHS.orange, (obj) => { templates.orange = obj; });
  tryLoad('cone', ASSET_PATHS.cone, (obj) => { templates.cone = obj; });
  tryLoad('barrier', ASSET_PATHS.barrier, (obj) => { templates.barrier = obj; });
  tryLoad('car', ASSET_PATHS.car, (obj) => { templates.car = obj; });
  tryLoad('burj', ASSET_PATHS.burj, (obj) => {
    // Если положишь свою модель — она заменит весь процедурный скайлайн
    if (templates.skylineGroup) scene.remove(templates.skylineGroup);
    obj.position.set(0, 0, -110);
    obj.scale.setScalar(2);
    scene.add(obj);
    templates.skylineGroup = obj;
  });
}

// ---------- Игрок ----------
function buildPlayer() {
  player = new THREE.Group();
  const modelHolder = new THREE.Group();
  modelHolder.add(templates.capybara.clone(true));
  player.add(modelHolder);
  player.userData.modelHolder = modelHolder;

  // Мягкая тень-блин под капибарой (отдельно от player, чтобы не сжималась в подкате)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 24),
    new THREE.MeshBasicMaterial({ color: 0x2a1a0a, transparent: true, opacity: 0.32 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  scene.add(shadow);
  player.userData.shadow = shadow;

  player.position.set(LANES[playerLane], PLAYER_BASE_Y, 0);
  scene.add(player);
}

// ---------- Частицы при сборе апельсина ----------
function spawnPickupParticles(x, y, z) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffa840, transparent: true, opacity: 1,
  });
  const geo = new THREE.SphereGeometry(0.08, 6, 5);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.position.set(x, y, z);
    scene.add(m);
    const a = Math.random() * Math.PI * 2;
    particles.push({
      mesh: m,
      vx: Math.cos(a) * (1.5 + Math.random() * 1.5),
      vy: 1.5 + Math.random() * 2.5,
      vz: Math.sin(a) * (1.5 + Math.random() * 1.5),
      life: 0,
      maxLife: 0.5 + Math.random() * 0.2,
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      particles.splice(i, 1);
      continue;
    }
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.vy -= 8 * dt; // гравитация
    p.mesh.material.opacity = 1 - (p.life / p.maxLife);
    const s = 1 + p.life * 1.5;
    p.mesh.scale.setScalar(s);
  }
}

// ---------- UI / события ----------
function setupUI() {
  document.getElementById('best-score-start').textContent = bestScore;
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-restart').addEventListener('click', startGame);
}

// Панель паузы и кнопка-пауза
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
    startGame();
  });
  btnMenu.addEventListener('click', () => {
    document.getElementById('pause-panel').classList.add('hidden');
    backToMenu();
  });
  // клик по фону — закрыть
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
  // clock накопил dt пока стояли — сбрасываем, чтобы мир не «прыгнул»
  if (clock) clock.getDelta();
  audio.resumeBg();
}
function backToMenu() {
  gameState = 'menu';
  audio.stopBg();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('btn-pause').classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
}

// Глушим звук и ставим паузу при уходе из вкладки/Safari в фон.
// На iOS Safari simple `volume=0` оставляет аудио живым в фоне — нужен реальный pause()
// и связка событий visibilitychange + pagehide + window.blur.
function setupVisibility() {
  const onHide = () => {
    audio.pauseBg();                // глушим музыку немедленно
    if (gameState === 'playing') pauseGame(); // и ставим геймплей на паузу
  };
  const onShow = () => {
    // НЕ авто-возобновляем игру — пользователь сам нажмёт «Продолжить».
    // Музыку тоже не запускаем, пока юзер не вернулся к игре.
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onHide(); else onShow();
  });
  // pagehide ловит свайп-вверх «домой» в iOS Safari, когда visibilitychange может не сработать
  window.addEventListener('pagehide', onHide);
  window.addEventListener('blur', onHide);
}

// Панель настроек — громкость и mute
function setupSettings() {
  const panel = document.getElementById('settings-panel');
  const btnOpen  = document.getElementById('btn-settings');
  const btnClose = document.getElementById('btn-close-settings');
  const slider   = document.getElementById('vol-slider');
  const valLabel = document.getElementById('vol-value');
  const muteCb   = document.getElementById('mute-checkbox');

  // Подтянуть сохранённые значения в UI
  slider.value = Math.round(audio.volume * 100);
  valLabel.textContent = `${slider.value}%`;
  muteCb.checked = audio.muted;

  btnOpen.addEventListener('click', () => panel.classList.remove('hidden'));
  btnClose.addEventListener('click', () => panel.classList.add('hidden'));
  // Клик по фону — закрыть
  panel.addEventListener('click', (e) => {
    if (e.target === panel) panel.classList.add('hidden');
  });

  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10) / 100;
    audio.setVolume(v);
    valLabel.textContent = `${slider.value}%`;
    if (audio.muted && v > 0) muteCb.checked = false; // setVolume уже снял mute
  });
  // На iOS Safari внутри <label> событие change иногда не приходит из-за конфликта
  // touch/click — слушаем и change, и click, и синхронизируем состояние.
  const onMuteToggle = () => audio.setMuted(muteCb.checked);
  muteCb.addEventListener('change', onMuteToggle);
  muteCb.addEventListener('click', onMuteToggle);
}

function setupInput() {
  // Свайпы
  let sx = 0, sy = 0, tracking = false;
  const SWIPE_MIN = 30;
  const canvas = renderer.domElement;
  canvas.addEventListener('touchstart', (e) => {
    if (gameState !== 'playing') return;
    const t = e.changedTouches[0];
    sx = t.clientX; sy = t.clientY; tracking = true;
  }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    if (!tracking || gameState !== 'playing') return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      dx > 0 ? moveLane(+1) : moveLane(-1);
    } else {
      dy < 0 ? doJump() : doSlide();
    }
  }, { passive: true });

  // Клавиатура (для отладки на десктопе)
  window.addEventListener('keydown', (e) => {
    // Пауза работает и в игре, и в состоянии «paused» (как тумблер)
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
  if (isJumping || isSliding) return;
  isJumping = true; jumpTime = 0;
}
function doSlide() {
  if (isSliding || isJumping) return;
  isSliding = true; slideTime = 0;
}

// ---------- Запуск / рестарт ----------
function startGame() {
  // сбросить состояние
  oranges = 0;
  distance = 0;
  speed = START_SPEED;
  playerLane = 1;
  playerTargetX = LANES[1];
  isJumping = false; isSliding = false; jumpTime = 0; slideTime = 0;
  player.position.set(LANES[1], PLAYER_BASE_Y, 0);
  player.scale.set(1, 1, 1);

  // очистить мир
  for (const o of activeObstacles) scene.remove(o.mesh);
  for (const o of activeOranges) scene.remove(o.mesh);
  for (const b of sideBuildings) scene.remove(b.mesh);
  for (const p of particles) { scene.remove(p.mesh); p.mesh.material.dispose?.(); }
  activeObstacles.length = 0;
  activeOranges.length = 0;
  sideBuildings.length = 0;
  particles.length = 0;
  farthestRowZ = -ROW_SPACING * 2;     // первый ряд появится ~33 ед. впереди игрока
  farthestBuildingZ = -10;

  // экраны
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('pause-panel').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('btn-pause').classList.remove('hidden');
  updateHUD();

  // Музыка: первый клик «Играть» одновременно — пользовательский жест,
  // которого требуют браузеры для autoplay. Громкость восстанавливаем после Game Over.
  audio.unduckBg();
  audio.startBg();

  gameState = 'playing';
}

function gameOver() {
  gameState = 'gameover';
  if (oranges > bestScore) {
    bestScore = oranges;
    localStorage.setItem('mukashik_best', String(bestScore));
  }
  document.getElementById('final-score').textContent = oranges;
  document.getElementById('final-distance').textContent = Math.floor(distance);
  document.getElementById('best-score-end').textContent = bestScore;
  document.getElementById('best-score-start').textContent = bestScore;
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('btn-pause').classList.add('hidden');
  document.getElementById('gameover-screen').classList.remove('hidden');

  // Звук: фоновая музыка приглушается, отдельный SFX «Игра окончена»
  audio.duckBg();
  audio.playGameover();
}

// ---------- Спавн рядов препятствий и апельсинов ----------
function spawnRow(z) {
  // Случайно выбираем 1-2 дорожки под препятствия (никогда все 3)
  const blockedLanes = new Set();
  const carLane = (Math.random() < 0.18) ? Math.floor(Math.random() * 3) : -1;
  if (carLane >= 0) blockedLanes.add(carLane);
  const numOther = 1 + (Math.random() < 0.35 ? 1 : 0);
  for (let i = 0; i < numOther; i++) {
    if (blockedLanes.size >= 2) break;
    const lane = Math.floor(Math.random() * 3);
    if (blockedLanes.has(lane)) continue;
    blockedLanes.add(lane);
    const type = Math.random() < 0.55 ? 'cone' : 'barrier';
    spawnObstacle(type, lane, z);
  }
  if (carLane >= 0) spawnObstacle('car', carLane, z);

  // На свободных дорожках — апельсины
  for (let lane = 0; lane < 3; lane++) {
    if (blockedLanes.has(lane)) continue;
    if (Math.random() < ORANGE_CHAIN_CHANCE) {
      // цепочка из 5-7 апельсинов
      const n = 5 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        spawnOrange(lane, z + i * 1.4);
      }
    } else if (Math.random() < 0.65) {
      spawnOrange(lane, z);
    }
  }
}

function spawnObstacle(type, lane, z) {
  const mesh = templates[type].clone(true);
  mesh.position.set(LANES[lane], 0, z);
  scene.add(mesh);
  // Хитбоксы: компромисс между визуалом и честностью
  let hitbox;
  if (type === 'cone')      hitbox = { w: 0.7, h: 1.0, d: 0.7 };
  else if (type === 'barrier') hitbox = { w: 2.0, h: 0.5, d: 0.4, yMin: 1.55 };
  else /* car */               hitbox = { w: 1.7, h: 1.5, d: 3.0 };
  activeObstacles.push({ mesh, type, lane, hitbox });
}

function spawnOrange(lane, z) {
  const mesh = templates.orange.clone(true);
  mesh.position.set(LANES[lane], 1.0, z);
  scene.add(mesh);
  activeOranges.push({ mesh, baseY: 1.0 });
}

// ---------- Боковая среда: пальмы и небольшие постройки ближнего плана ----------
function spawnSideBuildings(z) {
  for (const side of [-1, 1]) {
    const r = Math.random();
    if (r < 0.55) {
      // Пальма — клон шаблона
      const palm = templates.palm.clone(true);
      const offset = 5.2 + Math.random() * 2.5;
      palm.position.set(side * offset, 0, z + (Math.random() - 0.5) * 2);
      palm.rotation.y = Math.random() * Math.PI * 2;
      const s = 0.9 + Math.random() * 0.35;
      palm.scale.setScalar(s);
      scene.add(palm);
      sideBuildings.push({ mesh: palm });
    } else if (r < 0.85) {
      // Низкая постройка-вилла в песочных тонах
      const w = 2.5 + Math.random() * 2.5;
      const h = 2.5 + Math.random() * 3.5;
      const d = 2.5 + Math.random() * 3;
      const villaColors = [0xeed7a6, 0xe2c181, 0xd4a877, 0xc99a5e, 0xeae0c8];
      const color = villaColors[Math.floor(Math.random() * villaColors.length)];
      const villa = new THREE.Group();
      const walls = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
      );
      walls.position.y = h / 2;
      villa.add(walls);
      // плоская крыша с парапетом
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.2, 0.2, d + 0.2),
        new THREE.MeshStandardMaterial({ color: 0xb89868, roughness: 0.9 }),
      );
      roof.position.y = h + 0.1;
      villa.add(roof);
      // окошко
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.4, h * 0.35, 0.05),
        new THREE.MeshStandardMaterial({
          color: 0x6dabd6, metalness: 0.6, roughness: 0.2,
          emissive: 0x223a55, emissiveIntensity: 0.2,
        }),
      );
      win.position.set(0, h * 0.55, d / 2 + 0.03);
      villa.add(win);
      const offset = 6 + Math.random() * 4;
      villa.position.set(side * offset, 0, z);
      villa.rotation.y = (Math.random() - 0.5) * 0.6 + (side < 0 ? 0 : Math.PI);
      scene.add(villa);
      sideBuildings.push({ mesh: villa });
    } else {
      // Кактус / куст
      const bush = new THREE.Group();
      const bushMat = new THREE.MeshStandardMaterial({ color: 0x6a8a4a, roughness: 0.9 });
      const main = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.9, 8), bushMat);
      main.position.y = 0.45;
      bush.add(main);
      for (const sx of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.4, 6), bushMat);
        arm.position.set(sx * 0.18, 0.55, 0);
        arm.rotation.z = sx * 0.5;
        bush.add(arm);
      }
      const offset = 5 + Math.random() * 3;
      bush.position.set(side * offset, 0, z);
      scene.add(bush);
      sideBuildings.push({ mesh: bush });
    }
  }
}

// ---------- AABB-коллизия ----------
function checkCollision() {
  // Хитбокс игрока зависит от состояния
  const px = player.position.x, py = player.position.y, pz = player.position.z;
  const playerW = 0.9, playerD = 1.4;
  const playerH = isSliding ? 0.5 : 1.5;
  const playerYCenter = isSliding ? 0.25 : (py + 0.4); // для слайда — низко
  const pMinX = px - playerW / 2, pMaxX = px + playerW / 2;
  const pMinZ = pz - playerD / 2, pMaxZ = pz + playerD / 2;
  const pMinY = playerYCenter - playerH / 2, pMaxY = playerYCenter + playerH / 2;

  for (const o of activeObstacles) {
    const ox = o.mesh.position.x, oz = o.mesh.position.z;
    const hb = o.hitbox;
    const oMinX = ox - hb.w / 2, oMaxX = ox + hb.w / 2;
    const oMinZ = oz - hb.d / 2, oMaxZ = oz + hb.d / 2;
    let oMinY, oMaxY;
    if (hb.yMin !== undefined) { // шлагбаум висит сверху
      oMinY = hb.yMin; oMaxY = hb.yMin + hb.h;
    } else {
      oMinY = 0; oMaxY = hb.h;
    }
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
    const dx = o.mesh.position.x - px;
    const dz = o.mesh.position.z - pz;
    if (Math.abs(dx) < 0.8 && Math.abs(dz) < 0.9) {
      spawnPickupParticles(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z);
      scene.remove(o.mesh);
      activeOranges.splice(i, 1);
      oranges += 1;
      pulseHUD();
      updateHUD();
    }
  }
}

// ---------- HUD ----------
function updateHUD() {
  document.getElementById('hud-oranges').textContent = oranges;
  document.getElementById('hud-distance').textContent = Math.floor(distance);
}

// ---------- Resize ----------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------- Игровой цикл ----------
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05); // кэп против фриза
  if (gameState === 'playing') update(dt);
  renderer.render(scene, camera);
}

function update(dt) {
  // Скорость растёт
  speed = Math.min(MAX_SPEED, speed + SPEED_GROWTH * dt);
  const advance = speed * dt;
  distance += advance;

  // Двигаем мир (а не игрока): минус Z = вперёд. Объекты «едут» к игроку.
  for (const o of activeObstacles) o.mesh.position.z += advance;
  for (const o of activeOranges) {
    o.mesh.position.z += advance;
    o.mesh.rotation.y += dt * 3; // вращение для красоты
  }
  for (const b of sideBuildings) b.mesh.position.z += advance;
  farthestRowZ += advance;
  farthestBuildingZ += advance;

  // Анимация дороги
  if (roadTexture) roadTexture.offset.y -= advance / 25;

  // Удаляем то, что уехало за камеру
  pruneBehind(activeObstacles);
  pruneBehind(activeOranges);
  pruneBehind(sideBuildings);

  // Спавним новые ряды впереди — отодвигаем границу к -SPAWN_AHEAD
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

  // Прыжок (параболический)
  if (isJumping) {
    jumpTime += dt;
    const t = jumpTime / JUMP_DURATION;
    if (t >= 1) {
      isJumping = false;
      player.position.y = PLAYER_BASE_Y;
    } else {
      // 4t(1-t) даёт максимум 1 в середине
      player.position.y = PLAYER_BASE_Y + JUMP_HEIGHT * (4 * t * (1 - t));
    }
  } else {
    player.position.y = PLAYER_BASE_Y;
  }

  // Подкат: визуально приплющиваем модель + опускаем
  if (isSliding) {
    slideTime += dt;
    if (slideTime >= SLIDE_DURATION) {
      isSliding = false;
      player.scale.set(1, 1, 1);
    } else {
      player.scale.set(1, 0.45, 1.1);
    }
  } else {
    player.scale.set(1, 1, 1);
  }

  // Лёгкая «беговая» анимация — покачивание модели
  const bob = Math.sin(performance.now() * 0.012) * 0.05;
  if (player.userData.modelHolder) {
    player.userData.modelHolder.position.y = bob;
    player.userData.modelHolder.rotation.z = Math.sin(performance.now() * 0.012) * 0.05;
  }

  // Тень — следует за игроком по X/Z, тает в прыжке
  if (player.userData.shadow) {
    const sh = player.userData.shadow;
    sh.position.x = player.position.x;
    sh.position.z = player.position.z;
    const heightAbove = Math.max(0, player.position.y - PLAYER_BASE_Y);
    const f = Math.max(0, 1 - heightAbove / 2.2);
    sh.material.opacity = 0.08 + 0.26 * f;
    sh.scale.setScalar(0.7 + 0.45 * f);
  }

  // Частицы
  updateParticles(dt);

  // Параллакс скайлайна — еле заметный сдвиг по X для эффекта движения
  if (templates.skylineGroup) {
    templates.skylineGroup.position.x = Math.sin(distance * 0.002) * 1.5;
  }

  // Проверки
  checkOrangePickup();
  if (checkCollision()) {
    gameOver();
    return;
  }

  updateHUD();
}

// Лёгкий «пульс» HUD-пилюли при сборе апельсина
function pulseHUD() {
  const pill = document.getElementById('hud-oranges');
  if (!pill) return;
  pill.parentElement.classList.remove('pulse');
  // принудительный reflow, чтобы анимация перезапустилась
  void pill.parentElement.offsetWidth;
  pill.parentElement.classList.add('pulse');
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
