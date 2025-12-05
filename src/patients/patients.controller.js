// src/patients/patients.controller.js
const { Router } = require("express");
const { prisma } = require("../db/client");
const { authRequired, adminOnly } = require("../auth/auth.middleware");

const router = Router();

/* ---------- Helpers ---------- */

function normalizeAllergies(arr = []) {
  return arr
    .map(a => (typeof a === "string" ? { nombre: a } : a))
    .filter(a => a && a.nombre);
}

async function applyRelationsTx(tx, patientId, { allergies = [], contacts = [], companion = null }) {
  // Alergias: borrado total y recreación simple
  await tx.allergy.deleteMany({ where: { patientId } });
  const allergyRows = normalizeAllergies(allergies);
  if (allergyRows.length) {
    await tx.allergy.createMany({
      data: allergyRows.map(a => ({ nombre: a.nombre, patientId }))
    });
  }

  // Contactos: borrado total y recreación simple
  await tx.contact.deleteMany({ where: { patientId } });
  for (const c of Array.isArray(contacts) ? contacts : []) {
    if (!c) continue;
    await tx.contact.create({
      data: {
        nombre:     c.nombre ?? "",
        parentesco: c.parentesco ?? null,
        telefono:   c.telefono ?? null,
        email:      c.email ?? null,
        prioridad:  typeof c.prioridad === "number" ? c.prioridad : 1,
        patientId
      }
    });
  }

  // Acompañante: único
  await tx.companion.deleteMany({ where: { patientId } });
  const hasCompanion =
    companion &&
    (companion.nombre || companion.telefono || companion.email || companion.direccion);

  if (hasCompanion) {
    await tx.companion.create({
      data: {
        nombre:    companion.nombre ?? null,
        telefono:  companion.telefono ?? null,
        email:     companion.email ?? null,
        direccion: companion.direccion ?? null,
        patientId
      }
    });
  }
}

async function updatePatientTx(tx, id, body) {
  const {
    name, age, condition, phone, address, eps, bloodGroup, notes,
    allergies, contacts, companion
  } = body;

  // Actualiza básicos
  await tx.patient.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(age  !== undefined ? { age }  : {}),
      condition:  condition ?? null,
      phone:      phone ?? null,
      address:    address ?? null,
      eps:        eps ?? null,
      bloodGroup: bloodGroup ?? null,
      notes:      notes ?? null
    }
  });

  // Actualiza relaciones si vinieron en el payload
  if (allergies !== undefined || contacts !== undefined || companion !== undefined) {
    await applyRelationsTx(tx, id, { allergies, contacts, companion });
  }

  // Devuelve completo
  const full = await tx.patient.findUnique({
    where: { id },
    include: { contacts: true, allergies: true, companion: true, devices: true, owner: true }
  });
  return full;
}

// Helper consistente para obtener el id de usuario del token
function getAuthUserId(user) {
  return Number(user?.sub ?? user?.userId);
}

// Middleware: ADMIN o dueño del paciente
async function ensureCanEdit(req, res, next) {
  try {
    const role = String(req.user?.role || "").toUpperCase();
    if (role === "ADMIN") return next();

    const uid = getAuthUserId(req.user);
    if (!Number.isInteger(uid)) return res.status(401).json({ error: "token inválido" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

    const p = await prisma.patient.findUnique({
      where: { id },
      select: { id: true, ownerId: true }
    });
    if (!p) return res.status(404).json({ error: "Paciente no encontrado" });
    if (p.ownerId !== uid) return res.status(403).json({ error: "No autorizado" });

    next();
  } catch (e) {
    console.error("ensureCanEdit error:", e);
    res.status(500).json({ error: "server error" });
  }
}

async function getMyPatientId(userId) {
  const p = await prisma.patient.findFirst({
    where: { ownerId: userId },
    select: { id: true }
  });
  return p?.id || null;
}

/**
 * Normaliza teléfonos chilenos a formato E.164 (+56...)
 * Se usará para crear EmergencyContact automáticamente
 */
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

/* ---------- Rutas ---------- */

/**
 * GET /api/patients
 * - ADMIN: ve todos
 * - USER:  ve solo los suyos (ownerId = id del token)
 */
router.get("/", authRequired, async (req, res) => {
  try {
    const role = String(req.user?.role || "").toUpperCase();
    const uid  = getAuthUserId(req.user);

    const where = role === "ADMIN" ? {} : { ownerId: uid };

    const patients = await prisma.patient.findMany({
      where,
      orderBy: { id: "asc" },
      include: {
        contacts: true,
        allergies: true,
        companion: true,
        devices: true,
        owner: true
      }
    });

    res.json(patients);
  } catch (e) {
    console.error("GET /patients error:", e);
    res.status(500).json({ error: "server error" });
  }
});

/**
 * POST /api/patients  (solo ADMIN)
 * Nota: Para el flujo “usuario + paciente” desde el admin, estás usando /api/admin/patients,
 * que recibe ownerId explícito. Este endpoint lo dejamos solo-admin y crea para el propio admin.
 *
 * 🔹 Modificado para:
 *  - crear automáticamente EmergencyContact a partir de `contacts` (cuando haya teléfono).
 */
router.post("/", authRequired, adminOnly, async (req, res) => {
  try {
    const {
      name, age,
      condition, phone, address, eps, bloodGroup, notes,
      allergies = [],
      contacts  = [],
      companion = null
    } = req.body;

    if (!name || typeof age !== "number") {
      return res.status(400).json({ error: "Nombre y edad son obligatorios" });
    }

    const ownerId = getAuthUserId(req.user); // admin actual
    if (!Number.isInteger(ownerId)) return res.status(401).json({ error: "token inválido" });

    // 1) Crear paciente y relaciones (contacts, allergies, companion) en una transacción
    const createdId = await prisma.$transaction(async (tx) => {
      const p = await tx.patient.create({
        data: {
          name,
          age,
          condition:  condition ?? null,
          phone:      phone ?? null,
          address:    address ?? null,
          eps:        eps ?? null,
          bloodGroup: bloodGroup ?? null,
          notes:      notes ?? null,
          ownerId
        }
      });

      await applyRelationsTx(tx, p.id, { allergies, contacts, companion });

      return p.id;
    });

    // 2) Crear EmergencyContact automáticamente en base a contacts (fuera de la tx principal)
    try {
      const contactList = Array.isArray(contacts) ? contacts : [];
      for (const c of contactList) {
        if (!c) continue;
        const rawPhone =
          c.telefono ??
          c.phone ??
          c.phoneE164 ??
          null;

        const phoneE164 = toE164CL(rawPhone);
        if (!phoneE164) continue;

        await prisma.emergencyContact.create({
          data: {
            patientId: createdId,
            name: c.nombre || c.name || "Contacto de emergencia",
            phoneE164,
            priority: typeof c.prioridad === "number" ? c.prioridad : 1,
            active: true
          }
        });
      }
    } catch (e) {
      console.warn("[POST /patients] No se pudo crear EmergencyContact automático:", e?.message);
      // No interrumpimos la creación del paciente por esto
    }

    const full = await prisma.patient.findUnique({
      where: { id: createdId },
      include: { contacts: true, allergies: true, companion: true, devices: true, owner: true }
    });

    res.status(201).json(full);
  } catch (e) {
    console.error("POST /patients error:", e);
    res.status(500).json({ error: "No se pudo crear el paciente" });
  }
});

/**
 * ⚠️ IMPORTANTE: /me DEBE IR ANTES DE /:id
 * PUT/PATCH /api/patients/me  → edita el paciente del usuario autenticado (ownerId)
 */
router.put("/me", authRequired, async (req, res) => {
  try {
    const uid = getAuthUserId(req.user);
    if (!Number.isInteger(uid)) return res.status(401).json({ error: "token inválido" });

    const myId = await getMyPatientId(uid);
    if (!myId) return res.status(404).json({ error: "Paciente del usuario no encontrado" });

    const updated = await prisma.$transaction(async (tx) => updatePatientTx(tx, myId, req.body));
    res.json(updated);
  } catch (e) {
    console.error("PUT /patients/me error:", e);
    res.status(500).json({ error: "No se pudo actualizar el paciente" });
  }
});

router.patch("/me", authRequired, async (req, res) => {
  try {
    const uid = getAuthUserId(req.user);
    if (!Number.isInteger(uid)) return res.status(401).json({ error: "token inválido" });

    const myId = await getMyPatientId(uid);
    if (!myId) return res.status(404).json({ error: "Paciente del usuario no encontrado" });

    const updated = await prisma.$transaction(async (tx) => updatePatientTx(tx, myId, req.body));
    res.json(updated);
  } catch (e) {
    console.error("PATCH /patients/me error:", e);
    res.status(500).json({ error: "No se pudo actualizar el paciente" });
  }
});

/**
 * PUT/PATCH /api/patients/:id  → ADMIN o OWNER
 */
router.put("/:id", authRequired, ensureCanEdit, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

    const updated = await prisma.$transaction(async (tx) => updatePatientTx(tx, id, req.body));
    res.json(updated);
  } catch (e) {
    console.error("PUT /patients/:id error:", e);
    res.status(500).json({ error: "No se pudo actualizar el paciente" });
  }
});

router.patch("/:id", authRequired, ensureCanEdit, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

    const updated = await prisma.$transaction(async (tx) => updatePatientTx(tx, id, req.body));
    res.json(updated);
  } catch (e) {
    console.error("PATCH /patients/:id error:", e);
    res.status(500).json({ error: "No se pudo actualizar el paciente" });
  }
});

module.exports = { patientsRouter: router };
