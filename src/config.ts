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
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  airtable: {
    token: required('AIRTABLE_TOKEN'),
    baseId: required('AIRTABLE_BASE_ID'),
    tableClientes: required('AIRTABLE_TABLE_CLIENTES'),
    tableClientesAgenda: required('AIRTABLE_TABLE_CLIENTES_AGENDA'),
    tableTiposCita: required('AIRTABLE_TABLE_TIPOS_CITA'),
    tableReservas: required('AIRTABLE_TABLE_RESERVAS'),
    // Tabla tecnica de errores (nodo LogError en n8n), NO la tabla "LogAgente"
    // (esa es el log de conversacion paciente/asistente que alimenta el informe
    // semanal - escribir ahi filas de fallos tecnicos contaminaria ese analisis).
    tableErrores: required('AIRTABLE_TABLE_ERRORES'),
    // Opcional a proposito, como redis mas abajo: es un log de mejor esfuerzo
    // (clients/logAgente.ts), nunca debe impedir que el servicio arranque ni
    // que un turno responda al paciente si falta configurar esta variable.
    tableLogAgente: process.env.AIRTABLE_TABLE_LOG_AGENTE,
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
