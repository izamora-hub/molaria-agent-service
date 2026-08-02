import { config } from '../config';

export type EnviarEmailResultado = { ok: true } | { ok: false; error: string };

// Nunca lanza: el llamador decide que hacer si el email falla (tipicamente
// registrar en LogAgente y continuar, nunca revertir una cancelacion/reprogramacion
// ya aplicada por su fallo).
export async function enviarEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<EnviarEmailResultado> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.resend.fromEmail,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}
