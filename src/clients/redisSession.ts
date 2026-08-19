import { randomBytes } from 'crypto';
import { getRedisClient } from './redis';

const PREFIJO_MAGIC = 'magic:';
const PREFIJO_SESION = 'session:';
const TTL_MAGIC_SEGUNDOS = 15 * 60;
const TTL_SESION_SEGUNDOS = 24 * 60 * 60; // 24h deslizante (decision 2026-08-19: 14 dias daba mala impresion de seguridad)

export type Sesion = { cliente_id: string; rol: 'clinica' };

function generarToken(): string {
  return randomBytes(24).toString('base64url');
}

// Token de magic-link de un solo uso, vive solo en Redis (1-01 punto 1): sin
// cambio de schema, y perder tokens en un reinicio de Redis es inofensivo -
// el usuario simplemente pide otro enlace.
export async function emitirTokenMagicLink(clienteId: string): Promise<string | null> {
  const c = getRedisClient();
  if (!c) return null; // fail-closed: sin Redis no hay forma de emitir un token verificable
  const token = generarToken();
  await c.set(PREFIJO_MAGIC + token, clienteId, { EX: TTL_MAGIC_SEGUNDOS });
  return token;
}

// GETDEL: lectura+borrado atomico en un solo comando, sin race entre dos
// intentos simultaneos de consumir el mismo token (1-01 punto 1).
export async function consumirTokenMagicLink(token: string): Promise<string | null> {
  const c = getRedisClient();
  if (!c) return null; // fail-closed
  try {
    return await c.getDel(PREFIJO_MAGIC + token);
  } catch (err) {
    console.error('consumirTokenMagicLink fallo (fail-closed):', err);
    return null;
  }
}

export async function crearSesion(clienteId: string): Promise<string> {
  const c = getRedisClient();
  if (!c) throw new Error('Redis no disponible: no se puede crear sesion');
  const sessionId = generarToken();
  const sesion: Sesion = { cliente_id: clienteId, rol: 'clinica' };
  await c.set(PREFIJO_SESION + sessionId, JSON.stringify(sesion), { EX: TTL_SESION_SEGUNDOS });
  return sessionId;
}

// Fail-closed a proposito (a diferencia de los locks/rate-limit del resto del
// servicio, que fallan abiertos): cualquier fallo de Redis aqui es "sesion
// invalida", nunca "sesion valida" - lo contrario dejaria el panel abierto
// para cualquiera si Redis se cae (1-01 punto 1, matiz añadido).
export async function leerSesion(sessionId: string): Promise<Sesion | null> {
  const c = getRedisClient();
  if (!c) return null;
  try {
    const clave = PREFIJO_SESION + sessionId;
    const raw = await c.get(clave);
    if (!raw) return null;
    await c.expire(clave, TTL_SESION_SEGUNDOS); // TTL deslizante: actividad reciente = sesion viva mas tiempo
    return JSON.parse(raw) as Sesion;
  } catch (err) {
    console.error('leerSesion fallo (fail-closed):', err);
    return null;
  }
}

export async function borrarSesion(sessionId: string): Promise<void> {
  const c = getRedisClient();
  if (!c) return;
  try {
    await c.del(PREFIJO_SESION + sessionId);
  } catch (err) {
    console.error('borrarSesion fallo:', err);
  }
}
