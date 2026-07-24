import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularHuecos, norm, Ventana } from '../src/tools/huecos';

const ventanaBase: Ventana = {
  calendar_id: 'cal-test',
  timeZone: 'Europe/Madrid',
  desde: '2026-08-03T09:00:00.000+02:00', // lunes
  hasta: '2026-08-07T23:59:59.999+02:00', // viernes
  nombre_tipo: 'Primera visita',
  duracion_min: 30,
  colchon_min: 10,
  redondeo_min: 15,
  dias_reservables: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'],
  hora_inicio: '09:00',
  hora_fin: '14:00',
};

test('norm quita acentos y normaliza a minusculas', () => {
  assert.equal(norm('Miércoles'), 'miercoles');
  assert.equal(norm('  Primera Visita  '), 'primera visita');
});

test('calcularHuecos genera huecos dentro del horario de apertura sin choques', () => {
  const resultado = calcularHuecos(ventanaBase, { busy: [] }, 0, undefined);
  assert.ok(!('error' in resultado));
  if ('error' in resultado) return;
  assert.ok(resultado.ofrecer.length > 0);
  const primero = resultado.ofrecer[0];
  assert.equal(primero.inicio.slice(11, 16), '09:00');
});

test('calcularHuecos aplica el colchon despues de un evento ocupado', () => {
  const busy = [{ start: '2026-08-03T09:00:00.000+02:00', end: '2026-08-03T09:30:00.000+02:00' }];
  const resultado = calcularHuecos(ventanaBase, { busy }, 0, 'lunes');
  assert.ok(!('error' in resultado));
  if ('error' in resultado) return;
  const primerHueco = resultado.ofrecer[0];
  // El evento ocupado acaba a las 09:30; con 10 min de colchon y redondeo a 15,
  // el primer hueco libre debe empezar a las 09:45, no a las 09:30.
  assert.equal(primerHueco.inicio.slice(11, 16), '09:45');
});

test('calcularHuecos respeta omitir para paginar', () => {
  const sinOmitir = calcularHuecos(ventanaBase, { busy: [] }, 0, undefined);
  const conOmitir = calcularHuecos(ventanaBase, { busy: [] }, 3, undefined);
  assert.ok(!('error' in sinOmitir) && !('error' in conOmitir));
  if ('error' in sinOmitir || 'error' in conOmitir) return;
  assert.notEqual(sinOmitir.ofrecer[0].inicio, conOmitir.ofrecer[0].inicio);
});

test('calcularHuecos devuelve sin_huecos_ese_dia si el dia pedido no tiene huecos', () => {
  const resultado = calcularHuecos(ventanaBase, { busy: [] }, 0, 'sabado');
  assert.ok('error' in resultado && resultado.error === 'sin_huecos_ese_dia');
});
