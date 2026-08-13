// Genera un token de un solo uso para el formulario de alta/configuracion de
// clinica y lo inserta en tokens_alta. Imprime la URL completa del formulario
// (Cloudflare, molaria.app) con el token, lista para mandar a la clinica.
//
// Uso:
//   npx tsx scripts/generar_token_alta.ts [--cliente-id=<uuid>] [--dias=14]
//
// --cliente-id: opcional. Si la clinica ya existe en `clientes`, pasa su id
//   para que altas_pendientes.cliente_id quede enlazado desde el principio.
//   Si se omite, queda NULL (alta de clinica nueva).
// --dias: opcional, caducidad del token en dias desde ahora (por defecto 14).
//
// La URL base del formulario se lee de la variable de entorno FORM_BASE_URL
// (por defecto https://molaria.app/alta) - nunca hardcodeada aparte de ese
// default, para no atarse a un dominio fijo si cambia.
//
// Deliberadamente NO importa src/clients/db.ts / src/config.ts: ese config
// exige TODAS las variables de entorno del servicio (Telegram, Resend,
// Google, WhatsApp...) solo por importarse, aunque este script solo necesita
// DATABASE_URL. Pool propio y minimo en su lugar.

import { randomBytes } from 'crypto';
import { Pool } from 'pg';

function leerArg(nombre: string): string | undefined {
  const prefijo = `--${nombre}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefijo));
  return arg ? arg.slice(prefijo.length) : undefined;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Falta la variable de entorno DATABASE_URL');
  }

  const clienteId = leerArg('cliente-id') ?? null;
  const dias = Number(leerArg('dias') ?? '14');
  if (!Number.isFinite(dias) || dias <= 0) {
    throw new Error(`--dias invalido: ${leerArg('dias')}`);
  }
  const baseUrl = process.env.FORM_BASE_URL || 'https://molaria.app/alta';

  const token = randomBytes(24).toString('base64url');
  const expiraEn = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();

  const pool = new Pool({ connectionString });
  try {
    await pool.query('INSERT INTO tokens_alta (token, cliente_id, expira_en) VALUES ($1, $2, $3)', [
      token,
      clienteId,
      expiraEn,
    ]);
  } finally {
    await pool.end();
  }

  console.log(`Token generado (caduca ${expiraEn}, cliente_id=${clienteId ?? 'NULL'}):`);
  console.log(`${baseUrl}?token=${token}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error generando token de alta:', err);
    process.exit(1);
  });
