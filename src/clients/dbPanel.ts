import { Pool, QueryResultRow } from 'pg';
import { config } from '../config';

// Pool propio para /panel/* (1-01 punto 4, corregido: la query de login ya
// cuenta como "camino del panel" desde hoy, no desde 1-05/1-06). max bajo +
// statement_timeout explicito para que una query lenta del panel no compita
// por conexiones con el camino del paciente (crear_hold, consultar_disponibilidad...
// en clients/db.ts). types.setTypeParser de db.ts es global al proceso pg, se
// aplica igual aqui sin duplicarlo.
const pool = new Pool({
  connectionString: config.db.connectionString,
  max: 2,
  statement_timeout: 5000,
});

export async function queryPanel<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const { rows } = await pool.query<T>(text, params);
  return rows;
}

export async function queryOnePanel<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await queryPanel<T>(text, params);
  return rows[0] ?? null;
}
