import { createHmac, timingSafeEqual } from 'crypto';
import { config } from './config';

// A-04 (auditoria 2026-08-07): antes esto vivia en un Code node de n8n
// (VerificarFirma) con SHA256 escrito a mano, porque esa instancia bloquea
// `crypto`/`$env` dentro de Code nodes - el secreto tenia que pasar por el
// output de otro nodo (LeerSecreto) para llegar hasta alli, y ese output
// queda en texto plano en el execution log de cada ejecucion exitosa. Aqui
// el secreto solo vive en la env var de Railway de este servicio, nunca pasa
// por ningun nodo/log de n8n.
export function verificarFirmaWhatsapp(bodyBase64: string, signature: string | null | undefined): boolean {
  if (!signature) return false;

  const bodyBytes = Buffer.from(bodyBase64, 'base64');
  const hmac = createHmac('sha256', config.whatsappAppSecret).update(bodyBytes).digest('hex');
  const expected = `sha256=${hmac}`;

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
