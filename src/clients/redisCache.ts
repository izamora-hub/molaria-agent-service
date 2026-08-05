import { createClient, RedisClientType } from 'redis';
import { config } from '../config';
import { AgentRunSuccess } from '../types';

// Cache de idempotencia por wamid: si n8n reintenta la llamada a /agent/run
// (LlamarServicioAgente tiene retryOnFail) porque la respuesta se perdio
// DESPUES de que el turno ya se completo con exito (crear_hold/cancelar_cita/
// reprogramar_cita incluidos), sin esto el reintento repetiria el turno entero
// desde cero -> cita duplicada, cancelacion repetida, etc. Best-effort a
// proposito: si Redis no esta configurado o falla, se desactiva en silencio -
// nunca debe bloquear ni romper una respuesta real al paciente.
const TTL_SEGUNDOS = 600;
const PREFIJO = 'agent-run:';

let client: RedisClientType | null = null;
let intentado = false;

function getClient(): RedisClientType | null {
  if (!config.redis.host) return null;
  if (client) return client;
  if (intentado) return null;
  intentado = true;

  client = createClient({
    socket: { host: config.redis.host, port: config.redis.port },
    username: config.redis.username,
    password: config.redis.password,
  });
  client.on('error', (err) => console.error('Redis (cache idempotencia) error:', err));
  client.connect().catch((err) => console.error('Redis (cache idempotencia) fallo al conectar:', err));
  return client;
}

export async function getCachedAgentRun(wamid: string): Promise<AgentRunSuccess | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const raw = await c.get(PREFIJO + wamid);
    return raw ? (JSON.parse(raw) as AgentRunSuccess) : null;
  } catch (err) {
    console.error('Redis (cache idempotencia) fallo en lectura:', err);
    return null;
  }
}

export async function cacheAgentRun(wamid: string, resultado: AgentRunSuccess): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(PREFIJO + wamid, JSON.stringify(resultado), { EX: TTL_SEGUNDOS });
  } catch (err) {
    console.error('Redis (cache idempotencia) fallo en escritura:', err);
  }
}
