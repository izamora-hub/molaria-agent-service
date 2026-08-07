import { query } from './db';
import { enviarTelegram } from './telegram';

// Misma tabla y shape que ya usa el nodo LogError de n8n, mas una alerta
// instantanea por Telegram (el informe semanal solo lee Errores una vez por
// semana - sin esto, un fallo tarda hasta 7 dias en hacerse visible, y solo si
// alguien lo lee). Nunca lanza: es un log de mejor esfuerzo, no puede tumbar el
// flujo que lo invoca.
export async function logError(params: {
  convId: string;
  waId: string;
  phoneNumberId: string;
  nodoOrigen: string;
  errorMensaje: string;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO errores (conv_id, wa_id, phone_number_id, nodo_origen, error_mensaje, timestamp)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [params.convId, params.waId, params.phoneNumberId, params.nodoOrigen, params.errorMensaje]
    );
  } catch (err) {
    console.error('Fallo escribiendo en Errores:', err);
  }

  await enviarTelegram(
    `⚠️ Fallo en ${params.nodoOrigen}\n${params.errorMensaje}\nconv_id: ${params.convId}`
  );
}
