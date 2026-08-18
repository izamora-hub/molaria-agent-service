import { Router } from 'express';
import { queryOnePanel } from './clients/dbPanel';
import { rateLimitExcedido } from './clients/rateLimit';
import { enviarEmail } from './clients/resend';
import { emitirTokenMagicLink, consumirTokenMagicLink, crearSesion, borrarSesion } from './clients/redisSession';
import { fijarCookieSesion, borrarCookieSesion, requireSesionPanel, RequestConSesion } from './panelAuth';

export const panelAuthRoutes = Router();

// panel.molaria.app (1-01 punto 4) - env var opcional solo como escape hatch,
// mismo patron que FORM_BASE_URL en scripts/generar_token_alta.ts. Requiere
// el CNAME en Cloudflare + custom domain en Railway (pendiente, ver aviso).
const PANEL_URL_BASE = process.env.PANEL_URL_BASE || 'https://panel.molaria.app';

// Pide un magic link. Nunca revela si el email existe (evita enumeracion de
// clinicas) - siempre 200, solo emite/envia si hay match real y activo.
panelAuthRoutes.post('/solicitar', async (req, res) => {
  const emailRaw = (req.body as { email?: unknown }).email;
  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
  if (!email) {
    res.status(400).json({ error: { codigo: 'payload_invalido', mensaje: 'Falta el campo email' } });
    return;
  }

  const ip = (req.header('x-forwarded-for') || req.socket.remoteAddress || 'desconocida').split(',')[0].trim();
  // Doble clave (1-01 punto 7): por IP y por email destino, para que no baste
  // con rotar IP para inundar el buzon de una clinica concreta.
  const limitadoIp = await rateLimitExcedido(`panel_auth_rl_ip:${ip}`, 5, 3600);
  const limitadoEmail = await rateLimitExcedido(`panel_auth_rl_email:${email}`, 5, 3600);
  if (limitadoIp || limitadoEmail) {
    res.status(429).json({ error: { codigo: 'rate_limit', mensaje: 'Demasiadas solicitudes, intentalo mas tarde' } });
    return;
  }

  const cliente = await queryOnePanel<{ id: string }>(
    'SELECT id FROM clientes WHERE lower(resumen_email) = $1 AND activo',
    [email]
  );
  if (cliente) {
    const token = await emitirTokenMagicLink(cliente.id);
    if (token) {
      const enlace = `${PANEL_URL_BASE}/panel/auth/verificar?token=${token}`;
      await enviarEmail({
        to: email,
        subject: 'Tu enlace de acceso a MolarIA',
        html: `<p>Entra a tu panel de MolarIA:</p><p><a href="${enlace}">${enlace}</a></p><p>Caduca en 15 minutos y solo funciona una vez.</p>`,
      });
    }
  }

  res.json({ ok: true });
});

// GET: pinta una pagina con boton, NO consume el token todavia (1-01 punto 2 -
// los prefetchers de Outlook/Gmail hacen GET antes que el humano; si el GET
// consumiera el token, el usuario real veria siempre "enlace caducado").
panelAuthRoutes.get('/verificar', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  res.type('html').send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>MolarIA</title></head>
<body>
<button id="entrar" ${token ? '' : 'disabled'}>Entrar al panel</button>
<p id="msg"></p>
<script>
document.getElementById('entrar').addEventListener('click', async () => {
  const r = await fetch('/panel/auth/verificar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: ${JSON.stringify(token)} }),
  });
  if (r.ok) { location.href = '/panel'; }
  else { document.getElementById('msg').textContent = 'Enlace no valido o caducado.'; }
});
</script>
</body></html>`);
});

// POST: consumo real (GETDEL atomico) + crea sesion + cookie.
panelAuthRoutes.post('/verificar', async (req, res) => {
  const tokenRaw = (req.body as { token?: unknown }).token;
  const token = typeof tokenRaw === 'string' ? tokenRaw : '';
  if (!token) {
    res.status(400).json({ error: { codigo: 'payload_invalido', mensaje: 'Falta el campo token' } });
    return;
  }
  const clienteId = await consumirTokenMagicLink(token);
  if (!clienteId) {
    res.status(403).json({ error: { codigo: 'token_invalido', mensaje: 'Enlace no valido o caducado' } });
    return;
  }
  const sessionId = await crearSesion(clienteId);
  fijarCookieSesion(res, sessionId);
  res.json({ ok: true });
});

panelAuthRoutes.post('/salir', requireSesionPanel, async (req: RequestConSesion, res) => {
  if (req.sessionId) await borrarSesion(req.sessionId);
  borrarCookieSesion(res);
  res.json({ ok: true });
});

// Confirma la sesion actual (para que el frontend del panel sepa si hay que
// redirigir a login) - no expone nada mas alla de lo que ya vive en la cookie.
panelAuthRoutes.get('/whoami', requireSesionPanel, async (req: RequestConSesion, res) => {
  res.json({ cliente_id: req.sesion?.cliente_id, rol: req.sesion?.rol });
});
