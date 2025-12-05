// src/alerts/alerts.controller.js
const { Router } = require("express");
const { prisma } = require("../db/client");
const { authRequired } = require("../auth/auth.middleware");
const { notifyContact } = require("../integrations/notify");

const router = Router();

// --- helper: normaliza teléfonos chilenos a E.164 (+56...)
function toE164CL(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[^\d+]/g, "");
  if (s.startsWith("+56")) return s;
  if (s.startsWith("56")) return "+" + s;
  // 9 dígitos cel, 8 dígitos fijo
  if (/^\d{9}$/.test(s) || /^\d{8}$/.test(s)) return "+56" + s;
  if (s.startsWith("+")) return s;
  return null;
}

function parseAlertId(idParam) {
  const n = Number(idParam);
  return Number.isNaN(n) ? idParam : n;
}

/**
 * GET /api/alerts
 * - Admin: ve todas las alertas.
 * - Usuario normal: solo las alertas de sus pacientes.
 */
router.get("/", authRequired, async (req, res) => {
  try {
    const { userId, role } = req.user;

    const where =
      String(role).toUpperCase() === "ADMIN"
        ? {} // admin ve todas
        : {
            patient: {
              ownerId: userId,
            },
          };

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        patient: {
          select: { id: true, name: true },
        },
      },
    });

    return res.json(alerts);
  } catch (e) {
    console.error("[GET /api/alerts] error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

/**
 * Handler común para dar de baja una alerta
 */
async function dismissAlertHandler(req, res) {
  const { id } = req.params;
  const alertId = parseAlertId(id);

  try {
    const updated = await prisma.alert.update({
      where: { id: alertId },
      data: { status: "CLOSED" }, // estado que uses para "cerrada"
    });

    return res.json({ ok: true, alert: updated });
  } catch (e) {
    console.error("[/api/alerts/:id/dismiss] error:", e);
    // Prisma lanza P2025 si no encuentra el registro
    if (e.code === "P2025") {
      return res.status(404).json({ error: "alert not found" });
    }
    return res.status(500).json({ error: "server error" });
  }
}

/**
 * PATCH /api/alerts/:id/dismiss
 * POST  /api/alerts/:id/dismiss  (fallback por si PATCH da problemas)
 */
router.patch("/:id/dismiss", authRequired, dismissAlertHandler);
router.post("/:id/dismiss", authRequired, dismissAlertHandler);

/**
 * SOS desde la web (panel del usuario)
 * - Usa patient del owner (usuario logueado).
 * - Busca contactos en `emergencyContact` (viejo) y `contact` (nuevo).
 * - Crea `sosEvent` solo si hay Device asignado, y también `alert`.
 */
router.post("/sos-web", authRequired, async (req, res) => {
  try {
    const { userId } = req.user;
    const { lat = null, lng = null, accuracy = null } = req.body || {};

    // 1) Paciente del owner
    const patient = await prisma.patient.findFirst({
      where: { ownerId: userId },
      select: { id: true, name: true },
    });
    if (!patient) {
      return res
        .status(404)
        .json({ error: "Paciente del usuario no encontrado" });
    }

    // 1.1) Buscar device asignado al paciente (para evitar FK en SosEvent)
    let device = null;
    try {
      if (prisma.device) {
        device = await prisma.device.findFirst({
          where: { patientId: patient.id },
          select: { id: true },
        });
      }
    } catch (e) {
      console.warn("[alerts] no se pudo leer Device (continúo):", e?.message);
    }

    // 2) Crear SosEvent SOLO si hay device válido (para evitar FK)
    let sosId = null;
    let sosCreatedAt = null;
    try {
      if (prisma.sosEvent && device?.id) {
        const sos = await prisma.sosEvent.create({
          data: {
            patient: { connect: { id: patient.id } },
            device: { connect: { id: device.id } },
            lat: lat === null ? null : Number(lat),
            lng: lng === null ? null : Number(lng),
            accuracy: accuracy === null ? null : Number(accuracy),
            createdAt: new Date(),
          },
          select: { id: true, createdAt: true },
        });
        sosId = sos.id;
        sosCreatedAt = sos.createdAt;
      }
    } catch (e) {
      console.warn(
        "[alerts] no se pudo crear registro en `sosEvent` (continúo):",
        e?.message
      );
    }

    // 3) Crear registro en `alert` (simplificado)
    let alertId = null;
    try {
      if (prisma.alert) {
        const a = await prisma.alert.create({
          data: {
            type: "SOS",
            status: "ACTIVE",
            // podemos marcar la fuente como web, igual que en watch-sos usamos "watch-demo"
            source: "web",
            createdAt: new Date(),
          },
          select: { id: true },
        });
        alertId = a.id;
      }
    } catch (e) {
      console.warn(
        "[alerts] no se pudo crear registro en `alert` (continúo):",
        e?.message
      );
    }

    // 4) Contactos unificados
    const unifiedContacts = [];
    const seen = new Set();

    // 4.1) emergencyContact (esquema viejo)
    try {
      if (prisma.emergencyContact) {
        const ecs = await prisma.emergencyContact.findMany({
          where: { patientId: patient.id, active: true },
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
          select: { phoneE164: true, name: true },
        });
        for (const c of ecs) {
          const to = c.phoneE164 ? toE164CL(c.phoneE164) : null;
          if (to && !seen.has(to)) {
            seen.add(to);
            unifiedContacts.push({ to, name: c.name || null });
          }
        }
      }
    } catch (e) {
      console.warn(
        "[alerts] fallo al leer `emergencyContact` (continúo):",
        e?.message
      );
    }

    // 4.2) contact (esquema nuevo)
    try {
      if (prisma.contact) {
        const cs = await prisma.contact.findMany({
          where: { patientId: patient.id },
          orderBy: [{ prioridad: "asc" }, { id: "asc" }],
          select: { telefono: true, nombre: true },
        });
        for (const c of cs) {
          const to = toE164CL(c.telefono);
          if (to && !seen.has(to)) {
            seen.add(to);
            unifiedContacts.push({ to, name: c.nombre || null });
          }
        }
      }
    } catch (e) {
      console.warn("[alerts] fallo al leer `contact` (continúo):", e?.message);
    }

    // 5) Mensaje + envío best-effort
    const ts = (sosCreatedAt ? new Date(sosCreatedAt) : new Date()).toLocaleString();
    const map =
      lat != null && lng != null
        ? `https://www.google.com/maps?q=${lat},${lng}`
        : null;

    const body =
      `🚨 *SOS de ${patient.name || "Paciente"}*\n` +
      `Hora: ${ts}\n` +
      (map ? `Mapa: ${map}\n` : ``) +
      `Mensaje automático de *Familia Segura*.\n`;

    let sent = 0;
    for (const c of unifiedContacts) {
      try {
        const ok = await notifyContact(c.to, body, true);
        if (ok) sent++;
      } catch (err) {
        console.warn("[notifyContact] fallo para", c.to, err?.message);
      }
    }

    return res.json({
      ok: true,
      sent,
      sosId,
      alertId,
      contactsCount: unifiedContacts.length,
    });
  } catch (e) {
    console.error("[/api/alerts/sos-web] error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

/**
 * SOS de prueba desde el reloj sin auth (solo desarrollo)
 */
router.post("/watch-sos", async (req, res) => {
  try {
    console.log("🚨 SOS recibido desde el reloj (watch-sos)");

    const alerta = await prisma.alert.create({
      data: {
        type: "SOS",
        status: "ACTIVE",
        source: "watch-demo",
        meta: req.body || {},
      },
    });

    return res.json({
      ok: true,
      message: "Alerta SOS recibida desde el reloj (demo)",
      alerta,
    });
  } catch (error) {
    console.error("Error en /watch-sos:", error);
    res
      .status(500)
      .json({ error: "Error procesando alerta del reloj (watch-sos)" });
  }
});

module.exports = { alertsRouter: router };
