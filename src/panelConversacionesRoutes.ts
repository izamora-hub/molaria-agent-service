import { Router } from 'express';
import { queryPanel, queryOnePanel } from './clients/dbPanel';
import { requireSesionPanel, RequestConSesion } from './panelAuth';
import { registrarAuditoria } from './panelAuditoria';
import { ClaudeMessage } from './types';

export const panelConversacionesRoutes = Router();

const LIMITE_LISTADO = 50;

// 1-04: oculta todo menos los ultimos 3 digitos. No hay endpoint de
// "revelar" todavia - la ficha de la tarea lo deja como opcional
// ("si se justifica") y no se ha pedido, mejor no abrir esa superficie
// hasta que haga falta de verdad.
const MASCARA_PUNTOS = 6; // fijo: la longitud real del numero no debe filtrarse por el numero de puntos
function enmascararTelefono(numero: string): string {
  if (numero.length <= 3) return '•'.repeat(MASCARA_PUNTOS);
  return '•'.repeat(MASCARA_PUNTOS) + numero.slice(-3);
}

// Historial mezcla content como string (mensajes de usuario, ver Componer en
// el workflow n8n) y como array de bloques Anthropic (assistant/tool_result).
// Los bloques tool_use/tool_result son plomeria interna, no conversacion real
// - se descartan aqui, la clinica solo ve texto.
function extraerTextoMensaje(content: ClaudeMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

interface ClientePanel {
  id: string;
  phone_number_id: string;
}

async function obtenerClientePanel(clienteId: string): Promise<ClientePanel | null> {
  return queryOnePanel<ClientePanel>('SELECT id, phone_number_id FROM clientes WHERE id = $1', [clienteId]);
}

// Lista de conversaciones de la clinica autenticada (1-06). Aislamiento por
// phone_number_id derivado de la sesion (1-02), nunca de un parametro de la
// request - ver panelAuth.ts.
panelConversacionesRoutes.get('/conversaciones', requireSesionPanel, async (req: RequestConSesion, res) => {
  const cliente = await obtenerClientePanel(req.sesion!.cliente_id);
  if (!cliente) {
    res.status(401).json({ error: { codigo: 'sesion_invalida', mensaje: 'Inicia sesion de nuevo' } });
    return;
  }

  const q = typeof req.query.q === 'string' ? req.query.q.replace(/\D/g, '') : '';

  const filas = await queryPanel<{ id: string; conv_id: string; ultima_actividad: string; historial: ClaudeMessage[] | null }>(
    `SELECT id, conv_id, ultima_actividad, historial
     FROM conversaciones
     WHERE split_part(conv_id, '_', 1) = $1
       AND ($2 = '' OR split_part(conv_id, '_', 2) ILIKE '%' || $2 || '%')
     ORDER BY ultima_actividad DESC
     LIMIT ${LIMITE_LISTADO}`,
    [cliente.phone_number_id, q]
  );

  const conversaciones = filas.map((fila) => {
    const waId = fila.conv_id.split('_').slice(1).join('_');
    const historial = fila.historial ?? [];
    // Ultimo mensaje del PACIENTE, no el ultimo del array (que suele ser el
    // cierre del agente) - para supervisar interesa que pregunto, no como
    // respondio el agente (revision 2026-08-19). role:'user' tambien cubre
    // tool_result (ver agentLoop.ts) que no tiene texto - se descarta junto
    // con el resto de mensajes de usuario vacios de contenido visible.
    let ultimoMensaje = '';
    for (let i = historial.length - 1; i >= 0; i--) {
      if (historial[i].role !== 'user') continue;
      const texto = extraerTextoMensaje(historial[i].content);
      if (texto) {
        ultimoMensaje = texto;
        break;
      }
    }
    return {
      id: fila.id,
      ultima_actividad: fila.ultima_actividad,
      telefono_enmascarado: enmascararTelefono(waId),
      ultimo_mensaje: ultimoMensaje.slice(0, 140),
    };
  });

  res.json({ ok: true, conversaciones });
});

// Detalle de una conversacion (1-06). El WHERE incluye el filtro de
// aislamiento, no solo el listado - una request directa a un id de otra
// clinica debe dar 404, igual de indistinguible que "no existe" (1-07: esto
// es justo la superficie que hay que probar activamente en cuanto haya
// datos de dos tenants).
panelConversacionesRoutes.get('/conversaciones/:id', requireSesionPanel, async (req: RequestConSesion, res) => {
  const cliente = await obtenerClientePanel(req.sesion!.cliente_id);
  if (!cliente) {
    res.status(401).json({ error: { codigo: 'sesion_invalida', mensaje: 'Inicia sesion de nuevo' } });
    return;
  }

  let fila: { id: string; conv_id: string; ultima_actividad: string; historial: ClaudeMessage[] | null } | null;
  try {
    fila = await queryOnePanel(
      `SELECT id, conv_id, ultima_actividad, historial
       FROM conversaciones
       WHERE id = $1 AND split_part(conv_id, '_', 1) = $2`,
      [req.params.id, cliente.phone_number_id]
    );
  } catch {
    fila = null; // id con formato invalido (no es un uuid) -> mismo 404 que "no existe"
  }

  if (!fila) {
    res.status(404).json({ error: { codigo: 'no_encontrada', mensaje: 'Conversacion no encontrada' } });
    return;
  }

  await registrarAuditoria(req, { clienteId: cliente.id, tipo: 'lectura_conversacion', conversacionId: fila.id });

  const waId = fila.conv_id.split('_').slice(1).join('_');
  const mensajes = (fila.historial ?? [])
    .map((m) => ({ role: m.role, texto: extraerTextoMensaje(m.content) }))
    .filter((m) => m.texto);

  res.json({
    ok: true,
    id: fila.id,
    ultima_actividad: fila.ultima_actividad,
    telefono_enmascarado: enmascararTelefono(waId),
    mensajes,
  });
});
