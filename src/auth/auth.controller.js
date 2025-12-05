// src/auth/auth.controller.js
const { Router } = require("express");
const { prisma } = require("../db/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;

/* -------- Helpers -------- */
function pickRole(body, userRoleFromDb) {
  // Acepta varios nombres de campo y normaliza
  let r =
    body?.rolSeleccionado ??
    body?.role ??
    body?.rol ??
    body?.roleSelected ??
    "";

  r = String(r || "").trim().toUpperCase();
  if (r !== "ADMIN" && r !== "USER") {
    // si no viene rol válido, usa el del usuario en DB
    r = String(userRoleFromDb || "").toUpperCase();
  }
  return r === "ADMIN" ? "ADMIN" : "USER";
}

/* -------- Register -------- */
router.post("/register", async (req, res) => {
  try {
    const { email, password, role, sosEnabled } = req.body || {};
    const emailNorm = String(email || "").trim().toLowerCase();

    if (!emailNorm || !password) {
      return res.status(400).json({ error: "email & password required" });
    }
    const exists = await prisma.user.findUnique({ where: { email: emailNorm } });
    if (exists) return res.status(409).json({ error: "Email ya registrado" });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: emailNorm,
        password: hash,
        role: String(role || "USER").toUpperCase() === "ADMIN" ? "ADMIN" : "USER",
        sosEnabled: !!sosEnabled
      },
    });

    res.json({ id: user.id, email: user.email, role: user.role, sosEnabled: user.sosEnabled });
  } catch (e) {
    console.error("[AUTH] register error:", e);
    res.status(500).json({ error: "server error" });
  }
});

/* -------- Login -------- */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const emailNorm = String(email || "").trim().toLowerCase();

    if (!emailNorm || !password) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    const user = await prisma.user.findUnique({ where: { email: emailNorm } });
    if (!user) return res.status(401).json({ error: "Credenciales inválidas" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

    // Rol solicitado (tolerante). Si el frontend no lo manda, usamos el de DB.
    const incomingRole = pickRole(req.body, user.role);

    // Solo rechazamos si explícitamente pidió un rol distinto al de su cuenta
    if (incomingRole && incomingRole !== user.role) {
      return res.status(403).json({ error: "Rol no autorizado para esta cuenta" });
    }

    const payload = {
      sub: user.id,              // <- clave: usado en el resto de controladores
      userId: user.id,           // compat para código que lea userId
      role: user.role,
      sosEnabled: user.sosEnabled,
      email: user.email,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, role: user.role, sosEnabled: user.sosEnabled });
  } catch (e) {
    console.error("[AUTH] login error:", e);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = { authRouter: router };
