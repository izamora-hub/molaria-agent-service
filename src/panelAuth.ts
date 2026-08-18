import { NextFunction, Request, Response } from 'express';
import { leerSesion, Sesion } from './clients/redisSession';

export const COOKIE_NOMBRE = 'panel_session';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface RequestConSesion extends Request {
  sesion?: Sesion;
  sessionId?: string;
}

// Parser minimo de un solo cookie con nombre conocido - no hace falta la
// dependencia cookie-parser para esto.
export function leerCookie(req: Request, nombre: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const parte of header.split(';')) {
    const idx = parte.indexOf('=');
    if (idx === -1) continue;
    const k = parte.slice(0, idx).trim();
    if (k === nombre) return decodeURIComponent(parte.slice(idx + 1).trim());
  }
  return null;
}

// Deriva cliente_id de la sesion server-side (Redis), nunca de un parametro
// que mande el navegador (1-02 / SEC-013). Fail-closed: sin cookie o sesion
// invalida/caducada -> 401, ver leerSesion() para el porque del fail-closed.
export async function requireSesionPanel(req: RequestConSesion, res: Response, next: NextFunction): Promise<void> {
  const sessionId = leerCookie(req, COOKIE_NOMBRE);
  const sesion = sessionId ? await leerSesion(sessionId) : null;
  if (!sesion || !sessionId) {
    res.status(401).json({ error: { codigo: 'sesion_invalida', mensaje: 'Inicia sesion de nuevo' } });
    return;
  }
  req.sesion = sesion;
  req.sessionId = sessionId;
  next();
}

// Cookie host-only (sin Domain), Secure+HttpOnly+SameSite=Lax, Path=/panel
// (1-01 punto 3) - nunca .molaria.app para no compartirla con otros subdominios.
export function fijarCookieSesion(res: Response, sessionId: string): void {
  res.cookie(COOKIE_NOMBRE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/panel',
    maxAge: MAX_AGE_MS,
  });
}

export function borrarCookieSesion(res: Response): void {
  res.clearCookie(COOKIE_NOMBRE, { path: '/panel' });
}
