// Smoke test manual, no automatizado (no usa node:test): llama directamente a
// consultarDisponibilidad/crearHold contra Postgres-TyAZ para verificar la
// reescritura de Airtable -> Postgres sin montar el loop completo de Claude.
// Uso: node --env-file=.env --import tsx test/smoke-postgres.ts

import { consultarDisponibilidad } from '../src/tools/consultarDisponibilidad';
import { crearHold } from '../src/tools/crearHold';

const PHONE_NUMBER_ID = '1242478758940947'; // Sarrat

async function main() {
  console.log('--- consultarDisponibilidad ---');
  const disponibilidad = await consultarDisponibilidad(PHONE_NUMBER_ID, {
    tipo_cita: 'primera visita',
  });
  console.log(JSON.stringify(disponibilidad, null, 2));

  if ('error' in disponibilidad) {
    console.log('\nParar aqui: revisar el error de arriba antes de probar crearHold.');
    return;
  }

  const primerHueco = disponibilidad.huecos[0];
  if (!primerHueco) {
    console.log('\nNo hay huecos ofrecidos, no se puede probar crearHold.');
    return;
  }

  console.log('\n--- crearHold (con el primer hueco ofrecido) ---');
  const hold = await crearHold(
    {
      phoneNumberId: PHONE_NUMBER_ID,
      convId: 'smoke-test-conv',
      waId: 'smoke-test-wa',
      clienteNombre: 'Clínica Dental Sarrat',
      toolUseId: `smoke-test-${Date.now()}`,
    },
    {
      inicio: primerHueco.inicio,
      fin: primerHueco.fin,
      tipo_cita: 'primera visita',
      nombre: 'Paciente de prueba (smoke test)',
      telefono: '600000000',
    }
  );
  console.log(JSON.stringify(hold, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FALLO:', err);
    process.exit(1);
  });
