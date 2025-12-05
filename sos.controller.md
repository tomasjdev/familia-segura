// src/sos/sos.controller.js
const { Router } = require("express");
const { prisma } = require("../db/client");
const { deviceAuthRequired } = require("../auth/auth.middleware");

// WhatsApp: SOLO contactos del paciente con waJoined=true
const { getPatientWaRecipients, sendText } = require("../integrations/whatsapp.twilio");

const router = Router();

// --- mantén aquí tu router.post("/api/sos", upload.single("audio"), ...) existente ---

// SOS desde el reloj (JSON). Queda como POST /api/sos/device (router se monta en /api)
const DEBOUNCE_S = 60;

router.post("/sos/device", deviceAuthRequired, async (req, res) => {
  const { deviceId } = req.device;
  const { ts, lat, lng, accuracy, battery } = req.body || {};
  const now = new Date();

  // Verifica dispositivo y paciente
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || !device.patientId) {
    return res.status(400).json({ ok: false, error: "device sin patient asignado" });
  }

  // Anti-spam si existe SosEvent
  try {
    const last = await prisma.sosEvent.findFirst({
      where: { deviceId },
      orderBy: { createdAt: "desc" },
    });
    if (last && (now - last.createdAt) / 1000 < DEBOUNCE_S) {
      // actualiza lastSeen/batería igual, pero no dispara notificaciones
      try {
        await prisma.device.update({
          where: { id: deviceId },
          data: {
            lastSeenAt: now,
            isConnected: true,
            batteryPct: battery ?? device.batteryPct,
          },
        });
      } catch {}
      return res.json({ ok: true, delivered: false, reason: "debounced" });
    }
  } catch {
    // si aún no existe la tabla, seguimos
  }

  // Guardar evento si el modelo existe
  try {
    await prisma.sosEvent.create({
      data: {
        patientId: device.patientId,
        deviceId,
        createdAt: ts ? new Date(ts) : now,
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null,
        accuracy: accuracy != null ? Number(accuracy) : null,
        battery: battery != null ? Number(battery) : null,
      },
    });
  } catch {
    // si no existe el modelo aún, continuamos
  }

  // Arma mensaje SOS
  const patient = await prisma.patient.findUnique({ where: { id: device.patientId } });
  const when = (ts ? new Date(ts) : now).toLocaleString("es-CL", {
    timeZone: "America/Santiago",
  });
  const mapUrl =
    lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : "(sin ubicación)";
  const mensajeSOS =
    `🚨 SOS de ${patient?.name || "Paciente"}. Revisa ubicación en el panel.\n` +
    `Fecha/Hora: ${when}\n` +
    `Ubicación: ${mapUrl}`;

  // === SOLO WhatsApp a contactos del paciente que hicieron join ===
  let delivered = false;
  let attempts = 0;

  // Puedes pasar ?to=+569XXXXXXXX como override temporal (solo dev)
  const recipients = await getPatientWaRecipients(device.patientId, req.query?.to);

  if (!recipients.length) {
    // Actualiza telemetría igual
    try {
      await prisma.device.update({
        where: { id: deviceId },
        data: {
          lastSeenAt: now,
          isConnected: true,
          batteryPct: battery ?? device.batteryPct,
        },
      });
    } catch {}
    return res.json({
      ok: true,
      delivered: false,
      reason: "no_wa_recipients_for_patient", // nadie con join
      attempts,
    });
  }

  const results = [];
  for (const dest of recipients) {
    attempts += 1;
    try {
      const r = await sendText(dest, mensajeSOS);
      results.push({ to: dest, ok: true, sid: r.sid });
      delivered = true;
    } catch (e) {
      console.warn("[WA] fallo a", dest, e?.message);
      results.push({ to: dest, ok: false, error: e?.message });
    }
  }

  // Actualizar estado del dispositivo
  try {
    await prisma.device.update({
      where: { id: deviceId },
      data: {
        lastSeenAt: now,
        isConnected: true,
        batteryPct: battery ?? device.batteryPct,
      },
    });
  } catch {}

  return res.json({
    ok: true,
    delivered,
    attempts,
    recipients: recipients.length,
    results,
  });
});

module.exports = router;
