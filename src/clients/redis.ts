import { createClient, RedisClientType } from 'redis';
import { config } from '../config';

// Cliente compartido por redisCache.ts (idempotencia por wamid) y
// redisLock.ts (lock de hueco al crear una reserva). Opcional a proposito:
// si REDIS_HOST no esta configurado, getRedisClient() devuelve null y cada
// consumidor debe desactivarse en silencio - nunca debe bloquear ni romper
// una respuesta real al paciente.
let client: RedisClientType | null = null;
let intentado = false;

export function getRedisClient(): RedisClientType | null {
  if (!config.redis.host) return null;
  if (client) return client;
  if (intentado) return null;
  intentado = true;

  client = createClient({
    socket: { host: config.redis.host, port: config.redis.port },
    username: config.redis.username,
    password: config.redis.password,
  });
  client.on('error', (err) => console.error('Redis error:', err));
  client.connect().catch((err) => console.error('Redis fallo al conectar:', err));
  return client;
}
