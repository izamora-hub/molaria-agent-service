import { config } from '../config';

// Best-effort: nunca lanza. Es una alerta, no puede tumbar el flujo que la dispara.
export async function enviarTelegram(text: string): Promise<void> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegram.chatId, text }),
    });
    if (!res.ok) {
      console.error('Fallo enviando alerta a Telegram:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('Fallo enviando alerta a Telegram:', err);
  }
}
