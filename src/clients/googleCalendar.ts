import { google } from 'googleapis';
import { config } from '../config';

const credentials = JSON.parse(config.googleServiceAccountJson);

const auth = new google.auth.JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

const calendar = google.calendar({ version: 'v3', auth });

export interface FreeBusyResult {
  busy: { start: string; end: string }[];
}

export async function freeBusy(
  calendarId: string,
  timeMin: string,
  timeMax: string,
  timeZone: string
): Promise<FreeBusyResult> {
  const res = await calendar.freebusy.query({
    requestBody: { timeMin, timeMax, timeZone, items: [{ id: calendarId }] },
  });
  const cal = res.data.calendars?.[calendarId];
  if (!cal || cal.errors?.length) {
    throw new Error(`freeBusy no devolvio el calendario ${calendarId}`);
  }
  return { busy: (cal.busy ?? []).map((b) => ({ start: b.start!, end: b.end! })) };
}

export async function createTentativeEvent(params: {
  calendarId: string;
  timeZone: string;
  summary: string;
  description: string;
  inicio: string;
  fin: string;
}): Promise<{ eventId: string }> {
  const res = await calendar.events.insert({
    calendarId: params.calendarId,
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.inicio, timeZone: params.timeZone },
      end: { dateTime: params.fin, timeZone: params.timeZone },
      status: 'tentative',
      transparency: 'opaque',
      colorId: '5',
    },
  });
  return { eventId: res.data.id! };
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  try {
    await calendar.events.delete({ calendarId, eventId });
  } catch (err) {
    // Ya borrado o inexistente (p.ej. reintento tras un fallo previo a mitad de
    // camino): no es un fallo real de cancelacion, el resultado que importa
    // (evento fuera del calendario) ya se cumple.
    const status = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
    if (status === 404 || status === 410) return;
    throw err;
  }
}
