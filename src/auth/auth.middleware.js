// src/auth/auth.middleware.js
const jwt = require("jsonwebtoken");
const { prisma } = require("../db/client");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// --- AUTH de usuario (ya lo tenías) ---
function authRequired(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // payload típico: { sub: userId, role, ... , aud?: "user" }
    if (payload.aud && payload.aud !== "user") {
      return res.status(403).json({ error: "Invalid audience" });
    }
    req.user = payload; // { sub, role, ... }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "No token" });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admins only" });
  next();
}

// --- AUTH de dispositivo (NUEVA VERSIÓN CON X-Device-Key) ---
async function deviceAuthRequired(req, res, next) {
  try {
    // Permitimos leer desde header o query
    const key =
      req.header("X-Device-Key") ||
      req.header("x-device-key") ||
      req.query.deviceKey;

    if (!key) {
      return res.status(401).json({ ok: false, error: "missing_device_key" });
    }

    const device = await prisma.device.findFirst({
      where: { apiKey: key },
    });

    if (!device) {
      return res.status(401).json({ ok: false, error: "invalid_device_key" });
    }

    // Guardamos info del dispositivo en req
    req.device = {
      deviceId: device.id,
      patientId: device.patientId,
    };

    return next();
  } catch (e) {
    console.error("[deviceAuthRequired] error:", e);
    return res.status(500).json({ ok: false, error: "device_auth_error" });
  }
}

// --- Helpers para firmar tokens JWT (USUARIOS + DISPOSITIVOS) ---
function signUserToken({ userId, role = "USER", expiresIn = "30d" }) {
  return jwt.sign({ aud: "user", role }, JWT_SECRET, {
    subject: String(userId),
    expiresIn,
  });
}

function signDeviceToken({ deviceId, patientId, expiresIn = "180d" }) {
  return jwt.sign(
    { aud: "device", patientId: patientId ? String(patientId) : undefined },
    JWT_SECRET,
    {
      subject: String(deviceId),
      expiresIn,
    }
  );
}

module.exports = {
  authRequired,
  adminOnly,
  deviceAuthRequired,
  signUserToken,
  signDeviceToken,
};
