import { NextFunction, Request, Response } from 'express';
import { config } from './config';

export function requireBearerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || token !== config.agentServiceSecret) {
    res.status(401).json({ error: { codigo: 'no_autorizado', mensaje: 'Token invalido o ausente' } });
    return;
  }
  next();
}
