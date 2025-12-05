// src/routes/shortcut.routes.js
const { Router } = require("express");
const { prisma } = require("../db/client");

// Usa tu helper actual que ya envía WA y/o SMS
const { notifyContact } = require("../integrations/notify");

// Si tienes helper de email, lo usamos de forma opcional (no rompe si no existe)
let sendAlertEmail = null;
try {
  ({ sendAlertEmail } = require("../integrations/email"));
} catch (_) {}

const r = Router();

/**
 * POST /api/shortcuts/sos
 * body: {
 *   key: string,                // debe igualar SOS_SHORTCUT_KEY
 *   patientId: number,          // paciente al que pertenece el SOS
 *   lat?: number, lng?: number, // opcional (la app puede adjuntar ubicación)
 *   accuracy?: number           // opcional
 * }
 */
r.post("/shortcuts/sos", async (req, res) => {
  try {
    const { key, patientId, lat, lng, accuracy } = req.body || {};

    // Seguridad mínima por clave
    if (!key || key !== process.env.SOS_SHORTCUT_KEY) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const id = Number(patientId);
    if (!Number.isFinite(id))
      return res.status(400).json({ error: "patientId inválido" });

    // Paciente + contactos
    const patient = await prisma.patient.findUnique({
      where: { id },
      include: { contacts: true },
    });
    if (!patient)
      return res.status(404).json({ error: "Paciente no encontrado" });

    // 🔹 Busca o crea un "device virtual" para este paciente
    let shortcutDevice = await prisma.device.findFirst({
      where: { patientId: patient.id, name: "shortcut" },
    });

    if (!shortcutDevice) {
      shortcutDevice = await prisma.device.create({
        data: {
          patient: { connect: { id: patient.id } }, // relación correcta según schema
          name: "shortcut",
          model: "virtual",
          isConnected: false,
          batteryPct: null,
        },
      });
    }

    // Registra evento SOS (y alerta) para que el panel lo vea
    const sos = await prisma.sosEvent.create({
      data: {
        patient: { connect: { id: patient.id } },
        device: { connect: { id: shortcutDevice.id } },
        lat: typeof lat === "number" ? lat : null,
        lng: typeof lng === "number" ? lng : null,
        accuracy: typeof accuracy === "number" ? accuracy : null,
      },
      select: { id: true, createdAt: true, lat: true, lng: true },
    });

    // Crea alerta activa
    await prisma.alert.create({
      data: {
        type: "SOS",
        status: "ACTIVE",
        patient: { connect: { id: patient.id } },
      },
    });

    // Mensaje
    const mapUrl =
      typeof lat === "number" && typeof lng === "number"
        ? `https://www.google.com/maps?q=${lat},${lng}`
        : null;

    const msgLines = [
      `🚨 SOS de ${patient.name} (id ${patient.id})`,
      patient.condition ? `Condición: ${patient.condition}` : null,
      mapUrl ? `Ubicación aprox: ${mapUrl}` : null,
      `Hora: ${new Date().toLocaleString()}`,
    ].filter(Boolean);

    const message = msgLines.join("\n");

    // Enviar a contactos por WhatsApp/SMS (según tu notifyContact)
    let sent = 0;
    for (const c of patient.contacts || []) {
      const to = (c.telefono || "").trim();
      if (!to) continue;
      try {
        const ok = await notifyContact(to, message, true);
        if (ok) sent++;
      } catch (_) {}
    }

    // (Opcional) Enviar por correo si tu helper existe y hay emails
    if (sendAlertEmail) {
      const emails = (patient.contacts || [])
        .map((c) => c.email)
        .filter(Boolean);
      if (emails.length) {
        try {
          await sendAlertEmail({
            to: emails,
            subject: "Alerta SOS",
            html: `<h2>Alerta SOS</h2>
                   <p>Paciente: <b>${patient.name}</b> (id ${patient.id})</p>
                   ${
                     patient.condition
                       ? `<p>Condición: ${patient.condition}</p>`
                       : ""
                   }
                   ${
                     mapUrl
                       ? `<p>Mapa: <a href="${mapUrl}">${mapUrl}</a></p>`
                       : ""
                   }
                   <p>Fecha: ${new Date().toLocaleString()}</p>`,
          });
        } catch (_) {}
      }
    }

    res.json({ ok: true, sosId: sos.id, sent });
  } catch (e) {
    console.error("[shortcuts/sos]", e);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = r;
