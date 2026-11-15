import * as THREE from "three";
import { StereoEffect } from "three/addons/effects/StereoEffect.js";
import {
  BLOCK_IDS,
  BUILDABLE_IDS,
  CHUNKS_X,
  CHUNKS_Z,
  CHUNK_SIZE,
  HOTBAR_DEFAULTS,
  WORLD_HEIGHT,
  WORLD_SIZE_X,
  WORLD_SIZE_Z,
  blockIndex,
  generateBaseWorld,
  getBlockDef,
  getSpawnPoint,
  inBounds,
  isSolidBlock,
} from "./shared/blocks.js";
import { raycastVoxels } from "./shared/raycast.js";
import { buildChunkMeshData } from "./shared/mesher.js";
import {
  AVATAR_COLORS,
  AVATAR_STYLES,
  findAvatarStyle,
  normalizeAvatarColor,
  normalizeAvatarStyle,
  normalizeUid,
  sanitizePlayerName,
} from "./shared/profiles.js";
import { createAtlasCanvas, drawBlockPreview } from "./textures.js";
import { soundFX } from "./audio.js";

const EYE_HEIGHT = 1.56;
const PLAYER_RADIUS = 0.28;
const PLAYER_HEIGHT = 1.75;

function createUid() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return `u${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-6)}`;
}

function getOrCreateUid() {
  let uid = normalizeUid(localStorage.getItem("ac_uid"));
  if (!uid) {
    uid = createUid();
    localStorage.setItem("ac_uid", uid);
  }
  return uid;
}

const params = new URLSearchParams(window.location.search);
let currentRoom = (params.get("room") || localStorage.getItem("ac_room") || "principal")
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, "")
  .slice(0, 28) || "principal";
let playerUid = getOrCreateUid();
const urlName = sanitizePlayerName(params.get("name"));
const storedName = sanitizePlayerName(localStorage.getItem("ac_name"));
let playerName = urlName || storedName;
if (urlName) {
  localStorage.setItem("ac_name", urlName);
}
let hasChosenIdentity = Boolean(playerName);
let playerColor =
  normalizeAvatarColor(localStorage.getItem("ac_color")) ||
  AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
let playerStyle = normalizeAvatarStyle(localStorage.getItem("ac_style"));
let draftColor = playerColor;
let draftStyle = playerStyle;

// DOM Refs
const canvas = document.getElementById("scene");
const wsDot = document.getElementById("ws-dot");
const playerPillBadge = document.getElementById("player-pill-badge");
const roomLabel = document.getElementById("room-label");
const onlineCountEl = document.getElementById("online-count");
const feedEl = document.getElementById("feed");
const toastEl = document.getElementById("toast");
const targetBadge = document.getElementById("target-badge");
const pointerBanner = document.getElementById("pointer-banner");
const touchUi = document.getElementById("touch-ui");
const joyZone = document.getElementById("joy-zone");
const joyKnob = document.getElementById("joy-knob");
const lookZone = document.getElementById("look-zone");
const hotbarEl = document.getElementById("hotbar");
const blocksGrid = document.getElementById("blocks-grid");

// Game State
let worldSeed = 2026;
let worldData = generateBaseWorld(worldSeed);
const hotbar = [...HOTBAR_DEFAULTS];
let selectedSlot = 0;
let flyMode = false;
let thirdPerson = false;
let stereoMode = false;
let touchVisible =
  window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window;

const playerState = {
  ...getSpawnPoint(worldData),
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: 0,
  pitch: -0.08,
  onGround: false,
};

// Networking State
let ws = null;
let selfId = null;
let selfColor = playerColor;
let reconnectTimer = null;
let reconnectAttempt = 0;
let lastMoveSentAt = 0;
let lastSentPose = "";
const remotePlayers = new Map();
const WS_BACKOFF_BASE_MS = 700;
const WS_BACKOFF_MAX_MS = 15000;
const WS_CONNECT_TIMEOUT_MS = 9000;
const WS_PING_MS = 20000;
const WS_STALE_MS = 55000;
const MAX_PENDING_EDITS = 96;
let wsGeneration = 0;
let lastWsMessageAt = 0;
let lastInitRoom = null;
let initReceived = false;
let welcomeGreeted = false;
let reconnectCountdownTimer = null;
let latencyMs = null;
let offlineEditWarned = false;
const pendingEdits = new Map(); // "x,y,z" -> {x,y,z,t} queued while offline

// Input State
const keys = new Set();
const touchState = {
  joyId: null,
  joyOriginX: 0,
  joyOriginY: 0,
  moveX: 0,
  moveZ: 0,
  lookId: null,
  lookLastX: 0,
  lookLastY: 0,
  lookStartX: 0,
  lookStartY: 0,
  jumpHeld: false,
  downHeld: false,
};
const tmpVecA = new THREE.Vector3();
const tmpVecB = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

// Three.js Setup
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;

const stereoEffect = new StereoEffect(renderer);
stereoEffect.setEyeSeparation(0.064);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ec8f8);
scene.fog = new THREE.FogExp2(0x7ec8f8, 0.011);

const camera = new THREE.PerspectiveCamera(
  72,
  window.innerWidth / window.innerHeight,
  0.1,
  180
);
const playerRig = new THREE.Group();
const yawPivot = new THREE.Group();
yawPivot.position.set(0, EYE_HEIGHT, 0);
playerRig.add(yawPivot);
yawPivot.add(camera);
scene.add(playerRig);

// Lighting
const hemiLight = new THREE.HemisphereLight(0xf0f9ff, 0x3b4d34, 0.85);
scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight(0xfff7e6, 0.95);
sunLight.position.set(42, 72, 28);
scene.add(sunLight);

// Blocky decorative sun & clouds
const sunMesh = new THREE.Mesh(
  new THREE.BoxGeometry(7, 7, 7),
  new THREE.MeshBasicMaterial({ color: 0xfff099, fog: false })
);
sunMesh.position.set(58, 70, 22);
scene.add(sunMesh);

const cloudGroup = new THREE.Group();
const cloudMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.78,
});
for (let i = 0; i < 12; i++) {
  const c = new THREE.Mesh(
    new THREE.BoxGeometry(7 + (i % 3) * 3, 1.4, 5 + ((i + 1) % 2) * 3),
    cloudMat
  );
  c.position.set((i * 19) % 80 - 10, 38 + (i % 3) * 2, ((i * 29) % 80) - 10);
  cloudGroup.add(c);
}
scene.add(cloudGroup);

// Shared Texture Atlas Materials
const atlasCanvas = createAtlasCanvas();
const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.generateMipmaps = false;
atlasTexture.colorSpace = THREE.SRGBColorSpace;

const opaqueMaterial = new THREE.MeshLambertMaterial({
  map: atlasTexture,
  vertexColors: true,
});

const translucentMaterial = new THREE.MeshLambertMaterial({
  map: atlasTexture,
  vertexColors: true,
  transparent: true,
  opacity: 0.86,
  depthWrite: false,
  side: THREE.DoubleSide,
});

// Highlight box
const highlightMesh = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01)),
  new THREE.LineBasicMaterial({ color: 0x0f172a, linewidth: 2 })
);
highlightMesh.visible = false;
scene.add(highlightMesh);

// Chunk Meshes
const chunkMap = new Map();

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function disposeMesh(mesh) {
  if (!mesh) return;
  scene.remove(mesh);
  mesh.geometry?.dispose();
}

function rebuildChunk(cx, cz) {
  if (cx < 0 || cx >= CHUNKS_X || cz < 0 || cz >= CHUNKS_Z) return;
  const key = chunkKey(cx, cz);
  const prev = chunkMap.get(key);
  if (prev) {
    disposeMesh(prev.opaque);
    disposeMesh(prev.translucent);
  }

  const data = buildChunkMeshData(worldData, cx, cz);
  const entry = { opaque: null, translucent: null };

  if (data.opaque.vertexCount > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(data.opaque.positions, 3));
    geom.setAttribute("normal", new THREE.BufferAttribute(data.opaque.normals, 3));
    geom.setAttribute("uv", new THREE.BufferAttribute(data.opaque.uvs, 2));
    geom.setAttribute("color", new THREE.BufferAttribute(data.opaque.colors, 3));
    geom.setIndex(new THREE.BufferAttribute(data.opaque.indices, 1));
    const mesh = new THREE.Mesh(geom, opaqueMaterial);
    mesh.frustumCulled = true;
    scene.add(mesh);
    entry.opaque = mesh;
  }

  if (data.translucent.vertexCount > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(data.translucent.positions, 3));
    geom.setAttribute("normal", new THREE.BufferAttribute(data.translucent.normals, 3));
    geom.setAttribute("uv", new THREE.BufferAttribute(data.translucent.uvs, 2));
    geom.setAttribute("color", new THREE.BufferAttribute(data.translucent.colors, 3));
    geom.setIndex(new THREE.BufferAttribute(data.translucent.indices, 1));
    const mesh = new THREE.Mesh(geom, translucentMaterial);
    mesh.renderOrder = 2;
    scene.add(mesh);
    entry.translucent = mesh;
  }

  chunkMap.set(key, entry);
}

function rebuildAllChunks() {
  for (let cz = 0; cz < CHUNKS_Z; cz++) {
    for (let cx = 0; cx < CHUNKS_X; cx++) {
      rebuildChunk(cx, cz);
    }
  }
}

function markChunksAround(x, z, dirtySet) {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  dirtySet.add(chunkKey(cx, cz));
  const lx = x % CHUNK_SIZE;
  const lz = z % CHUNK_SIZE;
  if (lx === 0 && cx > 0) dirtySet.add(chunkKey(cx - 1, cz));
  if (lx === CHUNK_SIZE - 1 && cx < CHUNKS_X - 1) dirtySet.add(chunkKey(cx + 1, cz));
  if (lz === 0 && cz > 0) dirtySet.add(chunkKey(cx, cz - 1));
  if (lz === CHUNK_SIZE - 1 && cz < CHUNKS_Z - 1) dirtySet.add(chunkKey(cx, cz + 1));
}

function applyBlockLocal(x, y, z, t, rebuild = true) {
  if (!inBounds(x, y, z)) return false;
  worldData[blockIndex(x, y, z)] = t;
  if (rebuild) {
    const dirty = new Set();
    markChunksAround(x, z, dirty);
    for (const k of dirty) {
      const [cx, cz] = k.split(",").map(Number);
      rebuildChunk(cx, cz);
    }
  }
  return true;
}

// Avatar Builder (Minecraft-style humanoid cuboid rig)
function makeNameSprite(label, colorHex) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
  ctx.fillRect(16, 12, 224, 40);
  ctx.strokeStyle = colorHex || "#38bdf8";
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 12, 224, 40);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(label || "").slice(0, 18), 128, 32);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.38, 1);
  sprite.position.set(0, 2.15, 0);
  sprite.renderOrder = 5;
  sprite.userData.isNameTag = true;
  return sprite;
}

function disposeObject3D(obj) {
  if (!obj) return;
  obj.traverse((node) => {
    node.geometry?.dispose?.();
    const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const m of mats) {
      m.map?.dispose?.();
      m.dispose?.();
    }
  });
}

function setAvatarNameTag(avatar, label, colorHex) {
  const prev = avatar.userData.nameTag;
  if (prev) {
    avatar.remove(prev);
    disposeObject3D(prev);
  }
  const tag = makeNameSprite(label, colorHex);
  avatar.add(tag);
  avatar.userData.nameTag = tag;
}

function buildAccessoryMeshes(group, accessory, colorHex) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    disposeObject3D(child);
  }
  if (accessory === "cap") {
    const mat = new THREE.MeshLambertMaterial({ color: colorHex || "#38bdf8" });
    const dome = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.45), mat);
    dome.position.set(0, 0.43, 0);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.2), mat);
    brim.position.set(0, 0.37, -0.27);
    group.add(dome, brim);
  } else if (accessory === "crown") {
    const goldMat = new THREE.MeshLambertMaterial({ color: "#facc15" });
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.44), goldMat);
    band.position.set(0, 0.45, 0);
    group.add(band);
    for (const px of [-0.14, 0, 0.14]) {
      const spike = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.08), goldMat);
      spike.position.set(px, 0.54, -0.16);
      group.add(spike);
    }
  } else if (accessory === "visor") {
    const frameMat = new THREE.MeshLambertMaterial({ color: "#0f172a" });
    const lensMat = new THREE.MeshBasicMaterial({ color: "#22d3ee" });
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.44), frameMat);
    band.position.set(0, 0.24, 0);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, 0.04), lensMat);
    lens.position.set(0, 0.24, -0.22);
    group.add(band, lens);
  } else if (accessory === "hardhat") {
    const hatMat = new THREE.MeshLambertMaterial({ color: "#f59e0b" });
    const lampMat = new THREE.MeshBasicMaterial({ color: "#fef08a" });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.46), hatMat);
    shell.position.set(0, 0.45, 0);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.52), hatMat);
    brim.position.set(0, 0.38, -0.02);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.05), lampMat);
    lamp.position.set(0, 0.46, -0.24);
    group.add(shell, brim, lamp);
  } else if (accessory === "antenna") {
    const metalMat = new THREE.MeshLambertMaterial({ color: "#64748b" });
    const bulbMat = new THREE.MeshBasicMaterial({ color: "#22d3ee" });
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05), metalMat);
    stem.position.set(0, 0.5, 0);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), bulbMat);
    bulb.position.set(0, 0.61, 0);
    group.add(stem, bulb);
  }
}

function applyAvatarLook(avatar, colorHex, styleId = "classic", isAi = false) {
  if (!avatar?.userData) return;
  const st = findAvatarStyle(styleId);
  const resolvedColor = colorHex || "#38bdf8";
  avatar.userData.bodyMat.color.set(resolvedColor);
  avatar.userData.skinMat.color.set(isAi ? "#a5f3fc" : st.skin);
  avatar.userData.pantsMat.color.set(isAi ? "#312e81" : st.pants);
  buildAccessoryMeshes(avatar.userData.accessoryGroup, isAi ? "none" : st.accessory, resolvedColor);
}

function createAvatar(name, colorHex, isAi = false, styleId = "classic") {
  const root = new THREE.Group();
  const st = findAvatarStyle(styleId);
  const bodyMat = new THREE.MeshLambertMaterial({
    color: colorHex || "#38bdf8",
    emissive: isAi ? new THREE.Color("#7c3aed") : new THREE.Color(0x000000),
    emissiveIntensity: isAi ? 0.5 : 0,
  });
  const skinMat = new THREE.MeshLambertMaterial({ color: isAi ? "#a5f3fc" : st.skin });
  const pantsMat = new THREE.MeshLambertMaterial({ color: isAi ? "#312e81" : st.pants });

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.65, 0.22), pantsMat);
  legL.position.set(-0.12, 0.325, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.65, 0.22), pantsMat);
  legR.position.set(0.12, 0.325, 0);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.68, 0.26), bodyMat);
  torso.position.set(0, 0.99, 0);

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.18), bodyMat);
  armL.position.set(-0.36, 0.98, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.18), bodyMat);
  armR.position.set(0.36, 0.98, 0);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.35, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skinMat);
  head.position.set(0, 0.21, 0);
  const eyeMat = new THREE.MeshBasicMaterial({ color: isAi ? "#22d3ee" : "#0f172a" });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), eyeMat);
  eyeL.position.set(-0.1, 0.23, -0.215);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), eyeMat);
  eyeR.position.set(0.1, 0.23, -0.215);
  const accessoryGroup = new THREE.Group();
  headPivot.add(head, eyeL, eyeR, accessoryGroup);

  root.add(legL, legR, torso, armL, armR, headPivot);
  root.userData = {
    legL,
    legR,
    armL,
    armR,
    headPivot,
    bodyMat,
    skinMat,
    pantsMat,
    accessoryGroup,
    phase: 0,
    nameTag: null,
  };
  applyAvatarLook(root, colorHex, styleId, isAi);
  if (name) {
    setAvatarNameTag(root, name, colorHex);
  }
  return root;
}

const selfAvatar = createAvatar("", selfColor, false, playerStyle);
selfAvatar.visible = false;
scene.add(selfAvatar);

const aiAvatar = createAvatar("✨ Ariadna IA", "#c084fc", true);
aiAvatar.visible = false;
scene.add(aiAvatar);
let aiAvatarHideAt = 0;

// UI Feedback helpers
let toastTimer = null;
function showToast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), ms);
}

function addFeed(sender, text, kind = "chat") {
  const row = document.createElement("div");
  row.className = `feed-item ${kind}`;
  const strong = document.createElement("strong");
  strong.textContent = sender ? `${sender}: ` : "";
  row.appendChild(strong);
  row.appendChild(document.createTextNode(text));
  feedEl.appendChild(row);
  while (feedEl.children.length > 5) {
    feedEl.removeChild(feedEl.firstChild);
  }
  setTimeout(() => {
    row.style.opacity = "0.75";
  }, 8000);
}

// Hotbar & Block Catalog UI
function renderHotbar() {
  hotbarEl.innerHTML = "";
  hotbar.forEach((blockId, idx) => {
    const btn = document.createElement("button");
    btn.className = `slot${idx === selectedSlot ? " active" : ""}`;
    btn.title = `${idx + 1}: ${getBlockDef(blockId).name}`;
    const num = document.createElement("span");
    num.className = "slot-num";
    num.textContent = String(idx + 1);
    const prev = document.createElement("canvas");
    prev.width = 32;
    prev.height = 32;
    drawBlockPreview(prev, blockId);
    btn.appendChild(num);
    btn.appendChild(prev);
    btn.addEventListener("click", () => selectSlot(idx));
    hotbarEl.appendChild(btn);
  });
}

function renderBlocksCatalog() {
  blocksGrid.innerHTML = "";
  const activeId = hotbar[selectedSlot];
  for (const id of BUILDABLE_IDS) {
    const def = getBlockDef(id);
    const tile = document.createElement("button");
    tile.className = `block-tile${id === activeId ? " active" : ""}`;
    const prev = document.createElement("canvas");
    prev.width = 32;
    prev.height = 32;
    drawBlockPreview(prev, id);
    const lbl = document.createElement("span");
    lbl.textContent = def.name;
    tile.appendChild(prev);
    tile.appendChild(lbl);
    tile.addEventListener("click", () => {
      hotbar[selectedSlot] = id;
      renderHotbar();
      renderBlocksCatalog();
      closeAllModals();
      showToast(`Bloque: ${def.name}`);
    });
    blocksGrid.appendChild(tile);
  }
}

function selectSlot(idx) {
  selectedSlot = ((idx % hotbar.length) + hotbar.length) % hotbar.length;
  renderHotbar();
  showToast(`Seleccionado: ${getBlockDef(hotbar[selectedSlot]).name}`, 1200);
}

function updatePlayerBadge() {
  const st = findAvatarStyle(playerStyle);
  playerPillBadge.textContent = playerName ? `${st.emoji} ${playerName}` : `${st.emoji} …`;
  playerPillBadge.style.color = selfColor;
}

function renderProfilePicker({ colorsEl, stylesEl, previewEl, getColor, setColor, getStyle, setStyle }) {
  const syncPreview = () => {
    const c = getColor();
    const s = findAvatarStyle(getStyle());
    if (previewEl) {
      previewEl.textContent = s.emoji;
      previewEl.style.background = c;
    }
    colorsEl.querySelectorAll(".color-swatch").forEach((el) => {
      const active = el.dataset.color === c;
      el.classList.toggle("active", active);
      el.setAttribute("aria-checked", String(active));
    });
    stylesEl.querySelectorAll(".style-pill").forEach((el) => {
      const active = el.dataset.style === s.id;
      el.classList.toggle("active", active);
      el.setAttribute("aria-checked", String(active));
    });
  };

  if (!colorsEl.childElementCount) {
    AVATAR_COLORS.forEach((hex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "color-swatch";
      btn.dataset.color = hex;
      btn.style.background = hex;
      btn.title = hex;
      btn.setAttribute("role", "radio");
      btn.addEventListener("click", () => {
        setColor(hex);
        syncPreview();
      });
      colorsEl.appendChild(btn);
    });
  }

  if (!stylesEl.childElementCount) {
    AVATAR_STYLES.forEach((st) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "style-pill";
      btn.dataset.style = st.id;
      btn.textContent = `${st.emoji} ${st.label}`;
      btn.setAttribute("role", "radio");
      btn.addEventListener("click", () => {
        setStyle(st.id);
        syncPreview();
      });
      stylesEl.appendChild(btn);
    });
  }

  syncPreview();
}

const roomPickerConfig = {
  colorsEl: document.getElementById("room-colors"),
  stylesEl: document.getElementById("room-styles"),
  previewEl: document.getElementById("room-avatar-preview"),
  getColor: () => draftColor,
  setColor: (c) => {
    draftColor = c;
  },
  getStyle: () => draftStyle,
  setStyle: (s) => {
    draftStyle = s;
  },
};

const welcomePickerConfig = {
  colorsEl: document.getElementById("welcome-colors"),
  stylesEl: document.getElementById("welcome-styles"),
  previewEl: document.getElementById("welcome-avatar-preview"),
  getColor: () => draftColor,
  setColor: (c) => {
    draftColor = c;
  },
  getStyle: () => draftStyle,
  setStyle: (s) => {
    draftStyle = s;
  },
};

// Modal helpers
function anyModalOpen() {
  return Boolean(document.querySelector(".modal:not(.hidden)"));
}

function closeAllModals(force = false) {
  document.querySelectorAll(".modal").forEach((m) => {
    if (!force && m.id === "modal-welcome" && !hasChosenIdentity) return;
    m.classList.add("hidden");
  });
}

function openModal(id) {
  closeAllModals(true);
  if (document.pointerLockElement === canvas) {
    document.exitPointerLock?.();
  }
  document.getElementById(id)?.classList.remove("hidden");
  if (id === "modal-blocks") renderBlocksCatalog();
  if (id === "modal-ai") document.getElementById("ai-input")?.focus();
  if (id === "modal-chat") document.getElementById("chat-input")?.focus();
  if (id === "modal-welcome") {
    draftColor = playerColor;
    draftStyle = playerStyle;
    const inp = document.getElementById("welcome-name");
    inp.value = playerName || "";
    renderProfilePicker(welcomePickerConfig);
    setTimeout(() => inp?.focus(), 40);
  }
  if (id === "modal-room") {
    draftColor = playerColor;
    draftStyle = playerStyle;
    document.getElementById("input-name").value = playerName;
    document.getElementById("input-room").value = currentRoom;
    renderProfilePicker(roomPickerConfig);
  }
}

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", closeAllModals);
});

// Touch UI toggle
function syncTouchVisibility() {
  touchUi.classList.toggle("hidden", !touchVisible);
  document.body.classList.toggle("touch-mode", touchVisible);
  document.getElementById("t-fly").classList.toggle("active", flyMode);
  document.getElementById("t-down").classList.toggle("hidden", !flyMode);
  document.getElementById("btn-fly").classList.toggle("active", flyMode);
  pointerBanner.classList.toggle(
    "hidden",
    touchVisible || document.pointerLockElement === canvas
  );
}

// Voxel Interaction (Break / Place)
// raySource: optional XR controller Object3D (ray from controller instead of head)
function getAimRay(raySource = null) {
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3(0, 0, -1);
  if (raySource && renderer.xr.isPresenting) {
    raySource.getWorldPosition(origin);
    dir.applyQuaternion(raySource.getWorldQuaternion(tmpQuat)).normalize();
  } else if (renderer.xr.isPresenting) {
    const xrCam = renderer.xr.getCamera();
    xrCam.getWorldPosition(origin);
    dir.applyQuaternion(xrCam.getWorldQuaternion(tmpQuat)).normalize();
  } else if (thirdPerson) {
    origin.set(playerState.x, playerState.y + EYE_HEIGHT, playerState.z);
    const euler = new THREE.Euler(playerState.pitch, playerState.yaw, 0, "YXZ");
    dir.applyEuler(euler).normalize();
  } else {
    camera.getWorldPosition(origin);
    camera.getWorldDirection(dir);
  }
  return { origin, dir };
}

function overlapsPlayer(bx, by, bz) {
  const minX = playerState.x - PLAYER_RADIUS;
  const maxX = playerState.x + PLAYER_RADIUS;
  const minY = playerState.y;
  const maxY = playerState.y + PLAYER_HEIGHT;
  const minZ = playerState.z - PLAYER_RADIUS;
  const maxZ = playerState.z + PLAYER_RADIUS;
  return (
    bx + 1 > minX &&
    bx < maxX &&
    by + 1 > minY &&
    by < maxY &&
    bz + 1 > minZ &&
    bz < maxZ
  );
}

function breakBlock(raySource = null) {
  const { origin, dir } = getAimRay(raySource);
  const hit = raycastVoxels(worldData, origin, dir, 7.5);
  if (!hit) return;
  if (hit.y <= 0) {
    showToast("El suelo base es indestructible.");
    return;
  }
  applyBlockLocal(hit.x, hit.y, hit.z, BLOCK_IDS.AIR);
  soundFX.playBreak();
  sendBlockEdit(hit.x, hit.y, hit.z, BLOCK_IDS.AIR);
}

function placeBlock(raySource = null) {
  const { origin, dir } = getAimRay(raySource);
  const hit = raycastVoxels(worldData, origin, dir, 7.5);
  if (!hit) return;
  const tx = hit.x + hit.nx;
  const ty = hit.y + hit.ny;
  const tz = hit.z + hit.nz;
  if (!inBounds(tx, ty, tz) || ty <= 0) return;

  const blockId = hotbar[selectedSlot];
  if (isSolidBlock(blockId) && overlapsPlayer(tx, ty, tz)) {
    return;
  }
  applyBlockLocal(tx, ty, tz, blockId);
  soundFX.playPlace();
  sendBlockEdit(tx, ty, tz, blockId);
}

// Networking (WebSocket to Cloudflare Durable Object) — hardened reconnect
const netBanner = document.getElementById("net-banner");
const roomBtn = document.getElementById("btn-room");

function isWsOpen() {
  return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

function sendWs(obj) {
  if (!isWsOpen()) return false;
  try {
    ws.send(JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}

function sendBlockEdit(x, y, z, t) {
  if (sendWs({ type: "block", x, y, z, t })) return;
  // Offline: queue (last write per coordinate wins) and replay after re-sync
  const key = `${x},${y},${z}`;
  pendingEdits.delete(key);
  pendingEdits.set(key, { x, y, z, t });
  while (pendingEdits.size > MAX_PENDING_EDITS) {
    pendingEdits.delete(pendingEdits.keys().next().value);
  }
  if (!offlineEditWarned) {
    offlineEditWarned = true;
    showToast("Sin conexión: tus cambios se enviarán al reconectar", 2600);
  }
}

function setNetStatus(state, text = "") {
  wsDot.classList.toggle("online", state === "online");
  wsDot.classList.toggle("connecting", state === "connecting");
  wsDot.classList.toggle("offline", state === "offline");
  const ping = latencyMs !== null && state === "online" ? ` · ${latencyMs} ms` : "";
  roomBtn.title = `Sala "${currentRoom}" · ${
    state === "online" ? "conectado" : state === "connecting" ? "conectando…" : "desconectado"
  }${ping} · tocá para cambiar sala o nombre`;
  if (state === "online" || !text) {
    netBanner.classList.add("hidden");
  } else {
    netBanner.textContent = text;
    netBanner.classList.toggle("is-offline", state === "offline");
    netBanner.classList.remove("hidden");
  }
}

function updateOnlineBadge() {
  onlineCountEl.textContent = String(1 + remotePlayers.size);
}

function removeRemotePlayer(id) {
  const rp = remotePlayers.get(id);
  if (!rp) return;
  scene.remove(rp.mesh);
  disposeObject3D(rp.mesh);
  remotePlayers.delete(id);
  updateOnlineBadge();
}

function clearRemotePlayers() {
  for (const id of [...remotePlayers.keys()]) {
    removeRemotePlayer(id);
  }
  remotePlayers.clear();
  updateOnlineBadge();
}

function finiteOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function remoteLabel(p) {
  const name = String(p?.name || "Jugador").slice(0, 16);
  return p?.vr ? `🥽 ${name}` : name;
}

function upsertRemotePlayer(p) {
  if (!p || p.id === undefined || p.id === null) return;
  const id = String(p.id);
  if (id === selfId) return;
  const prev = remotePlayers.get(id);
  const x = Math.max(0, Math.min(WORLD_SIZE_X, finiteOr(p.x, prev?.targetX ?? WORLD_SIZE_X / 2)));
  const y = Math.max(-4, Math.min(WORLD_HEIGHT + 12, finiteOr(p.y, prev?.targetY ?? WORLD_HEIGHT / 2)));
  const z = Math.max(0, Math.min(WORLD_SIZE_Z, finiteOr(p.z, prev?.targetZ ?? WORLD_SIZE_Z / 2)));
  const yaw = finiteOr(p.yaw, prev?.targetYaw ?? 0);
  const pitch = Math.max(-1.58, Math.min(1.58, finiteOr(p.pitch, prev?.targetPitch ?? 0)));
  const color = normalizeAvatarColor(p.color) || "#38bdf8";
  const style = normalizeAvatarStyle(p.style);
  const label = remoteLabel(p);
  const now = performance.now();

  if (!prev) {
    const mesh = createAvatar(label, color, false, style);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    scene.add(mesh);
    remotePlayers.set(id, {
      mesh,
      label,
      color,
      style,
      yaw,
      pitch,
      targetX: x,
      targetY: y,
      targetZ: z,
      targetYaw: yaw,
      targetPitch: pitch,
      lastMoved: now,
      lastSeen: now,
    });
    updateOnlineBadge();
    return;
  }

  if (Math.hypot(x - prev.targetX, y - prev.targetY, z - prev.targetZ) > 0.02) {
    prev.lastMoved = now;
  }
  // Teleports / respawns / world resets: snap instead of sliding through walls
  if (Math.hypot(x - prev.mesh.position.x, y - prev.mesh.position.y, z - prev.mesh.position.z) > 12) {
    prev.mesh.position.set(x, y, z);
  }
  prev.targetX = x;
  prev.targetY = y;
  prev.targetZ = z;
  prev.targetYaw = yaw;
  prev.targetPitch = pitch;
  prev.lastSeen = now;
  if (label !== prev.label || color !== prev.color || style !== prev.style) {
    prev.label = label;
    prev.color = color;
    prev.style = style;
    applyAvatarLook(prev.mesh, color, style, false);
    setAvatarNameTag(prev.mesh, label, color);
  }
}

function applyBlocksBatch(blocks) {
  const dirty = new Set();
  for (const b of blocks) {
    const bx = Math.floor(Number(b?.x));
    const by = Math.floor(Number(b?.y));
    const bz = Math.floor(Number(b?.z));
    const bt = Math.floor(Number(b?.t));
    if (!Number.isFinite(bt)) continue;
    if (applyBlockLocal(bx, by, bz, bt, false)) {
      markChunksAround(bx, bz, dirty);
    }
  }
  for (const k of dirty) {
    const [cx, cz] = k.split(",").map(Number);
    rebuildChunk(cx, cz);
  }
}

function respawnPlayer() {
  const safe = getSpawnPoint(worldData);
  playerState.x = safe.x;
  playerState.y = safe.y;
  playerState.z = safe.z;
  playerState.vx = 0;
  playerState.vy = 0;
  playerState.vz = 0;
}

function handleInit(msg) {
  initReceived = true;
  selfId = msg.selfId != null ? String(msg.selfId) : null;
  if (msg.selfName) {
    playerName = sanitizePlayerName(msg.selfName) || playerName;
    if (playerName) {
      hasChosenIdentity = true;
      localStorage.setItem("ac_name", playerName);
    }
  }
  selfColor = normalizeAvatarColor(msg.selfColor) || playerColor;
  playerColor = selfColor;
  playerStyle = normalizeAvatarStyle(msg.selfStyle || playerStyle);
  localStorage.setItem("ac_color", playerColor);
  localStorage.setItem("ac_style", playerStyle);
  applyAvatarLook(selfAvatar, selfColor, playerStyle, false);
  updatePlayerBadge();

  const prevSeed = worldSeed;
  const nextSeed = Number.isFinite(Number(msg.seed)) && Number(msg.seed) > 0 ? Number(msg.seed) : worldSeed;
  // Same room + same seed => this is a reconnect: keep the player where they were
  const resume = lastInitRoom === currentRoom && nextSeed === prevSeed;
  worldSeed = nextSeed;
  worldData = generateBaseWorld(worldSeed);

  if (Array.isArray(msg.edits)) {
    for (const e of msg.edits) {
      applyBlockLocal(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z), Math.floor(e.t), false);
    }
  }

  // Replay edits made while disconnected (only if the world is the same one)
  const replay = resume ? [...pendingEdits.values()] : [];
  pendingEdits.clear();
  offlineEditWarned = false;
  for (const e of replay) {
    applyBlockLocal(e.x, e.y, e.z, e.t, false);
  }
  rebuildAllChunks();

  if (!resume) {
    const saved = msg.selfState;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.z)) {
      let sy = saved.y;
      while (collidesAt(saved.x, sy, saved.z) && sy < saved.y + 4) {
        sy += 1;
      }
      if (!collidesAt(saved.x, sy, saved.z)) {
        playerState.x = saved.x;
        playerState.y = sy;
        playerState.z = saved.z;
        playerState.yaw = finiteOr(saved.yaw, 0);
        playerState.pitch = Math.max(-1.58, Math.min(1.58, finiteOr(saved.pitch, -0.08)));
        playerState.vx = 0;
        playerState.vy = 0;
        playerState.vz = 0;
        if (Number.isInteger(saved.held)) {
          const idx = hotbar.indexOf(saved.held);
          if (idx >= 0) selectSlot(idx);
        }
      } else {
        respawnPlayer();
      }
    } else {
      respawnPlayer();
    }
  } else if (collidesAt(playerState.x, playerState.y, playerState.z)) {
    respawnPlayer();
  }
  lastInitRoom = currentRoom;

  clearRemotePlayers();
  if (Array.isArray(msg.players)) {
    msg.players.forEach((p) => upsertRemotePlayer(p));
  }

  feedEl.innerHTML = "";
  if (Array.isArray(msg.chat)) {
    msg.chat.slice(-4).forEach((c) => addFeed(c.sender, c.text, c.kind));
  }
  updateOnlineBadge();

  for (const e of replay) {
    sendWs({ type: "block", x: e.x, y: e.y, z: e.z, t: e.t });
  }
  if (replay.length) {
    showToast(`Sincronizados ${replay.length} cambios hechos sin conexión`, 2400);
  } else if (!welcomeGreeted) {
    welcomeGreeted = true;
    if (msg.returning && msg.selfState) {
      showToast(`👋 ¡Hola de nuevo, ${playerName}! Retomás tu personaje`, 2600);
    } else if (playerName) {
      showToast(`✨ ¡Hola, ${playerName}! Estás en "${msg.room || currentRoom}"`, 2200);
    }
  }
  // Announce our pose right away so others don't see us at the default spawn
  lastSentPose = "";
  lastMoveSentAt = 0;
  // Healthy session: reset backoff only after a real init (not just TCP open)
  reconnectAttempt = 0;
}

function handleServerMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;

  switch (msg.type) {
    case "init":
      handleInit(msg);
      return;
    case "pong": {
      const t = Number(msg.t);
      if (Number.isFinite(t) && t > 0) {
        latencyMs = Math.max(0, Math.min(9999, Date.now() - t));
        setNetStatus("online");
      }
      return;
    }
    case "player_join":
      upsertRemotePlayer(msg.player);
      addFeed("Sala", `${msg.player?.name || "Alguien"} entró al mundo`, "system");
      return;
    case "player_move":
      upsertRemotePlayer(msg.player);
      return;
    case "player_profile": {
      const p = msg.player;
      if (!p) return;
      if (String(p.id) === selfId) {
        if (p.name) playerName = sanitizePlayerName(p.name) || playerName;
        if (p.color) {
          playerColor = normalizeAvatarColor(p.color) || playerColor;
          selfColor = playerColor;
        }
        if (p.style) playerStyle = normalizeAvatarStyle(p.style);
        localStorage.setItem("ac_name", playerName);
        localStorage.setItem("ac_color", playerColor);
        localStorage.setItem("ac_style", playerStyle);
        applyAvatarLook(selfAvatar, selfColor, playerStyle, false);
        updatePlayerBadge();
      } else {
        upsertRemotePlayer(p);
      }
      return;
    }
    case "player_leave": {
      const rp = remotePlayers.get(String(msg.id));
      if (rp) {
        addFeed("Sala", `${rp.label.replace(/^🥽 /, "")} salió`, "system");
        removeRemotePlayer(String(msg.id));
      }
      return;
    }
    case "block":
      if (msg.by == null || String(msg.by) !== selfId) {
        applyBlocksBatch([msg]);
      }
      return;
    case "ai_build":
      if (Array.isArray(msg.blocks)) applyBlocksBatch(msg.blocks);
      if (msg.anchor) {
        aiAvatar.position.set(
          finiteOr(msg.anchor.x, 0) + 0.5,
          finiteOr(msg.anchor.y, 1) + 1,
          finiteOr(msg.anchor.z, 0) + 0.5
        );
        aiAvatar.visible = true;
        aiAvatarHideAt = performance.now() + 14000;
      }
      if (msg.chat) addFeed(msg.chat.sender, msg.chat.text, "ai");
      if (msg.provider !== "sync") soundFX.playAiBuild();
      return;
    case "chat":
      addFeed(msg.sender, msg.text, msg.kind || "chat");
      return;
    case "world_reset":
      worldSeed = Number(msg.seed) || 2026;
      worldData = generateBaseWorld(worldSeed);
      pendingEdits.clear();
      rebuildAllChunks();
      respawnPlayer();
      if (msg.chat) addFeed(msg.chat.sender, msg.chat.text, "system");
      showToast("Mundo regenerado!");
      return;
    case "error":
      if (msg.message || msg.error) showToast(`⚠️ ${msg.message || msg.error}`, 2600);
      return;
    default:
      return;
  }
}

function stopReconnectTimers() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearInterval(reconnectCountdownTimer);
  reconnectCountdownTimer = null;
}

function scheduleReconnect(gen, reason) {
  if (gen !== wsGeneration || reconnectTimer) return;
  ws = null;
  clearInterval(reconnectCountdownTimer);
  if (typeof navigator.onLine === "boolean" && !navigator.onLine) {
    setNetStatus("offline", "📴 Sin internet · reconecto solo cuando vuelva la red");
    return;
  }
  reconnectAttempt += 1;
  const exp = Math.min(
    WS_BACKOFF_MAX_MS,
    WS_BACKOFF_BASE_MS * 2 ** Math.min(reconnectAttempt - 1, 6)
  );
  const delay = Math.round(exp * (0.75 + Math.random() * 0.5)); // ±25% jitter
  const until = Date.now() + delay;
  const tick = () => {
    const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    setNetStatus(
      "offline",
      `⚠️ ${reason} · reintento #${reconnectAttempt} en ${s}s · tocá para reconectar ya`
    );
  };
  tick();
  reconnectCountdownTimer = setInterval(tick, 1000);
  reconnectTimer = setTimeout(() => {
    stopReconnectTimers();
    connectSocket();
  }, delay);
}

function connectSocket() {
  if (!hasChosenIdentity || !playerName) return;
  stopReconnectTimers();
  initReceived = false;
  const gen = ++wsGeneration;
  if (ws) {
    const old = ws;
    ws = null;
    try {
      old.close(1000, "reconnect");
    } catch {}
  }

  roomLabel.textContent = currentRoom;
  updatePlayerBadge();
  setNetStatus(
    "connecting",
    reconnectAttempt > 0 ? `🔄 Reconectando a "${currentRoom}"… (intento #${reconnectAttempt + 1})` : ""
  );

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${location.host}/ws?room=${encodeURIComponent(
    currentRoom
  )}&uid=${encodeURIComponent(playerUid)}&name=${encodeURIComponent(
    playerName
  )}&color=${encodeURIComponent(playerColor)}&style=${encodeURIComponent(playerStyle)}`;

  let sock;
  try {
    sock = new WebSocket(wsUrl);
  } catch {
    scheduleReconnect(gen, "No se pudo abrir la conexión");
    return;
  }
  ws = sock;

  const connectTimeout = setTimeout(() => {
    if (gen !== wsGeneration || sock.readyState !== WebSocket.CONNECTING) return;
    try {
      sock.close();
    } catch {}
    scheduleReconnect(gen, "Servidor sin respuesta");
  }, WS_CONNECT_TIMEOUT_MS);

  sock.addEventListener("open", () => {
    clearTimeout(connectTimeout);
    if (gen !== wsGeneration) return;
    lastWsMessageAt = performance.now();
    const wasReconnect = reconnectAttempt > 0;
    setNetStatus("online");
    showToast(
      wasReconnect ? `✅ Reconectado a "${currentRoom}"` : `Conectado a sala "${currentRoom}"`,
      1800
    );
    sendWs({ type: "ping", t: Date.now() });
  });

  sock.addEventListener("message", (event) => {
    if (gen !== wsGeneration) return;
    lastWsMessageAt = performance.now();
    handleServerMessage(event.data);
  });

  sock.addEventListener("close", (ev) => {
    clearTimeout(connectTimeout);
    if (gen !== wsGeneration) return;
    const reason =
      ev.code === 1008 || ev.code === 4003
        ? "Conexión rechazada por el servidor"
        : ev.code === 1013
          ? "Sala ocupada"
          : "Conexión perdida";
    scheduleReconnect(gen, reason);
  });

  sock.addEventListener("error", () => {
    if (gen !== wsGeneration) return;
    wsDot.classList.remove("online");
  });
}

function reconnectNow() {
  if (!hasChosenIdentity || isWsOpen()) return;
  stopReconnectTimers();
  connectSocket();
}

netBanner.addEventListener("click", reconnectNow);

window.addEventListener("online", () => {
  reconnectAttempt = 0;
  reconnectNow();
});

window.addEventListener("offline", () => {
  setNetStatus("offline", "📴 Sin internet · reconecto solo cuando vuelva la red");
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const stale = performance.now() - lastWsMessageAt > WS_STALE_MS;
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    reconnectNow();
  } else if (isWsOpen() && stale) {
    sendWs({ type: "ping", t: Date.now() });
  }
});

// Heartbeat + stale-connection watchdog (half-open sockets after sleep / network switch)
setInterval(() => {
  if (!isWsOpen()) return;
  if (performance.now() - lastWsMessageAt > WS_STALE_MS) {
    const gen = wsGeneration;
    try {
      ws.close(4000, "stale");
    } catch {}
    scheduleReconnect(gen, "Conexión congelada");
    return;
  }
  sendWs({ type: "ping", t: Date.now() });
}, WS_PING_MS);

// AI Architect Action
const AI_PROVIDERS = ["auto", "gemini", "groq", "mistral"];
const AI_PROVIDER_HINTS = {
  auto: "⚡ Auto: rota Gemini (3 cuentas) → Groq → Mistral con failover automático ante 429/503.",
  gemini: "🔷 Gemini 4-Hydrogen · 3.8 Flash · 3.5 Flash-Lite repartido en 3 cuentas Google AI Studio.",
  groq: "🚀 Groq ultra-rápido: GPT-OSS 120B con respaldo Qwen3.8.",
  mistral: "🧩 Mistral Codestral: JSON preciso para estructuras voxel.",
};
const AI_TIMEOUT_MS = 45000;
const aiProviderSel = document.getElementById("ai-provider");
const aiProviderHint = document.getElementById("ai-provider-hint");
const aiModal = document.getElementById("modal-ai");
let aiBusy = false;

function syncAiProviderHint() {
  if (aiProviderHint) {
    aiProviderHint.textContent = AI_PROVIDER_HINTS[aiProviderSel.value] || AI_PROVIDER_HINTS.auto;
  }
}

{
  const saved = localStorage.getItem("ac_ai_provider");
  if (saved && AI_PROVIDERS.includes(saved)) aiProviderSel.value = saved;
  syncAiProviderHint();
  aiProviderSel.addEventListener("change", () => {
    if (AI_PROVIDERS.includes(aiProviderSel.value)) {
      localStorage.setItem("ac_ai_provider", aiProviderSel.value);
    }
    syncAiProviderHint();
  });
}

function setAiBusy(busy) {
  aiBusy = busy;
  aiModal.classList.toggle("busy", busy);
  document.getElementById("ai-submit").disabled = busy;
  document.querySelectorAll("[data-ai-prompt]").forEach((chip) => {
    chip.disabled = busy;
  });
}

async function invokeAiArchitect(promptText, preset = null) {
  const statusEl = document.getElementById("ai-status");
  const text = String(promptText || "").trim().slice(0, 250);
  if (!text) return;
  if (aiBusy) {
    showToast("✨ La IA ya está construyendo… esperá un momento", 1800);
    return;
  }
  const provider = AI_PROVIDERS.includes(aiProviderSel.value) ? aiProviderSel.value : "auto";

  const { origin, dir } = getAimRay();
  const hit = raycastVoxels(worldData, origin, dir, 12);
  let anchor;
  if (hit) {
    anchor = {
      x: hit.x + hit.nx,
      y: Math.max(1, hit.y + hit.ny),
      z: hit.z + hit.nz,
    };
  } else {
    const fx = Math.round(playerState.x - Math.sin(playerState.yaw) * 4);
    const fz = Math.round(playerState.z - Math.cos(playerState.yaw) * 4);
    anchor = {
      x: fx,
      y: Math.max(1, Math.round(playerState.y)),
      z: fz,
    };
  }
  anchor.x = Math.max(4, Math.min(WORLD_SIZE_X - 5, anchor.x));
  anchor.y = Math.max(1, Math.min(WORLD_HEIGHT - 2, anchor.y));
  anchor.z = Math.max(4, Math.min(WORLD_SIZE_Z - 5, anchor.z));

  const providerName = aiProviderSel.options[aiProviderSel.selectedIndex]?.text || provider;
  statusEl.textContent = `Consultando ${providerName.split("(")[0].trim()} y construyendo...`;
  setAiBusy(true);

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const abortTimer = controller ? setTimeout(() => controller.abort(), AI_TIMEOUT_MS) : null;

  try {
    const body = { room: currentRoom, prompt: text, anchor, playerName, provider };
    if (preset) body.preset = preset;
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { ok: false, error: `Respuesta inválida del servidor (HTTP ${res.status}).` };
    }
    if (!res.ok || !data.ok) {
      statusEl.textContent =
        res.status === 429
          ? "Demasiadas solicitudes a la IA. Esperá unos segundos y reintentá."
          : data.error || `Error al conectar con la IA (HTTP ${res.status}).`;
      return;
    }
    const tag = [data.provider, data.model].filter(Boolean).join("/") || "ia";
    const count = Number(data.blocksCount) || 0;
    statusEl.textContent = `[${tag}] ${data.reply || "Listo"} (${count} bloques)`;
    showToast(`✨ ${data.reply || "Construcción lista"}`, 3200);
    if (count > 0) {
      setTimeout(closeAllModals, 700);
    }
  } catch (err) {
    statusEl.textContent =
      err?.name === "AbortError"
        ? "La IA tardó demasiado (45 s). Probá otro motor o reintentá."
        : "Sin conexión con el servidor IA.";
  } finally {
    clearTimeout(abortTimer);
    setAiBusy(false);
  }
}

// Button Bindings
document.getElementById("btn-ai").addEventListener("click", () => openModal("modal-ai"));
document.getElementById("btn-blocks").addEventListener("click", () => openModal("modal-blocks"));
document.getElementById("btn-room").addEventListener("click", () => openModal("modal-room"));
document.getElementById("btn-chat").addEventListener("click", () => openModal("modal-chat"));
document.getElementById("btn-help").addEventListener("click", () => openModal("modal-help"));
document.getElementById("hb-prev").addEventListener("click", () => selectSlot(selectedSlot - 1));
document.getElementById("hb-next").addEventListener("click", () => selectSlot(selectedSlot + 1));

// Click on the dark backdrop closes a modal (no need to aim for the ✕)
document.querySelectorAll(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m && m.id !== "modal-welcome") closeAllModals();
  });
});

const camBtnLabel = document.getElementById("cam-label");
document.getElementById("btn-cam").addEventListener("click", () => {
  thirdPerson = !thirdPerson;
  selfAvatar.visible = thirdPerson;
  camBtnLabel.textContent = thirdPerson ? "3ª" : "1ª";
  showToast(thirdPerson ? "Cámara 3ª Persona" : "Cámara 1ª Persona", 1400);
});

const toggleFly = () => {
  flyMode = !flyMode;
  playerState.vy = 0;
  touchState.downHeld = false;
  syncTouchVisibility();
  showToast(flyMode ? "Modo Vuelo activado (⬆️ subir · ⬇️ bajar)" : "Gravedad normal", 1400);
};
document.getElementById("btn-fly").addEventListener("click", toggleFly);

const audioBtn = document.getElementById("btn-audio");
function syncAudioBtn() {
  audioBtn.textContent = soundFX.muted ? "🔇" : "🔊";
}
soundFX.muted = localStorage.getItem("ac_muted") === "1";
syncAudioBtn();
audioBtn.addEventListener("click", () => {
  soundFX.muted = !soundFX.muted;
  localStorage.setItem("ac_muted", soundFX.muted ? "1" : "0");
  syncAudioBtn();
  if (!soundFX.muted) soundFX.playPlace();
});

document.getElementById("btn-touch-toggle").addEventListener("click", () => {
  touchVisible = !touchVisible;
  syncTouchVisibility();
  closeAllModals();
});

document.getElementById("btn-invite").addEventListener("click", async () => {
  const url = `${location.origin}/?room=${encodeURIComponent(currentRoom)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "AriadnaCraft Online", text: "Entrá a mi mundo voxel:", url });
      return;
    }
  } catch {}
  try {
    await navigator.clipboard.writeText(url);
    showToast(`Link copiado: ?room=${currentRoom}`);
  } catch {
    showToast(url, 4000);
  }
});

document.getElementById("btn-reset-world").addEventListener("click", () => {
  if (!isWsOpen()) {
    showToast("Sin conexión: no se puede regenerar el mundo ahora");
    return;
  }
  if (!window.confirm("¿Regenerar el mundo para TODOS en esta sala? Se borran las construcciones.")) {
    return;
  }
  sendWs({ type: "reset_world" });
  closeAllModals();
});

document.getElementById("welcome-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("welcome-name");
  const nextName = sanitizePlayerName(input.value);
  if (!nextName) {
    showToast("Escribí tu nombre para entrar", 1800);
    input.focus();
    return;
  }
  soundFX.unlock();
  playerName = nextName;
  playerColor = draftColor;
  playerStyle = draftStyle;
  selfColor = playerColor;
  hasChosenIdentity = true;
  welcomeGreeted = false;
  localStorage.setItem("ac_uid", playerUid);
  localStorage.setItem("ac_name", playerName);
  localStorage.setItem("ac_color", playerColor);
  localStorage.setItem("ac_style", playerStyle);
  localStorage.setItem("ac_room", currentRoom);
  applyAvatarLook(selfAvatar, selfColor, playerStyle, false);
  updatePlayerBadge();
  closeAllModals(true);
  reconnectAttempt = 0;
  connectSocket();
});

document.getElementById("btn-new-user").addEventListener("click", () => {
  stopReconnectTimers();
  wsGeneration += 1;
  if (ws) {
    const old = ws;
    ws = null;
    try {
      old.close(1000, "switch user");
    } catch {}
  }
  playerUid = createUid();
  localStorage.setItem("ac_uid", playerUid);
  localStorage.removeItem("ac_name");
  playerName = "";
  hasChosenIdentity = false;
  welcomeGreeted = false;
  initReceived = false;
  lastInitRoom = null;
  clearRemotePlayers();
  playerColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  playerStyle = "classic";
  selfColor = playerColor;
  applyAvatarLook(selfAvatar, selfColor, playerStyle, false);
  updatePlayerBadge();
  setNetStatus("connecting", "");
  openModal("modal-welcome");
});

document.getElementById("room-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const inputName = document.getElementById("input-name");
  const nextName = sanitizePlayerName(inputName.value);
  if (!nextName) {
    showToast("Escribí un nombre válido", 1800);
    inputName.focus();
    return;
  }
  const nextRoom =
    document
      .getElementById("input-room")
      .value.trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 28) || "principal";
  const sameRoom = nextRoom === currentRoom;
  if (!sameRoom) pendingEdits.clear();
  playerName = nextName;
  playerColor = draftColor;
  playerStyle = draftStyle;
  selfColor = playerColor;
  hasChosenIdentity = true;
  currentRoom = nextRoom;
  localStorage.setItem("ac_uid", playerUid);
  localStorage.setItem("ac_name", playerName);
  localStorage.setItem("ac_color", playerColor);
  localStorage.setItem("ac_style", playerStyle);
  localStorage.setItem("ac_room", currentRoom);
  applyAvatarLook(selfAvatar, selfColor, playerStyle, false);
  updatePlayerBadge();

  const nextUrl = new URL(location.href);
  nextUrl.searchParams.set("room", currentRoom);
  history.replaceState(null, "", nextUrl.toString());
  closeAllModals(true);

  if (sameRoom && isWsOpen() && initReceived) {
    sendWs({ type: "profile", name: playerName, color: playerColor, style: playerStyle });
    showToast(`✅ Personaje guardado: ${playerName}`);
  } else {
    welcomeGreeted = false;
    reconnectAttempt = 0;
    connectSocket();
  }
});

document.getElementById("ai-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("ai-input");
  const val = input.value.trim();
  if (!val || aiBusy) return;
  input.value = "";
  invokeAiArchitect(val);
});

document.querySelectorAll("[data-ai-prompt]").forEach((chip) => {
  chip.addEventListener("click", () => {
    invokeAiArchitect(chip.getAttribute("data-ai-prompt"), chip.getAttribute("data-preset"));
  });
});

document.getElementById("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  closeAllModals();
  if (text.toLowerCase().startsWith("/ia ")) {
    invokeAiArchitect(text.slice(4));
  } else if (!sendWs({ type: "chat", text: text.slice(0, 250) })) {
    showToast("Sin conexión: el mensaje no se envió");
  }
});

// WebXR (immersive-vr) with safe activation + Cardboard stereo fallback
let activeXrSession = null;
let vrBusy = false;
let stereoFullscreen = false;
let xrSnapLatched = false;
const vrBtn = document.getElementById("btn-vr");
const vrLabel = document.getElementById("vr-label");
const xrBanner = document.getElementById("xr-banner");
let xrBannerTimer = null;

function showXrBanner(text, ms = 6500) {
  xrBanner.textContent = text;
  xrBanner.classList.remove("hidden");
  clearTimeout(xrBannerTimer);
  xrBannerTimer = setTimeout(() => xrBanner.classList.add("hidden"), ms);
}
xrBanner.addEventListener("click", () => xrBanner.classList.add("hidden"));

async function detectXrSupport() {
  if (!window.isSecureContext) {
    return { vr: false, reason: "WebXR requiere HTTPS" };
  }
  if (!navigator.xr || typeof navigator.xr.isSessionSupported !== "function") {
    return { vr: false, reason: "Este navegador no soporta WebXR" };
  }
  try {
    const ok = await navigator.xr.isSessionSupported("immersive-vr");
    return { vr: Boolean(ok), reason: ok ? "" : "No se detectó visor VR / runtime WebXR" };
  } catch {
    return { vr: false, reason: "WebXR bloqueado por el navegador o permisos" };
  }
}

let xrSupport = { vr: false, reason: "Comprobando WebXR…" };
async function refreshXrSupport() {
  xrSupport = await detectXrSupport();
  vrBtn.dataset.xr = xrSupport.vr ? "1" : "0";
  vrBtn.title = xrSupport.vr
    ? "Entrar a realidad virtual WebXR"
    : `VR: ${xrSupport.reason} → modo estéreo 3D (Cardboard)`;
  return xrSupport;
}
const xrSupportReady = refreshXrSupport();
navigator.xr?.addEventListener?.("devicechange", () => {
  refreshXrSupport();
});

function syncVrButton() {
  const on = Boolean(activeXrSession) || stereoMode;
  vrBtn.classList.toggle("active", on);
  vrLabel.textContent = on ? "Salir" : "VR";
}

function enterStereo() {
  stereoMode = true;
  syncVrButton();
  const fsReq = document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
  if (fsReq && typeof fsReq.then === "function") {
    fsReq
      .then(() => {
        stereoFullscreen = true;
        return screen.orientation?.lock?.("landscape");
      })
      .catch(() => {});
  }
  stereoEffect.setSize(window.innerWidth, window.innerHeight);
  showToast("Modo Estéreo 3D (Cardboard) activo · 🥽 Salir para volver", 2600);
}

function exitStereo() {
  stereoMode = false;
  syncVrButton();
  renderer.setScissorTest(false);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  try {
    screen.orientation?.unlock?.();
  } catch {}
  if (stereoFullscreen && document.fullscreenElement) {
    document.exitFullscreen?.().catch?.(() => {});
  }
  stereoFullscreen = false;
  showToast("Modo Estéreo VR desactivado", 1600);
}

async function startXrSession() {
  let session;
  try {
    session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
    });
  } catch (err) {
    console.warn("[AriadnaCraft] requestSession falló:", err?.message || err);
    return false;
  }
  // Use local-floor only if the runtime actually granted it, otherwise "local"
  const floor = !Array.isArray(session.enabledFeatures) || session.enabledFeatures.includes("local-floor");
  renderer.xr.setReferenceSpaceType(floor ? "local-floor" : "local");
  try {
    await renderer.xr.setSession(session);
  } catch (err) {
    console.warn("[AriadnaCraft] setSession falló:", err?.message || err);
    try {
      await session.end();
    } catch {}
    renderer.xr.setReferenceSpaceType("local-floor");
    return false;
  }

  activeXrSession = session;
  if (stereoMode) {
    stereoMode = false;
    renderer.setScissorTest(false);
  }
  // local-floor already includes the real head height; "local" starts at the head
  yawPivot.position.y = floor ? 0 : EYE_HEIGHT;
  syncVrButton();
  session.addEventListener("end", () => {
    activeXrSession = null;
    yawPivot.position.y = EYE_HEIGHT;
    camera.position.set(0, 0, 0);
    renderer.xr.setReferenceSpaceType("local-floor");
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    syncVrButton();
    showToast("Sesión WebXR finalizada", 1600);
  });
  showToast("Sesión WebXR activa · gatillo izq/der = poner/romper · stick der = girar", 3200);
  return true;
}

async function toggleVrMode() {
  if (vrBusy) return;
  vrBusy = true;
  try {
    if (activeXrSession) {
      await activeXrSession.end().catch(() => {});
      return;
    }
    if (stereoMode) {
      exitStereo();
      return;
    }
    closeAllModals();
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    await xrSupportReady;
    if (xrSupport.vr) {
      if (await startXrSession()) return;
      showXrBanner("🥽 No se pudo iniciar WebXR en este dispositivo → usando modo estéreo 3D (Cardboard).");
    } else {
      showXrBanner(`🥽 ${xrSupport.reason}. Activé el modo estéreo 3D (Cardboard). Tocá 🥽 Salir para volver.`);
    }
    enterStereo();
  } finally {
    vrBusy = false;
  }
}

vrBtn.addEventListener("click", toggleVrMode);

// WebXR Controllers (attached to yawPivot so snap-turn rotates hands with the view)
const controller0 = renderer.xr.getController(0);
const controller1 = renderer.xr.getController(1);
const rayLineGeom = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, -5),
]);
controller0.add(new THREE.Line(rayLineGeom, new THREE.LineBasicMaterial({ color: 0x38bdf8 })));
controller1.add(new THREE.Line(rayLineGeom, new THREE.LineBasicMaterial({ color: 0xf87171 })));
controller0.addEventListener("selectstart", () => placeBlock(controller0));
controller1.addEventListener("selectstart", () => breakBlock(controller1));
controller0.addEventListener("squeezestart", () => selectSlot(selectedSlot + 1));
controller1.addEventListener("squeezestart", toggleFly);
yawPivot.add(controller0, controller1);

// Desktop Pointer Lock + Keyboard Controls (NO scroll wheel needed!)
canvas.addEventListener("click", () => {
  soundFX.unlock();
  if (!anyModalOpen() && !touchVisible && document.pointerLockElement !== canvas) {
    try {
      const req = canvas.requestPointerLock?.();
      req?.catch?.(() => {});
    } catch {}
  }
});

canvas.addEventListener("mousedown", (e) => {
  if (anyModalOpen() || touchVisible) return;
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 0) breakBlock();
  if (e.button === 2) placeBlock();
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  pointerBanner.classList.toggle("hidden", locked || touchVisible);
});

document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== canvas) return;
  playerState.yaw -= e.movementX * 0.0024;
  playerState.pitch = Math.max(
    -1.52,
    Math.min(1.52, playerState.pitch - e.movementY * 0.0024)
  );
});

const GAME_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"]);

window.addEventListener("keydown", (e) => {
  if (anyModalOpen()) {
    if (e.key === "Escape") closeAllModals();
    return;
  }
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const code = e.code;
  if (GAME_KEYS.has(code)) e.preventDefault();
  keys.add(code);

  if (code >= "Digit1" && code <= "Digit9" && code.length === 6) {
    selectSlot(Number(code.slice(5)) - 1);
  } else if (code >= "Numpad1" && code <= "Numpad9" && code.length === 7) {
    selectSlot(Number(code.slice(6)) - 1);
  } else if (code === "KeyQ") {
    selectSlot(selectedSlot - 1);
  } else if (code === "KeyE") {
    selectSlot(selectedSlot + 1);
  } else if (code === "KeyB") {
    e.preventDefault();
    openModal("modal-blocks");
  } else if (code === "KeyI") {
    e.preventDefault();
    openModal("modal-ai");
  } else if (code === "KeyT" || code === "Enter") {
    e.preventDefault();
    openModal("modal-chat");
  } else if (code === "KeyV") {
    document.getElementById("btn-cam").click();
  } else if (code === "KeyF" && !e.repeat) {
    toggleFly();
  } else if (code === "KeyJ") {
    breakBlock();
  } else if (code === "KeyK") {
    placeBlock();
  } else if (code === "Escape" && stereoMode) {
    exitStereo();
  }
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
});

// Losing focus (alt-tab, notification, modal) must never leave keys "stuck"
function releaseAllInputs() {
  keys.clear();
  touchState.jumpHeld = false;
  touchState.downHeld = false;
}
window.addEventListener("blur", releaseAllInputs);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") releaseAllInputs();
});

// Mobile Touch Events (Multi-touch tracked by identifier) — dual stick:
// left = floating move joystick, right = look stick (drag anywhere on the right half)
window.addEventListener(
  "touchstart",
  () => {
    soundFX.unlock();
    if (!touchVisible) {
      touchVisible = true;
      syncTouchVisibility();
    }
  },
  { once: true, passive: true }
);

const JOY_MAX_R = 42;
function updateJoyFromTouch(t) {
  const dx = t.clientX - touchState.joyOriginX;
  const dy = t.clientY - touchState.joyOriginY;
  const dist = Math.hypot(dx, dy);
  const clamped = dist > JOY_MAX_R ? JOY_MAX_R / dist : 1;
  const nx = dx * clamped;
  const ny = dy * clamped;
  joyKnob.style.transform = `translate(${nx}px, ${ny}px)`;
  // Small dead zone avoids drift when the thumb rests on the stick
  const mx = nx / JOY_MAX_R;
  const mz = ny / JOY_MAX_R;
  const mag = Math.hypot(mx, mz);
  touchState.moveX = mag < 0.12 ? 0 : mx;
  touchState.moveZ = mag < 0.12 ? 0 : mz;
}

joyZone.addEventListener(
  "touchstart",
  (e) => {
    if (anyModalOpen()) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    if (touchState.joyId === null) {
      touchState.joyId = t.identifier;
      const rect = document.getElementById("joy-base").getBoundingClientRect();
      touchState.joyOriginX = rect.left + rect.width / 2;
      touchState.joyOriginY = rect.top + rect.height / 2;
      joyZone.classList.add("engaged");
      updateJoyFromTouch(t);
    }
  },
  { passive: false }
);

joyZone.addEventListener(
  "touchmove",
  (e) => {
    if (touchState.joyId === null) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === touchState.joyId) updateJoyFromTouch(t);
    }
  },
  { passive: false }
);

const endJoy = (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === touchState.joyId) {
      touchState.joyId = null;
      touchState.moveX = 0;
      touchState.moveZ = 0;
      joyKnob.style.transform = "translate(0px, 0px)";
      joyZone.classList.remove("engaged");
    }
  }
};
joyZone.addEventListener("touchend", endJoy);
joyZone.addEventListener("touchcancel", endJoy);

const lookRing = document.getElementById("look-ring");
const lookDot = document.getElementById("look-dot");

lookZone.addEventListener(
  "touchstart",
  (e) => {
    if (anyModalOpen()) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    if (touchState.lookId === null) {
      touchState.lookId = t.identifier;
      touchState.lookLastX = t.clientX;
      touchState.lookLastY = t.clientY;
      touchState.lookStartX = t.clientX;
      touchState.lookStartY = t.clientY;
      const zr = lookZone.getBoundingClientRect();
      lookRing.style.left = `${t.clientX - zr.left}px`;
      lookRing.style.top = `${t.clientY - zr.top}px`;
      lookDot.style.transform = "translate(-50%, -50%)";
      lookRing.classList.remove("hidden");
    }
  },
  { passive: false }
);

lookZone.addEventListener(
  "touchmove",
  (e) => {
    if (touchState.lookId === null) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === touchState.lookId) {
        const dx = t.clientX - touchState.lookLastX;
        const dy = t.clientY - touchState.lookLastY;
        touchState.lookLastX = t.clientX;
        touchState.lookLastY = t.clientY;
        playerState.yaw -= dx * 0.0055;
        playerState.pitch = Math.max(-1.5, Math.min(1.5, playerState.pitch - dy * 0.005));
        const ox = t.clientX - touchState.lookStartX;
        const oy = t.clientY - touchState.lookStartY;
        const od = Math.hypot(ox, oy);
        const k = od > 34 ? 34 / od : 1;
        lookDot.style.transform = `translate(calc(-50% + ${ox * k}px), calc(-50% + ${oy * k}px))`;
      }
    }
  },
  { passive: false }
);

const endLook = (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === touchState.lookId) {
      touchState.lookId = null;
      lookRing.classList.add("hidden");
    }
  }
};
lookZone.addEventListener("touchend", endLook);
lookZone.addEventListener("touchcancel", endLook);

// Action buttons via Pointer Events (touch + mouse + pen), hold-to-repeat for break/place
function bindHoldButton(el, { onDown, onUp, repeatMs = 0 }) {
  let repeatTimer = null;
  let activePointer = null;
  const release = () => {
    if (activePointer === null) return;
    activePointer = null;
    clearInterval(repeatTimer);
    repeatTimer = null;
    el.classList.remove("pressed");
    onUp?.();
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    soundFX.unlock();
    if (anyModalOpen() || activePointer !== null) return;
    activePointer = e.pointerId;
    el.classList.add("pressed");
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    onDown();
    if (repeatMs > 0) repeatTimer = setInterval(onDown, repeatMs);
  });
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("lostpointercapture", release);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener("click", (e) => e.preventDefault());
}

bindHoldButton(document.getElementById("t-break"), { onDown: () => breakBlock(), repeatMs: 280 });
bindHoldButton(document.getElementById("t-place"), { onDown: () => placeBlock(), repeatMs: 320 });
bindHoldButton(document.getElementById("t-jump"), {
  onDown: () => {
    touchState.jumpHeld = true;
  },
  onUp: () => {
    touchState.jumpHeld = false;
  },
});
bindHoldButton(document.getElementById("t-down"), {
  onDown: () => {
    touchState.downHeld = true;
  },
  onUp: () => {
    touchState.downHeld = false;
  },
});
bindHoldButton(document.getElementById("t-fly"), { onDown: toggleFly });

// Physics & Collision
function collidesAt(px, py, pz) {
  const minX = Math.floor(px - PLAYER_RADIUS);
  const maxX = Math.floor(px + PLAYER_RADIUS);
  const minY = Math.floor(py + 0.02);
  const maxY = Math.floor(py + PLAYER_HEIGHT - 0.02);
  const minZ = Math.floor(pz - PLAYER_RADIUS);
  const maxZ = Math.floor(pz + PLAYER_RADIUS);

  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (!inBounds(x, y, z)) {
          if (x < 0 || x >= WORLD_SIZE_X || z < 0 || z >= WORLD_SIZE_Z || y < 0) return true;
          continue;
        }
        const id = worldData[blockIndex(x, y, z)];
        if (isSolidBlock(id)) return true;
      }
    }
  }
  return false;
}

function inWaterAt(px, py, pz) {
  const bx = Math.floor(px);
  const by = Math.floor(py + 0.4);
  const bz = Math.floor(pz);
  if (!inBounds(bx, by, bz)) return false;
  return worldData[blockIndex(bx, by, bz)] === BLOCK_IDS.WATER;
}

function stepPhysics(dt) {
  // Keyboard look fallback (no mouse required!)
  if (keys.has("ArrowLeft")) playerState.yaw += 2.1 * dt;
  if (keys.has("ArrowRight")) playerState.yaw -= 2.1 * dt;
  if (keys.has("ArrowUp")) playerState.pitch = Math.min(1.5, playerState.pitch + 1.6 * dt);
  if (keys.has("ArrowDown")) playerState.pitch = Math.max(-1.5, playerState.pitch - 1.6 * dt);

  let forward = 0;
  let strafe = 0;
  if (keys.has("KeyW")) forward += 1;
  if (keys.has("KeyS")) forward -= 1;
  if (keys.has("KeyD")) strafe += 1;
  if (keys.has("KeyA")) strafe -= 1;

  forward -= touchState.moveZ;
  strafe += touchState.moveX;

  // WebXR thumbsticks: left = move (relative to head), right X = snap turn,
  // right Y = fly up/down, right A/X button = jump
  let moveYaw = playerState.yaw;
  let xrJump = false;
  let xrVertical = 0;
  if (renderer.xr.isPresenting && activeXrSession?.inputSources) {
    renderer.xr.getCamera().getWorldDirection(tmpVecA);
    if (Math.hypot(tmpVecA.x, tmpVecA.z) > 0.05) {
      moveYaw = Math.atan2(-tmpVecA.x, -tmpVecA.z);
    }
    const sources = [...activeXrSession.inputSources];
    const hasHanded = sources.some((s) => s.handedness === "left" || s.handedness === "right");
    for (const src of sources) {
      const gp = src.gamepad;
      if (!gp || gp.axes.length < 4) continue;
      const ax = gp.axes[2];
      const ay = gp.axes[3];
      if (src.handedness === "right" && hasHanded) {
        if (Math.abs(ax) > 0.7 && !xrSnapLatched) {
          playerState.yaw -= Math.sign(ax) * (Math.PI / 6);
          xrSnapLatched = true;
        } else if (Math.abs(ax) < 0.3) {
          xrSnapLatched = false;
        }
        if (Math.abs(ay) > 0.35) xrVertical = -ay;
        if (gp.buttons[4]?.pressed) xrJump = true;
      } else {
        if (Math.abs(ax) > 0.15) strafe += ax;
        if (Math.abs(ay) > 0.15) forward -= ay;
        if (gp.buttons[4]?.pressed) xrJump = true;
      }
    }
  }

  const len = Math.hypot(forward, strafe);
  if (len > 1) {
    forward /= len;
    strafe /= len;
  }

  const sprint = keys.has("ShiftLeft") && !flyMode ? 1.45 : 1.0;
  const speed = (flyMode ? 9.5 : 5.4) * sprint;

  const sinY = Math.sin(moveYaw);
  const cosY = Math.cos(moveYaw);
  const vx = (-sinY * forward + cosY * strafe) * speed;
  const vz = (-cosY * forward - sinY * strafe) * speed;

  const jumpPressed = keys.has("Space") || touchState.jumpHeld || xrJump;
  const inWater = inWaterAt(playerState.x, playerState.y, playerState.z);

  if (flyMode) {
    let vy = 0;
    if (jumpPressed) vy += 6.5;
    if (keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("KeyC") || touchState.downHeld) {
      vy -= 6.5;
    }
    vy += xrVertical * 6.5;
    playerState.vy = vy;
  } else if (inWater) {
    playerState.vy = jumpPressed ? 3.8 : Math.max(-2.2, playerState.vy - 9.0 * dt);
  } else {
    playerState.vy -= 21.0 * dt;
    if (jumpPressed && playerState.onGround) {
      playerState.vy = 7.4;
      playerState.onGround = false;
    }
  }

  // Move X
  const nextX = playerState.x + vx * dt;
  if (!collidesAt(nextX, playerState.y, playerState.z)) {
    playerState.x = nextX;
  }

  // Move Z
  const nextZ = playerState.z + vz * dt;
  if (!collidesAt(playerState.x, playerState.y, nextZ)) {
    playerState.z = nextZ;
  }

  // Move Y
  const nextY = playerState.y + playerState.vy * dt;
  if (!collidesAt(playerState.x, nextY, playerState.z)) {
    playerState.y = nextY;
    playerState.onGround = false;
  } else {
    if (playerState.vy < 0) playerState.onGround = true;
    playerState.vy = 0;
  }

  if (playerState.y < -4) {
    const safe = getSpawnPoint(worldData);
    playerState.x = safe.x;
    playerState.y = safe.y;
    playerState.z = safe.z;
    playerState.vy = 0;
  }

  // Apply camera rig transform
  playerRig.position.set(playerState.x, playerState.y, playerState.z);

  if (renderer.xr.isPresenting) {
    // Keep rig yaw so thumbstick snap-turn works; the headset drives the camera pose
    yawPivot.rotation.y = playerState.yaw;
    camera.rotation.set(0, 0, 0);
    camera.position.set(0, 0, 0);
    selfAvatar.visible = false;
  } else if (thirdPerson) {
    yawPivot.rotation.y = playerState.yaw;
    camera.rotation.set(playerState.pitch, 0, 0);
    // Pull camera back safely without clipping through walls
    const backDir = new THREE.Vector3(
      Math.sin(playerState.yaw) * Math.cos(playerState.pitch),
      -Math.sin(playerState.pitch),
      Math.cos(playerState.yaw) * Math.cos(playerState.pitch)
    ).normalize();
    const eyeOrigin = new THREE.Vector3(
      playerState.x,
      playerState.y + EYE_HEIGHT,
      playerState.z
    );
    const camHit = raycastVoxels(worldData, eyeOrigin, backDir, 4.2);
    const backDist = camHit ? Math.max(0.8, camHit.distance - 0.35) : 4.2;
    camera.position.set(0, 0.25, backDist);

    selfAvatar.visible = true;
    selfAvatar.position.set(playerState.x, playerState.y, playerState.z);
    selfAvatar.rotation.y = playerState.yaw;
    selfAvatar.userData.headPivot.rotation.x = playerState.pitch * 0.6;
    const moving = Math.hypot(vx, vz) > 0.2;
    if (moving) {
      selfAvatar.userData.phase += dt * 9;
      const s = Math.sin(selfAvatar.userData.phase) * 0.55;
      selfAvatar.userData.legL.rotation.x = s;
      selfAvatar.userData.legR.rotation.x = -s;
      selfAvatar.userData.armL.rotation.x = -s * 0.8;
      selfAvatar.userData.armR.rotation.x = s * 0.8;
    } else {
      selfAvatar.userData.legL.rotation.x = 0;
      selfAvatar.userData.legR.rotation.x = 0;
      selfAvatar.userData.armL.rotation.x = 0;
      selfAvatar.userData.armR.rotation.x = 0;
    }
  } else {
    yawPivot.rotation.y = playerState.yaw;
    camera.rotation.set(playerState.pitch, 0, 0);
    camera.position.set(0, 0, 0);
    selfAvatar.visible = false;
  }
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function scaleNameTag(avatar, camPos) {
  const tag = avatar.userData.nameTag;
  if (!tag) return;
  // Keep nametags readable at distance without becoming huge up close
  const dist = avatar.position.distanceTo(camPos);
  const s = Math.max(1, Math.min(2.6, dist / 9));
  tag.scale.set(1.5 * s, 0.38 * s, 1);
  tag.position.y = 2.15 + (s - 1) * 0.18;
}

function updateRemoteAvatars(dt, now) {
  camera.getWorldPosition(tmpVecB);
  // Frame-rate independent exponential smoothing (~90 ms time constant)
  const k = 1 - Math.exp(-dt * 11);
  for (const rp of remotePlayers.values()) {
    const m = rp.mesh;
    m.position.x += (rp.targetX - m.position.x) * k;
    m.position.y += (rp.targetY - m.position.y) * k;
    m.position.z += (rp.targetZ - m.position.z) * k;
    rp.yaw += shortestAngle(rp.yaw, rp.targetYaw) * k;
    rp.pitch += (rp.targetPitch - rp.pitch) * k;
    m.rotation.y = rp.yaw;
    m.userData.headPivot.rotation.x = rp.pitch * 0.6;
    const isMoving = now - rp.lastMoved < 220;
    if (isMoving) {
      m.userData.phase += dt * 9;
      const s = Math.sin(m.userData.phase) * 0.55;
      m.userData.legL.rotation.x = s;
      m.userData.legR.rotation.x = -s;
      m.userData.armL.rotation.x = -s * 0.8;
      m.userData.armR.rotation.x = s * 0.8;
    } else {
      const damp = 1 - k;
      m.userData.legL.rotation.x *= damp;
      m.userData.legR.rotation.x *= damp;
      m.userData.armL.rotation.x *= damp;
      m.userData.armR.rotation.x *= damp;
    }
    scaleNameTag(m, tmpVecB);
  }

  if (aiAvatar.visible) {
    aiAvatar.rotation.y += dt * 1.6;
    scaleNameTag(aiAvatar, tmpVecB);
    if (now > aiAvatarHideAt) {
      aiAvatar.visible = false;
    }
  }
}

function updateTargetHighlight() {
  const { origin, dir } = getAimRay();
  const hit = raycastVoxels(worldData, origin, dir, 7.5);
  if (hit) {
    highlightMesh.visible = true;
    highlightMesh.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    targetBadge.textContent = `${getBlockDef(hit.block).name} (${hit.x},${hit.y},${hit.z})`;
    targetBadge.classList.remove("hidden");
  } else {
    highlightMesh.visible = false;
    targetBadge.classList.add("hidden");
  }
}

function syncPoseIfNeeded(now) {
  if (!initReceived || now - lastMoveSentAt < 80 || !isWsOpen()) return;
  let yaw = playerState.yaw;
  let pitch = playerState.pitch;
  if (renderer.xr.isPresenting) {
    // Broadcast where the headset is actually looking
    renderer.xr.getCamera().getWorldDirection(tmpVecA);
    yaw = Math.atan2(-tmpVecA.x, -tmpVecA.z);
    pitch = Math.asin(Math.max(-1, Math.min(1, tmpVecA.y)));
  }
  const pose = `${playerState.x.toFixed(2)},${playerState.y.toFixed(2)},${playerState.z.toFixed(
    2
  )},${yaw.toFixed(2)},${pitch.toFixed(2)},${hotbar[selectedSlot]},${Boolean(activeXrSession)}`;
  if (pose === lastSentPose) return;
  lastSentPose = pose;
  lastMoveSentAt = now;
  sendWs({
    type: "move",
    x: Number(playerState.x.toFixed(2)),
    y: Number(playerState.y.toFixed(2)),
    z: Number(playerState.z.toFixed(2)),
    yaw: Number(yaw.toFixed(3)),
    pitch: Number(pitch.toFixed(3)),
    held: hotbar[selectedSlot],
    vr: Boolean(activeXrSession),
  });
}

// Resize handler
function handleResize() {
  if (renderer.xr.isPresenting) return; // XR owns the framebuffer size
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (stereoMode) {
    stereoEffect.setSize(window.innerWidth, window.innerHeight);
  } else {
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
window.addEventListener("resize", handleResize);
window.visualViewport?.addEventListener("resize", handleResize);
window.addEventListener("orientationchange", () => setTimeout(handleResize, 250));
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) stereoFullscreen = false;
  setTimeout(handleResize, 60);
});

// Register PWA Service Worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// Bootstrap World + UI + Multiplayer + AnimationLoop
rebuildAllChunks();
renderHotbar();
syncTouchVisibility();
roomLabel.textContent = currentRoom;
updatePlayerBadge();
if (hasChosenIdentity) {
  connectSocket();
} else {
  openModal("modal-welcome");
}

let prevTime = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, Math.max(0.001, (now - prevTime) / 1000));
  prevTime = now;

  // Drift clouds gently
  cloudGroup.children.forEach((c, idx) => {
    c.position.x += dt * (0.4 + (idx % 3) * 0.15);
    if (c.position.x > 75) c.position.x = -12;
  });

  if (!anyModalOpen()) {
    stepPhysics(dt);
  }
  updateRemoteAvatars(dt, now);
  updateTargetHighlight();
  syncPoseIfNeeded(now);

  if (stereoMode && !renderer.xr.isPresenting) {
    stereoEffect.render(scene, camera);
  } else {
    renderer.render(scene, camera);
  }
});
