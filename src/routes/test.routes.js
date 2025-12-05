// src/routes/test.routes.js
const { Router } = require("express");
const { prisma } = require("../db/client");
const { authRequired, adminOnly } = require("../auth/auth.middleware");
const { notifyContact } = require("../integrations/notify");

// Normalizador muy simple. Idealmente usa libphonenumber.
function toE164(raw, defaultCc = "+56") {
  if (!raw) return null;
  let p = String(raw).replace(/[^\d+]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (!p.startsWith("+")) p = defaultCc + p.replace(/^0+/, "");
  return p;
}

const r = Router();

// ADMIN: probar notificación a un paciente específico
r.post("/test/notify/:patientId", authRequired, adminOnly, async (req, res) => {
  try {
    const pid = Number(req.params.patientId);
    if (!Number.isInteger(pid)) return res.status(400).json({ error: "id inválido" });

    // 1) Intentar EmergencyContact (oficial)
    let targets = await prisma.emergencyContact.findMany({
      where: { patientId: pid, active: true },
      orderBy: { priority: "asc" },
      select: { phoneE164: true, name: true }
    });

    // 2) Si no hay, caer a Contact (lo que rellenas desde el modal)
    if (!targets.length) {
      const contacts = await prisma.contact.findMany({
        where: { patientId: pid },
        orderBy: { prioridad: "asc" },
        select: { telefono: true, nombre: true }
      });
      targets = contacts
        .map(c => ({ phoneE164: toE164(c.telefono), name: c.nombre }))
        .filter(c => !!c.phoneE164);
    }

    // 3) Si sigue vacío, fin
    if (!targets.length) return res.json({ ok: true, sent: 0 });

    const msg = `🔔 Test de alerta para paciente #${pid}`;
    await Promise.allSettled(targets.map(t => notifyContact(t.phoneE164, msg, true)));

    res.json({ ok: true, sent: targets.length });
  } catch (e) {
    console.error("POST /test/notify/:patientId", e);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = r;
