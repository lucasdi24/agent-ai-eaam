# Desplegar el chatbot EAAM en la nube

El proyecto se puede desplegar como **una sola app**: el servidor Express sirve la API, el panel admin y el frontend (chat) después de hacer `npm run build`.

## Opción 1: Railway (recomendado)

1. **Cuenta:** Entrá en [railway.app](https://railway.app) y creá una cuenta (con GitHub).

2. **Nuevo proyecto:** "New Project" → "Deploy from GitHub repo". Conectá el repositorio de este proyecto.

3. **Variables de entorno:** En el proyecto, entrá a "Variables" y agregá:
   - `GEMINI_API_KEY` (o `OPENAI_API_KEY`) — obligatorio para el chat.
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` — para WhatsApp.
   - El agente usa solo programas y FAQ del panel admin (no hay RAG).
   - Opcional: `NODE_ENV=production`.

4. **Build y arranque:** Railway suele detectar Node. Si no:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Root Directory:** (dejalo vacío si el repo es la raíz del proyecto)

5. **Dominio:** En "Settings" → "Networking" → "Generate Domain". Te dan una URL tipo `https://tu-app.up.railway.app`.

6. **WhatsApp:** En Twilio, en el webhook del sandbox/número poné:
   `https://TU_URL_RAILWAY/webhook/whatsapp/twilio`

7. **Panel admin:** Entrá a `https://TU_URL_RAILWAY/admin` para ver conversaciones, leads y responder.

---

## Opción 2: Render

1. **Cuenta:** [render.com](https://render.com) → Sign up (GitHub).

2. **Nuevo Web Service:** "New" → "Web Service", conectá el repo.

3. **Configuración:**
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Plan:** Free (o paid si necesitás más recursos).

4. **Variables de entorno:** En "Environment" agregá las mismas que en Railway (`GEMINI_API_KEY`, Twilio, etc.).

5. **Dominio:** Render asigna una URL tipo `https://tu-app.onrender.com`.

6. **WhatsApp:** En Twilio poné `https://TU_URL_RENDER/webhook/whatsapp/twilio`.

---

## Datos y persistencia

- **Conversaciones y leads** se guardan en `server/data/` (archivos en el servidor).
- En Railway/Render el disco es **efímero**: al redeployar se puede perder esa carpeta. Para producción seria conviene después usar una base de datos o volúmenes persistentes si la plataforma lo ofrece.
- **Programas y FAQ** se leen de `server/data/programas.json` y `server/data/faq.json`. Subilos al repo o configuralos desde el panel admin una vez desplegado (si guardás esos JSON en el repo, sí persisten entre deploys).

---

## Resumen de URLs después del deploy

| Qué              | URL |
|------------------|-----|
| Chat (usuarios)  | `https://TU_DOMINIO/` |
| Panel admin      | `https://TU_DOMINIO/admin` |
| API health       | `https://TU_DOMINIO/health` |
| Webhook WhatsApp | `https://TU_DOMINIO/webhook/whatsapp/twilio` |

Si algo no anda, revisá los logs del servicio en Railway o Render; ahí aparecen errores de API keys o Twilio.
