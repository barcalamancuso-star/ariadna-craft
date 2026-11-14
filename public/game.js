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
import { createAtlasCanvas, drawBlockPreview } from "./textures.js";
import { soundFX } from "./audio.js";

const EYE_HEIGHT = 1.56;
const PLAYER_RADIUS = 0.28;
const PLAYER_HEIGHT = 1.75;

const params = new URLSearchParams(window.location.search);
let currentRoom = (params.get("room") || localStorage.getItem("ac_room") || "principal")
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, "")
  .slice(0, 28) || "principal";
let playerName = (params.get("name") || localStorage.getItem("ac_name") || "Cris")
  .trim()
  .slice(0, 20) || "Cris";

// DOM Refs
const canvas = document.getElementById("scene");
const wsDot = document.getElementById("ws-dot");
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
let selfColor = "#38bdf8";
let reconnectTimer = null;
let reconnectAttempt = 0;
let lastMoveSentAt = 0;
let lastSentPose = "";
const remotePlayers = new Map();

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
  jumpHeld: false,
};

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
  ctx.fillText(String(label || "").slice(0, 16), 128, 32);

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.38, 1);
  sprite.position.set(0, 2.15, 0);
  return sprite;
}

function createAvatar(name, colorHex, isAi = false) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({
    color: colorHex || "#38bdf8",
    emissive: isAi ? new THREE.Color("#7c3aed") : new THREE.Color(0x000000),
    emissiveIntensity: isAi ? 0.5 : 0,
  });
  const skinMat = new THREE.MeshLambertMaterial({ color: isAi ? "#a5f3fc" : "#f1c29b" });
  const pantsMat = new THREE.MeshLambertMaterial({ color: isAi ? "#312e81" : "#1e3a8a" });

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
  headPivot.add(head, eyeL, eyeR);

  root.add(legL, legR, torso, armL, armR, headPivot);
  if (name) {
    root.add(makeNameSprite(name, colorHex));
  }

  root.userData = { legL, legR, armL, armR, headPivot, bodyMat, phase: 0 };
  return root;
}

const selfAvatar = createAvatar("", selfColor, false);
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

// Modal helpers
function anyModalOpen() {
  return Boolean(document.querySelector(".modal:not(.hidden)"));
}

function closeAllModals() {
  document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
}

function openModal(id) {
  closeAllModals();
  if (document.pointerLockElement === canvas) {
    document.exitPointerLock?.();
  }
  document.getElementById(id)?.classList.remove("hidden");
  if (id === "modal-blocks") renderBlocksCatalog();
  if (id === "modal-ai") document.getElementById("ai-input")?.focus();
  if (id === "modal-chat") document.getElementById("chat-input")?.focus();
  if (id === "modal-room") {
    document.getElementById("input-name").value = playerName;
    document.getElementById("input-room").value = currentRoom;
  }
}

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", closeAllModals);
});

// Touch UI toggle
function syncTouchVisibility() {
  touchUi.classList.toggle("hidden", !touchVisible);
  document.getElementById("t-fly").classList.toggle("active", flyMode);
  document.getElementById("btn-fly").classList.toggle("active", flyMode);
}

// Voxel Interaction (Break / Place)
function getAimRay() {
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3(0, 0, -1);
  if (renderer.xr.isPresenting) {
    const xrCam = renderer.xr.getCamera();
    xrCam.getWorldPosition(origin);
    dir.applyQuaternion(xrCam.getWorldQuaternion(new THREE.Quaternion()));
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

function breakBlock() {
  const { origin, dir } = getAimRay();
  const hit = raycastVoxels(worldData, origin, dir, 7.5);
  if (!hit) return;
  if (hit.y <= 0) {
    showToast("El suelo base es indestructible.");
    return;
  }
  applyBlockLocal(hit.x, hit.y, hit.z, BLOCK_IDS.AIR);
  soundFX.playBreak();
  sendWs({ type: "block", x: hit.x, y: hit.y, z: hit.z, t: BLOCK_IDS.AIR });
}

function placeBlock() {
  const { origin, dir } = getAimRay();
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
  sendWs({ type: "block", x: tx, y: ty, z: tz, t: blockId });
}

// Networking (WebSocket to Cloudflare Durable Object)
function sendWs(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function updateOnlineBadge() {
  onlineCountEl.textContent = String(1 + remotePlayers.size);
}

function clearRemotePlayers() {
  for (const rp of remotePlayers.values()) {
    scene.remove(rp.mesh);
  }
  remotePlayers.clear();
  updateOnlineBadge();
}

function upsertRemotePlayer(p) {
  if (!p || !p.id || p.id === selfId) return;
  let entry = remotePlayers.get(p.id);
  if (!entry) {
    const mesh = createAvatar(p.name, p.color, false);
    mesh.position.set(p.x, p.y, p.z);
    scene.add(mesh);
    entry = {
      mesh,
      targetX: p.x,
      targetY: p.y,
      targetZ: p.z,
      targetYaw: p.yaw || 0,
      targetPitch: p.pitch || 0,
      lastMoved: performance.now(),
    };
    remotePlayers.set(p.id, entry);
    updateOnlineBadge();
  } else {
    if (
      Math.hypot(p.x - entry.targetX, p.z - entry.targetZ) > 0.02
    ) {
      entry.lastMoved = performance.now();
    }
    entry.targetX = p.x;
    entry.targetY = p.y;
    entry.targetZ = p.z;
    entry.targetYaw = p.yaw || 0;
    entry.targetPitch = p.pitch || 0;
  }
}

function connectSocket() {
  clearTimeout(reconnectTimer);
  if (ws) {
    try {
      ws.onclose = null;
      ws.close();
    } catch {}
  }

  roomLabel.textContent = currentRoom;
  wsDot.classList.remove("online");

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${location.host}/ws?room=${encodeURIComponent(
    currentRoom
  )}&name=${encodeURIComponent(playerName)}`;

  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    reconnectAttempt = 0;
    wsDot.classList.add("online");
    showToast(`Conectado a sala "${currentRoom}"`, 1800);
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "init") {
      selfId = msg.selfId;
      selfColor = msg.selfColor || "#38bdf8";
      selfAvatar.userData.bodyMat.color.set(selfColor);

      if (msg.seed && msg.seed !== worldSeed) {
        worldSeed = msg.seed;
        worldData = generateBaseWorld(worldSeed);
      } else {
        worldData = generateBaseWorld(worldSeed);
      }

      if (Array.isArray(msg.edits)) {
        for (const e of msg.edits) {
          applyBlockLocal(e.x, e.y, e.z, e.t, false);
        }
      }
      rebuildAllChunks();

      const safe = getSpawnPoint(worldData);
      playerState.x = safe.x;
      playerState.y = safe.y;
      playerState.z = safe.z;
      playerState.vx = 0;
      playerState.vy = 0;
      playerState.vz = 0;

      clearRemotePlayers();
      if (Array.isArray(msg.players)) {
        msg.players.forEach((p) => upsertRemotePlayer(p));
      }

      feedEl.innerHTML = "";
      if (Array.isArray(msg.chat)) {
        msg.chat.slice(-4).forEach((c) => addFeed(c.sender, c.text, c.kind));
      }
      updateOnlineBadge();
      return;
    }

    if (msg.type === "player_join") {
      upsertRemotePlayer(msg.player);
      addFeed("Sala", `${msg.player?.name || "Alguien"} entró al mundo`, "system");
      return;
    }

    if (msg.type === "player_move") {
      upsertRemotePlayer(msg.player);
      return;
    }

    if (msg.type === "player_leave") {
      const rp = remotePlayers.get(msg.id);
      if (rp) {
        scene.remove(rp.mesh);
        remotePlayers.delete(msg.id);
        updateOnlineBadge();
      }
      return;
    }

    if (msg.type === "block") {
      if (msg.by !== selfId) {
        applyBlockLocal(msg.x, msg.y, msg.z, msg.t, true);
      }
      return;
    }

    if (msg.type === "ai_build") {
      const dirty = new Set();
      if (Array.isArray(msg.blocks)) {
        for (const b of msg.blocks) {
          if (applyBlockLocal(b.x, b.y, b.z, b.t, false)) {
            markChunksAround(b.x, b.z, dirty);
          }
        }
      }
      for (const k of dirty) {
        const [cx, cz] = k.split(",").map(Number);
        rebuildChunk(cx, cz);
      }
      if (msg.anchor) {
        aiAvatar.position.set(msg.anchor.x + 0.5, msg.anchor.y + 1, msg.anchor.z + 0.5);
        aiAvatar.visible = true;
        aiAvatarHideAt = performance.now() + 14000;
      }
      if (msg.chat) {
        addFeed(msg.chat.sender, msg.chat.text, "ai");
      }
      soundFX.playAiBuild();
      return;
    }

    if (msg.type === "chat") {
      addFeed(msg.sender, msg.text, msg.kind || "chat");
      return;
    }

    if (msg.type === "world_reset") {
      worldSeed = msg.seed || 2026;
      worldData = generateBaseWorld(worldSeed);
      rebuildAllChunks();
      const safe = getSpawnPoint(worldData);
      playerState.x = safe.x;
      playerState.y = safe.y;
      playerState.z = safe.z;
      playerState.vy = 0;
      if (msg.chat) addFeed(msg.chat.sender, msg.chat.text, "system");
      showToast("Mundo regenerado!");
    }
  });

  ws.addEventListener("close", () => {
    wsDot.classList.remove("online");
    reconnectAttempt += 1;
    const waitMs = Math.min(5000, 900 * reconnectAttempt);
    reconnectTimer = setTimeout(connectSocket, waitMs);
  });

  ws.addEventListener("error", () => {
    wsDot.classList.remove("online");
  });
}

setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendWs({ type: "ping", t: Date.now() });
  }
}, 24000);

// AI Architect Action
async function invokeAiArchitect(promptText) {
  const statusEl = document.getElementById("ai-status");
  const submitBtn = document.getElementById("ai-submit");
  const provider = document.getElementById("ai-provider").value;

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
      x: Math.max(4, Math.min(WORLD_SIZE_X - 5, fx)),
      y: Math.max(1, Math.round(playerState.y)),
      z: Math.max(4, Math.min(WORLD_SIZE_Z - 5, fz)),
    };
  }

  statusEl.textContent = "Consultando red Multi-IA y construyendo...";
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: currentRoom,
        prompt: promptText,
        anchor,
        playerName,
        provider,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      statusEl.textContent = data.error || "Error al conectar con la IA.";
      return;
    }
    statusEl.textContent = `[${data.provider}/${data.model}] ${data.reply} (${data.blocksCount} bloques)`;
    showToast(`✨ ${data.reply}`, 3200);
    if (data.blocksCount > 0) {
      setTimeout(closeAllModals, 700);
    }
  } catch {
    statusEl.textContent = "Sin conexión con el servidor IA.";
  } finally {
    submitBtn.disabled = false;
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

document.getElementById("btn-cam").addEventListener("click", () => {
  thirdPerson = !thirdPerson;
  selfAvatar.visible = thirdPerson;
  document.getElementById("btn-cam").textContent = thirdPerson ? "👁️ 3ª" : "👁️ 1ª";
  showToast(thirdPerson ? "Cámara 3ª Persona" : "Cámara 1ª Persona", 1400);
});

const toggleFly = () => {
  flyMode = !flyMode;
  playerState.vy = 0;
  syncTouchVisibility();
  showToast(flyMode ? "Modo Vuelo activado" : "Gravedad normal", 1400);
};
document.getElementById("btn-fly").addEventListener("click", toggleFly);
document.getElementById("t-fly").addEventListener("click", toggleFly);

document.getElementById("btn-audio").addEventListener("click", (e) => {
  soundFX.muted = !soundFX.muted;
  e.currentTarget.textContent = soundFX.muted ? "🔇" : "🔊";
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
  sendWs({ type: "reset_world" });
  closeAllModals();
});

document.getElementById("room-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const nextName = document.getElementById("input-name").value.trim().slice(0, 20) || "Cris";
  const nextRoom =
    document
      .getElementById("input-room")
      .value.trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 28) || "principal";
  playerName = nextName;
  currentRoom = nextRoom;
  localStorage.setItem("ac_name", playerName);
  localStorage.setItem("ac_room", currentRoom);
  const nextUrl = new URL(location.href);
  nextUrl.searchParams.set("room", currentRoom);
  history.replaceState(null, "", nextUrl.toString());
  closeAllModals();
  connectSocket();
});

document.getElementById("ai-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const val = document.getElementById("ai-input").value.trim();
  if (!val) return;
  document.getElementById("ai-input").value = "";
  invokeAiArchitect(val);
});

document.querySelectorAll("[data-ai-prompt]").forEach((chip) => {
  chip.addEventListener("click", () => {
    invokeAiArchitect(chip.getAttribute("data-ai-prompt"));
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
  } else {
    sendWs({ type: "chat", text });
  }
});

// WebXR + Stereo VR Mode
let activeXrSession = null;
const vrBtn = document.getElementById("btn-vr");

async function toggleVrMode() {
  if (activeXrSession) {
    await activeXrSession.end();
    return;
  }

  if (navigator.xr && typeof navigator.xr.isSessionSupported === "function") {
    try {
      const supported = await navigator.xr.isSessionSupported("immersive-vr");
      if (supported) {
        const session = await navigator.xr.requestSession("immersive-vr", {
          optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
        });
        activeXrSession = session;
        stereoMode = false;
        vrBtn.classList.add("active");
        session.addEventListener("end", () => {
          activeXrSession = null;
          vrBtn.classList.remove("active");
          camera.position.set(0, 0, 0);
        });
        await renderer.xr.setSession(session);
        showToast("Sesión WebXR activa");
        return;
      }
    } catch {
      // Fallback below
    }
  }

  // Cardboard Stereo 3D Fallback for mobile browsers without WebXR runtime
  stereoMode = !stereoMode;
  vrBtn.classList.toggle("active", stereoMode);
  if (!stereoMode) {
    renderer.setScissorTest(false);
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    showToast("Modo Estéreo VR desactivado");
  } else {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {}
    stereoEffect.setSize(window.innerWidth, window.innerHeight);
    showToast("Modo Estéreo 3D (Cardboard) activo");
  }
}

vrBtn.addEventListener("click", toggleVrMode);

// WebXR Controllers
const controller0 = renderer.xr.getController(0);
const controller1 = renderer.xr.getController(1);
const rayLineGeom = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, -5),
]);
controller0.add(new THREE.Line(rayLineGeom, new THREE.LineBasicMaterial({ color: 0x38bdf8 })));
controller1.add(new THREE.Line(rayLineGeom, new THREE.LineBasicMaterial({ color: 0xf87171 })));
controller0.addEventListener("selectstart", () => placeBlock());
controller1.addEventListener("selectstart", () => breakBlock());
playerRig.add(controller0, controller1);

// Desktop Pointer Lock + Keyboard Controls (NO scroll wheel needed!)
canvas.addEventListener("click", () => {
  soundFX.unlock();
  if (!anyModalOpen() && !touchVisible && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
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

window.addEventListener("keydown", (e) => {
  if (anyModalOpen()) {
    if (e.key === "Escape") closeAllModals();
    return;
  }

  const code = e.code;
  keys.add(code);

  if (code >= "Digit1" && code <= "Digit9") {
    selectSlot(Number(code.slice(5)) - 1);
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
  } else if (code === "KeyF") {
    toggleFly();
  } else if (code === "KeyJ") {
    breakBlock();
  } else if (code === "KeyK") {
    placeBlock();
  }
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
});

// Mobile Touch Events (Multi-touch tracked by identifier)
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
      if (t.identifier === touchState.joyId) {
        const dx = t.clientX - touchState.joyOriginX;
        const dy = t.clientY - touchState.joyOriginY;
        const maxR = 42;
        const dist = Math.hypot(dx, dy);
        const clamped = dist > maxR ? maxR / dist : 1;
        const nx = dx * clamped;
        const ny = dy * clamped;
        joyKnob.style.transform = `translate(${nx}px, ${ny}px)`;
        touchState.moveX = nx / maxR;
        touchState.moveZ = ny / maxR;
      }
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
    }
  }
};
joyZone.addEventListener("touchend", endJoy);
joyZone.addEventListener("touchcancel", endJoy);

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
      }
    }
  },
  { passive: false }
);

const endLook = (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === touchState.lookId) {
      touchState.lookId = null;
    }
  }
};
lookZone.addEventListener("touchend", endLook);
lookZone.addEventListener("touchcancel", endLook);

document.getElementById("t-break").addEventListener("click", (e) => {
  e.preventDefault();
  breakBlock();
});
document.getElementById("t-place").addEventListener("click", (e) => {
  e.preventDefault();
  placeBlock();
});
const jumpBtn = document.getElementById("t-jump");
jumpBtn.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    touchState.jumpHeld = true;
  },
  { passive: false }
);
jumpBtn.addEventListener("touchend", () => {
  touchState.jumpHeld = false;
});
jumpBtn.addEventListener("touchcancel", () => {
  touchState.jumpHeld = false;
});
jumpBtn.addEventListener("mousedown", () => {
  touchState.jumpHeld = true;
});
jumpBtn.addEventListener("mouseup", () => {
  touchState.jumpHeld = false;
});

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

  // WebXR thumbstick locomotion
  if (renderer.xr.isPresenting && activeXrSession?.inputSources) {
    for (const src of activeXrSession.inputSources) {
      const gp = src.gamepad;
      if (gp && gp.axes.length >= 4) {
        if (Math.abs(gp.axes[2]) > 0.15) strafe += gp.axes[2];
        if (Math.abs(gp.axes[3]) > 0.15) forward -= gp.axes[3];
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

  const sinY = Math.sin(playerState.yaw);
  const cosY = Math.cos(playerState.yaw);
  const vx = (-sinY * forward + cosY * strafe) * speed;
  const vz = (-cosY * forward - sinY * strafe) * speed;

  const jumpPressed = keys.has("Space") || touchState.jumpHeld;
  const inWater = inWaterAt(playerState.x, playerState.y, playerState.z);

  if (flyMode) {
    let vy = 0;
    if (jumpPressed) vy += 6.5;
    if (keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("KeyC")) vy -= 6.5;
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
    yawPivot.rotation.y = 0;
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

function updateRemoteAvatars(dt, now) {
  for (const rp of remotePlayers.values()) {
    const k = Math.min(1, dt * 12);
    rp.mesh.position.x += (rp.targetX - rp.mesh.position.x) * k;
    rp.mesh.position.y += (rp.targetY - rp.mesh.position.y) * k;
    rp.mesh.position.z += (rp.targetZ - rp.mesh.position.z) * k;
    rp.mesh.rotation.y = rp.targetYaw;
    rp.mesh.userData.headPivot.rotation.x = rp.targetPitch * 0.6;
    const isMoving = now - rp.lastMoved < 180;
    if (isMoving) {
      rp.mesh.userData.phase += dt * 9;
      const s = Math.sin(rp.mesh.userData.phase) * 0.55;
      rp.mesh.userData.legL.rotation.x = s;
      rp.mesh.userData.legR.rotation.x = -s;
      rp.mesh.userData.armL.rotation.x = -s * 0.8;
      rp.mesh.userData.armR.rotation.x = s * 0.8;
    } else {
      rp.mesh.userData.legL.rotation.x = 0;
      rp.mesh.userData.legR.rotation.x = 0;
      rp.mesh.userData.armL.rotation.x = 0;
      rp.mesh.userData.armR.rotation.x = 0;
    }
  }

  if (aiAvatar.visible) {
    aiAvatar.rotation.y += dt * 1.6;
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
  if (now - lastMoveSentAt < 80) return;
  const pose = `${playerState.x.toFixed(2)},${playerState.y.toFixed(2)},${playerState.z.toFixed(
    2
  )},${playerState.yaw.toFixed(2)},${playerState.pitch.toFixed(2)},${hotbar[selectedSlot]}`;
  if (pose === lastSentPose) return;
  lastSentPose = pose;
  lastMoveSentAt = now;
  sendWs({
    type: "move",
    x: Number(playerState.x.toFixed(2)),
    y: Number(playerState.y.toFixed(2)),
    z: Number(playerState.z.toFixed(2)),
    yaw: Number(playerState.yaw.toFixed(3)),
    pitch: Number(playerState.pitch.toFixed(3)),
    held: hotbar[selectedSlot],
    vr: Boolean(activeXrSession),
  });
}

// Resize handler
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (stereoMode) {
    stereoEffect.setSize(window.innerWidth, window.innerHeight);
  } else {
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
});

// Register PWA Service Worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// Bootstrap World + UI + Multiplayer + AnimationLoop
rebuildAllChunks();
renderHotbar();
syncTouchVisibility();
connectSocket();

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
