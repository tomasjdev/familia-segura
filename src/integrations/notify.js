// src/integrations/notify.js
const twilio = require("twilio");
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendWhatsApp(toE164, body) {
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) return false;
  try {
    await client.messages.create({ from, to: `whatsapp:${toE164}`, body });
    return true;
  } catch (e) {
    console.warn("[WA] fallo, fallback a SMS:", e?.message);
    return false;
  }
}

async function sendSMS(toE164, body) {
  const from = process.env.TWILIO_SMS_FROM;
  if (!from) throw new Error("Falta TWILIO_SMS_FROM");
  await client.messages.create({ from, to: toE164, body });
}

async function notifyContact(toE164, body, tryWhatsAppFirst = true) {
  if (tryWhatsAppFirst) {
    const ok = await sendWhatsApp(toE164, body);
    if (ok) return;
  }
  await sendSMS(toE164, body);
}

module.exports = { notifyContact };
