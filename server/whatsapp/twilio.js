/**
 * Webhook y envío de mensajes WhatsApp Business vía Twilio
 * Documentación: https://www.twilio.com/docs/whatsapp
 */
import twilio from "twilio";
import { getReply, hasLLM } from "../chat-service.js";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM; // ej: whatsapp:+14155238886 (sandbox) o tu número aprobado

const client =
  accountSid && authToken
    ? twilio(accountSid, authToken)
    : null;

const MAX_MESSAGE_LENGTH = 1599; // WhatsApp ~1600; dejar margen

function truncateForWhatsApp(text) {
  if (!text || text.length <= MAX_MESSAGE_LENGTH) return text;
  return text.slice(0, MAX_MESSAGE_LENGTH - 20) + "\n\n[...] Consulta la web para más información.";
}

/**
 * Envía un mensaje de texto por WhatsApp usando Twilio
 */
export async function sendWhatsAppMessage(to, body) {
  if (!client || !whatsappFrom) {
    throw new Error("Twilio no configurado (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM)");
  }
  const normalizedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const normalizedFrom = whatsappFrom.startsWith("whatsapp:") ? whatsappFrom : `whatsapp:${whatsappFrom}`;

  const finalBody = truncateForWhatsApp(body ?? "");
  if (!finalBody || !String(finalBody).trim()) {
    throw new Error("El cuerpo del mensaje no puede estar vacío");
  }

  try {
    const message = await client.messages.create({
      body: finalBody,
      from: normalizedFrom,
      to: normalizedTo,
    });
    return message;
  } catch (err) {
    console.error("[WhatsApp] Twilio API error:", err.code || err.status, err.message);
    if (err.moreInfo) console.error("[WhatsApp] Más info:", err.moreInfo);
    throw err;
  }
}

/**
 * Procesa un mensaje entrante y envía la respuesta por WhatsApp.
 */
async function processIncomingMessage(from, body) {
  const sessionId = `wa-${from}`;
  if (!hasLLM()) {
    await sendWhatsAppMessage(
      from,
      "El asistente EAAM no está configurado en este momento. Podés escribirnos por email info@eaam.com.ar o a Secretaría 011 5120-6883."
    );
    console.log("[WhatsApp] Respuesta enviada (sin LLM) a", from);
    return;
  }
  const result = await getReply(sessionId, body);
  if (result.error) {
    console.error("[WhatsApp] Error del chat al procesar mensaje:", result.error);
    await sendWhatsAppMessage(
      from,
      "Lo siento, hubo un error al procesar tu mensaje. Escribinos por email info@eaam.com.ar o a Secretaría 011 5120-6883."
    );
    console.log("[WhatsApp] Respuesta de error enviada a", from);
  } else {
    const replyText = result.reply && String(result.reply).trim() ? result.reply : "No pude generar una respuesta. Escribinos por email info@eaam.com.ar o a Secretaría 011 5120-6883.";
    const msg = await sendWhatsAppMessage(from, replyText);
    console.log("[WhatsApp] Respuesta enviada a", from, "| SID:", msg?.sid || "—");
  }
}

/**
 * Registra las rutas del webhook Twilio en la app Express
 * Twilio envía application/x-www-form-urlencoded
 */
export function registerTwilioWebhook(app) {
  if (!client || !whatsappFrom) {
    console.warn("WhatsApp (Twilio): faltan TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN o TWILIO_WHATSAPP_FROM. Webhook desactivado.");
    return;
  }

  // Twilio envía application/x-www-form-urlencoded con From, Body (mayúsculas)
  app.post("/webhook/whatsapp/twilio", (req, res) => {
    const from = req.body?.From ?? req.body?.from;
    const body = (req.body?.Body ?? req.body?.body ?? "").trim();

    if (!from) {
      console.warn("[WhatsApp] Webhook recibido sin From");
      return res.status(400).send("Missing From");
    }

    if (!body) {
      return res.status(200).send("OK");
    }

    console.log("[WhatsApp] Mensaje entrante de", from, ":", body.slice(0, 80) + (body.length > 80 ? "..." : ""));

    res.status(200).send("OK");

    (async () => {
      try {
        await processIncomingMessage(from, body);
      } catch (err) {
        console.error("WhatsApp webhook error:", err.message || err);
        try {
          await sendWhatsAppMessage(
            from,
            "No pude responder ahora. Probá más tarde o escribinos por email info@eaam.com.ar o a Secretaría 011 5120-6883."
          );
          console.log("[WhatsApp] Respuesta de fallback enviada a", from);
        } catch (sendErr) {
          console.error("[WhatsApp] No se pudo enviar ni el fallback:", sendErr.message || sendErr);
        }
      }
    })();
  });

  // Prueba local: POST JSON { "from": "whatsapp:+54...", "body": "hola" } para ver si llega la respuesta al WhatsApp
  app.post("/webhook/whatsapp/twilio/test", async (req, res) => {
    const from = req.body?.from;
    const body = (req.body?.body ?? "").trim();
    if (!from || !body) {
      return res.status(400).json({
        error: "Faltan 'from' y 'body'. Ejemplo: { \"from\": \"whatsapp:+5491112345678\", \"body\": \"hola\" }",
      });
    }
    const normalizedFrom = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
    console.log("[WhatsApp] Prueba manual de", normalizedFrom, ":", body);
    try {
      await processIncomingMessage(normalizedFrom, body);
      res.json({ ok: true, message: "Procesado. Revisá WhatsApp y la consola del servidor." });
    } catch (err) {
      console.error("[WhatsApp] Error en prueba:", err.message || err);
      res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  });
}

export function isTwilioConfigured() {
  return !!(accountSid && authToken && whatsappFrom);
}
