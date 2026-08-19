import { queryOnePanel } from './clients/dbPanel';

export interface ClientePanel {
  id: string;
  phone_number_id: string;
  wa_ids_excluidos_prefijos: string[];
}

export async function obtenerClientePanel(clienteId: string): Promise<ClientePanel | null> {
  return queryOnePanel<ClientePanel>(
    'SELECT id, phone_number_id, wa_ids_excluidos_prefijos FROM clientes WHERE id = $1',
    [clienteId]
  );
}
