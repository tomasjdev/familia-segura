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

// WhatsApp (CommonJS)
const whatsappRoutes = require("./routes/whatsapp.routes");

// ⚠️ A partir de aquí recién puedes usar `app`
const app = express();

app.set("trust proxy", true);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const CORS_ORIGIN = process.env.CORS_ORIGIN || true;
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

// === Montaje de rutas API ===
app.use("/api", sosRoutes); // /api/sos/device
app.use("/api/auth", authRouter);
app.use("/api/patients", patientsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/devices", devicesRouter);
app.use("/api/tracks", tracksRouter);
app.use("/api/admin", adminRouter);
app.use("/api", whatsappRoutes);
app.use("/api", shortcutRoutes);

// 👉 Monta aquí la ruta de pruebas
app.use("/api", require("./routes/test.routes"));

app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
