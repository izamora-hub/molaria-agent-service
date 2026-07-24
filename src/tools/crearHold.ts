import { config } from '../config';
import { searchOne, upsert } from '../clients/airtable';
import { freeBusy, createTentativeEvent } from '../clients/googleCalendar';
import { CrearHoldInput } from '../types';

interface ClientesAgendaFields {
  calendar_id: string;
  timezone?: string;
  prefijo_hold?: string;
}

export type CrearHoldResultado =
  | {
      ok: true;
      estado: 'pendiente_de_confirmacion';
      tipo: string;
      inicio: string;
      fin: string;
      nombre: string;
      nota: string;
    }
  | { ok: false; error: 'hueco_no_disponible'; nota: string };

async function huecoLibre(calendarId: string, timezone: string, inicio: string, fin: string): Promise<boolean> {
  const fb = await freeBusy(calendarId, inicio, fin, timezone);
  return fb.busy.length === 0;
}

export async function crearHold(
  ctx: { phoneNumberId: string; convId: string; waId: string; clienteNombre: string; toolUseId: string },
  input: CrearHoldInput
): Promise<CrearHoldResultado> {
  const clienteAgenda = await searchOne<ClientesAgendaFields>(
    config.airtable.tableClientesAgenda,
    `{phone_number_id} = '${ctx.phoneNumberId}'`
  );
  if (!clienteAgenda) {
    throw new Error(`ClientesAgenda: no se encontro configuracion para phone_number_id ${ctx.phoneNumberId}`);
  }
  const { calendar_id, timezone } = clienteAgenda.fields;
  const tz = timezone || 'Europe/Madrid';
  const prefijoHold = clienteAgenda.fields.prefijo_hold || '[PENDIENTE CONFIRMAR]';

  const NO_DISPONIBLE: CrearHoldResultado = {
    ok: false,
    error: 'hueco_no_disponible',
    nota: 'Ese hueco ha sido ocupado mientras hablabais. Disculpate brevemente y vuelve a invocar consultar_disponibilidad para ofrecerle otros huecos. No insistas con el mismo.',
  };

  // Primera comprobacion.
  if (!(await huecoLibre(calendar_id, tz, input.inicio, input.fin))) {
    return NO_DISPONIBLE;
  }

  // Segunda comprobacion justo antes de escribir, para cerrar al maximo la ventana
  // de doble reserva entre el primer check y la creacion real del evento.
  if (!(await huecoLibre(calendar_id, tz, input.inicio, input.fin))) {
    return NO_DISPONIBLE;
  }

  const { eventId } = await createTentativeEvent({
    calendarId: calendar_id,
    timeZone: tz,
    summary: `${prefijoHold} ${input.tipo_cita} - ${input.nombre}`,
    description: `Solicitud creada por el agente de WhatsApp.\nTelefono: ${input.telefono}\nTipo: ${input.tipo_cita}\nEstado: pendiente de confirmar.`,
    inicio: input.inicio,
    fin: input.fin,
  });

  await upsert(
    config.airtable.tableReservas,
    {
      reserva_id: ctx.toolUseId,
      conv_id: ctx.convId,
      wa_id: ctx.waId,
      phone_number_id: ctx.phoneNumberId,
      cliente: ctx.clienteNombre,
      tipo_cita: input.tipo_cita,
      inicio: input.inicio,
      fin: input.fin,
      nombre: input.nombre,
      telefono: input.telefono,
      event_id: eventId,
      calendar_id,
      estado: 'pendiente',
      notificado: false,
      creado_en: new Date().toISOString(),
    },
    'reserva_id'
  );

  return {
    ok: true,
    estado: 'pendiente_de_confirmacion',
    tipo: input.tipo_cita,
    inicio: input.inicio,
    fin: input.fin,
    nombre: input.nombre,
    nota: 'La solicitud ha quedado anotada y el hueco bloqueado provisionalmente. Confirmale al paciente que queda PENDIENTE de que la clinica lo confirme, y que se le avisara. No digas que la cita esta confirmada.',
  };
}
