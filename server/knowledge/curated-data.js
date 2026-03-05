/**
 * Datos curados: programas (productos) y preguntas frecuentes.
 * Se guardan en JSON y se inyectan en el prompt del agente como fuente prioritaria.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const PROGRAMAS_FILE = path.resolve(DATA_DIR, "programas.json");
const FAQ_FILE = path.resolve(DATA_DIR, "faq.json");

const DEFAULT_PROGRAMAS = [
  { id: "1", name: "Guía de Montaña", description: "", price: "", duration: "", startDate: "", notes: "" },
  { id: "2", name: "Guía de Trekking y Turismo Aventura", description: "", price: "", duration: "", startDate: "", notes: "" },
  { id: "3", name: "Montañismo y Trekking (Presencial)", description: "", price: "", duration: "", startDate: "", notes: "" },
  { id: "4", name: "Montañismo y Trekking (Semipresencial)", description: "", price: "", duration: "", startDate: "", notes: "" },
  { id: "5", name: "Postítulo Actividades y Deportes en la Naturaleza", description: "", price: "", duration: "", startDate: "", notes: "" },
];

const DEFAULT_FAQ = [
  { question: "¿Cuándo empiezan las inscripciones?", answer: "" },
  { question: "¿Cuál es el precio del curso?", answer: "" },
];

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    }
  } catch (_) {}
  return defaultValue;
}

function writeJson(filePath, data) {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function getProgramas() {
  const data = readJson(PROGRAMAS_FILE, DEFAULT_PROGRAMAS);
  return Array.isArray(data) ? data : DEFAULT_PROGRAMAS;
}

export function saveProgramas(programas) {
  if (!Array.isArray(programas)) return false;
  writeJson(PROGRAMAS_FILE, programas);
  return true;
}

export function getFaq() {
  return readJson(FAQ_FILE, DEFAULT_FAQ);
}

export function saveFaq(faq) {
  if (!Array.isArray(faq)) return false;
  writeJson(FAQ_FILE, faq);
  return true;
}

/**
 * Texto para inyectar en el system prompt (programas + FAQ).
 * El agente usa esto como fuente prioritaria.
 */
export function getCuratedForPrompt() {
  try {
    const programas = getProgramas();
    const faq = getFaq();
    const progList = Array.isArray(programas) ? programas : [];
    const faqList = Array.isArray(faq) ? faq : [];

  let out = "";

  if (progList.some((p) => (p.description || p.price || p.notes || "").trim())) {
    out += "\n\n## Programas / productos (datos actualizados)\n\n";
    progList.forEach((p) => {
      const parts = [];
      if (p.name) parts.push(`**${p.name}**`);
      if (p.description) parts.push(p.description);
      if (p.price) parts.push(`Precio: ${p.price}`);
      if (p.duration) parts.push(`Duración: ${p.duration}`);
      if (p.startDate) parts.push(`Inicio: ${p.startDate}`);
      if (p.notes) parts.push(p.notes);
      if (parts.length) out += parts.join("\n") + "\n\n";
    });
  }

  if (faqList.some((f) => (f.question || f.answer || "").trim())) {
    out += "\n## Preguntas frecuentes y respuesta recomendada\n\n";
    faqList.forEach((f) => {
      if (f.question || f.answer) {
        out += `P: ${f.question || "(sin pregunta)"}\nR: ${f.answer || "(sin respuesta)"}`;
        if (f.notes && String(f.notes).trim()) out += `\nNota: ${String(f.notes).trim()}`;
        out += "\n\n";
      }
    });
  }

  return out.trim();
  } catch (err) {
    console.warn("getCuratedForPrompt error:", err.message);
    return "";
  }
}
