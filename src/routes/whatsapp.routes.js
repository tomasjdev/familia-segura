// src/routes/whatsapp.routes.js
const { Router } = require("express");
const { handleIncoming } = require("../integrations/whatsapp.twilio");

const router = Router();

// Ruta del webhook de WhatsApp (Twilio):
// Configura esta URL en el Twilio Sandbox o número Business
// → "When a message comes in" (POST)
router.post("/twilio/whatsapp", handleIncoming);

module.exports = router;
