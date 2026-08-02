import { config } from '../config';
import { searchAll, AirtableRecord } from '../clients/airtable';
import { norm } from './huecos';

export interface TipoCitaFields {
  nombre_tipo: string;
  duracion_min: number;
  colchon_min?: number;
  redondeo_min?: number;
  dias_reservables?: string[];
  hora_inicio: string;
  hora_fin: string;
}

// Compartido por consultarDisponibilidad (para calcular huecos) y crearHold
// (para resolver el id de registro que enlazar en Reservas.tipo_cita).
export async function listarTiposCita(clienteNombre: string): Promise<AirtableRecord<TipoCitaFields>[]> {
  return searchAll<TipoCitaFields>(config.airtable.tableTiposCita, `{cliente} = "${clienteNombre}"`);
}

export function buscarTipoCita(
  tipos: AirtableRecord<TipoCitaFields>[],
  tipoCitaTexto: string
): AirtableRecord<TipoCitaFields> | undefined {
  const pedido = norm(tipoCitaTexto);
  return (
    tipos.find((t) => norm(t.fields.nombre_tipo) === pedido) ??
    tipos.find((t) => {
      const n = norm(t.fields.nombre_tipo);
      return n.includes(pedido) || pedido.includes(n);
    })
  );
}
