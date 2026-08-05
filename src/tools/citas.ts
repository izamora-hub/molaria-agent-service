import { DateTime } from 'luxon';
import { config } from '../config';
import { searchOne, searchAll, updateById, AirtableRecord } from '../clients/airtable';
import { deleteEvent } from '../clients/googleCalendar';
import { logError } from '../clients/logError';

// Compartido por cancelarCita y reprogramarCita (que empieza con los mismos
// pasos 1-5 de busqueda/desambiguacion/cancelacion que cancelarCita).

export interface ClienteFields {
  phone_number_id: string;
  resumen_email?: string;
  ventana_cancelacion_horas?: number;
  telefono_derivacion?: string;
  // JSON string: {"lunes":[["09:30","18:00"]], "sabado":[], ...} - horario real
  // por dia de la semana, usado por consultarDisponibilidad (ver huecos.ts).
  horario?: string;
}

export interface ReservaFields {
  reserva_id: string;
  conv_id: string;
  wa_id: string;
  phone_number_id: string;
  cliente: string[];
  tipo_cita: string[];
  inicio: string;
  fin: string;
  nombre: string;
  telefono: string;
  event_id: string;
  calendar_id: string;
  estado: 'activa' | 'cancelada';
  cancelada_en?: string;
}

export async function buscarCliente(phoneNumberId: string): Promise<AirtableRecord<ClienteFields>> {
  const cliente = await searchOne<ClienteFields>(
    config.airtable.tableClientes,
    `{phone_number_id} = '${phoneNumberId}'`
  );
  if (!cliente) {
    throw new Error(`Clientes: no se encontro registro para phone_number_id ${phoneNumberId}`);
  }
  return cliente;
}

function legible(iso: string, tz: string): string {
  return DateTime.fromISO(iso).setZone(tz).setLocale('es').toFormat("cccc d 'de' LLLL 'a las' HH:mm");
}

export type BuscarReservaResultado =
  | { ok: true; reserva: AirtableRecord<ReservaFields> }
  | { ok: false; error: 'sin_cita'; nota: string }
  | {
      ok: false;
      error: 'ambiguo';
      opciones: { inicio: string; legible: string }[];
      nota: string;
    }
  | {
      ok: false;
      error: 'fuera_de_ventana';
      horas_restantes: number;
      telefono_derivacion?: string;
      nota: string;
    };

// Pasos 1-4 del procedimiento: busca la(s) reserva(s) activa(s) que casen con
// telefono (y, si hay mas de una, con el inicio exacto pasado para desambiguar),
// y aplica la ventana de cancelacion del cliente.
export async function buscarReservaCancelable(
  cliente: AirtableRecord<ClienteFields>,
  phoneNumberId: string,
  telefono: string,
  inicioDesambiguar: string | undefined
): Promise<BuscarReservaResultado> {
  let reservas = await searchAll<ReservaFields>(
    config.airtable.tableReservas,
    `AND({estado} = 'activa', {phone_number_id} = '${phoneNumberId}', {telefono} = '${telefono}')`
  );
  reservas.sort((a, b) => a.fields.inicio.localeCompare(b.fields.inicio));

  // Reservas.inicio se lee de Airtable normalizado a UTC (ver comentario mas
  // abajo): hay que reconvertir a la zona horaria de la clinica para mostrarle
  // la hora correcta al paciente, igual que hace huecos.ts al ofrecer huecos.
  const clienteAgenda = await searchOne<{ timezone?: string }>(
    config.airtable.tableClientesAgenda,
    `{phone_number_id} = '${phoneNumberId}'`
  );
  const tz = clienteAgenda?.fields.timezone || 'Europe/Madrid';

  if (inicioDesambiguar) {
    // Comparacion por instante, no por string: "inicio" es dateTime en Airtable
    // y se normaliza a UTC al leer, mientras que Claude copia el valor tal como
    // lo devolvio Luxon (con el offset de la clinica) - las dos strings son
    // legitimamente distintas para la misma cita.
    const objetivo = DateTime.fromISO(inicioDesambiguar).toMillis();
    reservas = reservas.filter((r) => DateTime.fromISO(r.fields.inicio).toMillis() === objetivo);
  }

  if (reservas.length === 0) {
    return {
      ok: false,
      error: 'sin_cita',
      nota: 'No encuentro ninguna cita activa con ese telefono. Diselo al paciente con naturalidad y confirma que el telefono es el que uso al reservar.',
    };
  }

  if (reservas.length > 1) {
    return {
      ok: false,
      error: 'ambiguo',
      opciones: reservas.map((r) => ({ inicio: r.fields.inicio, legible: legible(r.fields.inicio, tz) })),
      nota: 'Hay mas de una cita activa con ese telefono. Preguntale al paciente por cual fecha (usa los valores "legible"), y vuelve a invocar la herramienta pasando el "inicio" EXACTO de la opcion elegida, copiado literalmente.',
    };
  }

  const reserva = reservas[0];
  const ventanaHoras = Number(cliente.fields.ventana_cancelacion_horas) || 0;
  if (ventanaHoras > 0) {
    const horasRestantes = DateTime.fromISO(reserva.fields.inicio).diff(DateTime.now(), 'hours').hours;
    if (horasRestantes < ventanaHoras) {
      const tel = cliente.fields.telefono_derivacion;
      return {
        ok: false,
        error: 'fuera_de_ventana',
        horas_restantes: Math.max(0, Math.round(horasRestantes)),
        telefono_derivacion: tel,
        nota: `Quedan menos de ${ventanaHoras}h para la cita (${legible(reserva.fields.inicio, tz)}), fuera del plazo permitido para gestionarlo por aqui. Explicaselo al paciente y derivalo a la clinica${tel ? ` (${tel})` : ''} para que lo resuelvan directamente. No canceles ni reprogrames.`,
      };
    }
  }

  return { ok: true, reserva };
}

// Paso 5: cancela de verdad. El check de disponibilidad (freeBusy) solo mira el
// calendario real, asi que borrar el evento es lo que hace que ese hueco vuelva
// a contar como libre - es el paso autoritativo y NO se atrapa: si falla de
// verdad (no 404/410, que deleteEvent ya trata como exito), la funcion lanza y
// el llamador NO debe decirle al paciente que se canceló.
// El update de Airtable es secundario: si falla despues de borrar el evento, el
// hueco ya esta libre (que es lo que importa) - se loguea y no se revierte ni
// se propaga, para no devolver un fallo cuando el efecto real ya se cumplio.
export async function marcarCancelada(
  reserva: AirtableRecord<ReservaFields>,
  ctx: { convId: string; waId: string; phoneNumberId: string }
): Promise<void> {
  await deleteEvent(reserva.fields.calendar_id, reserva.fields.event_id);
  try {
    await updateById<ReservaFields>(config.airtable.tableReservas, reserva.id, {
      estado: 'cancelada',
      cancelada_en: new Date().toISOString(),
    });
  } catch (err) {
    await logError({
      convId: ctx.convId,
      waId: ctx.waId,
      phoneNumberId: ctx.phoneNumberId,
      nodoOrigen: 'marcarCancelada',
      errorMensaje: `Evento de Calendar borrado (reserva ${reserva.id}) pero fallo el update de Airtable a estado=cancelada: ${
        err instanceof Error ? err.message : 'error desconocido'
      }`,
    });
  }
}
