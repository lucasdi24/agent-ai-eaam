# Agente AI – EAAM Escuela de Montaña

Asistente virtual para la **EAAM** (Escuela Andaluza de Alta Montaña) de la **FADMES**. Para **subir la app a la nube** (Railway, Render), seguí **[DEPLOY.md](DEPLOY.md)**. (Federación Andaluza de Deportes de Montaña, Escalada y Senderismo). Responde sobre formación, cursos, inscripciones y recursos de montaña en Andalucía.

## Requisitos

- **Node.js** 18+
- **Clave de API de OpenAI** ([obtener aquí](https://platform.openai.com/api-keys))
- Para **WhatsApp Business**: cuenta en [Twilio](https://www.twilio.com) (sandbox gratis para pruebas)

## Instalación

```bash
npm install
```

Copia el archivo de ejemplo de variables de entorno:

```bash
copy .env.example .env
```

Edita `.env` y define al menos:

```
OPENAI_API_KEY=sk-tu-clave-aqui
PORT=3001
```

Para activar WhatsApp Business (Twilio), añade también:

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

## Uso

**Opción 1 – Todo en uno (backend + frontend):**

```bash
npm run dev
```

- Backend: http://localhost:3001  
- Frontend: http://localhost:5173  

**Opción 2 – Por separado:**

Terminal 1 (servidor):

```bash
npm run dev:server
```

Terminal 2 (interfaz):

```bash
npm run dev:client
```

Abre el navegador en http://localhost:5173 y escribe en el chat. El agente usa la base de conocimiento de la EAAM para responder.

## Información del agente (programas y FAQ)

El agente usa **solo** los **programas** y las **preguntas frecuentes** que cargás desde el **panel admin** (`/admin`). No se usa RAG ni la carpeta de documentos: toda la información se edita en el panel y se guarda en `server/data/programas.json` y `server/data/faq.json`.

## WhatsApp Business (Twilio)

El agente puede atender conversaciones por **WhatsApp** usando la API de Twilio.

### 1. Configuración en Twilio

1. Entra en [Twilio Console](https://console.twilio.com) y crea una cuenta (o usa la existente).
2. Ve a **Messaging** → **Try it out** → **Send a WhatsApp message** y activa el **Sandbox para WhatsApp** (o configura tu número WhatsApp Business aprobado).
3. Anota:
   - **Account SID** y **Auth Token** (en la página principal de la consola).
   - El **número del sandbox** (ej. `+1 415 523 8886`) que será `TWILIO_WHATSAPP_FROM`.

### 2. Variables de entorno

En tu `.env`:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=tu_auth_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

(En producción, usa tu número WhatsApp Business en lugar del sandbox.)

### 3. Webhook público

Twilio debe poder llamar a tu servidor con un **URL público**. En local:

- Usa [ngrok](https://ngrok.com): `ngrok http 3001`
- Copia la URL HTTPS que te da (ej. `https://abc123.ngrok.io`).

En Twilio:

1. **Messaging** → **Settings** → **WhatsApp Sandbox** (o tu número).
2. En **WHEN A MESSAGE COMES IN** pon: `https://TU_URL_PUBLICA/webhook/whatsapp/twilio`.
3. Método: **POST**. Guarda.

### 4. Código de unión al sandbox (solo pruebas)

Para que alguien pueda chatear con el bot en el **sandbox** de Twilio, primero debe unirse enviando este mensaje al número de WhatsApp del sandbox:

| Número (WhatsApp) | Mensaje para unirse |
|-------------------|---------------------|
| **+1 415 523 8886** | `join cattle-there` |

Después de enviar `join cattle-there`, ya pueden escribir cualquier consulta y el agente EAAM responderá.

### 5. Probar

Envía un mensaje de WhatsApp al número del sandbox (o a tu número Business). El agente responderá con la misma lógica que el chat web (cursos EAAM, formación, contacto, etc.).

- **Endpoint del webhook:** `POST /webhook/whatsapp/twilio`
- Cada usuario mantiene su propia conversación (sesión por número de teléfono).

### Si la respuesta del bot no llega por WhatsApp

1. **Probar envío sin ngrok:** Hacé un POST a `http://localhost:3001/webhook/whatsapp/twilio/test` con JSON:
   ```json
   { "from": "whatsapp:+54911TU_NUMERO", "body": "hola" }
   ```
   (reemplazá por tu número con código de país). Si en el celular llega el mensaje, Twilio y el servidor están bien; el problema es que Twilio no puede llamar a tu PC (necesitás ngrok con esa URL en el webhook). Si no llega, revisá la consola del servidor: verás el error de la API de Twilio (credenciales, formato de número, etc.).

2. **Webhook público:** En desarrollo, Twilio solo puede llamar a una URL pública. Usá `ngrok http 3001` y en Twilio poné `https://TU_URL_NGROK/webhook/whatsapp/twilio`.

3. **Sandbox:** El usuario debe haber enviado antes `join cattle-there` (o el código que muestre tu sandbox) al número de WhatsApp de Twilio.

## Estructura del proyecto

```
chatbot-eaam-agente-ai/
├── server/
│   ├── index.js                 # API Express + rutas
│   ├── chat-service.js          # Lógica de chat (API y WhatsApp)
│   ├── knowledge/
│   │   ├── eaam-system-prompt.js  # Personalidad y datos fijos
│   │   └── curated-data.js        # Programas y FAQ (también editables en /admin)
│   └── whatsapp/
│       └── twilio.js            # Webhook y envío WhatsApp (Twilio)
├── src/
│   ├── main.js
│   └── main.css
├── index.html
├── package.json
├── .env.example
└── README.md
```

## API del agente

- **GET** `/health` – Estado del servicio, OpenAI y WhatsApp (Twilio).
- **POST** `/chat` – Enviar mensaje y recibir respuesta.
  - Body: `{ "message": "texto", "sessionId": "opcional" }`
  - Respuesta: `{ "reply": "texto", "sessionId": "..." }`
- **POST** `/chat/reset` – Borrar historial de una sesión.
  - Body: `{ "sessionId": "opcional" }`
- **GET** `/knowledge/status` – Estado (el agente usa solo programas y FAQ del admin).

## Personalizar el agente

El comportamiento y la información del agente se definen en:

**`server/knowledge/eaam-system-prompt.js`** – Tono y rol del agente.

**Panel admin (`/admin`)** – Programas y FAQ; se guardan en `server/data/`. Es la única fuente de datos del agente.

## Contacto EAAM / FADMES

- **Web EAAM:** https://eaam.com.ar/  
- **Federación (FADMES):** https://fadmes.es | Formación: https://fadmes.es/formacion/  
- **Cursos EAAM:** cursos.eaam@fadmes.es  
- **Teléfono:** 958 29 13 40 (ext. 2030)
