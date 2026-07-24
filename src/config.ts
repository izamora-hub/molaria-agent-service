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
    tableClientesAgenda: required('AIRTABLE_TABLE_CLIENTES_AGENDA'),
    tableTiposCita: required('AIRTABLE_TABLE_TIPOS_CITA'),
    tableReservas: required('AIRTABLE_TABLE_RESERVAS'),
  },
  googleServiceAccountJson: required('GOOGLE_SERVICE_ACCOUNT_JSON'),
};
