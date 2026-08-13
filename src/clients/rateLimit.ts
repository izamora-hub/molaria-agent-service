import { getRedisClient } from './redis';

// Rate limit generico por clave (ej. "alta_rl:<ip>") usando INCR+EXPIRE, mismo
// patron que redisLock.ts/redisCache.ts. Fail-open a proposito: sin Redis
// configurado o si falla, no bloquea - el riesgo de dejar pasar sin limitar es
// menor que tumbar un endpoint publico por un blip de Redis.
export async function rateLimitExcedido(clave: string, limite: number, ttlSegundos: number): Promise<boolean> {
  const c = getRedisClient();
  if (!c) return false;
  try {
    const total = await c.incr(clave);
    if (total === 1) {
      await c.expire(clave, ttlSegundos);
    }
    return total > limite;
  } catch (err) {
    console.error('rateLimitExcedido fallo, fail-open:', err);
    return false;
  }
}
