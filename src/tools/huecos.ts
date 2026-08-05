import { DateTime } from 'luxon';
import { FreeBusyResult } from '../clients/googleCalendar';

// Puerto 1:1 del nodo "Huecos" del sub-workflow de Agenda (workflows/workflow-molaria-agenda.json
// en el repo molaria). Funcion pura para poder testearla sin Airtable ni Calendar de por medio.

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

export function norm(s: string | null | undefined): string {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Horario real de la clinica por dia de la semana (clave = nombre en DIAS,
// valor = lista de rangos [inicio,fin] "HH:mm", vacia si cierra ese dia).
// Soporta varios rangos por dia (ej. manana/tarde con parada al mediodia).
export type HorarioSemana = Partial<Record<string, [string, string][]>>;

export interface Ventana {
  calendar_id: string;
  timeZone: string;
  desde: string;
  hasta: string;
  nombre_tipo: string;
  duracion_min: number;
  colchon_min: number;
  redondeo_min: number;
  dias_reservables: string[];
  horario: HorarioSemana;
}

export interface HuecoOfrecido {
  inicio: string;
  fin: string;
  legible: string;
}

export interface HuecosOk {
  calendar_id: string;
  timeZone: string;
  nombre_tipo: string;
  duracion_min: number;
  dia_filtrado: string | null;
  total_libres: number;
  omitidos: number;
  quedan_mas: boolean;
  omitir_siguiente: number | null;
  ofrecer: HuecoOfrecido[];
}

export interface HuecosSinDia {
  error: 'sin_huecos_ese_dia';
  dia_pedido: string;
  mensaje: string;
}

export function calcularHuecos(
  ventana: Ventana,
  freeBusy: FreeBusyResult,
  omitir: number,
  diaSemanaPedido: string | undefined
): HuecosOk | HuecosSinDia {
  const OFRECER = 3;
  const OMITIR = Number(omitir) || 0;
  const DIA_PEDIDO = norm(diaSemanaPedido);

  const TZ = ventana.timeZone;
  const DUR = Number(ventana.duracion_min);
  const COLCHON = Number(ventana.colchon_min) || 0;
  const RED = Number(ventana.redondeo_min) || 1;
  // DIAS_OK normalizado igual que nombreDia mas abajo (norm()): si en Airtable
  // dias_reservables trae "Miercoles" o con tilde, sin esto el dia se descarta
  // en silencio y nunca se ofrecen huecos en el.
  const DIAS_OK = (ventana.dias_reservables || []).map(norm);

  // Sin este guard, un TipoCita mal configurado con duracion_min=0 (y
  // colchon_min=0) hace que "ini" nunca avance en el bucle de abajo. Como esta
  // funcion es sincrona sin ningun await, ese bucle infinito no cuelga solo
  // esta peticion: bloquea el event loop de Node entero, tumbando el servicio
  // para todas las clinicas hasta reiniciar el proceso a mano.
  if (!(DUR > 0)) {
    throw new Error(`calcularHuecos: duracion_min invalida (${ventana.duracion_min}) para "${ventana.nombre_tipo}"`);
  }

  const desde = DateTime.fromISO(ventana.desde).setZone(TZ);
  const hasta = DateTime.fromISO(ventana.hasta).setZone(TZ);
  const HORARIO = ventana.horario || {};

  const busyRaw = (freeBusy.busy || [])
    .map((b) => ({ ini: DateTime.fromISO(b.start).setZone(TZ), fin: DateTime.fromISO(b.end).setZone(TZ) }))
    .sort((a, b) => a.ini.toMillis() - b.ini.toMillis());

  const ocupado: { ini: DateTime<boolean>; fin: DateTime<boolean> }[] = [];
  for (const b of busyRaw) {
    const ult = ocupado[ocupado.length - 1];
    if (ult && b.ini <= ult.fin) {
      if (b.fin > ult.fin) ult.fin = b.fin;
    } else {
      ocupado.push({ ini: b.ini, fin: b.fin });
    }
  }

  const redondear = (dt: DateTime<boolean>): DateTime<boolean> => {
    if (RED <= 1) return dt.set({ second: 0, millisecond: 0 });
    const resto = dt.minute % RED;
    const out = resto === 0 ? dt : dt.plus({ minutes: RED - resto });
    return out.set({ second: 0, millisecond: 0 });
  };

  const slots: { inicio: string; fin: string }[] = [];
  let dia = desde.startOf('day');

  while (dia <= hasta) {
    const nombreDia = DIAS[dia.weekday % 7];
    if (DIAS_OK.includes(nombreDia)) {
      const rangos = HORARIO[nombreDia] || [];
      for (const [horaIni, horaFin] of rangos) {
        const [hIni, mIni] = horaIni.split(':').map(Number);
        const [hFin, mFin] = horaFin.split(':').map(Number);
        const apertura = dia.set({ hour: hIni, minute: mIni, second: 0, millisecond: 0 });
        const cierre = dia.set({ hour: hFin, minute: mFin, second: 0, millisecond: 0 });

        const trozos: { ini: DateTime<boolean>; fin: DateTime<boolean>; tras_evento: boolean }[] = [];
        let cursor: DateTime<boolean> = apertura;
        for (const b of ocupado) {
          if (b.fin <= apertura || b.ini >= cierre) continue;
          if (b.ini > cursor) trozos.push({ ini: cursor, fin: b.ini, tras_evento: cursor > apertura });
          if (b.fin > cursor) cursor = b.fin;
        }
        if (cursor < cierre) trozos.push({ ini: cursor, fin: cierre, tras_evento: cursor > apertura });

        for (const t of trozos) {
          let ini: DateTime<boolean> = t.tras_evento ? t.ini.plus({ minutes: COLCHON }) : t.ini;
          if (ini < desde) ini = desde;
          ini = redondear(ini);

          while (ini.plus({ minutes: DUR }) <= t.fin && ini.plus({ minutes: DUR }) <= cierre) {
            slots.push({ inicio: ini.toISO()!, fin: ini.plus({ minutes: DUR }).toISO()! });
            ini = redondear(ini.plus({ minutes: DUR + COLCHON }));
          }
        }
      }
    }
    dia = dia.plus({ days: 1 });
  }

  let candidatos = slots;
  if (DIA_PEDIDO) {
    candidatos = slots.filter((s) => DIAS[DateTime.fromISO(s.inicio).setZone(TZ).weekday % 7] === DIA_PEDIDO);
    if (candidatos.length === 0) {
      return {
        error: 'sin_huecos_ese_dia',
        dia_pedido: DIA_PEDIDO,
        mensaje: `No hay huecos disponibles en ${DIA_PEDIDO} dentro del horizonte. Ofrecele los proximos huecos disponibles sin filtrar por dia.`,
      };
    }
  }

  const ofrecer: HuecoOfrecido[] = candidatos.slice(OMITIR, OMITIR + OFRECER).map((s) => ({
    inicio: s.inicio,
    fin: s.fin,
    legible: DateTime.fromISO(s.inicio).setZone(TZ).setLocale('es').toFormat("cccc d 'de' LLLL 'a las' HH:mm"),
  }));

  const quedanMas = candidatos.length > OMITIR + OFRECER;

  return {
    calendar_id: ventana.calendar_id,
    timeZone: TZ,
    nombre_tipo: ventana.nombre_tipo,
    duracion_min: DUR,
    dia_filtrado: DIA_PEDIDO || null,
    total_libres: candidatos.length,
    omitidos: OMITIR,
    quedan_mas: quedanMas,
    omitir_siguiente: quedanMas ? OMITIR + OFRECER : null,
    ofrecer,
  };
}
