/**
 * Persistencia de conversaciones en archivos JSON.
 * Cada sesión se guarda en server/data/conversations/ (nombre = hash del sessionId).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data", "conversations");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function sessionIdToFilename(sessionId) {
  const hash = crypto.createHash("sha256").update(String(sessionId)).digest("hex");
  return `${hash}.json`;
}

function sessionToStorable(session) {
  return {
    sessionId: null,
    channel: session.channel,
    createdAt: session.createdAt,
    lastMessageAt: session.lastMessageAt,
    handoff: !!session.handoff,
    category: session.category ?? "",
    state: session.state ?? "Nuevo",
    history: (session.history || []).map((m) => ({
      role: m.role,
      content: m.content,
      support: !!m.support,
    })),
  };
}

function storableToSession(storable, sessionId) {
  return {
    history: (storable.history || []).map((m) => ({
      role: m.role,
      content: m.content,
      support: !!m.support,
    })),
    channel: storable.channel || (sessionId.startsWith("wa-") ? "wa" : "web"),
    createdAt: storable.createdAt || new Date().toISOString(),
    lastMessageAt: storable.lastMessageAt || storable.createdAt || new Date().toISOString(),
    handoff: !!storable.handoff,
    category: storable.category ?? "",
    state: storable.state ?? "Nuevo",
  };
}

/**
 * Carga una sesión desde disco. Retorna null si no existe.
 */
export function loadSession(sessionId) {
  ensureDir();
  const filePath = path.join(DATA_DIR, sessionIdToFilename(sessionId));
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const storable = JSON.parse(raw);
    const id = storable.sessionId || sessionId;
    return { sessionId: id, ...storableToSession(storable, id) };
  } catch (err) {
    console.warn("[conversation-store] Error al leer", sessionId, err.message);
    return null;
  }
}

/**
 * Guarda la sesión en disco. sessionData = { history, channel, createdAt, lastMessageAt, handoff }.
 */
export function saveSession(sessionId, sessionData) {
  ensureDir();
  const filePath = path.join(DATA_DIR, sessionIdToFilename(sessionId));
  const storable = sessionToStorable(sessionData);
  storable.sessionId = sessionId;
  try {
    fs.writeFileSync(filePath, JSON.stringify(storable, null, 0), "utf-8");
  } catch (err) {
    console.warn("[conversation-store] Error al guardar", sessionId, err.message);
  }
}

/**
 * Actualiza solo category y/o state de una sesión (lee del disco, aplica cambios, guarda).
 * Así el guardado no depende de la caché en memoria.
 */
export function updateSessionMeta(sessionId, updates) {
  ensureDir();
  const filePath = path.join(DATA_DIR, sessionIdToFilename(sessionId));
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const storable = JSON.parse(raw);
    if (typeof updates.category !== "undefined") storable.category = typeof updates.category === "string" ? updates.category.trim() : "";
    if (typeof updates.state !== "undefined") storable.state = typeof updates.state === "string" && String(updates.state).trim() ? String(updates.state).trim() : "Nuevo";
    storable.sessionId = storable.sessionId || sessionId;
    fs.writeFileSync(filePath, JSON.stringify(storable, null, 0), "utf-8");
    return true;
  } catch (err) {
    console.warn("[conversation-store] Error al actualizar meta", sessionId, err.message);
    return false;
  }
}

/**
 * Elimina la sesión del disco (para reset).
 */
export function deleteSession(sessionId) {
  const filePath = path.join(DATA_DIR, sessionIdToFilename(sessionId));
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn("[conversation-store] Error al borrar", sessionId, err.message);
  }
}

/**
 * Lista todas las conversaciones guardadas (para el panel admin). Ordenadas por lastMessageAt.
 */
export function listSessions() {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  const list = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, file), "utf-8");
      const storable = JSON.parse(raw);
      const sessionId = storable.sessionId || file.replace(".json", "");
      const history = storable.history || [];
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      list.push({
        sessionId,
        channel: storable.channel || (sessionId.startsWith("wa-") ? "wa" : "web"),
        createdAt: storable.createdAt || "",
        lastMessageAt: storable.lastMessageAt || storable.createdAt || "",
        preview: lastUser ? (lastUser.content || "").slice(0, 80) : "",
        messageCount: history.length,
        handoff: !!storable.handoff,
        category: storable.category ?? "",
        state: storable.state ?? "Nuevo",
      });
    } catch (_) {}
  }
  list.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  return list;
}
