export const AVATAR_COLORS = [
  "#38bdf8",
  "#f472b6",
  "#4ade80",
  "#facc15",
  "#fb923c",
  "#a78bfa",
  "#2dd4bf",
  "#f87171",
];

export const AVATAR_STYLES = [
  { id: "classic", label: "Clásico", emoji: "🧑", skin: "#f1c29b", pants: "#1e3a8a", accessory: "none" },
  { id: "cap", label: "Gorra", emoji: "🧢", skin: "#e0a97b", pants: "#0f172a", accessory: "cap" },
  { id: "crown", label: "Corona", emoji: "👑", skin: "#f1c29b", pants: "#312e81", accessory: "crown" },
  { id: "visor", label: "Ciber", emoji: "🕶️", skin: "#d69e74", pants: "#111827", accessory: "visor" },
  { id: "hardhat", label: "Builder", emoji: "⛑️", skin: "#f5cba7", pants: "#3f3f46", accessory: "hardhat" },
  { id: "robot", label: "Bot", emoji: "🤖", skin: "#94a3b8", pants: "#1e293b", accessory: "antenna" },
];

const STYLE_MAP = new Map(AVATAR_STYLES.map((s) => [s.id, s]));

export function sanitizePlayerName(raw) {
  return String(raw ?? "")
    .replace(/[<>&"'`\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 20);
}

export function normalizeUid(raw) {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 48);
  return cleaned.length >= 4 ? cleaned : "";
}

export function normalizeAvatarColor(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : "";
}

export function isValidAvatarStyle(raw) {
  return typeof raw === "string" && STYLE_MAP.has(raw.trim().toLowerCase());
}

export function normalizeAvatarStyle(raw) {
  const id = String(raw ?? "").trim().toLowerCase();
  return STYLE_MAP.has(id) ? id : "classic";
}

export function findAvatarStyle(raw) {
  return STYLE_MAP.get(normalizeAvatarStyle(raw)) || AVATAR_STYLES[0];
}
