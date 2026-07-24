import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { ClaudeMessage } from '../types';

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

export const TOOLS = [
  {
    name: 'consultar_disponibilidad',
    description:
      'Devuelve los huecos libres reales para un tipo de cita, leyendo el calendario del cliente. Es la UNICA fuente valida de disponibilidad: nunca inventes, deduzcas ni estimes huecos, y nunca derives al telefono para darlos. Invocala en cuanto sepas el tipo de cita que quiere el paciente, sin anunciar antes que vas a hacerlo. Permite filtrar por dia de la semana. Si el tipo que envias no existe, la herramienta te devolvera la lista de tipos validos para que reintentes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tipo_cita: {
          type: 'string',
          description:
            'Tipo de cita en lenguaje natural, tal como se deduce de la conversacion. Basta con saber si el paciente viene por primera vez ("primera visita") o si ya es paciente ("visita de seguimiento").',
        },
        omitir: {
          type: 'integer',
          description:
            'Cuantos huecos ya ofrecidos hay que saltar. Omitir este parametro en la primera consulta. Si el paciente rechaza los huecos y pide otros, sumale 3 al valor de la llamada anterior (0 -> 3 -> 6 -> 9). No calcules fechas: solo cuenta cuantos huecos le has ensenado ya.',
        },
        dia_semana: {
          type: 'string',
          enum: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],
          description:
            'Opcional. Usalo SOLO si el paciente pide un dia de la semana concreto. Copia el nombre del dia en minusculas y sin tilde. NUNCA pongas aqui una fecha, ni un numero, ni "la semana que viene". Si ya has filtrado por un dia, repite el mismo valor en las llamadas siguientes de esa busqueda, incluso al aumentar omitir.',
        },
      },
      required: ['tipo_cita'],
    },
  },
  {
    name: 'crear_hold',
    description:
      'Anota una SOLICITUD de cita: bloquea provisionalmente el hueco en el calendario y la registra como pendiente de confirmacion por parte de la clinica. NO confirma la cita. Invocala solo cuando ya tengas los cuatro datos: hueco elegido, nombre y telefono del paciente, y tipo de cita. Si el hueco ha sido ocupado mientras hablabais, te devolvera un error y deberas ofrecer otros huecos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        inicio: {
          type: 'string',
          description:
            'Fecha y hora de inicio del hueco elegido, COPIADA LITERALMENTE del campo "inicio" que devolvio consultar_disponibilidad. No la recalcules ni cambies su formato.',
        },
        fin: {
          type: 'string',
          description:
            'Fecha y hora de fin del hueco elegido, COPIADA LITERALMENTE del campo "fin" que devolvio consultar_disponibilidad. No la recalcules ni cambies su formato.',
        },
        tipo_cita: { type: 'string', description: 'El mismo tipo de cita con el que se consulto la disponibilidad.' },
        nombre: { type: 'string', description: 'Nombre completo del paciente, tal como lo ha escrito.' },
        telefono: { type: 'string', description: 'Telefono de contacto que ha dado el paciente.' },
      },
      required: ['inicio', 'fin', 'tipo_cita', 'nombre', 'telefono'],
    },
  },
];

function withCache(messages: ClaudeMessage[]): ClaudeMessage[] {
  if (messages.length === 0) return messages;
  const msgs = messages.map((m) => ({ ...m }));
  const last = msgs[msgs.length - 1];
  if (typeof last.content === 'string') {
    last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }];
  } else {
    const c = last.content.map((b) => ({ ...b }));
    c[c.length - 1] = { ...c[c.length - 1], cache_control: { type: 'ephemeral' } } as typeof c[number];
    last.content = c;
  }
  return msgs;
}

export async function callClaude(params: {
  systemEstatico: string;
  systemDinamico: string;
  messages: ClaudeMessage[];
  toolsEnabled: boolean;
}): Promise<Anthropic.Message> {
  return anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: params.systemEstatico, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: params.systemDinamico },
    ],
    messages: withCache(params.messages) as Anthropic.MessageParam[],
    ...(params.toolsEnabled ? { tools: TOOLS } : {}),
  });
}
