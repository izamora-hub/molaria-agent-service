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
  /* Paleta de marca real, extraida del PDF de informe semanal
     (workflows/workflow-molaria-informe.json) - no inventada para esta pantalla. */
  :root {
    color-scheme: light;
    --ink: #10302C;      /* texto principal / titulos */
    --brand: #2E635E;    /* acentos, lineas, bordes */
    --accent: #17A092;   /* highlights, acciones, numeros */
    --body-text: #48635F;/* texto secundario */
    --mint: #E6F7F2;     /* fondo de marca */
  }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; background: var(--mint); color: var(--ink); }
  header { padding: 16px 24px; background: #fff; border-bottom: 1px solid #d5ebe4; display: flex; align-items: center; justify-content: space-between; }
  .marca { display: flex; align-items: center; gap: 10px; }
  .marca .icono { width: 30px; height: 30px; border-radius: 8px; background: var(--ink); color: var(--mint); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
  .marca .wordmark { font-size: 17px; font-weight: 700; letter-spacing: -.2px; }
  .marca .wordmark .ia { color: var(--accent); }
  main { max-width: 720px; margin: 0 auto; padding: 20px 16px; }
  #login { max-width: 360px; margin: 80px auto; padding: 28px; background: #fff; border-radius: 10px; box-shadow: 0 2px 10px rgba(16,48,44,.08); }
  #login p { color: var(--body-text); font-size: 14px; }
  #login input { width: 100%; box-sizing: border-box; padding: 10px; margin: 8px 0; border: 1px solid #cfe4dd; border-radius: 6px; font-size: 14px; }
  button { padding: 10px 16px; border: none; border-radius: 6px; background: var(--accent); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  #salir { background: none; color: var(--body-text); font-weight: 400; border: 1px solid #cfe4dd; }
  #buscador { width: 100%; box-sizing: border-box; padding: 10px; margin-bottom: 12px; border: 1px solid #cfe4dd; border-radius: 6px; font-size: 14px; }
  .conv { background: #fff; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; cursor: pointer; box-shadow: 0 1px 2px rgba(16,48,44,.05); border: 1px solid #e4f2ed; }
  .conv .tel { font-weight: 600; font-size: 14px; color: var(--ink); }
  .conv .fecha { font-size: 12px; color: var(--body-text); float: right; }
  .conv .snippet { font-size: 13px; color: var(--body-text); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #detalle { background: #fff; border-radius: 8px; padding: 16px; border: 1px solid #e4f2ed; }
  #detalle .msg { margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; max-width: 80%; font-size: 14px; white-space: pre-wrap; }
  #detalle .msg.user { background: var(--mint); }
  #detalle .msg.assistant { background: #f1f1ef; margin-left: auto; }
  #volver { background: none; color: var(--body-text); padding: 4px 0; margin-bottom: 12px; }
  .vacio { color: var(--body-text); text-align: center; padding: 40px 0; }
  .error { color: #b00020; font-size: 13px; margin-top: 8px; }
  #tabs { display: flex; gap: 8px; margin-bottom: 16px; }
  #tabs button { background: none; color: var(--body-text); border: 1px solid #cfe4dd; font-weight: 500; }
  #tabs button.active { background: var(--ink); color: #fff; border-color: var(--ink); }
  #rango { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
  #rango input[type=date] { padding: 8px; border: 1px solid #cfe4dd; border-radius: 6px; font-size: 13px; }
  #stats { display: flex; gap: 12px; }
  .stat { flex: 1; background: #fff; border-radius: 8px; padding: 20px; text-align: center; border: 1px solid #e4f2ed; }
  .stat .num { font-size: 32px; font-weight: 700; color: var(--accent); }
  .stat .label { font-size: 13px; color: var(--body-text); margin-top: 4px; }
</style>
</head>
<body>
<header>
  <div class="marca"><div class="icono">M</div><div class="wordmark">Molar<span class="ia">IA</span></div></div>
  <button id="salir" style="display:none">Salir</button>
</header>
<main>
  <div id="login">
    <p>Introduce tu email para recibir un enlace de acceso.</p>
    <input id="email" type="email" placeholder="tu@clinica.com" autocomplete="email">
    <button id="pedir">Enviar enlace</button>
    <p id="loginMsg"></p>
  </div>
  <div id="app" style="display:none">
    <div id="tabs">
      <button id="tabMetricas" class="active">Métricas</button>
      <button id="tabConversaciones">Conversaciones</button>
    </div>
    <div id="vistaMetricas">
      <div id="rango">
        <input type="date" id="desde">
        <span>&ndash;</span>
        <input type="date" id="hasta">
        <button id="verMetricas">Ver</button>
      </div>
      <div id="stats">
        <div class="stat"><div class="num" id="numConversaciones">&ndash;</div><div class="label">Conversaciones atendidas</div></div>
        <div class="stat"><div class="num" id="numCitas">&ndash;</div><div class="label">Citas creadas</div></div>
        <div class="stat"><div class="num" id="numReagendadas">&ndash;</div><div class="label">Citas reagendadas</div></div>
      </div>
    </div>
    <div id="vistaConversaciones" style="display:none">
      <input id="buscador" type="text" placeholder="Buscar por teléfono...">
      <div id="lista"></div>
      <div id="detalle" style="display:none">
        <button id="volver">&larr; Volver</button>
        <div id="detalleContenido"></div>
      </div>
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
    const hoy = new Date().toISOString().slice(0, 10);
    const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    $('desde').value = hace30;
    $('hasta').value = hoy;
    cargarMetricas();
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

$('tabMetricas').addEventListener('click', () => {
  $('tabMetricas').classList.add('active');
  $('tabConversaciones').classList.remove('active');
  $('vistaMetricas').style.display = 'block';
  $('vistaConversaciones').style.display = 'none';
});

$('tabConversaciones').addEventListener('click', () => {
  $('tabConversaciones').classList.add('active');
  $('tabMetricas').classList.remove('active');
  $('vistaConversaciones').style.display = 'block';
  $('vistaMetricas').style.display = 'none';
  if (!listaCache.length) cargarLista();
});

async function cargarMetricas() {
  const desde = $('desde').value;
  const hasta = $('hasta').value;
  const { status, body } = await api('/panel/api/metricas?desde=' + desde + '&hasta=' + hasta);
  if (status !== 200) return;
  $('numConversaciones').textContent = body.conversaciones_atendidas;
  $('numCitas').textContent = body.citas_creadas;
  $('numReagendadas').textContent = body.citas_reagendadas;
}

$('verMetricas').addEventListener('click', cargarMetricas);

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
    $('detalleContenido').innerHTML = '<div class="error">No se pudo cargar la conversación.</div>';
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
