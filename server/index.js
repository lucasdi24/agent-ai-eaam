import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import {
  getReply,
  hasLLM,
  getLLMProvider,
  resetSession,
  listConversations,
  getConversation,
  addSupportReply,
  setHandoff,
  setConversationCategory,
  setConversationState,
} from "./chat-service.js";
import { registerTwilioWebhook, isTwilioConfigured, sendWhatsAppMessage } from "./whatsapp/twilio.js";
import { getProgramas, saveProgramas, getFaq, saveFaq } from "./knowledge/curated-data.js";
import { getLeads } from "./leads.js";
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    agent: "EAAM",
    llm: getLLMProvider(),
    whatsapp: isTwilioConfigured() ? "twilio" : false,
    knowledge: "programas y FAQ (panel admin)",
  });
});

app.get("/config", (_, res) => {
  res.json({ chatUrl: FRONTEND_URL });
});

app.get("/knowledge/status", (_, res) => {
  res.json({ enabled: false, source: "programas y FAQ (panel admin)" });
});

app.get("/knowledge/index", (_, res) => {
  res.json({ files: [], totalChunks: 0, message: "El agente usa solo programas y FAQ cargados en /admin." });
});

app.get("/knowledge/programas", (_, res) => res.json(getProgramas()));
app.post("/knowledge/programas", (req, res) => {
  const body = req.body;
  const programas = Array.isArray(body) ? body : (body && Array.isArray(body.programas) ? body.programas : null);
  if (!programas) {
    return res.status(400).json({ ok: false, error: "Body debe ser un array de programas" });
  }
  saveProgramas(programas);
  res.json({ ok: true });
});

app.get("/knowledge/faq", (_, res) => res.json(getFaq()));
app.post("/knowledge/faq", (req, res) => {
  const body = req.body;
  const faq = Array.isArray(body) ? body : (body && Array.isArray(body.faq) ? body.faq : null);
  if (!faq) {
    return res.status(400).json({ ok: false, error: "Body debe ser un array de FAQ" });
  }
  saveFaq(faq);
  res.json({ ok: true });
});

app.post("/chat", async (req, res) => {
  const { message, sessionId = "default" } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Falta el campo 'message'" });
  }

  if (!hasLLM()) {
    return res.status(503).json({
      error: "Agente no configurado",
      detail: "Configura OPENAI_API_KEY o GEMINI_API_KEY en el archivo .env",
    });
  }

  const result = await getReply(sessionId, message);

  if (result.error) {
    let status = 502;
    if (result.error.includes("401")) status = 401;
    else if (/429|quota|insufficient_quota/i.test(result.error)) status = 429;
    return res.status(status).json({
      error: "Error al procesar la consulta",
      detail: result.error,
    });
  }

  const conv = getConversation(sessionId);
  const messages = conv ? conv.messages : [];
  res.json({ reply: result.reply, sessionId, messages });
});

app.post("/chat/reset", (req, res) => {
  const { sessionId = "default" } = req.body;
  resetSession(sessionId);
  res.json({ ok: true, sessionId });
});

app.get("/chat/history", (req, res) => {
  const sessionId = req.query.sessionId || "default";
  const conv = getConversation(sessionId);
  res.json({ messages: conv ? conv.messages : [] });
});

registerTwilioWebhook(app);

// Panel de supervisión: API bajo /api/admin para no chocar con express.static("/admin")
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.get("/api/admin/conversations", (_, res) => {
  res.json(listConversations());
});

app.get("/api/admin/leads", (_, res) => {
  try {
    const leads = getLeads();
    res.json(Array.isArray(leads) ? leads : []);
  } catch (err) {
    console.error("GET /api/admin/leads error:", err.message);
    res.json([]);
  }
});

app.get("/api/admin/conversations/:sessionId", (req, res) => {
  const conv = getConversation(req.params.sessionId);
  if (!conv) return res.status(404).json({ error: "Conversación no encontrada" });
  res.json(conv);
});

app.post("/api/admin/conversations/:sessionId/reply", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const message = req.body?.message ?? req.body?.text ?? "";
    const sendWa = isTwilioConfigured()
      ? (to, body) => sendWhatsAppMessage(to, body)
      : undefined;
    const result = await addSupportReply(sessionId, message, sendWa);
    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, content: result.content });
  } catch (err) {
    console.error("POST /api/admin/conversations/:sessionId/reply error:", err.message);
    res.status(500).json({ ok: false, error: err.message || "Error del servidor" });
  }
});

app.post("/api/admin/conversations/:sessionId/handoff", (req, res) => {
  try {
    const { sessionId } = req.params;
    const handoff = !!req.body?.handoff;
    const ok = setHandoff(sessionId, handoff);
    if (!ok) return res.status(404).json({ error: "Sesión no encontrada" });
    res.json({ ok: true, handoff });
  } catch (err) {
    console.error("POST /api/admin/conversations/:sessionId/handoff error:", err.message);
    res.status(500).json({ ok: false, error: err.message || "Error del servidor" });
  }
});

app.post("/api/admin/conversations/:sessionId/category", (req, res) => {
  try {
    const { sessionId } = req.params;
    const category = req.body?.category ?? "";
    const ok = setConversationCategory(sessionId, category);
    if (!ok) return res.status(404).json({ error: "Sesión no encontrada" });
    res.json({ ok: true, category: typeof category === "string" ? category.trim() : "" });
  } catch (err) {
    console.error("POST /api/admin/conversations/:sessionId/category error:", err.message);
    res.status(500).json({ ok: false, error: err.message || "Error del servidor" });
  }
});

app.post("/api/admin/conversations/:sessionId/state", (req, res) => {
  try {
    const { sessionId } = req.params;
    const state = req.body?.state ?? "Nuevo";
    const ok = setConversationState(sessionId, state);
    if (!ok) return res.status(404).json({ error: "Sesión no encontrada" });
    res.json({ ok: true, state: typeof state === "string" ? state.trim() : "Nuevo" });
  } catch (err) {
    console.error("POST /api/admin/conversations/:sessionId/state error:", err.message);
    res.status(500).json({ ok: false, error: err.message || "Error del servidor" });
  }
});

const adminDir = path.resolve(__dirname, "..", "admin");
const adminIndexPath = path.resolve(adminDir, "index.html");

// Panel admin: servir el mismo HTML en /admin y /admin/ (evita bucle de redirecciones)
app.get("/admin", (_, res) => {
  res.sendFile(adminIndexPath);
});
app.get("/admin/", (_, res) => {
  res.sendFile(adminIndexPath);
});
app.use("/admin", express.static(adminDir));

// En producción: servir el frontend (Vite build) desde la misma app
const distDir = path.resolve(__dirname, "..", "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.listen(PORT, async () => {
  console.log(`Agente EAAM escuchando en http://localhost:${PORT}`);
  const llm = getLLMProvider();
  if (!llm) console.warn("Ningún LLM configurado: definí OPENAI_API_KEY o GEMINI_API_KEY en .env");
  else console.log("LLM activo:", llm);
  if (isTwilioConfigured()) {
    console.log("WhatsApp Business (Twilio) activo. Webhook: POST /webhook/whatsapp/twilio");
    console.log("Prueba local (envío real): POST /webhook/whatsapp/twilio/test con JSON { from, body }");
  }
  const programas = getProgramas();
  const faq = getFaq();
  console.log("Programas y FAQ:", programas.length, "programas,", faq.length, "preguntas frecuentes (desde server/data/)");
});
