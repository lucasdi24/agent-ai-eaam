/**
 * Servicio de chat reutilizable para API REST y WhatsApp
 * Soporta OpenAI o Google Gemini. Contexto solo desde programas y FAQ del panel admin.
 */
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { getEAAMSystemPrompt } from "./knowledge/eaam-system-prompt.js";
import { getCuratedForPrompt } from "./knowledge/curated-data.js";
import * as store from "./conversation-store.js";
import { updateLeadFromConversation } from "./leads.js";

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const LLM_PROVIDER = process.env.LLM_PROVIDER || ""; // "openai" | "gemini" o vacío = auto
const openai = OPENAI_KEY ? new OpenAI({ apiKey: OPENAI_KEY }) : null;
const gemini = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

const sessions = new Map();

function channelFromSessionId(sessionId) {
  return typeof sessionId === "string" && sessionId.startsWith("wa-") ? "wa" : "web";
}

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    const loaded = store.loadSession(sessionId);
    if (loaded) {
      const { sessionId: _id, ...data } = loaded;
      sessions.set(loaded.sessionId, data);
    } else {
      const now = new Date().toISOString();
      const session = {
        history: [],
        createdAt: now,
        lastMessageAt: now,
        channel: channelFromSessionId(sessionId),
        handoff: false,
        category: "",
        state: "Nuevo",
      };
      sessions.set(sessionId, session);
      store.saveSession(sessionId, session);
    }
  }
  return sessions.get(sessionId);
}

function getOrCreateHistory(sessionId) {
  return getOrCreateSession(sessionId).history;
}

function buildSystemMessage(extraContext, channel = "web") {
  let content = getEAAMSystemPrompt(channel);
  const curated = getCuratedForPrompt();
  if (curated) content += "\n\n" + curated;
  if (extraContext && extraContext.trim()) {
    content += "\n\n## Información cargada desde documentos (usa esto para responder con datos reales):\n\n" + extraContext.trim();
  }
  return { role: "system", content };
}

function getProvider() {
  if (LLM_PROVIDER === "gemini" && GEMINI_KEY) return "gemini";
  if (LLM_PROVIDER === "openai" && OPENAI_KEY) return "openai";
  if (GEMINI_KEY) return "gemini";
  if (OPENAI_KEY) return "openai";
  return null;
}

export function hasOpenAI() {
  return !!OPENAI_KEY;
}

export function hasGemini() {
  return !!GEMINI_KEY;
}

/** true si hay al menos un proveedor de chat configurado */
export function hasLLM() {
  return getProvider() !== null;
}

/** "openai" | "gemini" | null */
export function getLLMProvider() {
  return getProvider();
}

async function getReplyWithOpenAI(history, userContent, systemMessage) {
  const messages = [systemMessage, ...history];
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 4096,
    temperature: 0.7,
  });
  return completion.choices[0]?.message?.content ?? "No pude generar una respuesta.";
}

async function getReplyWithGemini(history, userContent, systemMessage) {
  const systemText = systemMessage.content;
  const contents = [];
  for (const msg of history) {
    const role = msg.role === "user" ? "user" : "model";
    contents.push({ role, parts: [{ text: msg.content }] });
  }

  const response = await gemini.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction: { parts: [{ text: systemText }] },
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  });

  const text = typeof response?.text === "function" ? response.text() : response?.text;
  return (text && String(text).trim()) ? String(text).trim() : "No pude generar una respuesta.";
}

const MAX_RETRIES_429 = 3;
const RETRY_DELAY_MS = 18000; // 18 s entre reintentos (Gemini suele limitar por minuto)

/** Máximo de mensajes recientes que se envían al modelo (evita superar contexto). El historial completo se sigue guardando. */
const MAX_HISTORY_MESSAGES = 50;

function is429OrQuota(err) {
  const msg = (err && err.message) || String(err);
  return /429|quota|RESOURCE_EXHAUSTED|rate limit|too many requests/i.test(msg);
}

async function getReplyWithRetry(provider, history, userContent, systemMessage) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES_429; attempt++) {
    try {
      if (provider === "gemini") {
        return await getReplyWithGemini(history, userContent, systemMessage);
      }
      return await getReplyWithOpenAI(history, userContent, systemMessage);
    } catch (err) {
      lastErr = err;
      if (is429OrQuota(err) && attempt < MAX_RETRIES_429) {
        console.warn(`[Chat] 429/cuota (intento ${attempt}/${MAX_RETRIES_429}), esperando ${RETRY_DELAY_MS / 1000}s…`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

/**
 * Obtiene la respuesta del agente para un mensaje.
 * Si la sesión está en handoff (operador tomó control), no llama al LLM y devuelve mensaje fijo.
 * @param {string} sessionId - Identificador de sesión
 * @param {string} message - Mensaje del usuario
 * @returns {Promise<{ reply: string, handoff?: boolean } | { error: string }>}
 */
export async function getReply(sessionId, message) {
  const session = getOrCreateSession(sessionId);
  const history = session.history;
  const userContent = message.trim();
  session.lastMessageAt = new Date().toISOString();
  history.push({ role: "user", content: userContent });

  if (session.handoff) {
    store.saveSession(sessionId, session);
    try {
      updateLeadFromConversation(sessionId, session);
    } catch (_) {}
    return {
      reply: "Un operador te atenderá pronto. Gracias por tu paciencia.",
      handoff: true,
    };
  }

  const provider = getProvider();
  if (!provider) {
    return { error: "Ningún proveedor configurado. Definí OPENAI_API_KEY o GEMINI_API_KEY en .env" };
  }

  try {
    const systemMessage = buildSystemMessage("", session.channel);
    const recentHistory = history.length > MAX_HISTORY_MESSAGES ? history.slice(-MAX_HISTORY_MESSAGES) : history;

    const reply = await getReplyWithRetry(provider, recentHistory, userContent, systemMessage);

    history.push({ role: "assistant", content: reply });
    store.saveSession(sessionId, session);
    try {
      updateLeadFromConversation(sessionId, session);
    } catch (leadErr) {
      console.warn("Leads update:", leadErr.message);
    }
    return { reply };
  } catch (err) {
    history.pop();
    console.error("Chat service error:", err.message);
    return {
      error: err.message || "Error al procesar la consulta",
    };
  }
}

export function resetSession(sessionId) {
  sessions.delete(sessionId);
  store.deleteSession(sessionId);
}

/**
 * Lista conversaciones para el panel de supervisión (ordenadas por última actividad).
 * @returns {{ sessionId: string, channel: string, createdAt: string, lastMessageAt: string, preview: string, messageCount: number, handoff: boolean }[]}
 */
export function listConversations() {
  return store.listSessions();
}

/**
 * Devuelve una conversación por id (mensajes + metadatos).
 */
export function getConversation(sessionId) {
  if (!sessions.has(sessionId)) {
    const loaded = store.loadSession(sessionId);
    if (loaded) {
      const { sessionId: id, ...data } = loaded;
      sessions.set(id, data);
    }
  }
  const session = sessions.get(sessionId);
  if (!session) return null;
  const messages = session.history.map((m) => ({
    role: m.role,
    content: m.content,
    support: !!m.support,
  }));
  return {
    sessionId,
    channel: session.channel,
    createdAt: session.createdAt,
    lastMessageAt: session.lastMessageAt,
    handoff: !!session.handoff,
    category: session.category ?? "",
    state: session.state ?? "Nuevo",
    messages,
  };
}

/**
 * Añade una respuesta escrita por soporte (operador) y opcionalmente la envía por WhatsApp.
 * @param {string} sessionId
 * @param {string} text
 * @param {(to: string, body: string) => Promise<void>} [sendViaWhatsApp] - Si existe y canal es wa, se llama para enviar al usuario
 */
export async function addSupportReply(sessionId, text, sendViaWhatsApp) {
  if (!sessions.has(sessionId)) {
    const loaded = store.loadSession(sessionId);
    if (loaded) {
      const { sessionId: id, ...data } = loaded;
      sessions.set(id, data);
    }
  }
  const session = sessions.get(sessionId);
  if (!session) return { error: "Sesión no encontrada" };
  const content = (text || "").trim();
  if (!content) return { error: "Mensaje vacío" };
  session.history.push({ role: "assistant", content, support: true });
  session.lastMessageAt = new Date().toISOString();
  store.saveSession(sessionId, session);
  if (session.channel === "wa" && sendViaWhatsApp) {
    const to = sessionId.startsWith("wa-") ? sessionId.slice(3) : sessionId;
    sendViaWhatsApp(to, content).catch((err) =>
      console.error("[WhatsApp] Error enviando mensaje de soporte:", err.message)
    );
  }
  return { ok: true, content };
}

/**
 * Activa o desactiva el “control humano” (handoff). Cuando está activo, el bot no responde y se muestra mensaje de espera.
 */
export function setHandoff(sessionId, value) {
  if (!sessions.has(sessionId)) {
    const loaded = store.loadSession(sessionId);
    if (loaded) {
      const { sessionId: id, ...data } = loaded;
      sessions.set(id, data);
    }
  }
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.handoff = !!value;
  store.saveSession(sessionId, session);
  return true;
}

/**
 * Asigna una categoría a una conversación (para organizar en el panel admin).
 * Guarda directo en disco para no depender de la caché en memoria.
 */
export function setConversationCategory(sessionId, category) {
  const value = typeof category === "string" ? category.trim() : "";
  const ok = store.updateSessionMeta(sessionId, { category: value });
  if (ok && sessions.has(sessionId)) {
    sessions.get(sessionId).category = value;
  }
  return ok;
}

/** Estados válidos para una conversación (para el panel admin). */
export const CONVERSATION_STATES = [
  "Nuevo",
  "Requiere operador",
  "En curso",
  "Contestado",
  "Pendiente",
  "Cerrado",
];

/**
 * Asigna un estado a una conversación (Requiere operador, Contestado, Cerrado, etc.).
 * Guarda directo en disco para no depender de la caché en memoria.
 */
export function setConversationState(sessionId, state) {
  const value = typeof state === "string" && state.trim() ? state.trim() : "Nuevo";
  const ok = store.updateSessionMeta(sessionId, { state: value });
  if (ok && sessions.has(sessionId)) {
    sessions.get(sessionId).state = value;
  }
  return ok;
}
