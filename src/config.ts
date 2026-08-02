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
};
