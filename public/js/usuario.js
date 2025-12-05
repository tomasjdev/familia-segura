// public/js/usuario.js
(function () {
  const API = "";

  const token = localStorage.getItem("token");
  const role = (localStorage.getItem("role") || "").toUpperCase();
  const sosEnabled = localStorage.getItem("sosEnabled") === "1";

  // Inyecta Authorization en todos los fetch (para que /sos-web reciba JWT)
  (function patchFetch() {
    const orig = window.fetch;
    window.fetch = (input, init = {}) => {
      const headers = new Headers(init.headers || {});
      const t = localStorage.getItem("token");
      if (t) headers.set("Authorization", "Bearer " + t);
      return orig(input, { ...init, headers });
    };
  })();

  if (!token || role !== "USER") {
    if (role === "ADMIN") window.location.href = "/inicio.html";
    else window.location.href = "/iniciosesion.html";
    return;
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      localStorage.removeItem("sosEnabled");
      sessionStorage.clear();
      window.location.href = "/iniciosesion.html";
    };
  }

  // Obtener el primer patient del usuario para asociar la alerta
  let cachedDefaultPatientId = null;
  async function getDefaultPatientId() {
    if (cachedDefaultPatientId) return cachedDefaultPatientId;
    try {
      const res = await fetch(`${API}/api/patients`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        cachedDefaultPatientId = data[0]?.id || null;
        return cachedDefaultPatientId;
      }
    } catch (e) {
      console.warn("[getDefaultPatientId] no se pudo obtener:", e?.message || e);
    }
    return null;
  }

  const btnSos = document.getElementById("btnSos") || document.getElementById("sosBtn");
  const sosStatusEl = document.getElementById("sosStatus");
  const sosSection = document.getElementById("sosSection");

  function setSosStatus(msg) {
    if (sosStatusEl) sosStatusEl.textContent = msg || "";
  }

  function getPosition(timeoutMs = 6000) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
      );
    });
  }

  async function sendSosWeb() {
    if (!btnSos) return;
    const original = btnSos.textContent;
    btnSos.disabled = true;
    btnSos.textContent = "Enviando…";
    setSosStatus("Enviando SOS...");

    try {
      const pos = await getPosition();
      const fromName = document.getElementById("nombreSaludo")?.textContent?.trim() || "Usuario Web";
      const patientId = await getDefaultPatientId(); // ← clave: asociar paciente

      const body = {
        fromName,
        lat: pos?.lat,
        lng: pos?.lng,
        patientId, // se envía para que el backend lo grabe
      };

      const resp = await fetch(`${API}/api/alerts/sos-web`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const textBody = await resp.text();
      let json = {};
      try { json = JSON.parse(textBody); } catch {}

      if (!resp.ok || json?.ok !== true) {
        const msg = json?.error || `HTTP ${resp.status} ${textBody || ""}`.trim();
        throw new Error(msg);
      }

      const extra =
        json.failed && json.failed > 0
          ? ` (${json.sent} ok, ${json.failed} fallidos)`
          : ` (${json.sent} enviado${json.sent === 1 ? "" : "s"})`;

      setSosStatus(`SOS enviado${extra}.`);
      if (typeof showToast === "function") showToast("SOS enviado correctamente.", "success");
    } catch (e) {
      console.error(e);
      setSosStatus("No se pudo enviar el SOS.");
      if (typeof showToast === "function") showToast(`Error al enviar SOS: ${e.message}`, "error");
      else alert("Error al enviar SOS: " + e.message);
    } finally {
      setTimeout(() => setSosStatus(""), 5000);
      btnSos.disabled = false;
      btnSos.textContent = original;
    }
  }

  if (sosSection) sosSection.style.display = sosEnabled ? "block" : "none";
  if (btnSos) btnSos.onclick = sendSosWeb;

  // (resto de tu código de pacientes se mantiene)
})();
