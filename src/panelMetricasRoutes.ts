import { Router } from 'express';
import { queryOnePanel } from './clients/dbPanel';
import { requireSesionPanel, RequestConSesion } from './panelAuth';

export const panelMetricasRoutes = Router();

const DIAS_RANGO_DEFECTO = 30;

interface ClientePanel {
  id: string;
  phone_number_id: string;
}

async function obtenerClientePanel(clienteId: string): Promise<ClientePanel | null> {
  return queryOnePanel<ClientePanel>('SELECT id, phone_number_id FROM clientes WHERE id = $1', [clienteId]);
}

function fechaValida(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// 1-05, con alcance reducido a proposito (decision 2026-08-19): solo las dos
// metricas que se pueden calcular con datos que ya existen. "Derivaciones a
// humano" y "no-shows" no tienen ningun evento/columna que las registre hoy
// (telefono_derivacion es solo el numero que se le da al paciente, no un
// log; reserva_estado_t no tiene un estado de no-show) - instrumentarlas es
// tarea aparte, no bloquea esto.
//
// conversaciones_atendidas se ancla en ultima_actividad (unica marca de
// tiempo de actividad que se guarda por conversacion, ver conversaciones.md
// en CLAUDE.md) - una conversacion con actividad fuera del rango pedido no
// cuenta, aunque existiera antes. citas_creadas se ancla en creado_en.
panelMetricasRoutes.get('/metricas', requireSesionPanel, async (req: RequestConSesion, res) => {
  const cliente = await obtenerClientePanel(req.sesion!.cliente_id);
  if (!cliente) {
    res.status(401).json({ error: { codigo: 'sesion_invalida', mensaje: 'Inicia sesion de nuevo' } });
    return;
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - DIAS_RANGO_DEFECTO * 86400000).toISOString().slice(0, 10);
  const desde = fechaValida(req.query.desde) ? req.query.desde : hace30;
  const hasta = fechaValida(req.query.hasta) ? req.query.hasta : hoy;

  const conv = await queryOnePanel<{ n: string }>(
    `SELECT count(*) AS n
     FROM conversaciones c
     WHERE split_part(c.conv_id, '_', 1) = $1
       AND c.ultima_actividad >= $2::date
       AND c.ultima_actividad < ($3::date + interval '1 day')`,
    [cliente.phone_number_id, desde, hasta]
  );

  const citas = await queryOnePanel<{ n: string }>(
    `SELECT count(*) AS n
     FROM reservas r
     WHERE r.cliente_id = $1
       AND r.creado_en >= $2::date
       AND r.creado_en < ($3::date + interval '1 day')`,
    [cliente.id, desde, hasta]
  );

  // reagendada_de_id enlaza la reserva nueva con la cancelada al reprogramar
  // (crearHold.ts / reprogramarCita.ts, 2026-08-19) - sin ese enlace una
  // reprogramacion es indistinguible de una cancelacion+reserva independiente.
  const reagendadas = await queryOnePanel<{ n: string }>(
    `SELECT count(*) AS n
     FROM reservas r
     WHERE r.cliente_id = $1
       AND r.reagendada_de_id IS NOT NULL
       AND r.creado_en >= $2::date
       AND r.creado_en < ($3::date + interval '1 day')`,
    [cliente.id, desde, hasta]
  );

  res.json({
    ok: true,
    desde,
    hasta,
    conversaciones_atendidas: Number(conv?.n ?? 0),
    citas_creadas: Number(citas?.n ?? 0),
    citas_reagendadas: Number(reagendadas?.n ?? 0),
  });
});
