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
  {
    name: 'cancelar_cita',
    description:
      'Cancela una cita activa del paciente. La herramienta identifica automaticamente de quien es la cita por el numero de WhatsApp desde el que escribe - nunca le pidas el telefono ni se lo preguntes para esto, y si te lo da igualmente ignoralo, no es un dato que puedas pasarle a la herramienta. Invocala en cuanto el paciente pida cancelar. Si tiene mas de una cita activa, la herramienta te devolvera una lista para que le preguntes por cual fecha, y debes volver a invocarla pasando el campo inicio con el valor EXACTO de la opcion elegida. Si el plazo de cancelacion de la clinica ya se ha cumplido, te lo indicara para que derives al paciente a la clinica.',
    input_schema: {
      type: 'object' as const,
      properties: {
        inicio: {
          type: 'string',
          description:
            'Solo cuando la herramienta te haya devuelto varias opciones para desambiguar: copia aqui, LITERALMENTE, el campo "inicio" de la opcion que el paciente ha elegido. Omitelo en la primera llamada.',
        },
      },
      required: [],
    },
  },
  {
    name: 'reprogramar_cita',
    description:
      'Mueve la cita activa del paciente a un hueco nuevo: crea una SOLICITUD de cita en el hueco nuevo (pendiente de confirmacion por la clinica, igual que crear_hold) y solo entonces cancela la anterior. La herramienta identifica automaticamente de quien es la cita por el numero de WhatsApp desde el que escribe - nunca le pidas el telefono ni se lo preguntes para esto, y si te lo da igualmente ignoralo, no es un dato que puedas pasarle a la herramienta. Invocala solo cuando ya tengas el hueco nuevo elegido (obtenido con consultar_disponibilidad). Si tiene mas de una cita activa, te devolvera una lista para desambiguar por fecha, igual que cancelar_cita: vuelve a invocarla con el campo inicio EXACTO de la opcion elegida. Si el plazo de cancelacion ya se ha cumplido, te lo indicara para derivar a la clinica. Si el hueco nuevo elegido ya no esta libre, la cita original queda intacta (no se pierde) y debes ofrecer otros huecos y volver a invocar la herramienta.',
    input_schema: {
      type: 'object' as const,
      properties: {
        inicio: {
          type: 'string',
          description:
            'Solo para desambiguar cuando la herramienta te haya devuelto varias opciones: copia aqui, LITERALMENTE, el "inicio" de la cita elegida. Omitelo en la primera llamada.',
        },
        nuevo_inicio: {
          type: 'string',
          description:
            'Fecha y hora de inicio del hueco nuevo, COPIADA LITERALMENTE del campo "inicio" que devolvio consultar_disponibilidad. No la recalcules ni cambies su formato.',
        },
        nuevo_fin: {
          type: 'string',
          description:
            'Fecha y hora de fin del hueco nuevo, COPIADA LITERALMENTE del campo "fin" que devolvio consultar_disponibilidad. No la recalcules ni cambies su formato.',
        },
      },
      required: ['nuevo_inicio', 'nuevo_fin'],
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
    // disable_parallel_tool_use: el resto del codigo (agentLoop.ts) solo lee el
    // PRIMER bloque tool_use de la respuesta - si Claude alguna vez paralelizara
    // 2 herramientas en el mismo turno, solo se ejecutaria y respondiera una,
    // y la siguiente llamada a la API fallaria con 400 (falta un tool_result
    // por cada tool_use del turno anterior). El procedimiento del prompt ya
    // exige una herramienta a la vez, asi que esto no quita capacidad real.
    ...(params.toolsEnabled ? { tools: TOOLS, tool_choice: { type: 'auto', disable_parallel_tool_use: true } } : {}),
  });
}
