// src/sos/sos.controller.js
const { Router } = require("express");
const { prisma } = require("../db/client");
const { deviceAuthRequired } = require("../auth/auth.middleware");

// WhatsApp: SOLO contactos del paciente
const {
  getPatientWaRecipients,
  sendText,
} = require("../integrations/whatsapp.twilio");

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
    return res
      .status(400)
      .json({ ok: false, error: "device sin patient asignado" });
  }

  // Anti-spam si existe SosEvent
  try {
    const last = await prisma.sosEvent.findFirst({
      where: { deviceId },
      orderBy: { createdAt: "desc" },
    });
    if (last && (now - last.createdAt) / 1000 < DEBOUNCE_S) {
      // Actualizar estado del dispositivo (debounce)
      try {
        await prisma.device.update({
          where: { id: deviceId },
          data: {
            lastSeenAt: now,
            isConnected: true,
            batteryPct:
              battery != null ? Number(battery) : device.batteryPct,
          },
        });
      } catch (e) {
        console.warn(
          "[sos/device] error al actualizar batteryPct (debounce):",
          e?.message
        );
      }

      return res.json({ ok: true, delivered: false, reason: "debounced" });
    }
  } catch (_) {}

  // CREACIÓN DE ALERTA
  try {
    if (prisma.alert) {
      const alerta = await prisma.alert.create({
        data: {
          type: "SOS",
          status: "ACTIVE",
          patient: { connect: { id: device.patientId } }, // ← relación válida
          createdAt: ts ? new Date(ts) : now,
        },
      });

      console.log("[/api/sos/device] alerta creada con id", alerta.id);
    }
  } catch (e) {
    console.warn("[/api/sos/device] no se pudo crear alerta:", e?.message);
  }
  // =================================================================================

  // 👇 NUEVO: guardar también en `Track` para que el panel use la misma posición
  try {
    if (lat != null && lng != null && prisma.track) {
      await prisma.track.create({
        data: {
          patientId: device.patientId,
          lat: Number(lat),
          lng: Number(lng),
          accuracy: accuracy != null ? Number(accuracy) : null,
          timestamp: ts ? new Date(ts) : now,
        },
      });
    }
  } catch (e) {
    console.warn("[/api/sos/device] no se pudo guardar Track:", e?.message);
  }

  // Arma mensaje SOS
  const patient = await prisma.patient.findUnique({
    where: { id: device.patientId },
  });

  const when = (ts ? new Date(ts) : now).toLocaleString("es-CL", {
    timeZone: "America/Santiago",
  });

  const mapUrl =
    lat != null && lng != null
      ? `https://maps.google.com/?q=${lat},${lng}`
      : "(sin ubicación)";

  const mensajeSOS =
    `🚨 SOS de ${patient?.name || "Paciente"}.\n` +
    `Revisa ubicación en el panel.\n` +
    `Fecha/Hora: ${when}\n` +
    `Ubicación: ${mapUrl}`;

  // === WhatsApp a contactos del paciente ===
  let delivered = false;
  let attempts = 0;

  const recipients = await getPatientWaRecipients(
    device.patientId,
    req.query?.to
  );

  if (!recipients.length) {
    // Actualizar estado del dispositivo si no hay contactos
    try {
      await prisma.device.update({
        where: { id: deviceId },
        data: {
          lastSeenAt: now,
          isConnected: true,
          batteryPct:
            battery != null ? Number(battery) : device.batteryPct,
        },
      });
    } catch (e) {
      console.warn(
        "[sos/device] error al actualizar batteryPct (sin contactos):",
        e?.message
      );
    }

    return res.json({
      ok: true,
      delivered: false,
      reason: "no_recipients_for_patient",
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

  // Actualizar estado del dispositivo (caso normal)
  try {
    await prisma.device.update({
      where: { id: deviceId },
      data: {
        lastSeenAt: now,
        isConnected: true,
        batteryPct:
          battery != null ? Number(battery) : device.batteryPct,
      },
    });
  } catch (e) {
    console.warn("[sos/device] error al actualizar batteryPct:", e?.message);
  }

  return res.json({
    ok: true,
    delivered,
    attempts,
    recipients: recipients.length,
    results,
  });
});

module.exports = router;
