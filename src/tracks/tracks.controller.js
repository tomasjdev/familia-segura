// src/tracks/tracks.controller.js
const { Router } = require("express");
const { prisma } = require("../db/client");
const { authRequired, deviceAuthRequired } = require("../auth/auth.middleware");

const router = Router();

// Listar tracks (últimas posiciones de un paciente)
router.get("/", authRequired, async (req, res) => {
  const { patientId, limit = 20 } = req.query;
  if (!patientId) {
    return res.status(400).json({ error: "patientId requerido" });
  }

  const pid = Number(patientId);
  const take = Number(limit);

  try {
    let tracks = [];

    // 1) Intentar con la tabla Track normal (si existe)
    try {
      if (prisma.track) {
        tracks = await prisma.track.findMany({
          where: { patientId: pid },
          orderBy: { timestamp: "desc" },
          take,
        });
      }
    } catch (e) {
      console.warn("[/api/tracks] fallo al leer Track (continúo):", e?.message);
    }

    // 2) Si NO hay tracks, usamos los SOS como fallback
    if (!tracks.length && prisma.sosEvent) {
      const sosEvents = await prisma.sosEvent.findMany({
        where: { patientId: pid },
        orderBy: { createdAt: "desc" },
        take,
      });

      // Adaptamos el formato para que el front lo entienda igual
      tracks = sosEvents.map((s) => ({
        id: s.id,
        patientId: s.patientId,
        lat: s.lat,
        lng: s.lng,
        accuracy: s.accuracy,
        timestamp: s.createdAt,
        source: "sosEvent",
      }));
    }

    return res.json(tracks);
  } catch (e) {
    console.error("[GET /api/tracks] error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

// Crear un track individual (legacy)
router.post("/", authRequired, async (req, res) => {
  const { lat, lng, patientId } = req.body;
  if (!lat || !lng || !patientId) {
    return res
      .status(400)
      .json({ error: "lat, lng y patientId son requeridos" });
  }
  const track = await prisma.track.create({
    data: {
      lat: Number(lat),
      lng: Number(lng),
      patientId: Number(patientId),
    },
  });
  res.json(track);
});

// NEW: batch desde el reloj (autenticado como dispositivo)
router.post("/batch", deviceAuthRequired, async (req, res) => {
  const { deviceId, points } = req.body || {};
  if (!deviceId || !Array.isArray(points) || points.length === 0) {
    return res.status(400).json({ error: "deviceId y points requeridos" });
  }
  if (req.device.deviceId != deviceId) {
    return res.status(403).json({ error: "token/device mismatch" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
  });
  if (!device || !device.patientId) {
    return res.status(400).json({ error: "device sin patient asignado" });
  }

  await prisma.$transaction(async (tx) => {
    for (const p of points) {
      await tx.track.create({
        data: {
          patientId: device.patientId,
          timestamp: p.ts ? new Date(p.ts) : new Date(),
          lat: Number(p.lat),
          lng: Number(p.lng),
          accuracy: p.accuracy != null ? Number(p.accuracy) : null,
          battery: p.battery != null ? Number(p.battery) : null,
        },
      });
    }
    const last = points[points.length - 1];
    await tx.device.update({
      where: { id: deviceId },
      data: {
        lastSeenAt: new Date(),
        isConnected: true,
        batteryPct: last?.battery ?? device.batteryPct,
      },
    });
  });

  res.sendStatus(204);
});

module.exports = { tracksRouter: router };
