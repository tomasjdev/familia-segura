// src/admin/admin.controller.js
const { Router } = require("express");
const bcrypt = require("bcryptjs");
const { prisma } = require("../db/client");
const { authRequired, adminOnly } = require("../auth/auth.middleware");

const router = Router();

// --- Health ---
router.get("/__health", authRequired, adminOnly, (_req, res) => {
  res.json({ ok: true });
});

/**
 * Crea un usuario (solo ADMIN)
 * POST /api/admin/users
 * body: { email, password, role? }  // role: "ADMIN" | "USER"
 */
router.post("/users", authRequired, adminOnly, async (req, res) => {
  try {
    let { email, password, role = "USER" } = req.body || {};
    email = String(email || "").trim().toLowerCase();

    if (!email || !password) {
      return res.status(400).json({ error: "email y password son requeridos" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: "El email ya está registrado" });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hash,
        role: String(role).toUpperCase() === "ADMIN" ? "ADMIN" : "USER",
      },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    res.status(201).json(user);
  } catch (e) {
    console.error("[ADMIN] create user error:", e);
    res.status(500).json({ error: "No se pudo crear el usuario" });
  }
});

/**
 * Crea un paciente para un ownerId (solo ADMIN)
 * POST /api/admin/patients
 */
router.post("/patients", authRequired, adminOnly, async (req, res) => {
  try {
    const {
      ownerId,
      name,
      age,
      condition,
      phone,
      address,
      eps,
      bloodGroup,
      notes,
      allergies = [],
      contacts = [],
      companion = null,
    } = req.body || {};

    if (!ownerId) return res.status(400).json({ error: "ownerId requerido" });
    if (!name || typeof age === "undefined") {
      return res.status(400).json({ error: "name y age son requeridos" });
    }

    const patient = await prisma.patient.create({
      data: {
        owner: { connect: { id: Number(ownerId) } },
        name,
        age: Number(age),
        condition: condition || null,
        phone: phone || null,
        address: address || null,
        eps: eps || null,
        bloodGroup: bloodGroup || null,
        notes: notes || null,
        allergies: {
          create: (Array.isArray(allergies) ? allergies : []).map((nombre) => ({
            nombre: String(nombre),
          })),
        },
        contacts: {
          create: (Array.isArray(contacts) ? contacts : []).map((c) => ({
            nombre: c?.nombre || "",
            parentesco: c?.parentesco || null,
            telefono: c?.telefono || null,
            email: c?.email || null,
            prioridad: Number(c?.prioridad || 1),
          })),
        },
        ...(companion &&
        (companion.nombre || companion.telefono || companion.email || companion.direccion)
          ? {
              companion: {
                create: {
                  nombre: companion.nombre || null,
                  telefono: companion.telefono || null,
                  email: companion.email || null,
                  direccion: companion.direccion || null,
                },
              },
            }
          : {}),
      },
      include: { allergies: true, contacts: true, companion: true },
    });

    res.status(201).json(patient);
  } catch (e) {
    console.error("[ADMIN] create patient error:", e);
    res.status(500).json({ error: "No se pudo crear el paciente" });
  }
});

/**
 * Elimina un paciente y sus dependencias (solo ADMIN)
 * DELETE /api/admin/patients/:id
 */
router.delete("/patients/:id", authRequired, adminOnly, async (req, res) => {
  const patientId = Number(req.params.id);
  if (!patientId) return res.status(400).json({ error: "id inválido" });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.allergy.deleteMany({ where: { patientId } });
      await tx.contact.deleteMany({ where: { patientId } });
      await tx.sosEvent.deleteMany({ where: { patientId } });
      await tx.emergencyContact.deleteMany({ where: { patientId } });
      await tx.alert.deleteMany({ where: { patientId } });
      await tx.track.deleteMany({ where: { patientId } });
      await tx.companion.deleteMany({ where: { patientId } });
      await tx.device.updateMany({ where: { patientId }, data: { patientId: null } });
      await tx.patient.delete({ where: { id: patientId } });
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("[ADMIN] delete patient error:", e);
    res.status(500).json({ error: "No se pudo eliminar el paciente" });
  }
});

/**
 * Eliminar DISPOSITIVO por UUID (solo ADMIN)
 * DELETE /api/admin/devices/:id
 * Nota: Device.id es STRING (UUID). NO parsear a número.
 */
router.delete("/devices/:id", authRequired, adminOnly, async (req, res) => {
  const { id } = req.params; // UUID string
  if (!id) return res.status(400).json({ error: "id requerido" });

  try {
    await prisma.device.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e) {
    // si no existe o ya fue borrado
    console.error("[ADMIN] delete device:", e?.message || e);
    return res.status(404).json({ error: "Dispositivo no encontrado" });
  }
});

/* ============================================================
 * Eliminar USUARIO por email (borra pacientes y desasocia devices)
 * Acepta DELETE y POST (fallback para proxies que bloquean DELETE).
 * Paths:
 *   - DELETE /api/admin/users/by-email
 *   - POST   /api/admin/users/by-email
 *   - POST   /api/admin/users/delete-by-email
 * ============================================================ */
async function deleteUserByEmailHandler(req, res) {
  try {
    let { email } = req.body || {};
    email = String(email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "email requerido" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    await prisma.$transaction(async (tx) => {
      const patients = await tx.patient.findMany({
        where: { ownerId: user.id },
        select: { id: true },
      });

      for (const { id: patientId } of patients) {
        await tx.allergy.deleteMany({ where: { patientId } });
        await tx.contact.deleteMany({ where: { patientId } });
        await tx.sosEvent.deleteMany({ where: { patientId } });
        await tx.emergencyContact.deleteMany({ where: { patientId } });
        await tx.alert.deleteMany({ where: { patientId } });
        await tx.track.deleteMany({ where: { patientId } });
        await tx.companion.deleteMany({ where: { patientId } });
        await tx.device.updateMany({ where: { patientId }, data: { patientId: null } });
        await tx.patient.delete({ where: { id: patientId } });
      }

      await tx.user.delete({ where: { id: user.id } });
    });

    res.json({ ok: true, deletedUserEmail: email });
  } catch (e) {
    console.error("[ADMIN] delete user by email error:", e);
    res.status(500).json({ error: "No se pudo eliminar el usuario" });
  }
}

router.delete("/users/by-email", authRequired, adminOnly, deleteUserByEmailHandler);
router.post("/users/by-email", authRequired, adminOnly, deleteUserByEmailHandler);
router.post("/users/delete-by-email", authRequired, adminOnly, deleteUserByEmailHandler);

module.exports = { adminRouter: router };
