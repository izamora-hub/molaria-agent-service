export type ClaudeContentBlock =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
}

export interface AgentRunRequest {
  conv_id: string;
  phone_number_id: string;
  wa_id: string;
  cliente_nombre: string;
  telefono_derivacion?: string;
  system_estatico: string;
  system_dinamico: string;
  tools_enabled: boolean;
  messages: ClaudeMessage[];
}

export interface AgentRunSuccess {
  respuesta_texto: string;
  delta_messages: ClaudeMessage[];
  herramienta_usada: 'consultar_disponibilidad' | 'crear_hold' | null;
}

export interface AgentRunError {
  error: { codigo: string; mensaje: string };
}

export type AgentRunResponse = AgentRunSuccess | AgentRunError;

export interface ConsultarDisponibilidadInput {
  tipo_cita: string;
  omitir?: number;
  dia_semana?: string;
}

export interface CrearHoldInput {
  inicio: string;
  fin: string;
  tipo_cita: string;
  nombre: string;
  telefono: string;
}
