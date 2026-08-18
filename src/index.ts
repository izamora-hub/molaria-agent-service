import express from 'express';
import { config } from './config';
import { requireBearerAuth } from './auth';
import { runAgentLoop } from './agentLoop';
import { adquirirLockConversacion, liberarLockConversacion } from './clients/conversationLock';
import { verificarFirmaWhatsapp } from './verificarFirma';
import { query, queryOneRetry } from './clients/db';
import { rateLimitExcedido } from './clients/rateLimit';
import { enviarTelegram } from './clients/telegram';
import { validarAlta } from './altaValidation';
import { panelAuthRoutes } from './panelAuthRoutes';
import { AgentRunRequest, AltaPayload } from './types';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/panel/auth', panelAuthRoutes);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/agent/run', requireBearerAuth, async (req, res) => {
  const body = req.body as Partial<AgentRunRequest>;

  const camposRequeridos: (keyof AgentRunRequest)[] = [
    'conv_id',
    'phone_number_id',
    'wa_id',
    'wamid',
    'cliente_nombre',
    'system_estatico',
    'system_dinamico',
    'messages',
  ];
  const faltante = camposRequeridos.find((campo) => body[campo] === undefined);
  if (faltante) {
    res.status(400).json({ error: { codigo: 'payload_invalido', mensaje: `Falta el campo ${faltante}` } });
    return;
  }

  try {
    const resultado = await runAgentLoop(body as AgentRunRequest);
    res.json(resultado);
  } catch (err) {
    console.error('Error en runAgentLoop:', err);
    res.status(502).json({
      error: {
        codigo: 'fallo_agente',
        mensaje: err instanceof Error ? err.message : 'Error desconocido',
      },
    });
  }
});

// Lock de conversacion (C-02 auditoria): n8n orquesta cuando adquirir/liberar
// dentro de su pipeline, pero la coordinacion real (SET NX con token, DEL
// condicionado) vive aqui - ver clients/conversationLock.ts.
app.post('/lock/acquire', requireBearerAuth, async (req, res) => {
  const convId = (req.body as { conv_id?: string }).conv_id;
  if (!convId) {
    res.status(400).json({ error: { codigo: 'payload_invalido', mensaje: 'Falta el campo conv_id' } });
    return;
  }
  const token = await adquirirLockConversacion(convId);
  res.json({ acquired: token !== null, token });
});

// Verificacion de firma del webhook de WhatsApp (A-04 auditoria): n8n manda
// el body crudo en base64 + el header X-Hub-Signature-256, aqui se calcula
// el HMAC contra el secreto (env var, nunca en un log de n8n) - ver
// verificarFirma.ts.
app.post('/verify-signature', requireBearerAuth, async (req, res) => {
  const body = req.body as { bodyBase64?: string; signature?: string | null };
  if (!body.bodyBase64) {
    res.status(400).json({ error: { codigo: 'payload_invalido', mensaje: 'Falta el campo bodyBase64' } });
    return;
  }
  const valid = verificarFirmaWhatsapp(body.bodyBase64, body.signature);
  res.json({ valid });
});

app.post('/lock/release', requireBearerAuth, async (req, res) => {
  const body = req.body as { conv_id?: string; token?: string };
  if (!body.conv_id || !body.token) {
    res.status(400).json({ error: { codigo: 'payload_invalido', mensaje: 'Falta conv_id o token' } });
    return;
  }
  await liberarLockConversacion(body.conv_id, body.token);
  res.json({ ok: true });
});

// Alta/configuracion de clinica: recibe el payload del formulario estatico
// servido desde Cloudflare (molaria.app), sin login/token de sesion propios -
// solo el token de un solo uso de tokens_alta. Deliberadamente NO escribe en
// clientes/tipos_cita: el alta se aplica despues a mano, revisando
// altas_pendientes. Sin auth Bearer (requireBearerAuth es para llamadas
// n8n->este servicio, no para un formulario publico) - la proteccion aqui es
// CORS + honeypot + rate limit + token de un solo uso.
const ALTA_ORIGEN_PERMITIDO = 'https://molaria.app';

function aplicarCorsAlta(req: express.Request, res: express.Response): void {
  const origin = req.header('origin');
  if (origin !== ALTA_ORIGEN_PERMITIDO) return;
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
}

app.options('/alta', (req, res) => {
  aplicarCorsAlta(req, res);
  res.sendStatus(204);
});

app.post('/alta', async (req, res) => {
  aplicarCorsAlta(req, res);

  const ip = (req.header('x-forwarded-for') || req.socket.remoteAddress || 'desconocida').split(',')[0].trim();
  if (await rateLimitExcedido(`alta_rl:${ip}`, 5, 3600)) {
    res.status(429).json({ error: { codigo: 'rate_limit', mensaje: 'Demasiadas solicitudes, intentalo mas tarde' } });
    return;
  }

  const body = req.body as Partial<AltaPayload>;

  // Honeypot: campo oculto que un humano nunca rellena. Se responde 200 sin
  // guardar nada y sin distinguir el motivo, para no delatar el honeypot.
  if (body.website) {
    res.json({ ok: true });
    return;
  }

  if (typeof body.token !== 'string' || !body.token) {
    res.status(400).json({ error: { codigo: 'payload_invalido', mensaje: 'Falta el campo token' } });
    return;
  }

  const tokenRow = await queryOneRetry<{ id: string; cliente_id: string | null; expira_en: string; usado_en: string | null }>(
    'SELECT id, cliente_id, expira_en, usado_en FROM tokens_alta WHERE token = $1',
    [body.token]
  );
  if (!tokenRow) {
    res.status(403).json({ error: { codigo: 'token_invalido', mensaje: 'Token no reconocido' } });
    return;
  }
  if (tokenRow.usado_en) {
    res.status(403).json({ error: { codigo: 'token_usado', mensaje: 'Este token ya se utilizo' } });
    return;
  }
  if (new Date(tokenRow.expira_en).getTime() < Date.now()) {
    res.status(403).json({ error: { codigo: 'token_caducado', mensaje: 'Este token ha caducado' } });
    return;
  }

  const errorValidacion = validarAlta(body as Record<string, unknown>);
  if (errorValidacion) {
    res.status(400).json({ error: { codigo: 'payload_invalido', mensaje: errorValidacion } });
    return;
  }

  await query('INSERT INTO altas_pendientes (token, cliente_id, payload) VALUES ($1, $2, $3)', [
    body.token,
    tokenRow.cliente_id,
    JSON.stringify(body),
  ]);

  // Best-effort, no debe invalidar un alta ya guardada si falla.
  try {
    await query('UPDATE tokens_alta SET usado_en = now() WHERE id = $1', [tokenRow.id]);
  } catch (err) {
    console.error('Fallo marcando tokens_alta.usado_en (alta ya guardada de todas formas):', err);
  }

  // Guarda primero, avisa despues (requisito 6): un fallo de Telegram
  // (enviarTelegram ya es best-effort en si misma) nunca debe tumbar la
  // respuesta 200 al formulario.
  const revisionAviso = body.requiere_revision ? '\n⚠️ Hay FAQs marcadas para revision manual.' : '';
  await enviarTelegram(
    `📋 Nueva alta de clinica: ${body.clinica?.nombre}\n` +
      `Servicios: ${(body.servicios ?? []).length} · Tipos de cita: ${(body.tipos_cita ?? []).length}` +
      revisionAviso
  );

  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log(`molaria-agent-service escuchando en :${config.port}`);
});
