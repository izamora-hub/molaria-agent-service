import { enviarEmail } from '../clients/resend';
import { logError } from '../clients/logError';
import { buscarCliente, buscarReservaCancelable, marcarCancelada, BuscarReservaResultado } from './citas';
import { CancelarCitaInput } from '../types';

export type CancelarCitaResultado =
  | Exclude<BuscarReservaResultado, { ok: true }>
  | { ok: true; estado: 'cancelada'; inicio: string; nota: string };

export async function cancelarCita(
  ctx: { phoneNumberId: string; convId: string; waId: string },
  input: CancelarCitaInput
): Promise<CancelarCitaResultado> {
  const cliente = await buscarCliente(ctx.phoneNumberId);

  const resultado = await buscarReservaCancelable(cliente, ctx.phoneNumberId, input.telefono, input.inicio);
  if (!resultado.ok) return resultado;

  const reserva = resultado.reserva;
  await marcarCancelada(reserva, ctx);

  const resumenEmail = cliente.fields.resumen_email;
  if (resumenEmail) {
    const envio = await enviarEmail({
      to: resumenEmail,
      subject: `Cita cancelada: ${reserva.fields.nombre}`,
      html: `<p>El paciente <strong>${reserva.fields.nombre}</strong> (${reserva.fields.telefono}) ha cancelado su cita del <strong>${reserva.fields.inicio}</strong> a traves del agente de WhatsApp.</p>`,
    });
    if (!envio.ok) {
      await logError({
        convId: ctx.convId,
        waId: ctx.waId,
        phoneNumberId: ctx.phoneNumberId,
        nodoOrigen: 'cancelarCita',
        errorMensaje: `Fallo enviando email de aviso de cancelacion: ${envio.error}`,
      });
    }
  } else {
    await logError({
      convId: ctx.convId,
      waId: ctx.waId,
      phoneNumberId: ctx.phoneNumberId,
      nodoOrigen: 'cancelarCita',
      errorMensaje: 'Cancelacion sin aviso: el cliente no tiene resumen_email configurado.',
    });
  }

  return {
    ok: true,
    estado: 'cancelada',
    inicio: reserva.fields.inicio,
    nota: 'La cita ha quedado cancelada. Confirmaselo al paciente con naturalidad.',
  };
}
