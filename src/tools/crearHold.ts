import { query, queryOneRetry } from '../clients/db';
import { freeBusy, createTentativeEvent } from '../clients/googleCalendar';
import { adquirirLockHueco, liberarLockHueco } from '../clients/redisLock';
import { listarTiposCita, buscarTipoCita } from './tiposCita';
import { CrearHoldInput } from '../types';

interface ClientesAgendaRow {
  id: string;
  calendar_id: string;
  timezone: string | null;
  prefijo_hold: string | null;
}

interface ClienteRow {
  id: string;
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
  ctx: {
    phoneNumberId: string;
    convId: string;
    waId: string;
    clienteNombre: string;
    toolUseId: string;
    reagendadaDeId?: string;
  },
  input: CrearHoldInput
): Promise<CrearHoldResultado> {
  const clienteAgenda = await queryOneRetry<ClientesAgendaRow>(
    `SELECT ca.id, ca.calendar_id, ca.timezone, ca.prefijo_hold
     FROM clientes_agenda ca JOIN clientes c ON c.id = ca.cliente_id
     WHERE c.phone_number_id = $1`,
    [ctx.phoneNumberId]
  );
  if (!clienteAgenda) {
    throw new Error(`clientes_agenda: no se encontro configuracion para phone_number_id ${ctx.phoneNumberId}`);
  }
  const { calendar_id, timezone } = clienteAgenda;
  const tz = timezone || 'Europe/Madrid';
  const prefijoHold = clienteAgenda.prefijo_hold || '[PENDIENTE CONFIRMAR]';

  const clienteRecord = await queryOneRetry<ClienteRow>(
    'SELECT id FROM clientes WHERE phone_number_id = $1',
    [ctx.phoneNumberId]
  );
  if (!clienteRecord) {
    throw new Error(`clientes: no se encontro registro para phone_number_id ${ctx.phoneNumberId}`);
  }

  const tipos = await listarTiposCita(clienteAgenda.id);
  const tipoCitaRecord = buscarTipoCita(tipos, input.tipo_cita);
  if (!tipoCitaRecord) {
    throw new Error(`tipos_cita: no se encontro "${input.tipo_cita}" para clientes_agenda_id ${clienteAgenda.id}`);
  }

  const NO_DISPONIBLE: CrearHoldResultado = {
    ok: false,
    error: 'hueco_no_disponible',
    nota: 'Ese hueco ha sido ocupado mientras hablabais. Disculpate brevemente y vuelve a invocar consultar_disponibilidad para ofrecerle otros huecos. No insistas con el mismo.',
  };

  // Lock corto por hueco exacto: sin esto, dos holds concurrentes sobre el
  // mismo calendar_id+inicio podrian pasar ambos el doble check de freeBusy
  // (que solo mitiga la ventana, no la cierra del todo) y crear un
  // doble-booking. Si el lock esta ocupado, se trata igual que un hueco ya no
  // disponible - honesto: en ese instante, lo esta.
  if (!(await adquirirLockHueco(calendar_id, input.inicio))) {
    return NO_DISPONIBLE;
  }

  try {
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

    await query(
      `INSERT INTO reservas (
         reserva_id, conv_id, wa_id, phone_number_id, cliente_id, tipo_cita_id,
         inicio, fin, nombre, telefono, event_id, calendar_id, estado, notificado, creado_en, reagendada_de_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'activa', false, now(), $13)
       ON CONFLICT (reserva_id) DO UPDATE SET
         conv_id = EXCLUDED.conv_id, wa_id = EXCLUDED.wa_id, phone_number_id = EXCLUDED.phone_number_id,
         cliente_id = EXCLUDED.cliente_id, tipo_cita_id = EXCLUDED.tipo_cita_id,
         inicio = EXCLUDED.inicio, fin = EXCLUDED.fin, nombre = EXCLUDED.nombre,
         telefono = EXCLUDED.telefono, event_id = EXCLUDED.event_id, calendar_id = EXCLUDED.calendar_id,
         estado = 'activa', notificado = false, reagendada_de_id = EXCLUDED.reagendada_de_id`,
      [
        ctx.toolUseId,
        ctx.convId,
        ctx.waId,
        ctx.phoneNumberId,
        clienteRecord.id,
        tipoCitaRecord.id,
        input.inicio,
        input.fin,
        input.nombre,
        input.telefono,
        eventId,
        calendar_id,
        ctx.reagendadaDeId ?? null,
      ]
    );

    return {
      ok: true,
      estado: 'pendiente_de_confirmacion',
      tipo: input.tipo_cita,
      inicio: input.inicio,
      fin: input.fin,
      nombre: input.nombre,
      nota: 'La solicitud ha quedado anotada y el hueco bloqueado provisionalmente. Dile al paciente que solo le avisaran si hay algun problema con el horario; si no, la cita queda asi. No digas que la cita esta confirmada.',
    };
  } finally {
    await liberarLockHueco(calendar_id, input.inicio);
  }
}
