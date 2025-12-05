// src/integrations/whatsapp.meta.js

// Usamos 'fetch' nativo de Node (Node 18+). No importa node-fetch.

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;      // token temporal o permanente
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;    // ej: 814319138428665
const DEFAULT_CC = process.env.WHATSAPP_DEFAULT_CC || "56"; // Código país por defecto (ej: Chile = 56)

if (!WHATSAPP_TOKEN) {
  console.warn("[WhatsApp] Falta WHATSAPP_TOKEN en .env");
}
if (!PHONE_NUMBER_ID) {
  console.warn("[WhatsApp] Falta PHONE_NUMBER_ID en .env");
}

const baseUrl = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

// ---------- Normalizador de teléfonos ----------
function normalizePhone(raw) {
  let r = (raw || "").toString().trim();

  if (!r) return r;

  // si ya viene con +
  if (r.startsWith("+")) {
    return "+" + r.slice(1).replace(/\D/g, "");
  }

  // elimina todo lo que no sea dígito
  r = r.replace(/\D/g, "");

  // si venía con 00<cc>... => +<cc>...
  if (r.startsWith("00")) return "+" + r.slice(2);

  // si es corto (8–10 dígitos), prepende CC por defecto
  if (DEFAULT_CC && r.length <= 10) {
    return `+${DEFAULT_CC}${r}`;
  }

  // si ya trae cc (ej 569xxxxxxxx)
  return `+${r}`;
}

// ---------- POST genérico a WhatsApp ----------
async function postToWhatsapp(payload) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!res.ok) {
    console.error("WhatsApp API error:", JSON.stringify(json, null, 2));
    throw new Error(json?.error?.message || "Error al llamar a WhatsApp API");
  }
  return json;
}

// ---------- Enviar texto simple ----------
async function sendText(arg1, body) {
  let to, textBody;
  if (typeof arg1 === "object" && arg1 !== null) {
    to = arg1.to;
    textBody = arg1.body;
  } else {
    to = arg1;
    textBody = body;
  }
  if (!to || !textBody) throw new Error("sendText: faltan 'to' o 'body'");

  const toNorm = normalizePhone(to);
  const payload = {
    messaging_product: "whatsapp",
    to: toNorm,
    type: "text",
    text: { body: textBody },
  };
  return postToWhatsapp(payload);
}

// ---------- Enviar plantilla ----------
async function sendTemplate(to, name, language = "en_US", components = []) {
  if (!to || !name) throw new Error("sendTemplate: faltan 'to' o 'name'");
  const toNorm = normalizePhone(to);
  const payload = {
    messaging_product: "whatsapp",
    to: toNorm,
    type: "template",
    template: {
      name,
      language: { code: language },
      ...(components.length ? { components } : {}),
    },
  };
  return postToWhatsapp(payload);
}

// ---------- Marcar mensaje como leído ----------
async function markAsRead(messageId) {
  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  };
  return postToWhatsapp(payload);
}

// ---------- Texto SOS ----------
function buildSosText({ patientName, lat, lng }) {
  let text = `🚨 SOS de ${patientName || "Paciente"}.`;
  if (lat && lng) {
    text += `\n📍 Ubicación: https://www.google.com/maps?q=${lat},${lng}`;
  }
  return text;
}

module.exports = {
  sendText,
  sendTemplate,
  markAsRead,
  buildSosText,
};
