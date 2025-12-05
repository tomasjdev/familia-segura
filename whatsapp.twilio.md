// src/integrations/whatsapp.twilio.js
const twilio = require("twilio");
const { prisma } = require("../db/client");

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function normalizeE164(s) {
  if (!s) return null;
  s = String(s).trim();
  if (s.startsWith("whatsapp:")) s = s.replace(/^whatsapp:/, "");
  return s.startsWith("+") ? s : null;
}

async function sendText(toE164, body) {
  const from = process.env.TWILIO_WHATSAPP_FROM; // "whatsapp:+14155238886"
  if (!from) throw new Error("Falta TWILIO_WHATSAPP_FROM");
  return client.messages.create({ from, to: `whatsapp:${toE164}`, body });
}

/**
 * Webhook entrante de Twilio:
 * - Si el número existe como contacto de emergencia de algún paciente,
 *   lo marcamos como "waJoined=true".
 */
async function handleIncoming(req, res) {
  try {
    const from = normalizeE164(req.body?.From);
    if (!from) return res.status(200).send("OK");

    // Marca opt-in para TODOS los contactos con ese teléfono (pueden existir en más de un paciente)
    // Si quieres restringir, puedes pedir que envíen "LINK <codigoPaciente>" y resolver por código.
    await prisma.emergencyContact.updateMany({
      where: { phoneE164: from },
      data: { waJoined: true, waJoinedAt: new Date() },
    });

    // Opcional: responder algo
    // await sendText(from, "¡Listo! Quedarás registrado para recibir alertas.");
    return res.status(200).send("OK");
  } catch (e) {
    console.error("[WA inbound] error:", e);
    return res.status(200).send("OK");
  }
}

/**
 * Obtiene destinatarios WA SOLO del paciente indicado.
 * Regla:
 *  1) Si pasas `to` explícito → solo ese.
 *  2) Contactos del paciente con waJoined=true → esos.
 *  3) (DEV) Fallbacks opcionales: SOS_CONTACTS/MY_WHATSAPP si no hay contactos unidos.
 */
async function getPatientWaRecipients(patientId, to) {
  if (to) return [normalizeE164(to)].filter(Boolean);

  const contacts = await prisma.emergencyContact.findMany({
    where: { patientId, waJoined: true, phoneE164: { not: null } },
    select: { phoneE164: true },
  });

  const list = contacts.map(c => normalizeE164(c.phoneE164)).filter(Boolean);
  if (list.length) return list;

  // Fallbacks de desarrollo (opcional)
  const csv = (process.env.SOS_CONTACTS || "")
    .split(",").map(x => normalizeE164(x.trim())).filter(Boolean);
  if (csv.length) return csv;

  const legacy = normalizeE164(process.env.MY_WHATSAPP);
  return legacy ? [legacy] : [];
}

module.exports = { handleIncoming, sendText, getPatientWaRecipients };
