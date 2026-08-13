import { DateTime } from 'luxon';
import { query, queryRetry, queryOneRetry } from '../clients/db';
import { deleteEvent } from '../clients/googleCalendar';
import { logError } from '../clients/logError';

// Compartido por cancelarCita y reprogramarCita (que empieza con los mismos
// pasos 1-5 de busqueda/desambiguacion/cancelacion que cancelarCita).

export interface ClienteRow {
  id: string;
  phone_number_id: string;
  resumen_email: string | null;
  ventana_cancelacion_horas: number | null;
  telefono_derivacion: string | null;
  // JSON string: {"lunes":[["09:30","18:00"]], "sabado":[], ...} - horario real
  // por dia de la semana, usado por consultarDisponibilidad (ver huecos.ts).
  horario: string | null;
}

export interface ReservaRow {
  id: string;
  reserva_id: string;
  conv_id: string;
  wa_id: string;
  phone_number_id: string;
  cliente_id: string | null;
  tipo_cita_id: string | null;
  inicio: string;
  fin: string;
  nombre: string;
  telefono: string;
  event_id: string;
  calendar_id: string;
  estado: 'activa' | 'cancelada' | 'confirmada' | 'rechazada';
  notificado: boolean;
  creado_en: string | null;
  cancelada_en: string | null;
}

export async function buscarCliente(phoneNumberId: string): Promise<ClienteRow> {
  const cliente = await queryOneRetry<ClienteRow>(
    'SELECT * FROM clientes WHERE phone_number_id = $1',
    [phoneNumberId]
  );
  if (!cliente) {
    throw new Error(`clientes: no se encontro registro para phone_number_id ${phoneNumberId}`);
  }
  return cliente;
}

function legible(iso: string, tz: string): string {
  return DateTime.fromISO(iso).setZone(tz).setLocale('es').toFormat("cccc d 'de' LLLL 'a las' HH:mm");
}

export type BuscarReservaResultado =
  | { ok: true; reserva: ReservaRow }
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
  cliente: ClienteRow,
  phoneNumberId: string,
  telefono: string,
  inicioDesambiguar: string | undefined
): Promise<BuscarReservaResultado> {
  // Comparacion por digitos, no por string exacto: el telefono guardado puede
  // llevar espacios/guiones (ej. citas sincronizadas a mano desde el calendario,
  // ver ConciliarEventos) y no tiene por que coincidir caracter a caracter con
  // lo que el paciente teclea esta vez.
  let reservas = await queryRetry<ReservaRow>(
    `SELECT * FROM reservas
     WHERE estado = 'activa' AND phone_number_id = $1
       AND regexp_replace(telefono, '\\D', '', 'g') = regexp_replace($2, '\\D', '', 'g')
     ORDER BY inicio`,
    [phoneNumberId, telefono]
  );

  const clienteAgenda = await queryOneRetry<{ timezone: string | null }>(
    `SELECT ca.timezone
     FROM clientes_agenda ca JOIN clientes c ON c.id = ca.cliente_id
     WHERE c.phone_number_id = $1`,
    [phoneNumberId]
  );
  const tz = clienteAgenda?.timezone || 'Europe/Madrid';

  if (inicioDesambiguar) {
    // Comparacion por instante, no por string: Claude copia el "inicio" tal como
    // lo devolvio consultar_disponibilidad (con el offset de la clinica), que no
    // tiene por que coincidir caracter a caracter con el ISO en UTC que devuelve
    // Postgres para la misma cita.
    const objetivo = DateTime.fromISO(inicioDesambiguar).toMillis();
    reservas = reservas.filter((r) => DateTime.fromISO(r.inicio).toMillis() === objetivo);
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
      opciones: reservas.map((r) => ({ inicio: r.inicio, legible: legible(r.inicio, tz) })),
      nota: 'Hay mas de una cita activa con ese telefono. Preguntale al paciente por cual fecha (usa los valores "legible"), y vuelve a invocar la herramienta pasando el "inicio" EXACTO de la opcion elegida, copiado literalmente.',
    };
  }

  const reserva = reservas[0];
  const ventanaHoras = Number(cliente.ventana_cancelacion_horas) || 0;
  if (ventanaHoras > 0) {
    const horasRestantes = DateTime.fromISO(reserva.inicio).diff(DateTime.now(), 'hours').hours;
    if (horasRestantes < ventanaHoras) {
      const tel = cliente.telefono_derivacion;
      return {
        ok: false,
        error: 'fuera_de_ventana',
        horas_restantes: Math.max(0, Math.round(horasRestantes)),
        telefono_derivacion: tel ?? undefined,
        nota: `Quedan menos de ${ventanaHoras}h para la cita (${legible(reserva.inicio, tz)}), fuera del plazo permitido para gestionarlo por aqui. Explicaselo al paciente y derivalo a la clinica${tel ? ` (${tel})` : ''} para que lo resuelvan directamente. No canceles ni reprogrames.`,
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
// El update de Postgres es secundario: si falla despues de borrar el evento, el
// hueco ya esta libre (que es lo que importa) - se loguea y no se revierte ni
// se propaga, para no devolver un fallo cuando el efecto real ya se cumplio.
export async function marcarCancelada(
  reserva: ReservaRow,
  ctx: { convId: string; waId: string; phoneNumberId: string }
): Promise<void> {
  await deleteEvent(reserva.calendar_id, reserva.event_id);
  try {
    await query(
      `UPDATE reservas SET estado = 'cancelada', cancelada_en = now() WHERE id = $1`,
      [reserva.id]
    );
  } catch (err) {
    await logError({
      convId: ctx.convId,
      waId: ctx.waId,
      phoneNumberId: ctx.phoneNumberId,
      nodoOrigen: 'marcarCancelada',
      errorMensaje: `Evento de Calendar borrado (reserva ${reserva.id}) pero fallo el update de Postgres a estado=cancelada: ${
        err instanceof Error ? err.message : 'error desconocido'
      }`,
    });
  }
}
