import express from 'express';
import { config } from './config';
import { requireBearerAuth } from './auth';
import { runAgentLoop } from './agentLoop';
import { adquirirLockConversacion, liberarLockConversacion } from './clients/conversationLock';
import { verificarFirmaWhatsapp } from './verificarFirma';
import { AgentRunRequest } from './types';

const app = express();
app.use(express.json({ limit: '2mb' }));

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

app.listen(config.port, () => {
  console.log(`molaria-agent-service escuchando en :${config.port}`);
});
