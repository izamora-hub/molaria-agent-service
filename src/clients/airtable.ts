import { config } from '../config';

export interface AirtableRecord<F = Record<string, unknown>> {
  id: string;
  createdTime: string;
  fields: F;
}

// Escapa un valor antes de interpolarlo en un filterByFormula. Sin esto, un
// valor con una comilla doble o una barra invertida rompe o manipula la
// formula (inyeccion) - el caso mas directo es el "telefono" que el propio
// paciente escribe en la conversacion de WhatsApp y que citas.ts usa tal cual
// en AND({telefono} = "...").
export function escapeFormulaValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Reintentos SOLO para lecturas (GET): son naturalmente idempotentes. Las
// escrituras (POST/PATCH) nunca se reintentan aqui - un 429/503 despues de
// que Airtable ya aplico el cambio duplicaria el efecto (mismo riesgo que
// cerramos en A-05/M-06 para Calendar), y el llamador es quien decide si una
// escritura fallida debe reintentarse con su propia logica de idempotencia.
const REINTENTOS_LECTURA = 3;
const ESPERA_BASE_MS = 400;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esReintentable(status: number): boolean {
  return status === 429 || status >= 500;
}

async function airtableRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown
): Promise<T> {
  const maxIntentos = method === 'GET' ? REINTENTOS_LECTURA : 1;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    let res: Response;
    try {
      res = await fetch(`https://api.airtable.com/v0/${config.airtable.baseId}/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.airtable.token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (intento < maxIntentos) {
        await esperar(ESPERA_BASE_MS * intento);
        continue;
      }
      throw err;
    }

    if (res.ok) return res.json() as Promise<T>;

    const text = await res.text().catch(() => '');
    if (esReintentable(res.status) && intento < maxIntentos) {
      await esperar(ESPERA_BASE_MS * intento);
      continue;
    }
    throw new Error(`Airtable ${method} ${path} -> ${res.status}: ${text}`);
  }

  // Inalcanzable: el bucle de arriba siempre retorna o lanza en su ultima vuelta.
  throw new Error(`Airtable ${method} ${path}: agotados los reintentos`);
}

export async function searchOne<F = Record<string, unknown>>(
  tableId: string,
  filterByFormula: string
): Promise<AirtableRecord<F> | null> {
  const qs = new URLSearchParams({ filterByFormula, maxRecords: '1' });
  const data = await airtableRequest<{ records: AirtableRecord<F>[] }>(
    'GET',
    `${tableId}?${qs.toString()}`
  );
  return data.records[0] ?? null;
}

export async function searchAll<F = Record<string, unknown>>(
  tableId: string,
  filterByFormula: string
): Promise<AirtableRecord<F>[]> {
  const qs = new URLSearchParams({ filterByFormula });
  const data = await airtableRequest<{ records: AirtableRecord<F>[] }>(
    'GET',
    `${tableId}?${qs.toString()}`
  );
  return data.records;
}

export async function upsert<F extends Record<string, unknown>>(
  tableId: string,
  fields: F,
  matchOn: keyof F & string
): Promise<AirtableRecord<F>> {
  const data = await airtableRequest<{ records: AirtableRecord<F>[] }>('PATCH', tableId, {
    performUpsert: { fieldsToMergeOn: [matchOn] },
    records: [{ fields }],
  });
  return data.records[0];
}

export async function getById<F = Record<string, unknown>>(
  tableId: string,
  recordId: string
): Promise<AirtableRecord<F>> {
  return airtableRequest<AirtableRecord<F>>('GET', `${tableId}/${recordId}`);
}

export async function updateById<F = Record<string, unknown>>(
  tableId: string,
  recordId: string,
  fields: Partial<F>
): Promise<AirtableRecord<F>> {
  return airtableRequest<AirtableRecord<F>>('PATCH', `${tableId}/${recordId}`, { fields });
}

export async function create<F extends Record<string, unknown>>(
  tableId: string,
  fields: F
): Promise<AirtableRecord<F>> {
  const data = await airtableRequest<{ records: AirtableRecord<F>[] }>('POST', tableId, {
    records: [{ fields }],
  });
  return data.records[0];
}
