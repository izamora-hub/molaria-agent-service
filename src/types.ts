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
  wamid: string;
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
  herramienta_usada:
    | 'consultar_disponibilidad'
    | 'crear_hold'
    | 'cancelar_cita'
    | 'reprogramar_cita'
    | null;
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

export interface CancelarCitaInput {
  telefono: string;
  inicio?: string;
}

export interface ReprogramarCitaInput {
  telefono: string;
  inicio?: string;
  nuevo_inicio: string;
  nuevo_fin: string;
}

export interface AltaFranja {
  desde: string;
  hasta: string;
}

export interface AltaHorarioDia {
  dia: string;
  cerrado: boolean;
  franjas: AltaFranja[];
}

export interface AltaServicio {
  nombre: string;
  precio_eur: number | null;
  nota: string | null;
}

export interface AltaTipoCita {
  nombre: string;
  duracion_min: number;
  colchon_min: number;
}

export interface AltaFaq {
  pregunta: string;
  respuesta: string;
  marcada_para_revision: boolean;
}

export interface AltaClinica {
  nombre: string;
  direccion: string;
  telefono_derivacion: string;
  email_avisos: string;
}

export interface AltaCondiciones {
  mutuas: boolean;
  mutuas_detalle: string | null;
  financiacion: boolean;
  financiacion_detalle: string | null;
}

export interface AltaPayload {
  token: string;
  enviado_en: string;
  requiere_revision: boolean;
  website?: string; // honeypot - nunca deberia venir relleno
  clinica: AltaClinica;
  horarios: AltaHorarioDia[];
  servicios: AltaServicio[];
  tipos_cita: AltaTipoCita[];
  condiciones: AltaCondiciones;
  faqs: AltaFaq[];
  no_afirmar: string[];
  notas: string | null;
}
