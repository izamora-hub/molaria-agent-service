const DIAS_VALIDOS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const HORA_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function minutosDesdeMedianoche(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function comoRegistro(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
}

// Validacion de servidor del payload de /alta (requisito 5: no confiar en la
// del cliente, el formulario ya valida ahi pero esto es la unica barrera
// real). Devuelve el primer error encontrado, no la lista completa - mismo
// criterio que el "primer campo que falta" de index.ts para /agent/run.
export function validarAlta(body: Record<string, unknown>): string | null {
  if (typeof body.token !== 'string' || !body.token) return 'Falta el campo token';
  if (typeof body.enviado_en !== 'string' || !body.enviado_en) return 'Falta el campo enviado_en';
  if (typeof body.requiere_revision !== 'boolean') return 'requiere_revision debe ser boolean';

  const clinica = comoRegistro(body.clinica);
  if (typeof clinica.nombre !== 'string' || !clinica.nombre.trim()) return 'clinica.nombre es obligatorio';
  if (typeof clinica.direccion !== 'string' || !clinica.direccion.trim()) return 'clinica.direccion es obligatorio';
  if (typeof clinica.telefono_derivacion !== 'string' || !clinica.telefono_derivacion.trim()) {
    return 'clinica.telefono_derivacion es obligatorio';
  }
  if (typeof clinica.email_avisos !== 'string' || !EMAIL_REGEX.test(clinica.email_avisos)) {
    return 'clinica.email_avisos no tiene formato de email valido';
  }

  const horarios = body.horarios;
  if (!Array.isArray(horarios) || horarios.length !== 7) return 'horarios debe tener exactamente 7 elementos';
  const diasVistos = new Set<string>();
  let algunDiaAbierto = false;
  for (const h of horarios) {
    const dia = comoRegistro(h).dia;
    const cerrado = comoRegistro(h).cerrado;
    const franjas = comoRegistro(h).franjas;
    if (typeof dia !== 'string' || !DIAS_VALIDOS.includes(dia)) return `horarios: dia invalido "${String(dia)}"`;
    if (diasVistos.has(dia)) return `horarios: dia repetido "${dia}"`;
    diasVistos.add(dia);
    if (typeof cerrado !== 'boolean') return `horarios[${dia}].cerrado debe ser boolean`;
    if (!Array.isArray(franjas) || franjas.length > 2) {
      return `horarios[${dia}].franjas debe ser un array de 0 a 2 elementos`;
    }
    if (!cerrado && franjas.length > 0) algunDiaAbierto = true;
    for (const f of franjas) {
      const desde = comoRegistro(f).desde;
      const hasta = comoRegistro(f).hasta;
      if (typeof desde !== 'string' || !HORA_REGEX.test(desde)) return `horarios[${dia}]: franja.desde invalida`;
      if (typeof hasta !== 'string' || !HORA_REGEX.test(hasta)) return `horarios[${dia}]: franja.hasta invalida`;
      if (minutosDesdeMedianoche(hasta) <= minutosDesdeMedianoche(desde)) {
        return `horarios[${dia}]: franja.hasta debe ser posterior a franja.desde`;
      }
    }
  }
  if (!algunDiaAbierto) return 'horarios: al menos un dia debe estar abierto con alguna franja';

  const servicios = body.servicios;
  if (!Array.isArray(servicios) || servicios.length === 0) return 'servicios debe tener al menos un elemento';
  for (const s of servicios) {
    const nombre = comoRegistro(s).nombre;
    if (typeof nombre !== 'string' || !nombre.trim()) return 'servicios: cada elemento necesita nombre';
    const precio = comoRegistro(s).precio_eur;
    if (precio !== null && typeof precio !== 'number') return 'servicios: precio_eur debe ser number o null';
  }

  const tipos = body.tipos_cita;
  if (!Array.isArray(tipos) || tipos.length === 0) return 'tipos_cita debe tener al menos un elemento';
  for (const t of tipos) {
    const nombre = comoRegistro(t).nombre;
    const duracion = comoRegistro(t).duracion_min;
    const colchon = comoRegistro(t).colchon_min;
    if (typeof nombre !== 'string' || !nombre.trim()) return 'tipos_cita: cada elemento necesita nombre';
    if (typeof duracion !== 'number' || !Number.isInteger(duracion) || duracion <= 0) {
      return `tipos_cita "${nombre}": duracion_min debe ser un entero mayor que 0`;
    }
    if (typeof colchon !== 'number' || !Number.isInteger(colchon) || colchon < 0) {
      return `tipos_cita "${nombre}": colchon_min debe ser un entero >= 0`;
    }
  }

  const condiciones = comoRegistro(body.condiciones);
  if (typeof condiciones.mutuas !== 'boolean') return 'condiciones.mutuas debe ser boolean';
  if (typeof condiciones.financiacion !== 'boolean') return 'condiciones.financiacion debe ser boolean';
  if (condiciones.mutuas_detalle !== null && typeof condiciones.mutuas_detalle !== 'string') {
    return 'condiciones.mutuas_detalle debe ser string o null';
  }
  if (condiciones.financiacion_detalle !== null && typeof condiciones.financiacion_detalle !== 'string') {
    return 'condiciones.financiacion_detalle debe ser string o null';
  }

  if (!Array.isArray(body.faqs)) return 'faqs debe ser un array';
  for (const f of body.faqs) {
    const pregunta = comoRegistro(f).pregunta;
    const respuesta = comoRegistro(f).respuesta;
    const marcada = comoRegistro(f).marcada_para_revision;
    if (typeof pregunta !== 'string' || !pregunta.trim()) return 'faqs: cada elemento necesita pregunta';
    if (typeof respuesta !== 'string' || !respuesta.trim()) return 'faqs: cada elemento necesita respuesta';
    if (typeof marcada !== 'boolean') return 'faqs: marcada_para_revision debe ser boolean';
  }

  if (!Array.isArray(body.no_afirmar) || !body.no_afirmar.every((x) => typeof x === 'string')) {
    return 'no_afirmar debe ser un array de strings';
  }

  if (body.notas !== null && typeof body.notas !== 'string') return 'notas debe ser string o null';

  return null;
}
