// Pagina unica del panel (1-06): un shell HTML + JS vanilla, mismo patron
// minimalista que la pagina de /panel/auth/verificar en panelAuthRoutes.ts -
// no hay build step ni framework de frontend en este servicio (ver package.json),
// asi que server-rendered + fetch es la opcion consistente, no una simplificacion
// de emergencia.
export const panelPageHtml = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panel MolarIA</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; background: #f7f7f8; color: #1a1a1a; }
  header { padding: 16px 20px; background: #fff; border-bottom: 1px solid #e5e5e5; display: flex; align-items: center; justify-content: space-between; }
  header h1 { font-size: 16px; margin: 0; }
  main { max-width: 720px; margin: 0 auto; padding: 16px; }
  #login { max-width: 360px; margin: 80px auto; padding: 24px; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  #login input { width: 100%; box-sizing: border-box; padding: 10px; margin: 8px 0; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }
  button { padding: 10px 16px; border: none; border-radius: 6px; background: #1a1a1a; color: #fff; font-size: 14px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  #buscador { width: 100%; box-sizing: border-box; padding: 10px; margin-bottom: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }
  .conv { background: #fff; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  .conv .tel { font-weight: 600; font-size: 14px; }
  .conv .fecha { font-size: 12px; color: #888; float: right; }
  .conv .snippet { font-size: 13px; color: #555; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #detalle { background: #fff; border-radius: 8px; padding: 16px; }
  #detalle .msg { margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; max-width: 80%; font-size: 14px; white-space: pre-wrap; }
  #detalle .msg.user { background: #eef2ff; }
  #detalle .msg.assistant { background: #f0f0f0; margin-left: auto; }
  #volver { background: none; color: #555; padding: 4px 0; margin-bottom: 12px; }
  .vacio { color: #888; text-align: center; padding: 40px 0; }
  .error { color: #b00020; font-size: 13px; margin-top: 8px; }
</style>
</head>
<body>
<header><h1>Panel MolarIA</h1><button id="salir" style="display:none">Salir</button></header>
<main>
  <div id="login">
    <p>Introduce tu email para recibir un enlace de acceso.</p>
    <input id="email" type="email" placeholder="tu@clinica.com" autocomplete="email">
    <button id="pedir">Enviar enlace</button>
    <p id="loginMsg"></p>
  </div>
  <div id="app" style="display:none">
    <input id="buscador" type="text" placeholder="Buscar por telefono...">
    <div id="lista"></div>
    <div id="detalle" style="display:none">
      <button id="volver">&larr; Volver</button>
      <div id="detalleContenido"></div>
    </div>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);

async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

function fmtFecha(iso) {
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function comprobarSesion() {
  const { status } = await api('/panel/auth/whoami');
  if (status === 200) {
    $('login').style.display = 'none';
    $('app').style.display = 'block';
    $('salir').style.display = 'inline-block';
    cargarLista();
  } else {
    $('login').style.display = 'block';
    $('app').style.display = 'none';
    $('salir').style.display = 'none';
  }
}

$('pedir').addEventListener('click', async () => {
  const email = $('email').value.trim();
  if (!email) return;
  $('pedir').disabled = true;
  await api('/panel/auth/solicitar', { method: 'POST', body: JSON.stringify({ email }) });
  $('loginMsg').textContent = 'Si el email esta registrado, te llegara un enlace en unos minutos.';
});

$('salir').addEventListener('click', async () => {
  await api('/panel/auth/salir', { method: 'POST' });
  location.reload();
});

let listaCache = [];

async function cargarLista(q) {
  $('lista').innerHTML = 'Cargando...';
  const { body } = await api('/panel/api/conversaciones' + (q ? '?q=' + encodeURIComponent(q) : ''));
  listaCache = body.conversaciones || [];
  if (!listaCache.length) {
    $('lista').innerHTML = '<div class="vacio">Sin conversaciones</div>';
    return;
  }
  $('lista').innerHTML = listaCache.map((c) =>
    '<div class="conv" data-id="' + c.id + '">' +
      '<span class="fecha">' + fmtFecha(c.ultima_actividad) + '</span>' +
      '<div class="tel">' + c.telefono_enmascarado + '</div>' +
      '<div class="snippet">' + (c.ultimo_mensaje || '').replace(/</g, '&lt;') + '</div>' +
    '</div>'
  ).join('');
  document.querySelectorAll('.conv').forEach((el) => {
    el.addEventListener('click', () => abrirDetalle(el.dataset.id));
  });
}

let debounceTimer;
$('buscador').addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => cargarLista($('buscador').value), 300);
});

async function abrirDetalle(id) {
  $('lista').parentElement.querySelector('#buscador').style.display = 'none';
  $('lista').style.display = 'none';
  $('detalle').style.display = 'block';
  $('detalleContenido').innerHTML = 'Cargando...';
  const { status, body } = await api('/panel/api/conversaciones/' + id);
  if (status !== 200) {
    $('detalleContenido').innerHTML = '<div class="error">No se pudo cargar la conversacion.</div>';
    return;
  }
  $('detalleContenido').innerHTML =
    '<p><strong>' + body.telefono_enmascarado + '</strong> &middot; ' + fmtFecha(body.ultima_actividad) + '</p>' +
    body.mensajes.map((m) =>
      '<div class="msg ' + m.role + '">' + m.texto.replace(/</g, '&lt;') + '</div>'
    ).join('');
}

$('volver').addEventListener('click', () => {
  $('detalle').style.display = 'none';
  $('lista').style.display = 'block';
  document.getElementById('buscador').style.display = 'block';
});

comprobarSesion();
</script>
</body>
</html>`;
