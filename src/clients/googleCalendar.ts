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
