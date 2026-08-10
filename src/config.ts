function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  agentServiceSecret: required('AGENT_SERVICE_SECRET'),
  whatsappAppSecret: required('WHATSAPP_APP_SECRET'),
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  db: {
    // Postgres-TyAZ en Railway (sustituye a Airtable). Usar la variable interna del
    // servicio (no la de proxy publico) - misma red privada, mismo patron que redis
    // mas abajo.
    connectionString: required('DATABASE_URL'),
  },
  googleServiceAccountJson: required('GOOGLE_SERVICE_ACCOUNT_JSON'),
  resend: {
    apiKey: required('RESEND_API_KEY'),
    fromEmail: required('RESEND_FROM_EMAIL'),
  },
  telegram: {
    // Mismo bot/chat que ya usa TelegramNotificarLead en workflow-molaria-leads.json.
    botToken: required('TELEGRAM_BOT_TOKEN'),
    chatId: required('TELEGRAM_CHAT_ID'),
  },
  // Mismo Redis que ya usa n8n para su cola (Bull) en el mismo proyecto de
  // Railway - opcional a proposito: si no esta configurado, la cache de
  // idempotencia por wamid simplemente se desactiva (ver clients/redisCache.ts),
  // nunca debe tumbar el servicio.
  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
    password: process.env.REDIS_PASSWORD,
    username: process.env.REDIS_USERNAME,
  },
};
