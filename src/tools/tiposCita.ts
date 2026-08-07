import { query } from '../clients/db';
import { norm } from './huecos';

export interface TipoCitaFields {
  id: string;
  nombre_tipo: string;
  duracion_min: number;
  colchon_min: number | null;
  redondeo_min: number | null;
  dias_reservables: string[] | null;
}

// Compartido por consultarDisponibilidad (para calcular huecos) y crearHold
// (para resolver el id de registro que enlazar en reservas.tipo_cita_id).
export async function listarTiposCita(clientesAgendaId: string): Promise<TipoCitaFields[]> {
  // dias_reservables::text[] - pg no trae un parser de array registrado para un
  // ENUM propio (dia_semana_t[]), asi que sin el cast llega como el string
  // literal de Postgres ("{lunes,martes}") en vez de un array de JS.
  return query<TipoCitaFields>(
    `SELECT id, nombre_tipo, duracion_min, colchon_min, redondeo_min, activo,
            dias_reservables::text[] AS dias_reservables
     FROM tipos_cita WHERE clientes_agenda_id = $1 AND activo = true`,
    [clientesAgendaId]
  );
}

export function buscarTipoCita(
  tipos: TipoCitaFields[],
  tipoCitaTexto: string
): TipoCitaFields | undefined {
  const pedido = norm(tipoCitaTexto);
  return (
    tipos.find((t) => norm(t.nombre_tipo) === pedido) ??
    tipos.find((t) => {
      const n = norm(t.nombre_tipo);
      return n.includes(pedido) || pedido.includes(n);
    })
  );
}
