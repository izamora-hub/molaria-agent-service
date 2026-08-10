import Anthropic from '@anthropic-ai/sdk';
import { callClaude } from './clients/anthropic';
import { consultarDisponibilidad } from './tools/consultarDisponibilidad';
import { crearHold } from './tools/crearHold';
import { cancelarCita } from './tools/cancelarCita';
import { reprogramarCita } from './tools/reprogramarCita';
import { AgentRunRequest, AgentRunSuccess, ClaudeMessage } from './types';
import { getCachedAgentRun, cacheAgentRun, marcarProcesando, esperarResultado } from './clients/redisCache';
import { logAgente } from './clients/logAgente';

// Limite de vueltas del loop real. A diferencia de n8n (donde el loop estaba
// desenrollado a mano en 3 nodos Claude y una 4a llamada a herramienta se
// perdia sin gestionar), aqui es un bucle de verdad: subir este numero no
// requiere anadir nodos nuevos.
const MAX_ITERACIONES = 6;

const FALLBACK_SIN_RESOLVER =
  'He tenido que hacer varias comprobaciones seguidas y no he podido completar tu solicitud ahora mismo. Nuestro equipo la revisara y te contactara en breve. Disculpa las molestias.';

async function ejecutarHerramienta(
  bloque: Anthropic.ToolUseBlock,
  ctx: { phoneNumberId: string; convId: string; waId: string; clienteNombre: string }
): Promise<unknown> {
  if (bloque.name === 'consultar_disponibilidad') {
    return consultarDisponibilidad(ctx.phoneNumberId, bloque.input as never);
  }
  if (bloque.name === 'crear_hold') {
    return crearHold({ ...ctx, toolUseId: bloque.id }, bloque.input as never);
  }
  if (bloque.name === 'cancelar_cita') {
    return cancelarCita(ctx, bloque.input as never);
  }
  if (bloque.name === 'reprogramar_cita') {
    return reprogramarCita({ ...ctx, toolUseId: bloque.id }, bloque.input as never);
  }
  throw new Error(`Herramienta desconocida: ${bloque.name}`);
}

function extraerTexto(content: ClaudeMessage['content']): string {
  if (typeof content === 'string') return content;
  for (let i = content.length - 1; i >= 0; i--) {
    const bloque = content[i];
    if (bloque.type === 'text') return bloque.text;
  }
  return '';
}

// Pregunta que se registra en LogAgente: el ultimo mensaje del paciente tal
// como llego en el payload original, nunca de `messages` (que dentro del loop
// va acumulando tool_result que no son la pregunta real).
function ultimaPreguntaPaciente(messages: ClaudeMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return extraerTexto(messages[i].content);
  }
  return '';
}

export async function runAgentLoop(req: AgentRunRequest): Promise<AgentRunSuccess> {
  // Idempotencia por wamid: si LlamarServicioAgente (n8n) reintenta esta misma
  // peticion porque la respuesta anterior se perdio en transito, el turno ya
  // completado (con sus efectos secundarios ya aplicados) se devuelve tal cual
  // en vez de volver a ejecutarse. Ver clients/redisCache.ts.
  const cacheado = await getCachedAgentRun(req.wamid);
  if (cacheado) return cacheado;

  // C-01 (auditoria): lo de arriba no bastaba - un reintento que llega mientras
  // el primer intento AUN esta en marcha (timeout de n8n a los 60s con Claude+
  // tools todavia trabajando) no encontraba nada cacheado y ejecutaba el turno
  // entero otra vez en paralelo, duplicando holds/cancelaciones. marcarProcesando
  // reserva la clave nada mas empezar; si otra ejecucion ya la reservo, esta
  // espera su resultado real en vez de repetir el turno.
  const soyElPrimero = await marcarProcesando(req.wamid);
  if (!soyElPrimero) {
    const esperado = await esperarResultado(req.wamid, 90_000);
    if (esperado) return esperado;
    throw new Error(`runAgentLoop: timeout esperando resultado concurrente para wamid ${req.wamid}`);
  }

  const pregunta = ultimaPreguntaPaciente(req.messages);
  const messages: ClaudeMessage[] = [...req.messages];
  let herramientaUsada: AgentRunSuccess['herramienta_usada'] = null;

  let tokensIn = 0;
  let tokensOut = 0;
  let cacheWrite = 0;
  let cacheRead = 0;
  let llamadasClaude = 0;

  for (let vuelta = 0; vuelta < MAX_ITERACIONES; vuelta++) {
    const respuesta = await callClaude({
      systemEstatico: req.system_estatico,
      systemDinamico: req.system_dinamico,
      messages,
      toolsEnabled: req.tools_enabled,
    });

    llamadasClaude++;
    tokensIn += respuesta.usage.input_tokens;
    tokensOut += respuesta.usage.output_tokens;
    cacheWrite += respuesta.usage.cache_creation_input_tokens ?? 0;
    cacheRead += respuesta.usage.cache_read_input_tokens ?? 0;

    const bloqueTexto = respuesta.content.find((c): c is Anthropic.TextBlock => c.type === 'text');
    const bloqueHerramienta = respuesta.content.find(
      (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use'
    );

    if (!bloqueHerramienta) {
      const textoFinal = bloqueTexto?.text ?? FALLBACK_SIN_RESOLVER;
      messages.push({ role: 'assistant', content: [{ type: 'text', text: textoFinal }] });
      const resultadoFinal: AgentRunSuccess = {
        respuesta_texto: textoFinal,
        delta_messages: messages.slice(req.messages.length - 1),
        herramienta_usada: herramientaUsada,
      };
      await logAgente({
        execId: req.wamid,
        waId: req.wa_id,
        phoneNumberId: req.phone_number_id,
        pregunta,
        respondido: textoFinal !== FALLBACK_SIN_RESOLVER,
        respuesta: textoFinal,
        tokensIn,
        tokensOut,
        cacheWrite,
        cacheRead,
        llamadasClaude,
      });
      await cacheAgentRun(req.wamid, resultadoFinal);
      return resultadoFinal;
    }

    herramientaUsada = bloqueHerramienta.name as AgentRunSuccess['herramienta_usada'];

    let resultado: unknown;
    try {
      resultado = await ejecutarHerramienta(bloqueHerramienta, {
        phoneNumberId: req.phone_number_id,
        convId: req.conv_id,
        waId: req.wa_id,
        clienteNombre: req.cliente_nombre,
      });
    } catch (err) {
      // Fallo real ejecutando la herramienta (Calendar/Postgres caidos): no es
      // un resultado de negocio como "hueco_no_disponible", asi que se
      // propaga como error de la llamada completa en vez de devolverselo a Claude.
      throw err;
    }

    messages.push({ role: 'assistant', content: respuesta.content as ClaudeMessage['content'] });
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: bloqueHerramienta.id, content: JSON.stringify(resultado) }],
    });
  }

  // Se agotaron las vueltas sin que Claude devolviera texto final.
  messages.push({ role: 'assistant', content: [{ type: 'text', text: FALLBACK_SIN_RESOLVER }] });
  const resultadoAgotado: AgentRunSuccess = {
    respuesta_texto: FALLBACK_SIN_RESOLVER,
    delta_messages: messages.slice(req.messages.length - 1),
    herramienta_usada: herramientaUsada,
  };
  await logAgente({
    execId: req.wamid,
    waId: req.wa_id,
    phoneNumberId: req.phone_number_id,
    pregunta,
    respondido: false,
    respuesta: FALLBACK_SIN_RESOLVER,
    tokensIn,
    tokensOut,
    cacheWrite,
    cacheRead,
    llamadasClaude,
  });
  await cacheAgentRun(req.wamid, resultadoAgotado);
  return resultadoAgotado;
}
