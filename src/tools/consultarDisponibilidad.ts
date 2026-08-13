import { DateTime } from 'luxon';
import { queryOneRetry } from '../clients/db';
import { freeBusy } from '../clients/googleCalendar';
import { calcularHuecos, HorarioSemana, Ventana } from './huecos';
import { listarTiposCita, buscarTipoCita } from './tiposCita';
import { buscarCliente } from './citas';
import { ConsultarDisponibilidadInput } from '../types';

interface ClientesAgendaRow {
  id: string;
  timezone: string | null;
  horizonte_dias: number;
  antelacion_min_horas: number;
  calendar_id: string;
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
  const clienteAgenda = await queryOneRetry<ClientesAgendaRow>(
    `SELECT ca.id, ca.timezone, ca.horizonte_dias, ca.antelacion_min_horas, ca.calendar_id
     FROM clientes_agenda ca JOIN clientes c ON c.id = ca.cliente_id
     WHERE c.phone_number_id = $1 AND ca.activo = true`,
    [phoneNumberId]
  );
  if (!clienteAgenda) {
    throw new Error(`clientes_agenda: no se encontro cliente activo para phone_number_id ${phoneNumberId}`);
  }

  const tipos = await listarTiposCita(clienteAgenda.id);
  const tipo = buscarTipoCita(tipos, input.tipo_cita);
  if (!tipo) {
    const tiposValidos = tipos.map((t) => t.nombre_tipo);
    return {
      error: 'tipo_no_valido',
      tipos_validos: tiposValidos,
      mensaje: `El tipo "${input.tipo_cita}" no existe. Tipos validos: ${tiposValidos.join(', ')}. Vuelve a llamar a la herramienta con uno de ellos.`,
    };
  }

  const antelacionHoras = Number(clienteAgenda.antelacion_min_horas);
  const horizonteDias = Number(clienteAgenda.horizonte_dias);
  const redondeoMin = Number(tipo.redondeo_min);
  // Sin validar, un valor no numerico/ausente produce NaN -> fecha invalida ->
  // el bucle de calcularHuecos no itera nunca -> "no hay huecos" enganoso en
  // vez de un error de configuracion claro. redondeo_min no lleva default
  // implicito a proposito: un valor mal puesto en tipos_cita debe fallar alto y
  // claro, no enmascararse con un 15 hardcodeado que nadie audita despues.
  if (!Number.isFinite(antelacionHoras) || !Number.isFinite(horizonteDias)) {
    throw new Error(
      `clientes_agenda: antelacion_min_horas/horizonte_dias no numericos para phone_number_id ${phoneNumberId}`
    );
  }
  if (!Number.isFinite(redondeoMin) || redondeoMin <= 0) {
    throw new Error(
      `tipos_cita: redondeo_min no numerico o no positivo para "${tipo.nombre_tipo}" (clientes_agenda_id ${clienteAgenda.id})`
    );
  }

  const TZ = clienteAgenda.timezone || 'Europe/Madrid';
  const ahora = DateTime.now().setZone(TZ);
  const desde = ahora.plus({ hours: antelacionHoras });
  const hasta = ahora.plus({ days: horizonteDias }).endOf('day');
  const timeMin = desde.startOf('day');

  // Horario real de la clinica (varia por dia de la semana) manda siempre sobre
  // cualquier rango que tuviera el tipo de cita: dias_reservables solo decide
  // que dias se ofrece ESE tipo, nunca a que hora abre/cierra la clinica.
  const clienteRecord = await buscarCliente(phoneNumberId);
  if (!clienteRecord.horario) {
    throw new Error(`clientes: falta el campo horario para phone_number_id ${phoneNumberId}`);
  }
  let horario: HorarioSemana;
  try {
    horario = JSON.parse(clienteRecord.horario);
  } catch {
    throw new Error(`clientes: horario no es JSON valido para phone_number_id ${phoneNumberId}`);
  }

  const ventana: Ventana = {
    calendar_id: clienteAgenda.calendar_id,
    timeZone: TZ,
    desde: desde.toISO()!,
    hasta: hasta.toISO()!,
    nombre_tipo: tipo.nombre_tipo,
    duracion_min: Number(tipo.duracion_min),
    colchon_min: Number(tipo.colchon_min) || 0,
    redondeo_min: redondeoMin,
    dias_reservables: tipo.dias_reservables || [],
    horario,
  };

  const fb = await freeBusy(clienteAgenda.calendar_id, timeMin.toISO()!, hasta.toISO()!, TZ);
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
