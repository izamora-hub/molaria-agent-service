import { DateTime } from 'luxon';
import { config } from '../config';
import { searchOne } from '../clients/airtable';
import { freeBusy } from '../clients/googleCalendar';
import { calcularHuecos, Ventana } from './huecos';
import { listarTiposCita, buscarTipoCita } from './tiposCita';
import { ConsultarDisponibilidadInput } from '../types';

interface ClientesAgendaFields {
  cliente: string;
  timezone?: string;
  horizonte_dias: number;
  antelacion_min_horas: number;
  calendar_id: string;
  activo: boolean;
}

export type ConsultarDisponibilidadResultado =
  | { error: 'tipo_no_valido'; mensaje: string; tipos_validos: string[] }
  | { error: 'sin_huecos_ese_dia'; mensaje: string; dia_pedido: string }
  | {
      tipo: string;
      duracion_min: number;
      dia_filtrado: string | null;
      huecos: { inicio: string; fin: string; legible: string }[];
      quedan_mas: boolean;
      omitir_siguiente: number | null;
      nota: string;
    };

export async function consultarDisponibilidad(
  phoneNumberId: string,
  input: ConsultarDisponibilidadInput
): Promise<ConsultarDisponibilidadResultado> {
  const clienteAgenda = await searchOne<ClientesAgendaFields>(
    config.airtable.tableClientesAgenda,
    `AND({phone_number_id} = "${phoneNumberId}", {activo} = TRUE())`
  );
  if (!clienteAgenda) {
    throw new Error(`ClientesAgenda: no se encontro cliente activo para phone_number_id ${phoneNumberId}`);
  }
  const cliente = clienteAgenda.fields;

  const tipos = await listarTiposCita(cliente.cliente);
  const tipo = buscarTipoCita(tipos, input.tipo_cita)?.fields;
  if (!tipo) {
    const tiposValidos = tipos.map((t) => t.fields.nombre_tipo);
    return {
      error: 'tipo_no_valido',
      tipos_validos: tiposValidos,
      mensaje: `El tipo "${input.tipo_cita}" no existe. Tipos validos: ${tiposValidos.join(', ')}. Vuelve a llamar a la herramienta con uno de ellos.`,
    };
  }

  const TZ = cliente.timezone || 'Europe/Madrid';
  const ahora = DateTime.now().setZone(TZ);
  const desde = ahora.plus({ hours: Number(cliente.antelacion_min_horas) });
  const hasta = ahora.plus({ days: Number(cliente.horizonte_dias) }).endOf('day');
  const timeMin = desde.startOf('day');

  const ventana: Ventana = {
    calendar_id: cliente.calendar_id,
    timeZone: TZ,
    desde: desde.toISO()!,
    hasta: hasta.toISO()!,
    nombre_tipo: tipo.nombre_tipo,
    duracion_min: Number(tipo.duracion_min),
    colchon_min: Number(tipo.colchon_min) || 0,
    redondeo_min: Number(tipo.redondeo_min) || 15,
    dias_reservables: tipo.dias_reservables || [],
    hora_inicio: String(tipo.hora_inicio),
    hora_fin: String(tipo.hora_fin),
  };

  const fb = await freeBusy(cliente.calendar_id, timeMin.toISO()!, hasta.toISO()!, TZ);
  const huecos = calcularHuecos(ventana, fb, input.omitir ?? 0, input.dia_semana);

  if ('error' in huecos && huecos.error === 'sin_huecos_ese_dia') {
    return { error: 'sin_huecos_ese_dia', mensaje: huecos.mensaje, dia_pedido: huecos.dia_pedido };
  }
  const ok = huecos as Exclude<typeof huecos, { error: string }>;

  const paginar = ok.dia_filtrado
    ? `vuelve a llamar a la herramienta con omitir=${ok.omitir_siguiente} y dia_semana="${ok.dia_filtrado}" (no lo omitas o se saldra de ese dia).`
    : `vuelve a llamar a la herramienta con omitir=${ok.omitir_siguiente}.`;
  const sinMas = ok.dia_filtrado
    ? `No quedan mas huecos en ${ok.dia_filtrado} dentro del horizonte. Si los rechaza, ofrecele buscar en otro dia de la semana o los proximos huecos disponibles sin filtrar.`
    : 'No quedan mas huecos en el horizonte configurado. Si los rechaza, indicale que le llamaran para buscar otra fecha.';

  return {
    tipo: ok.nombre_tipo,
    duracion_min: ok.duracion_min,
    dia_filtrado: ok.dia_filtrado,
    huecos: ok.ofrecer,
    quedan_mas: ok.quedan_mas,
    omitir_siguiente: ok.omitir_siguiente,
    nota: ok.quedan_mas ? `Hay mas huecos disponibles. Si el paciente los rechaza, ${paginar}` : sinMas,
  };
}
