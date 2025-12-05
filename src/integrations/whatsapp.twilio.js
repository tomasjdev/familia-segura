// src/integrations/whatsapp.twilio.js
const twilio = require("twilio");
const { prisma } = require("../db/client");

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function normalizeE164(s) {
  if (!s) return null;
  s = String(s).trim();
  // si viene como whatsapp:+56..., lo limpiamos
  if (s.startsWith("whatsapp:")) s = s.replace(/^whatsapp:/, "");
  // aceptamos solo formato +56...
  return s.startsWith("+") ? s : null;
}

async function sendText(toE164, body) {
  const from = process.env.TWILIO_WHATSAPP_FROM; // "whatsapp:+14155238886"
  if (!from) throw new Error("Falta TWILIO_WHATSAPP_FROM");
  return client.messages.create({
    from,
    to: `whatsapp:${toE164}`,
    body,
  });
}

/**
 * Webhook entrante de Twilio (sandbox):
 * Por ahora SOLO logueamos y dejamos la puerta abierta
 * para, en el futuro, amarrar esto a emergencyContact si quieres.
 */
async function handleIncoming(req, res) {
  try {
    const from = normalizeE164(req.body?.From);
    const body = String(req.body?.Body || "").trim();
    console.log("[WA inbound] From:", from, "Body:", body);
    // Aquí podríamos, a futuro, registrar opt-in por número.
    return res.status(200).send("OK");
  } catch (e) {
    console.error("[WA inbound] error:", e);
    return res.status(200).send("OK");
  }
}

/**
 * Obtiene destinatarios de WhatsApp para un paciente:
 *
 * Prioridad:
 *  1) Si viene `to` explícito → solo ese (uso dev).
 *  2) (Opcional futuro) Tabla emergencyContact.phoneE164.
 *  3) Contactos del paciente (tabla `contact.telefono`).
 *  4) Fallback .env: SOS_CONTACTS / MY_WHATSAPP.
 */
async function getPatientWaRecipients(patientId, to) {
  // 1) Override para pruebas: ?to=+569...
  if (to) return [normalizeE164(to)].filter(Boolean);

  let list = [];

  // 2) (Futuro) Si usas emergencyContact, lo consultamos aquí.
  //    Lo dejamos envuelto en try/catch por si el modelo no existe.
  try {
    const emergency = await prisma.emergencyContact.findMany({
      where: { patientId },
      select: { phoneE164: true },
    });

    list = emergency
      .map((c) => normalizeE164(c.phoneE164))
      .filter(Boolean);
  } catch (e) {
    // Si no existe la tabla / modelo, simplemente seguimos.
    // console.warn("[WA] emergencyContact no disponible:", e?.message);
  }

  // 3) Si no hay emergencyContact, intentamos con los contactos normales del paciente
  if (!list.length) {
    try {
      const contacts = await prisma.contact.findMany({
        where: { patientId },
        select: { telefono: true },
        orderBy: { prioridad: "asc" }, // si el campo prioridad existe en tu modelo
      });

      list = contacts
        .map((c) => normalizeE164(c.telefono))
        .filter(Boolean);
    } catch (e) {
      console.error("[WA] Error leyendo contactos de paciente:", e?.message);
    }
  }

  // Si encontramos al menos un número del paciente → usamos SOLO esos
  if (list.length) return list;

  // 4) Fallback de desarrollo: variables de entorno
  const csv = (process.env.SOS_CONTACTS || "")
    .split(",")
    .map((x) => normalizeE164(x.trim()))
    .filter(Boolean);
  if (csv.length) return csv;

  const legacy = normalizeE164(process.env.MY_WHATSAPP);
  return legacy ? [legacy] : [];
}

module.exports = { handleIncoming, sendText, getPatientWaRecipients };
