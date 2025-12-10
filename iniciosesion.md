<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Familia Segura - Iniciar sesión</title>

  <!-- Tailwind (CDN) -->
  <script src="https://cdn.tailwindcss.com"></script>

  <style>
    body {
      min-height: 100vh;
      margin: 0;
      background: radial-gradient(1200px 600px at 10% 10%, #e0edff 0%, transparent 60%),
                  radial-gradient(1000px 600px at 90% 20%, #fce9f1 0%, transparent 60%),
                  radial-gradient(900px 600px at 50% 100%, #e8fff3 0%, transparent 60%),
                  #f7fafc;
    }
    .blob { position: absolute; border-radius: 9999px; filter: blur(60px); opacity: .55; pointer-events: none; transform: translateZ(0); }
    .blob-1 { width: 32rem; height: 32rem; background: #a3c4ff; top: -8rem; left: -6rem; }
    .blob-2 { width: 28rem; height: 28rem; background: #ffd1e1; top: -6rem; right: -4rem; }
    .blob-3 { width: 36rem; height: 36rem; background: #b8ffd3; bottom: -10rem; left: 10%; }
    @media (max-width: 640px) { .blob { filter: blur(45px); } .blob-1 { width: 22rem; height: 22rem; } .blob-2 { width: 18rem; height: 18rem; } .blob-3 { width: 24rem; height: 24rem; } }
    .glass { background: rgba(255,255,255,.7); backdrop-filter: saturate(150%) blur(8px); -webkit-backdrop-filter: saturate(150%) blur(8px); border: 1px solid rgba(255,255,255,.6); border-radius: .95rem; box-shadow: 0 10px 25px -10px rgba(16, 24, 40, .25), inset 0 1px 0 rgba(255,255,255,.6); }
    .field { border:1px solid #e5e7eb; border-radius:.5rem; padding:.625rem .875rem; width:100%; background: #fff; }
    .field:focus { outline: none; box-shadow: 0 0 0 3px rgba(59,130,246,.15); border-color:#93c5fd; }
    .radio-card { display:flex; align-items:center; gap:.5rem; padding:.75rem 1rem; border:1px solid #e5e7eb; border-radius:.65rem; cursor:pointer; transition: background .2s, border-color .2s, box-shadow .2s, transform .15s; background:#fff; }
    .radio-card:hover { border-color:#cbd5e1; transform: translateY(-1px); }
    .radio-card[data-active="true"] { border-color:#3b82f6; background: #f5f8ff; box-shadow: 0 0 0 2px rgba(59,130,246,.15); }
    .btn-primary { --c:#2563eb; width:100%; padding:.75rem 1rem; border-radius:.65rem; color:#fff; font-weight:600; background: linear-gradient(180deg, #3b82f6, #2563eb); box-shadow: 0 8px 16px -8px rgba(37,99,235,.45); transition: transform .05s ease, box-shadow .2s ease, filter .2s ease; }
    .btn-primary:hover { filter: brightness(1.03); box-shadow: 0 12px 22px -10px rgba(37,99,235,.55); }
    .btn-primary:active { transform: translateY(1px); }
  </style>
</head>
<body class="relative flex items-center justify-center p-4">

  <div class="blob blob-1"></div>
  <div class="blob blob-2"></div>
  <div class="blob blob-3"></div>

  <main class="w-full max-w-md">
    <div class="glass p-6 sm:p-8">
      <div class="flex items-center justify-center gap-3 mb-6">
        <img src="img/logoiniciosesion.png" alt="Familia Segura" class="h-10 w-10 drop-shadow">
        <h1 class="text-2xl font-semibold text-gray-900">Familia Segura</h1>
      </div>

      <h2 class="text-lg font-medium text-gray-900 mb-1">Iniciar sesión</h2>
      <p class="text-sm text-gray-500 mb-6">Ingresa tus credenciales para continuar.</p>

      <form id="loginForm" class="space-y-5">
        <div>
          <label for="email" class="block text-sm font-medium text-gray-700">Correo electrónico</label>
          <input id="email" type="email" class="mt-1 field" placeholder="ej: nombre@correo.com" required>
        </div>

        <div>
          <label for="password" class="block text-sm font-medium text-gray-700">Contraseña</label>
          <div class="relative">
            <input id="password" type="password" class="mt-1 field pr-12" placeholder="••••••••" required>
            <button type="button" id="togglePwd" class="absolute inset-y-0 right-0 px-3 text-sm text-gray-500 hover:text-gray-700">
              Mostrar
            </button>
          </div>
        </div>



        <label class="flex items-center gap-2 text-sm text-gray-600">
          <input id="remember" type="checkbox" class="h-4 w-4 rounded border-gray-300">
          Recordarme en este dispositivo
        </label>

        <button class="btn-primary">Entrar</button>
        <p id="loginMsg" class="text-xs text-center text-gray-400 mt-2"></p>
      </form>

      <p class="mt-6 text-center text-xs text-gray-500">
        Si no tienes cuenta, pídele a un administrador que te registre.
      </p>
    </div>
  </main>

  <script>
    function refreshRoleCards() {
      const isAdmin = document.getElementById('roleAdmin').checked;
      document.getElementById('optAdminCard').dataset.active = isAdmin ? 'true' : 'false';
      document.getElementById('optUserCard').dataset.active  = !isAdmin ? 'true' : 'false';
      document.getElementById('dotAdmin').style.background   = isAdmin ? '#3b82f6' : 'transparent';
      document.getElementById('dotUser').style.background    = !isAdmin ? '#3b82f6' : 'transparent';
    }
    document.getElementById('roleAdmin').addEventListener('change', refreshRoleCards);
    document.getElementById('roleUser').addEventListener('change', refreshRoleCards);
    refreshRoleCards();

    document.getElementById('togglePwd').addEventListener('click', () => {
      const pwd = document.getElementById('password');
      const showing = pwd.type === 'text';
      pwd.type = showing ? 'password' : 'text';
      document.getElementById('togglePwd').textContent = showing ? 'Mostrar' : 'Ocultar';
    });
  </script>

  <!-- Lógica de login real -->
  <script defer src="/js/auth.js"></script>
  <script src="js/config.js"></script>
</body>
</html>
