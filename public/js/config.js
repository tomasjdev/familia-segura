// public/js/config.js

// Si la página se abre en localhost → usa backend local.
// Si se abre en cualquier otro dominio → usa backend en Render.
const API_URL =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://familia-segura.onrender.com";
