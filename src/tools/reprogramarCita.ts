import { queryOneRetry } from '../clients/db';
import { enviarEmail } from '../clients/resend';
import { logError } from '../clients/logError';
import { buscarCliente, buscarReservaCancelable, marcarCancelada, BuscarReservaResultado } from './citas';
import { crearHold, CrearHoldResultado } from './crearHold';
import { ReprogramarCitaInput } from '../types';

export type ReprogramarCitaResultado =
  | Exclude<BuscarReservaResultado, { ok: true }>
  | { ok: false; error: 'hueco_no_disponible'; nota: string }
  | Extract<CrearHoldResultado, { ok: true }>;

export async function reprogramarCita(
  ctx: { phoneNumberId: string; convId: string; waId: string; clienteNombre: string; toolUseId: string },
  input: ReprogramarCitaInput
): Promise<ReprogramarCitaResultado> {
  const cliente = await buscarCliente(ctx.phoneNumberId);

  // Pasos 1-4: misma busqueda/desambiguacion/ventana que cancelar_cita. OJO: esto
  // solo localiza la reserva, todavia NO la cancela - ver nota de orden abajo.
  const resultado = await buscarReservaCancelable(cliente, ctx.phoneNumberId, ctx.waId, input.inicio);
  if (!resultado.ok) return resultado;

  const reservaAnterior = resultado.reserva;

  const tipoCitaId = reservaAnterior.tipo_cita_id;
  const tipoCitaTexto = tipoCitaId
    ? (await queryOneRetry<{ nombre_tipo: string }>('SELECT nombre_tipo FROM tipos_cita WHERE id = $1', [tipoCitaId]))
        ?.nombre_tipo ?? ''
    : '';

  // Orden deliberado: crea el hold NUEVO antes de tocar el viejo. Si el hueco
  // nuevo ya no esta libre (o falla Calendar), la reserva original queda intacta
  // y el paciente conserva su cita - un fallo aqui no debe dejarlo sin ninguna.
  // reagendadaDeId enlaza la fila nueva con la que se cancela justo debajo -
  // sin esto, una reprogramacion y una cancelacion+reserva-nueva independiente
  // son indistinguibles en los datos (metrica "citas reagendadas", 2026-08-19).
  const hold = await crearHold({ ...ctx, reagendadaDeId: reservaAnterior.id }, {
    inicio: input.nuevo_inicio,
    fin: input.nuevo_fin,
    tipo_cita: tipoCitaTexto,
    nombre: reservaAnterior.nombre,
    telefono: reservaAnterior.telefono,
  });

  if (!hold.ok) {
    return {
      ok: false,
      error: 'hueco_no_disponible',
      nota: 'Ese hueco ya no esta libre. La cita original del paciente NO se ha tocado. Disculpate brevemente, invoca consultar_disponibilidad para ofrecer otros huecos y vuelve a invocar reprogramar_cita cuando elija uno nuevo.',
    };
  }

  // Solo ahora, con la cita nueva ya creada, se cancela la anterior. Si esto
  // fallara aqui, el paciente se queda con AMBAS citas activas en vez de con
  // ninguna - preferible, y recuperable a mano.
  await marcarCancelada(reservaAnterior, ctx);

  const resumenEmail = cliente.resumen_email;
  if (resumenEmail) {
    const envio = await enviarEmail({
      to: resumenEmail,
      subject: `Cita reprogramada: ${reservaAnterior.nombre}`,
      html: `<p>El paciente <strong>${reservaAnterior.nombre}</strong> (${reservaAnterior.telefono}) ha movido su cita del <strong>${reservaAnterior.inicio}</strong> al <strong>${input.nuevo_inicio}</strong> a traves del agente de WhatsApp. Queda pendiente de confirmar.</p>`,
    });
    if (!envio.ok) {
      await logError({
        convId: ctx.convId,
        waId: ctx.waId,
        phoneNumberId: ctx.phoneNumberId,
        nodoOrigen: 'reprogramarCita',
        errorMensaje: `Fallo enviando email de aviso de reprogramacion: ${envio.error}`,
      });
    }
  } else {
    await logError({
      convId: ctx.convId,
      waId: ctx.waId,
      phoneNumberId: ctx.phoneNumberId,
      nodoOrigen: 'reprogramarCita',
      errorMensaje: 'Reprogramacion sin aviso: el cliente no tiene resumen_email configurado.',
    });
  }

  return hold;
}
