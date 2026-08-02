import { config } from '../config';

export interface AirtableRecord<F = Record<string, unknown>> {
  id: string;
  createdTime: string;
  fields: F;
}

async function airtableRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`https://api.airtable.com/v0/${config.airtable.baseId}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.airtable.token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Airtable ${method} ${path} -> ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
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
