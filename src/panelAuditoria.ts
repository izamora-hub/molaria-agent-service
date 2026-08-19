import { Request } from 'express';
import { queryPanel } from './clients/dbPanel';

// Trazabilidad de acceso (2026-08-19): resumen_email suele ser un buzon
// compartido tipo info@, asi que el login no identifica a una persona. Lo que
// SI da trazabilidad util es el evento en si mismo: momento, IP, user-agent, y
// que conversacion en concreto se abrio - suficiente para que la clinica acote
// "quien tenia acceso a ese puesto/turno" internamente, sin necesitar saber el
// nombre del empleado. Best-effort (nunca lanza), igual que logError.ts /
// logAgente.ts: un fallo aqui no puede bloquear el acceso real del panel.

function extraerIp(req: Request): string {
  return (req.header('x-forwarded-for') || req.socket.remoteAddress || 'desconocida').split(',')[0].trim();
}

export async function registrarAuditoria(
  req: Request,
  params: { clienteId: string; tipo: 'login' | 'lectura_conversacion'; conversacionId?: string }
): Promise<void> {
  try {
    await queryPanel(
      `INSERT INTO panel_auditoria (cliente_id, tipo, conversacion_id, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [params.clienteId, params.tipo, params.conversacionId ?? null, extraerIp(req), req.header('user-agent') ?? 'desconocido']
    );
  } catch (err) {
    console.error('Fallo escribiendo en panel_auditoria:', err);
  }
}
