/**
 * CRM interno: leads extraídos de las conversaciones.
 * Se guardan en server/data/leads.json (nombre, email, teléfono, capacitación de interés).
 * El historial completo sigue en server/data/conversations/.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADS_FILE = path.join(__dirname, "data", "leads.json");

function ensureDir() {
  const dir = path.dirname(LEADS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readLeads() {
  try {
    ensureDir();
    if (!fs.existsSync(LEADS_FILE)) return [];
    const raw = fs.readFileSync(LEADS_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function writeLeads(leads) {
  ensureDir();
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf-8");
}

/**
 * Extrae nombre, email y teléfono del historial de mensajes (solo de mensajes del usuario).
 */
function extractLeadFromHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return {};
  const userText = history
    .filter((m) => m.role === "user" && m.content)
    .map((m) => m.content)
    .join("\n");

  const out = { name: "", email: "", phone: "", capacitacionInteres: "" };

  // Email: patrón común
  const emailMatch = userText.match(/[\w.+%-]+@[\w.-]+\.\w{2,}/i);
  if (emailMatch) out.email = emailMatch[0].trim();

  // Teléfono: Argentina (con 0, 15, +54, etc.)
  const phoneMatch = userText.match(
    /(?:\+54\s*)?(?:0?\s*)?(?:11|15|2\d{2})\s*-?\s*\d{4}\s*-?\s*\d{4}|(?:\+54\s*)?9?\s*11\s*\d{4}\s*-?\s*\d{4}|\d{4}\s*-?\s*\d{4}/g
  );
  if (phoneMatch && phoneMatch.length > 0) {
    out.phone = phoneMatch[0].replace(/\s+/g, " ").trim();
  }

  // Nombre: "me llamo X", "soy X", "mi nombre es X"
  const namePatterns = [
    /(?:me\s+llamo|soy|mi\s+nombre\s+es|me\s+dicen)\s+([^\n.,;]+)/i,
    /llamo\s+([A-ZÁÉÍÓÚÑa-záéíóúñ\s]{2,40})(?:\s|$|[,.\n])/i,
  ];
  for (const re of namePatterns) {
    const m = userText.match(re);
    if (m && m[1]) {
      const name = m[1].trim();
      if (name.length >= 2 && name.length <= 60) {
        out.name = name;
        break;
      }
    }
  }

  // Capacitación de interés: palabras clave (el usuario puede decir "la tecnicatura de montaña", "curso de trekking", etc.)
  const capKeywords = [
    "guía de montaña",
    "guía de trekking",
    "tecnicatura",
    "montañismo",
    "trekking",
    "postítulo",
    "curso integral",
    "adn",
  ];
  const lower = userText.toLowerCase();
  for (const kw of capKeywords) {
    if (lower.includes(kw)) {
      out.capacitacionInteres = kw;
      break;
    }
  }

  return out;
}

/**
 * Lista todos los leads (para el panel admin).
 */
export function getLeads() {
  return readLeads();
}

/**
 * Crea o actualiza un lead por sessionId. fields puede incluir name, email, phone, capacitacionInteres, channel, lastMessageAt, messageCount.
 */
export function addOrUpdateLead(sessionId, fields = {}) {
  const leads = readLeads();
  const existing = leads.findIndex((l) => l.sessionId === sessionId);
  const now = new Date().toISOString();
  const base = existing >= 0 ? leads[existing] : { sessionId, createdAt: now };
  const updated = {
    ...base,
    ...fields,
    sessionId,
    updatedAt: now,
  };
  if (existing >= 0) {
    leads[existing] = updated;
  } else {
    leads.push(updated);
  }
  writeLeads(leads);
  return updated;
}

/**
 * Extrae datos del historial y actualiza el lead para esa sesión.
 * Siempre actualiza lastMessageAt y messageCount; nombre/email/teléfono solo se actualizan si se detectan (no se pisan con vacío).
 */
export function updateLeadFromConversation(sessionId, session) {
  const history = session?.history || [];
  const extracted = extractLeadFromHistory(history);
  const channel = session?.channel || (sessionId.startsWith("wa-") ? "wa" : "web");
  const fields = {
    channel,
    lastMessageAt: session?.lastMessageAt,
    messageCount: history.length,
  };
  if (extracted.name) fields.name = extracted.name;
  if (extracted.email) fields.email = extracted.email;
  if (extracted.phone) fields.phone = extracted.phone;
  if (extracted.capacitacionInteres) fields.capacitacionInteres = extracted.capacitacionInteres;
  return addOrUpdateLead(sessionId, fields);
}

export { extractLeadFromHistory };
