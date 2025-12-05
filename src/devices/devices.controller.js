// src/devices/devices.controller.js
const { Router } = require("express");
const crypto = require("crypto");
const { prisma } = require("../db/client");
const {
  authRequired,
  adminOnly,
  signDeviceToken,
} = require("../auth/auth.middleware");

const router = Router();

/* ---------- Helpers ---------- */

// Genera una apiKey fuerte para usar como X-Device-Key
function generateApiKey() {
  return crypto.randomBytes(24).toString("base64url"); // ej: "kFQf2p9z-....."
}

// quick health
router.get("/__health", (req, res) => res.json({ ok: true }));

/**
 * Dispositivos del usuario logueado (vía sus pacientes)
 * GET /api/devices/mine
 */
router.get("/mine", authRequired, async (req, res) => {
  try {
    const { userId } = req.user;

    const devices = await prisma.device.findMany({
      where: {
        patient: {
          // relación Device -> Patient
          ownerId: userId,
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        batteryPct: true,
        isConnected: true,
      },
    });

    return res.json(devices);
  } catch (e) {
    console.error("[GET /api/devices/mine] error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

// listar
router.get("/", authRequired, async (req, res) => {
  // el id del usuario está en el claim "sub"
  const ownerId = Number(req.user?.sub);

  // si no es número válido, evita romper y devuelve vacío o 401
  if (!Number.isInteger(ownerId) && req.user?.role !== "ADMIN") {
    return res.status(401).json({ error: "Token inválido o userId ausente" });
  }

  // Para relaciones en Prisma, usa patient: { is: { ownerId: ... } }
  const where =
    req.user.role === "ADMIN"
      ? {}
      : {
          patient: {
            is: { ownerId: ownerId },
          },
        };

  const devices = await prisma.device.findMany({
    where,
    orderBy: { id: "asc" },
    include: { patient: true },
  });

  res.json(devices);
});

// crear (legacy)
router.post("/", authRequired, async (req, res) => {
  const { code, batteryPct, isConnected, patientId } = req.body;
  if (!code) return res.status(400).json({ error: "code requerido" });
  const device = await prisma.device.create({
    data: {
      code,
      batteryPct: batteryPct ?? null,
      isConnected: !!isConnected,
      ...(patientId ? { patient: { connect: { id: Number(patientId) } } } : {}),
    },
  });
  res.status(201).json(device);
});

/** ========================
 *   ADMIN: REGISTRO / ASIGNACIÓN
 *  ======================== */

/**
 * POST /api/devices/admin/register
 * body: { code:string(6), name?:string, model?:string }
 * auth: ADMIN
 * return: 201 { id, pairing_code, name, model } | 409 si ya existe
 */
router.post("/admin/register", authRequired, adminOnly, async (req, res) => {
  try {
    const { code, name, model } = req.body || {};
    if (!code || !/^\d{6}$/.test(String(code))) {
      return res.status(400).json({ error: "code inválido (6 dígitos)" });
    }

    // ¿ya hay un dispositivo esperando con ese pairingCode?
    const dup = await prisma.device.findFirst({
      where: { pairingCode: String(code) },
      select: { id: true },
    });
    if (dup) return res.status(409).json({ error: "Código ya existe" });

    // también evitamos chocar con el campo 'code' legacy si lo usas como identificador
    const dupLegacy = await prisma.device.findFirst({
      where: { code: String(code) },
      select: { id: true },
    });
    if (dupLegacy)
      return res.status(409).json({ error: "Código ya existe (legacy)" });

    const device = await prisma.device.create({
      data: {
        // Mantén el código en ambos campos: pairing (temporal) y code (definitivo)
        pairingCode: String(code),
        code: String(code),
        pairingExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // válido 1 año
        name: name || "WearOS",
        model: model || null,
        isConnected: false,
      },
      select: { id: true, pairingCode: true, name: true, model: true },
    });

    return res.status(201).json({
      id: device.id,
      pairing_code: device.pairingCode,
      name: device.name,
      model: device.model,
    });
  } catch (e) {
    console.error("[devices/admin/register] Error:", e);
    return res
      .status(500)
      .json({ error: "No se pudo registrar el dispositivo" });
  }
});

/**
 * POST /api/devices/admin/assign
 * body: { pairing_code:string(6), patientId:number }
 * auth: ADMIN
 * return: { ok: true, device }
 */
router.post("/admin/assign", authRequired, adminOnly, async (req, res) => {
  try {
    const { pairing_code, patientId } = req.body || {};
    if (!pairing_code || !/^\d{6}$/.test(String(pairing_code))) {
      return res
        .status(400)
        .json({ error: "pairing_code inválido (6 dígitos)" });
    }
    const pid = Number(patientId);
    if (!Number.isInteger(pid))
      return res.status(400).json({ error: "patientId inválido" });

    const device = await prisma.device.findFirst({
      where: { pairingCode: String(pairing_code) },
    });
    if (!device)
      return res
        .status(404)
        .json({ error: "Dispositivo no encontrado para ese código" });

    const updated = await prisma.device.update({
      where: { id: device.id },
      data: {
        patient: { connect: { id: pid } },
        // preserva code, solo limpia el pairing temporal
        pairingCode: null,
        pairingExpiresAt: null,
        isConnected: false,
      },
      include: { patient: true },
    });

    return res.json({ ok: true, device: updated });
  } catch (e) {
    console.error("[devices/admin/assign] Error:", e);
    return res
      .status(500)
      .json({ error: "No se pudo asignar el dispositivo" });
  }
});

/**
 * POST /api/devices/admin/delete
 * body: { id?: number | string, pairing_code?: string, code?: string }
 * auth: ADMIN
 * return: { ok: true, deletedId }
 *
 * Permite eliminar un dispositivo por id o por pairing_code (y hace fallback a 'code' legacy).
 */
router.post("/admin/delete", authRequired, adminOnly, async (req, res) => {
  try {
    const { id, pairing_code, code } = req.body || {};
    const needle = String(pairing_code || code || "").trim();

    let dev = null;

    // Buscar por id numérico (si vino)
    if (id !== undefined && id !== null && String(id).trim() !== "") {
      const nId = Number(id);
      if (Number.isInteger(nId)) {
        dev = await prisma.device.findUnique({ where: { id: nId } });
      }
    } else if (needle) {
      // Buscar por pairingCode vigente o por code (legacy)
      dev =
        (await prisma.device.findFirst({ where: { pairingCode: needle } })) ||
        (await prisma.device
          .findFirst({ where: { code: needle } })
          .catch(() => null));
    }

    if (!dev) return res.status(404).json({ error: "Dispositivo no encontrado" });

    await prisma.device.delete({ where: { id: dev.id } });
    res.json({ ok: true, deletedId: dev.id });
  } catch (e) {
    console.error("[DEVICES] admin/delete error:", e);
    res.status(500).json({ error: "No se pudo eliminar el dispositivo" });
  }
});

/** ========================
 *   PAIRING NUEVO (usuario)
 *  ======================== */

/**
 * POST /api/devices/pair/start
 * body: { patientId }
 * auth: usuario o admin
 * return: { pairing_code, expiresAt, deviceId }
 */
router.post("/pair/start", authRequired, async (req, res) => {
  const { patientId } = req.body || {};
  if (!patientId)
    return res.status(400).json({ error: "patientId requerido" });

  const pid = Number(patientId);
  if (!Number.isInteger(pid))
    return res.status(400).json({ error: "patientId debe ser entero" });

  // 1) Buscar paciente
  const patient = await prisma.patient.findUnique({ where: { id: pid } });
  if (!patient) return res.status(404).json({ error: "Paciente no encontrado" });

  // 2) Si no es admin, verificar pertenencia
  const isAdmin = req.user?.role === "ADMIN";
  const ownerId = Number(req.user?.sub);
  if (!isAdmin && patient.ownerId !== ownerId) {
    return res.status(403).json({ error: "Paciente no pertenece al usuario" });
  }

  // 3) Generar pairing
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  const device = await prisma.device.create({
    data: {
      patient: { connect: { id: pid } },
      pairingCode: code,
      pairingExpiresAt: expiresAt,
      // aún no conectado; 'code' definitivo se rellena en confirm si aún no existe
      isConnected: false,
      name: "WearOS",
      model: "Galaxy Watch",
    },
  });

  res.json({
    pairing_code: code,
    expiresAt: expiresAt.toISOString(),
    deviceId: device.id,
  });
});

/**
 * POST /api/devices/pair/confirm
 * body: { pairing_code }
 * return: { token, apiKey, deviceId, patientId }
 *
 * 🔹 Modificado para generar y devolver apiKey (para X-Device-Key)
 *    además de seguir devolviendo el token JWT legacy.
 */
router.post("/pair/confirm", async (req, res) => {
  const { pairing_code } = req.body || {};
  if (!pairing_code)
    return res.status(400).json({ error: "pairing_code requerido" });

  const now = new Date();
  const device =
    (await prisma.device.findFirst({
      where: { pairingCode: pairing_code, pairingExpiresAt: { gt: now } },
    })) ||
    (await prisma.device.findFirst({
      where: { code: pairing_code }, // fallback por compatibilidad
    }));

  if (!device)
    return res.status(400).json({ error: "código inválido o expirado" });

  try {
    // Generamos apiKey nueva solo si no existía
    const newApiKey = device.apiKey || generateApiKey();

    let updates = {
      pairingCode: null,
      pairingExpiresAt: null,
      isConnected: true,
      lastSeenAt: now,
      apiKey: newApiKey,
    };

    if (!device.code && device.pairingCode) {
      updates.code = device.pairingCode; // preserva el código como definitivo
    }

    await prisma.device.update({
      where: { id: device.id },
      data: updates,
    });

    const token = signDeviceToken({
      deviceId: device.id,
      patientId: device.patientId,
    });

    return res.json({
      token, // legacy (por si algo lo sigue usando)
      apiKey: newApiKey, // 👉 esto es lo que usará el reloj en X-Device-Key
      deviceId: device.id,
      patientId: device.patientId,
    });
  } catch (e) {
    console.error("[devices/pair/confirm] error en update:", e);
    // fallback mínimo: marcar conectado y asignar apiKey
    const fallbackApiKey = device.apiKey || generateApiKey();
    await prisma.device.update({
      where: { id: device.id },
      data: {
        isConnected: true,
        lastSeenAt: now,
        apiKey: fallbackApiKey,
      },
    });

    const token = signDeviceToken({
      deviceId: device.id,
      patientId: device.patientId,
    });

    return res.json({
      token,
      apiKey: fallbackApiKey,
      deviceId: device.id,
      patientId: device.patientId,
    });
  }
});

// borrar por ID (solo ADMIN)
router.delete("/:id", authRequired, adminOnly, async (req, res) => {
  const idParam = String(req.params.id || "");
  if (!idParam) return res.status(400).json({ error: "id requerido" });

  const id = Number(idParam);
  if (!Number.isInteger(id))
    return res.status(400).json({ error: "id inválido" });

  try {
    await prisma.device.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e) {
    // P2025 = not found en Prisma
    if (e?.code === "P2025")
      return res.status(404).json({ error: "Dispositivo no encontrado" });
    console.error("[DELETE /devices/:id] error:", e);
    return res
      .status(500)
      .json({ error: "No se pudo eliminar el dispositivo" });
  }
});

module.exports = { devicesRouter: router };
