import { getRedisClient } from './redis';
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

export async function getCachedAgentRun(wamid: string): Promise<AgentRunSuccess | null> {
  const c = getRedisClient();
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
  const c = getRedisClient();
  if (!c) return;
  try {
    await c.set(PREFIJO + wamid, JSON.stringify(resultado), { EX: TTL_SEGUNDOS });
  } catch (err) {
    console.error('Redis (cache idempotencia) fallo en escritura:', err);
  }
}
