import { getRedisClient } from './redis';
import { AgentRunSuccess } from '../types';

// Cache de idempotencia por wamid: si n8n reintenta la llamada a /agent/run
// (LlamarServicioAgente tiene retryOnFail) porque la respuesta se perdio
// DESPUES de que el turno ya se completo con exito (crear_hold/cancelar_cita/
// reprogramar_cita incluidos), sin esto el reintento repetiria el turno entero
// desde cero -> cita duplicada, cancelacion repetida, etc. Best-effort a
// proposito: si Redis no esta configurado o falla, se desactiva en silencio -
// nunca debe bloquear ni romper una respuesta real al paciente.
//
// C-01 (auditoria): un simple check-then-set no bastaba - si n8n hace timeout
// a los 60s con el turno TODAVIA en marcha (nada cacheado aun), el reintento
// encontraba `null` y ejecutaba el bucle agentico completo en paralelo con el
// primero. El centinela PROCESANDO cierra ese hueco: la primera ejecucion
// reserva la clave al empezar (no solo al terminar), y cualquier reintento
// concurrente espera el resultado real en vez de repetir el turno.
const TTL_SEGUNDOS = 600;
const PREFIJO = 'agent-run:';
const PROCESANDO = '__PROCESSING__';
const POLL_MS = 1500;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getCachedAgentRun(wamid: string): Promise<AgentRunSuccess | null> {
  const c = getRedisClient();
  if (!c) return null;
  try {
    const raw = await c.get(PREFIJO + wamid);
    if (!raw || raw === PROCESANDO) return null;
    return JSON.parse(raw) as AgentRunSuccess;
  } catch (err) {
    console.error('Redis (cache idempotencia) fallo en lectura:', err);
    return null;
  }
}

// Devuelve true si esta ejecucion es la primera en procesar este wamid (debe
// seguir adelante), o false si ya hay otra en curso o completada (debe
// esperar via esperarResultado, no volver a ejecutar el turno). Fail-open:
// sin Redis, siempre true - no hay forma de coordinar, mismo riesgo de hoy.
export async function marcarProcesando(wamid: string): Promise<boolean> {
  const c = getRedisClient();
  if (!c) return true;
  try {
    const ok = await c.set(PREFIJO + wamid, PROCESANDO, { NX: true, EX: TTL_SEGUNDOS });
    return ok === 'OK';
  } catch (err) {
    console.error('Redis (marcar procesando) fallo:', err);
    return true;
  }
}

// Polling corto a la espera de que la ejecucion que SI gano marcarProcesando
// termine y sobreescriba el centinela con el resultado real.
export async function esperarResultado(wamid: string, maxWaitMs: number): Promise<AgentRunSuccess | null> {
  const c = getRedisClient();
  if (!c) return null;
  const limite = Date.now() + maxWaitMs;
  while (Date.now() < limite) {
    await esperar(POLL_MS);
    try {
      const raw = await c.get(PREFIJO + wamid);
      if (raw && raw !== PROCESANDO) return JSON.parse(raw) as AgentRunSuccess;
    } catch (err) {
      console.error('Redis (esperar resultado) fallo en lectura:', err);
      return null;
    }
  }
  return null;
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
