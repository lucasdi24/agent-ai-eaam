// En producción sin VITE_API_URL se usa el mismo origen (cuando front y API están en el mismo servidor)
const API_URL = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || (import.meta.env.PROD ? "" : "http://localhost:3001");
const SESSION_ID = "eaam-" + Math.random().toString(36).slice(2, 11);

const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const messagesEl = document.getElementById("messages");
const chatView = document.getElementById("chatView");
const statusView = document.getElementById("statusView");
const statusContent = document.getElementById("statusContent");
const navLinks = document.querySelectorAll(".nav-link[data-page]");

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function showPage(page) {
  chatView.style.display = page === "chat" ? "flex" : "none";
  chatView.setAttribute("aria-hidden", page !== "chat");
  statusView.style.display = page === "status" ? "block" : "none";
  statusView.setAttribute("aria-hidden", page !== "status");
  navLinks.forEach((a) => {
    const isActive = a.dataset.page === page;
    a.classList.toggle("active", isActive);
  });
  if (page === "status") loadStatus();
}

function loadStatus() {
  statusContent.textContent = "Cargando…";
  Promise.all([
    fetch(`${API_URL}/health`).then((r) => r.json()),
    fetch(`${API_URL}/knowledge/status`).then((r) => r.json()),
  ])
    .then(([health, knowledge]) => {
      statusContent.textContent = JSON.stringify({ health, knowledge }, null, 2);
    })
    .catch((e) => {
      statusContent.textContent = "Error: " + e.message + "\n\n¿Está el backend en marcha en " + API_URL + "?";
    });
}

document.getElementById("navLogo").addEventListener("click", (e) => {
  e.preventDefault();
  showPage("chat");
});

navLinks.forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const page = a.dataset.page;
    if (page === "admin") {
      window.open(API_URL + "/admin/", "_blank", "noopener");
      return;
    }
    showPage(page);
  });
});

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, content, isError = false, isSupport = false) {
  const div = document.createElement("div");
  div.className = `message ${role}${isError ? " error" : ""}${isSupport ? " support" : ""}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (isSupport) {
    const label = document.createElement("span");
    label.className = "msg-label";
    label.textContent = "Operador";
    bubble.appendChild(label);
  }
  const p = document.createElement("p");
  p.textContent = content;
  bubble.appendChild(p);
  div.appendChild(bubble);
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function addLoading() {
  const div = document.createElement("div");
  div.className = "message assistant loading";
  div.dataset.loading = "true";
  div.innerHTML = `
    <div class="bubble">
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function renderMarkdownLike(text) {
  const p = document.createElement("p");
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      fragment.appendChild(strong);
    } else {
      fragment.appendChild(document.createTextNode(part));
    }
  }
  p.appendChild(fragment);
  return p;
}

function setAssistantContent(bubble, text) {
  bubble.innerHTML = "";
  const lines = text.split(/\n\n+/);
  lines.forEach((line) => {
    const p = renderMarkdownLike(line);
    bubble.appendChild(p);
  });
}

/** Reemplaza el historial de mensajes (todo excepto el welcome) con la lista del servidor. Así se ven los mensajes del operador. */
function replaceHistory(messages) {
  const welcome = messagesEl.querySelector(".message.welcome");
  const toRemove = messagesEl.querySelectorAll(".message:not(.welcome)");
  toRemove.forEach((el) => el.remove());
  (messages || []).forEach((m) => {
    const isSupport = m.role === "assistant" && m.support;
    const div = addMessage(m.role, m.content, false, isSupport);
    if (m.role === "assistant" && !isSupport) {
      const bubble = div.querySelector(".bubble");
      if (bubble) {
        bubble.innerHTML = "";
        setAssistantContent(bubble, m.content);
      }
    }
  });
}

function fetchHistory() {
  return fetch(`${API_URL}/chat/history?sessionId=${encodeURIComponent(SESSION_ID)}`)
    .then((r) => r.json())
    .then((data) => data.messages || []);
}

let lastSentMessage = "";

async function sendChatMessage(raw, addUserBubble = true) {
  if (!raw || !raw.trim()) return;
  lastSentMessage = raw.trim();
  if (addUserBubble) {
    addMessage("user", raw);
    input.value = "";
    input.style.height = "auto";
  }
  const loadingEl = addLoading();
  sendBtn.disabled = true;

  try {
    const res = await fetch(`${API_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: lastSentMessage,
        sessionId: SESSION_ID,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data.detail || data.error || "Error de conexión";
      const isQuota = res.status === 429 || /quota|429|insufficient_quota/i.test(msg);
      throw new Error(isQuota ? "QUOTA" : msg);
    }

    loadingEl.remove();
    if (Array.isArray(data.messages)) replaceHistory(data.messages);
    else addMessage("assistant", data.reply);
  } catch (err) {
    loadingEl.remove();
    let text;
    if (err.message === "QUOTA") {
      text = "En este momento hay mucha demanda y no pude procesar tu mensaje. Esperá un minuto y probá de nuevo, o hacé clic en Reintentar.";
    } else if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
      text = "No se pudo conectar con el servidor. Comprobá que esté en marcha y tu conexión.";
    } else {
      text = err.message;
    }
    const errDiv = addMessage("assistant", text, true);
    if (err.message === "QUOTA" && lastSentMessage) {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "btn-retry";
      retryBtn.textContent = "Reintentar";
      retryBtn.addEventListener("click", () => {
        errDiv.remove();
        sendChatMessage(lastSentMessage, false);
      });
      const bubble = errDiv.querySelector(".bubble");
      if (bubble) bubble.appendChild(retryBtn);
    }
  } finally {
    sendBtn.disabled = false;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = input.value.trim();
  if (!raw) return;
  sendChatMessage(raw, true);
});

// Auto-resize textarea
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

// Sincronizar historial al cargar (p. ej. tras recargar) y cada 5 s para ver mensajes del operador
fetchHistory().then((messages) => {
  if (messages.length) replaceHistory(messages);
});
setInterval(() => {
  if (document.visibilityState !== "visible" || sendBtn.disabled) return;
  fetchHistory().then((messages) => {
    const current = messagesEl.querySelectorAll(".message:not(.welcome)").length;
    if (messages.length !== current) replaceHistory(messages);
  });
}, 5000);

scrollToBottom();
