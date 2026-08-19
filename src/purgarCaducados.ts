import { query } from './clients/db';

export interface ResultadoPurga {
  conversaciones_borradas: number;
  conversaciones_anonimizadas: number;
  reservas_borradas: number;
  reservas_anonimizadas: number;
}

// 1-03: retencion configurable por clinica, con plazo independiente por tabla
// y modo (borrar/anonimizar) tambien por clinica (clientes.retencion_*,
// decision 2026-08-19). conversaciones no tiene cliente_id: el conv_id lleva
// el phone_number_id como prefijo (`${phone_number_id}_${wa_id}`, ver
// Componer en el workflow n8n), de ahi el split_part en vez de un join
// directo. reservas si tiene cliente_id.
//
// Ancla de purga: ultima_actividad en conversaciones, inicio (fecha de la
// cita, no la de creacion) en reservas - una reserva "caduca" cuando ya paso
// la cita, no cuando se creo.
//
// Modo 'anonimizar': en conversaciones se reescribe conv_id a un valor
// opaco (deja de contener el telefono real) - esto la saca por si sola de
// futuras pasadas de esta misma query (el split_part ya no matchea ningun
// phone_number_id real), asi que no hace falta guarda extra ahi. En reservas
// el join es por cliente_id (estable, no depende de conv_id), asi que la
// guarda "telefono IS NOT NULL" evita re-anonimizar (y re-contar) la misma
// fila cada dia. event_id/calendar_id NO se tocan: el evento real de Google
// Calendar (con nombre/telefono del paciente) sigue existiendo fuera de esto,
// limitacion conocida y no resuelta por esta tarea.
export async function purgarCaducados(): Promise<ResultadoPurga> {
  const conversacionesBorradas = await query<{ id: string }>(
    `DELETE FROM conversaciones c
     USING clientes cl
     WHERE split_part(c.conv_id, '_', 1) = cl.phone_number_id
       AND cl.retencion_modo = 'borrar'
       AND c.ultima_actividad < now() - (cl.retencion_conversaciones_dias || ' days')::interval
     RETURNING c.id`
  );

  const conversacionesAnonimizadas = await query<{ id: string }>(
    `UPDATE conversaciones c
     SET historial = '[]'::jsonb, respuesta_texto = NULL, ultimo_wamid = NULL,
         conv_id = 'anon_' || c.id::text
     FROM clientes cl
     WHERE split_part(c.conv_id, '_', 1) = cl.phone_number_id
       AND cl.retencion_modo = 'anonimizar'
       AND c.ultima_actividad < now() - (cl.retencion_conversaciones_dias || ' days')::interval
     RETURNING c.id`
  );

  const reservasBorradas = await query<{ id: string }>(
    `DELETE FROM reservas r
     USING clientes cl
     WHERE r.cliente_id = cl.id
       AND cl.retencion_modo = 'borrar'
       AND r.inicio < now() - (cl.retencion_reservas_dias || ' days')::interval
     RETURNING r.id`
  );

  const reservasAnonimizadas = await query<{ id: string }>(
    `UPDATE reservas r
     SET nombre = NULL, telefono = NULL, conv_id = NULL, wa_id = NULL, phone_number_id = NULL
     FROM clientes cl
     WHERE r.cliente_id = cl.id
       AND cl.retencion_modo = 'anonimizar'
       AND r.telefono IS NOT NULL
       AND r.inicio < now() - (cl.retencion_reservas_dias || ' days')::interval
     RETURNING r.id`
  );

  return {
    conversaciones_borradas: conversacionesBorradas.length,
    conversaciones_anonimizadas: conversacionesAnonimizadas.length,
    reservas_borradas: reservasBorradas.length,
    reservas_anonimizadas: reservasAnonimizadas.length,
  };
}

export async function contarCaducados(): Promise<ResultadoPurga> {
  const [convBorrar] = await query<{ n: string }>(
    `SELECT count(*) AS n
     FROM conversaciones c
     JOIN clientes cl ON split_part(c.conv_id, '_', 1) = cl.phone_number_id
     WHERE cl.retencion_modo = 'borrar'
       AND c.ultima_actividad < now() - (cl.retencion_conversaciones_dias || ' days')::interval`
  );
  const [convAnon] = await query<{ n: string }>(
    `SELECT count(*) AS n
     FROM conversaciones c
     JOIN clientes cl ON split_part(c.conv_id, '_', 1) = cl.phone_number_id
     WHERE cl.retencion_modo = 'anonimizar'
       AND c.ultima_actividad < now() - (cl.retencion_conversaciones_dias || ' days')::interval`
  );
  const [resBorrar] = await query<{ n: string }>(
    `SELECT count(*) AS n
     FROM reservas r
     JOIN clientes cl ON r.cliente_id = cl.id
     WHERE cl.retencion_modo = 'borrar'
       AND r.inicio < now() - (cl.retencion_reservas_dias || ' days')::interval`
  );
  const [resAnon] = await query<{ n: string }>(
    `SELECT count(*) AS n
     FROM reservas r
     JOIN clientes cl ON r.cliente_id = cl.id
     WHERE cl.retencion_modo = 'anonimizar'
       AND r.telefono IS NOT NULL
       AND r.inicio < now() - (cl.retencion_reservas_dias || ' days')::interval`
  );
  return {
    conversaciones_borradas: Number(convBorrar?.n ?? 0),
    conversaciones_anonimizadas: Number(convAnon?.n ?? 0),
    reservas_borradas: Number(resBorrar?.n ?? 0),
    reservas_anonimizadas: Number(resAnon?.n ?? 0),
  };
}
