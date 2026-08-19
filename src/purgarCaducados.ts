import { query } from './clients/db';

export interface ResultadoPurga {
  conversaciones_borradas: number;
  reservas_borradas: number;
}

// 1-03: retencion configurable por clinica (clientes.retencion_dias, default 30).
// conversaciones no tiene cliente_id: el conv_id lleva el phone_number_id como
// prefijo (`${phone_number_id}_${wa_id}`, ver Componer en el workflow n8n), de
// ahi el split_part en vez de un join directo. reservas si tiene cliente_id.
// Ancla de purga: ultima_actividad en conversaciones, inicio (fecha de la cita,
// no la de creacion) en reservas - una reserva "caduca" cuando ya paso la cita,
// no cuando se creo. Borrado completo, no anonimizado (decision 2026-08-19).
export async function purgarCaducados(): Promise<ResultadoPurga> {
  const conversaciones = await query<{ id: string }>(
    `DELETE FROM conversaciones c
     USING clientes cl
     WHERE split_part(c.conv_id, '_', 1) = cl.phone_number_id
       AND c.ultima_actividad < now() - (cl.retencion_dias || ' days')::interval
     RETURNING c.id`
  );

  const reservas = await query<{ id: string }>(
    `DELETE FROM reservas r
     USING clientes cl
     WHERE r.cliente_id = cl.id
       AND r.inicio < now() - (cl.retencion_dias || ' days')::interval
     RETURNING r.id`
  );

  return {
    conversaciones_borradas: conversaciones.length,
    reservas_borradas: reservas.length,
  };
}

export async function contarCaducados(): Promise<ResultadoPurga> {
  const [conv] = await query<{ n: string }>(
    `SELECT count(*) AS n
     FROM conversaciones c
     JOIN clientes cl ON split_part(c.conv_id, '_', 1) = cl.phone_number_id
     WHERE c.ultima_actividad < now() - (cl.retencion_dias || ' days')::interval`
  );
  const [res] = await query<{ n: string }>(
    `SELECT count(*) AS n
     FROM reservas r
     JOIN clientes cl ON r.cliente_id = cl.id
     WHERE r.inicio < now() - (cl.retencion_dias || ' days')::interval`
  );
  return {
    conversaciones_borradas: Number(conv?.n ?? 0),
    reservas_borradas: Number(res?.n ?? 0),
  };
}
