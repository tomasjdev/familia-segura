// src/server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");

// Routers propios
const { authRouter } = require("./auth/auth.controller");
const { patientsRouter } = require("./patients/patients.controller");
const { alertsRouter } = require("./alerts/alerts.controller");
const { devicesRouter } = require("./devices/devices.controller");
const { tracksRouter } = require("./tracks/tracks.controller");
const sosRoutes = require("./sos/sos.controller");
const { adminRouter } = require("./admin/admin.controller");
const shortcutRoutes = require("./routes/shortcut.routes");
const whatsappRoutes = require("./routes/whatsapp.routes");

const app = express();

app.set("trust proxy", true);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const CORS_ORIGIN = process.env.CORS_ORIGIN || true;
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

// === RUTAS API ===
app.use("/api", sosRoutes);
app.use("/api/auth", authRouter);
app.use("/api/patients", patientsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/devices", devicesRouter);
app.use("/api/tracks", tracksRouter);
app.use("/api/admin", adminRouter);
app.use("/api", whatsappRoutes);
app.use("/api", shortcutRoutes);
app.use("/api", require("./routes/test.routes"));

// 🌟 Ruta raíz: servir directamente el login
app.get("/", (req, res) => {
  console.log("GET / -> iniciosesion.html"); // para verificar en Render
  res.sendFile(path.join(__dirname, "..", "public", "iniciosesion.html"));
});

// Archivos estáticos (incluye index.html, usuario.html, etc.)
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
