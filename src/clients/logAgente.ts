import { query } from './db';

// Precios Claude Sonnet (USD por millon de tokens) - deben coincidir con el
// modelo fijado en clients/anthropic.ts (MODEL). Ajustar si ese modelo cambia.
const PRECIO_INPUT_POR_MILLON = 3;
const PRECIO_OUTPUT_POR_MILLON = 15;
const PRECIO_CACHE_WRITE_POR_MILLON = 3.75; // 1.25x input, tarifa estandar de cache de Anthropic
const PRECIO_CACHE_READ_POR_MILLON = 0.3; // 0.1x input

function calcularCosteUsd(params: {
  tokensIn: number;
  tokensOut: number;
  cacheWrite: number;
  cacheRead: number;
}): number {
  const coste =
    (params.tokensIn / 1_000_000) * PRECIO_INPUT_POR_MILLON +
    (params.tokensOut / 1_000_000) * PRECIO_OUTPUT_POR_MILLON +
    (params.cacheWrite / 1_000_000) * PRECIO_CACHE_WRITE_POR_MILLON +
    (params.cacheRead / 1_000_000) * PRECIO_CACHE_READ_POR_MILLON;
  return Number(coste.toFixed(6));
}

// Best-effort, como logError.ts: nunca lanza, un fallo aqui no puede tumbar la
// respuesta al paciente. Una fila por turno (por llamada a runAgentLoop), no
// por cada llamada individual a Claude dentro del loop - llamadasClaude cuenta
// cuantas hizo falta para ese turno.
export async function logAgente(params: {
  execId: string;
  waId: string;
  phoneNumberId: string;
  pregunta: string;
  respondido: boolean;
  respuesta: string;
  tokensIn: number;
  tokensOut: number;
  cacheWrite: number;
  cacheRead: number;
  llamadasClaude: number;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO log_agente (
         exec_id, timestamp, origen, wa_id_corto, phone_number_id, tipo, pregunta,
         respondido, respuesta, tokens_in, tokens_out, llamadas_claude, cache_write,
         cache_read, coste_usd
       ) VALUES ($1, now(), 'Paciente', $2, $3, 'text', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      // TODO: distinguir Paciente/Sita (staff) cuando se decida como detectarlo -
      // de momento todo se marca Paciente, ver conversacion sobre REC/LogAgente.
      [
        params.execId,
        params.waId.slice(-4),
        params.phoneNumberId,
        params.pregunta,
        params.respondido,
        params.respuesta,
        params.tokensIn,
        params.tokensOut,
        params.llamadasClaude,
        params.cacheWrite,
        params.cacheRead,
        calcularCosteUsd(params),
      ]
    );
  } catch (err) {
    console.error('Fallo escribiendo en LogAgente:', err);
  }
}
