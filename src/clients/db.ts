import { Pool, QueryResultRow, types } from 'pg';
import { DateTime } from 'luxon';
import { config } from '../config';

// pg devuelve timestamp/timestamptz como Date de JS por defecto. Todo el codigo
// (huecos.ts, citas.ts, crearHold.ts, googleCalendar.ts...) usa Luxon sobre strings
// ISO tal como los devolvia Airtable ("2026-08-07T10:00:00.000Z") - se sobreescriben
// los parsers para mantener ese mismo formato en vez de reescribir todos los call
// sites a DateTime.fromJSDate. Postgres emite timestamps con espacio en vez de "T"
// (formato SQL, no ISO puro), de ahi el fromSQL en vez de fromISO aqui.
types.setTypeParser(1114, (val) => DateTime.fromSQL(val, { zone: 'utc' }).toUTC().toISO()); // timestamp
types.setTypeParser(1184, (val) => DateTime.fromSQL(val, { zone: 'utc' }).toUTC().toISO()); // timestamptz

// Pool compartido por todos los tools (citas.ts, crearHold.ts, consultarDisponibilidad.ts,
// tiposCita.ts) y por logAgente.ts/logError.ts - un Pool, no un Client unico, porque hay
// turnos concurrentes de distintas conversaciones ejecutandose en paralelo.
const pool = new Pool({ connectionString: config.db.connectionString });

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const { rows } = await pool.query<T>(text, params);
  return rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

// AGD-05: reintento solo para lecturas (SELECT) - repetir una lectura tras un
// blip transitorio de conexion nunca duplica ni corrompe nada. NO usar con
// escrituras (INSERT/UPDATE): si el primer intento SI llego a ejecutarse en el
// servidor pero la respuesta se perdio por el camino, reintentar la dispararia
// dos veces. query()/queryOne() de arriba se quedan sin reintento a proposito
// para eso.
async function conReintento<T>(fn: () => Promise<T>, intentos = 3, esperaMs = 300): Promise<T> {
  let ultimoError: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimoError = err;
      if (i < intentos - 1) await new Promise((r) => setTimeout(r, esperaMs * (i + 1)));
    }
  }
  throw ultimoError;
}

export async function queryRetry<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  return conReintento(() => query<T>(text, params));
}

export async function queryOneRetry<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  return conReintento(() => queryOne<T>(text, params));
}
