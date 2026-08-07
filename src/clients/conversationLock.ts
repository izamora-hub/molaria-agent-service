import { randomUUID } from 'crypto';
import { getRedisClient } from './redis';

// Lock por conversacion (conv_id), con token de propiedad - reemplaza al
// INCR+DELETE que hacia n8n directamente con su nodo Redis (sin SET NX nativo,
// sin liberacion condicional). Expuesto via /lock/acquire y /lock/release en
// index.ts para que n8n orqueste CUANDO se adquiere/libera, pero la primitiva
// de coordinacion real vive aqui, donde si hay un cliente Redis de verdad.
//
// C-02 (auditoria): el lock viejo (ttl:30) podia expirar con el turno aun en
// marcha (peor caso real ~184s por los reintentos de LlamarServicioAgente,
// ver redisCache.ts), dejando entrar una segunda ejecucion para la misma
// conversacion; y el DELETE sin token borraba el lock de esa segunda
// ejecucion sin darse cuenta. TTL aqui va holgado por encima del peor caso, y
// la liberacion es atomica y condicionada al token (Lua: solo borra si el
// valor sigue siendo el tuyo).
const TTL_SEGUNDOS = 240;

function claveConv(convId: string): string {
  return `lock:${convId}`;
}

// Fail-open a proposito, igual que redisLock.ts: sin Redis configurado o si
// falla, no hay forma de coordinar - se deja pasar (mismo riesgo que sin lock,
// no uno nuevo) en vez de bloquear una respuesta real al paciente.
export async function adquirirLockConversacion(convId: string): Promise<string | null> {
  const c = getRedisClient();
  if (!c) return randomUUID(); // sin Redis, "adquirido" siempre - token solo para cumplir el contrato de la funcion

  const token = randomUUID();
  try {
    const ok = await c.set(claveConv(convId), token, { NX: true, EX: TTL_SEGUNDOS });
    return ok === 'OK' ? token : null;
  } catch (err) {
    console.error('Redis (lock conversacion) fallo al adquirir:', err);
    return randomUUID();
  }
}

const LUA_LIBERAR_SI_PROPIO = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

export async function liberarLockConversacion(convId: string, token: string): Promise<void> {
  const c = getRedisClient();
  if (!c) return;
  try {
    await c.eval(LUA_LIBERAR_SI_PROPIO, { keys: [claveConv(convId)], arguments: [token] });
  } catch (err) {
    console.error('Redis (lock conversacion) fallo al liberar:', err);
  }
}
