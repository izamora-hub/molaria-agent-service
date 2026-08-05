import { getRedisClient } from './redis';

// Lock corto por hueco (calendar_id + inicio) para cerrar la ventana entre el
// doble check de freeBusy y la creacion real del evento en crearHold.ts: dos
// holds concurrentes sobre el mismo slot exacto podrian pasar ambos checks y
// crear un doble-booking (auditoria M-06). TTL corto a proposito - la seccion
// critica es solo 2 llamadas freeBusy + 1 insert, no un turno completo de
// Claude. Fail-open: sin Redis configurado o si falla, no bloquea (mismo
// riesgo de hoy, no uno nuevo).
const TTL_SEGUNDOS = 10;

function claveHueco(calendarId: string, inicio: string): string {
  return `lock:hold:${calendarId}:${inicio}`;
}

export async function adquirirLockHueco(calendarId: string, inicio: string): Promise<boolean> {
  const c = getRedisClient();
  if (!c) return true;
  try {
    const key = claveHueco(calendarId, inicio);
    const count = await c.incr(key);
    if (count === 1) {
      await c.expire(key, TTL_SEGUNDOS);
      return true;
    }
    return false;
  } catch (err) {
    console.error('Redis (lock hueco) fallo:', err);
    return true;
  }
}

export async function liberarLockHueco(calendarId: string, inicio: string): Promise<void> {
  const c = getRedisClient();
  if (!c) return;
  try {
    await c.del(claveHueco(calendarId, inicio));
  } catch (err) {
    console.error('Redis (lock hueco) fallo liberando:', err);
  }
}
