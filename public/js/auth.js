// public/js/auth.js
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("loginForm") || document.querySelector("form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value.trim().toLowerCase();
    const password = document.getElementById("password").value;
    const roleUi = document.querySelector('input[name="role"]:checked')?.value || "user";
    const desiredRole = roleUi.toUpperCase(); // "ADMIN" o "USER"
    const remember = document.getElementById("remember")?.checked ?? true;

    const statusP = form.querySelector("p.text-xs.text-center") || form.querySelector("#loginMsg");
    if (statusP) statusP.textContent = "Verificando credenciales…";

    try {
      // Enviamos solo email y password (el rol lo determina el backend)
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (statusP) statusP.textContent = data?.error || "Error al iniciar sesión";
        return;
      }

      const token = data.token;
      const realRole = (data.role || "USER").toUpperCase();
      const sosEnabled = data.sosEnabled ? "1" : "0";

      if (!token) {
        if (statusP) statusP.textContent = "Respuesta inválida del servidor";
        return;
      }

      // Guardar credenciales (para remember y guard)
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem("token", token);
      storage.setItem("role", realRole);
      storage.setItem("sosEnabled", sosEnabled);

      // También reflejamos en localStorage para el resto del sitio
      localStorage.setItem("token", token);
      localStorage.setItem("role", realRole);
      localStorage.setItem("sosEnabled", sosEnabled);

      // Mostrar estado
      if (statusP) statusP.textContent = "Acceso concedido. Redirigiendo…";

      // Redirigir según el rol real del backend
      if (realRole === "ADMIN") {
        if (desiredRole !== "ADMIN")
          console.warn("Ingresó como usuario, pero su cuenta es ADMIN → redirigiendo a panel admin.");
        window.location.href = "/inicio.html#panel";
      } else {
        if (desiredRole !== "USER")
          console.warn("Ingresó como admin, pero su cuenta es USER → redirigiendo a panel usuario.");
        window.location.href = "/usuario.html#inicio";
      }
    } catch (err) {
      console.error("Error de conexión:", err);
      if (statusP) statusP.textContent = "No se pudo conectar con el servidor";
    }
  });
});
