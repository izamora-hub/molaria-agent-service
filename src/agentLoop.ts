import Anthropic from '@anthropic-ai/sdk';
import { callClaude } from './clients/anthropic';
import { consultarDisponibilidad } from './tools/consultarDisponibilidad';
import { crearHold } from './tools/crearHold';
import { cancelarCita } from './tools/cancelarCita';
import { reprogramarCita } from './tools/reprogramarCita';
import { AgentRunRequest, AgentRunSuccess, ClaudeMessage } from './types';
import { getCachedAgentRun, cacheAgentRun } from './clients/redisCache';

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

export async function runAgentLoop(req: AgentRunRequest): Promise<AgentRunSuccess> {
  // Idempotencia por wamid: si LlamarServicioAgente (n8n) reintenta esta misma
  // peticion porque la respuesta anterior se perdio en transito, el turno ya
  // completado (con sus efectos secundarios ya aplicados) se devuelve tal cual
  // en vez de volver a ejecutarse. Ver clients/redisCache.ts.
  const cacheado = await getCachedAgentRun(req.wamid);
  if (cacheado) return cacheado;

  const messages: ClaudeMessage[] = [...req.messages];
  let herramientaUsada: AgentRunSuccess['herramienta_usada'] = null;

  for (let vuelta = 0; vuelta < MAX_ITERACIONES; vuelta++) {
    const respuesta = await callClaude({
      systemEstatico: req.system_estatico,
      systemDinamico: req.system_dinamico,
      messages,
      toolsEnabled: req.tools_enabled,
    });

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
      // Fallo real ejecutando la herramienta (Calendar/Airtable caidos): no es
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
  await cacheAgentRun(req.wamid, resultadoAgotado);
  return resultadoAgotado;
}
