import express from 'express';
import { config } from './config';
import { requireBearerAuth } from './auth';
import { runAgentLoop } from './agentLoop';
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

app.listen(config.port, () => {
  console.log(`molaria-agent-service escuchando en :${config.port}`);
});
