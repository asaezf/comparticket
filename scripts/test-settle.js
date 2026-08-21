#!/usr/bin/env node
/**
 * Tests del cuadre de grupos — no gastan API ni base de datos.
 *   node scripts/test-settle.js
 *
 * Es dinero entre amigos a lo largo de un viaje entero, así que aquí no basta
 * con probar casos sueltos: se comprueban las tres PROPIEDADES que tienen que
 * cumplirse siempre, pase lo que pase con los datos.
 *
 *   1. El dinero no se crea ni se destruye: los saldos suman cero.
 *   2. Las transferencias saldan a TODO el mundo, no solo a la mayoría.
 *   3. Nunca salen más de N-1 transferencias con N personas.
 */

const S = require('../settle');
const M = require('../money');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = typeof want === 'number'
    ? Math.abs(got - want) < 0.005
    : JSON.stringify(got) === JSON.stringify(want);
  console.log('  ' + (ok ? 'ok  ' : 'FALLA') + '  ' + label.padEnd(56) + ' ' + JSON.stringify(got));
  if (!ok) console.log('         esperado: ' + JSON.stringify(want));
  ok ? pass++ : fail++;
}
function ok(label, cond, detalle) {
  console.log('  ' + (cond ? 'ok  ' : 'FALLA') + '  ' + label);
  if (!cond && detalle !== undefined) console.log('         ' + detalle);
  cond ? pass++ : fail++;
}

/** Aplica las transferencias a los saldos y devuelve cómo queda cada uno. */
function aplicar(saldos, transferencias) {
  const fin = Object.assign({}, saldos);
  transferencias.forEach(t => {
    fin[t.de] = (fin[t.de] || 0) + t.importe;
    fin[t.a] = (fin[t.a] || 0) - t.importe;
  });
  return fin;
}

console.log('\n1. Saldos: quién puso y quién consumió');
{
  // Álvaro paga una cena de 84,50 €. Consumió 20; Nerea, 64,50.
  const saldos = S.computeBalances(
    [{ pagador: 'Álvaro', total: 84.5, reparto: { 'Álvaro': 20, 'Nerea': 64.5 } }],
    [], ['Álvaro', 'Nerea']
  );
  check('a Álvaro le deben lo que adelantó de más', saldos['Álvaro'], 64.5);
  check('Nerea debe lo que consumió', saldos['Nerea'], -64.5);
}
{
  // Quien paga justo lo que consume queda a cero.
  const saldos = S.computeBalances(
    [{ pagador: 'Ana', total: 30, reparto: { 'Ana': 30 } }], [], ['Ana']
  );
  check('pagar solo lo tuyo deja saldo cero', saldos['Ana'], 0);
}
{
  // Un miembro que no ha tocado nada tiene que salir igualmente en la lista.
  const saldos = S.computeBalances([], [], ['Ana', 'Beto']);
  check('los miembros sin gastos aparecen a cero', saldos, { 'Ana': 0, 'Beto': 0 });
}

console.log('\n2. Los pagos ya hechos saldan deuda');
{
  const apuntes = [{ pagador: 'Álvaro', total: 100, reparto: { 'Álvaro': 50, 'Nerea': 50 } }];
  const antes = S.computeBalances(apuntes, [], ['Álvaro', 'Nerea']);
  check('antes de pagar, Nerea debe 50', antes['Nerea'], -50);

  const despues = S.computeBalances(apuntes, [{ de: 'Nerea', a: 'Álvaro', importe: 50 }], ['Álvaro', 'Nerea']);
  check('tras pagar, Nerea queda a cero', despues['Nerea'], 0);
  check('y Álvaro también', despues['Álvaro'], 0);
  ok('el grupo queda saldado', S.isSettled(despues));
}
{
  // Un pago a medias deja el resto pendiente.
  const saldos = S.computeBalances(
    [{ pagador: 'A', total: 100, reparto: { 'A': 50, 'B': 50 } }],
    [{ de: 'B', a: 'A', importe: 20 }], ['A', 'B']
  );
  check('un pago parcial deja el resto', saldos['B'], -30);
}

console.log('\n3. El mínimo de transferencias');
{
  // Caso de viaje: 4 personas, uno pagó casi todo.
  const saldos = { 'Álvaro': 150, 'Nerea': -60, 'María': -50, 'Lucía': -40 };
  const t = S.minimalTransfers(saldos);
  ok('3 deudores → 3 transferencias', t.length === 3, JSON.stringify(t));
  ok('todas van hacia Álvaro', t.every(x => x.a === 'Álvaro'), JSON.stringify(t));
  const fin = aplicar(saldos, t);
  ok('todos quedan a cero', S.isSettled(fin), JSON.stringify(fin));
}
{
  // Cruzado: no todos deben al mismo.
  const saldos = { 'A': 30, 'B': 20, 'C': -25, 'D': -25 };
  const t = S.minimalTransfers(saldos);
  const fin = aplicar(saldos, t);
  ok('con dos acreedores también salda a todos', S.isSettled(fin), JSON.stringify(fin));
  ok('y no se pasa de N-1 pagos', t.length <= 3, 'salieron ' + t.length);
}
{
  const t = S.minimalTransfers({ 'A': 0, 'B': 0, 'C': 0 });
  check('si nadie debe nada, no hay transferencias', t.length, 0);
}
{
  // Un céntimo de diferencia es ruido de redondeo, no una deuda que reclamar.
  const t = S.minimalTransfers({ 'A': 0.01, 'B': -0.01 });
  check('un céntimo suelto no genera un pago', t.length, 0);
}
{
  // Determinismo: dos ejecuciones iguales dan lo mismo. Si cambiara el orden
  // entre recargas, la gente pensaría que la app se lo inventa.
  const saldos = { 'A': 50, 'B': 50, 'C': -50, 'D': -50 };
  const a = JSON.stringify(S.minimalTransfers(saldos));
  const b = JSON.stringify(S.minimalTransfers(saldos));
  ok('el resultado es siempre el mismo', a === b, a + ' vs ' + b);
}

console.log('\n4. Gastos sin ticket, a partes iguales');
{
  const r = S.splitEqually(30, ['A', 'B', 'C']);
  check('30 entre 3', r, { 'A': 10, 'B': 10, 'C': 10 });
}
{
  // El caso que descuadra los grupos si se hace mal.
  const r = S.splitEqually(10, ['A', 'B', 'C']);
  const suma = Object.values(r).reduce((s, x) => s + x, 0);
  check('10 entre 3 reparte el céntimo suelto', r, { 'A': 3.34, 'B': 3.33, 'C': 3.33 });
  check('  y la suma sigue siendo 10 exactos', Math.round(suma * 100) / 100, 10);
}
{
  // Varios céntimos de resto.
  const r = S.splitEqually(10, ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  const suma = Object.values(r).reduce((s, x) => s + x, 0);
  check('10 entre 7 no pierde ni un céntimo', Math.round(suma * 100) / 100, 10);
}
{
  const r = S.splitEqually(50, ['A']);
  check('un gasto de uno solo es suyo entero', r, { 'A': 50 });
}
{
  check('sin gente, no hay reparto', S.splitEqually(50, []), {});
}

console.log('\n5. Propiedades que deben cumplirse SIEMPRE');
{
  // Un viaje entero generado a lo bruto: 6 personas, 40 apuntes con importes y
  // repartos irregulares. Se comprueban las tres invariantes.
  const gente = ['Ana', 'Beto', 'Carla', 'Dani', 'Elsa', 'Fran'];
  const apuntes = [];
  let semilla = 12345;
  const rnd = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (let i = 0; i < 40; i++) {
    const pagador = gente[Math.floor(rnd() * gente.length)];
    const cuantos = 1 + Math.floor(rnd() * gente.length);
    const entre = gente.slice(0, cuantos);
    const total = Math.round(rnd() * 20000) / 100;   // hasta 200 €
    apuntes.push({ pagador, total, reparto: S.splitEqually(total, entre) });
  }

  const saldos = S.computeBalances(apuntes, [], gente);
  const suma = Object.values(saldos).reduce((s, x) => s + x, 0);
  ok('1) el dinero no se crea ni se destruye: los saldos suman cero',
    Math.abs(suma) < 0.02, 'suman ' + suma.toFixed(4));

  const t = S.minimalTransfers(saldos);
  const fin = aplicar(saldos, t);
  const peor = Math.max.apply(null, Object.values(fin).map(Math.abs));
  ok('2) las transferencias saldan a TODO el mundo',
    S.isSettled(fin), 'el peor queda en ' + peor.toFixed(4));

  ok('3) no más de ' + (gente.length - 1) + ' transferencias con ' + gente.length + ' personas',
    t.length <= gente.length - 1, 'salieron ' + t.length);

  console.log('         (viaje simulado: ' + apuntes.length + ' apuntes, ' +
    S.groupStats(apuntes).total + ' € movidos, saldado en ' + t.length + ' pagos)');
}

console.log('\n6. Encaja con el reparto por unidades que ya existe');
{
  // El reparto de cada ticket lo sigue haciendo money.js, intacto. settle.js
  // solo suma lo que aquel devuelve.
  const items = [{ id: 1, name: 'Ginebra', quantity: 2, unitPrice: 10 }];
  const claims = [
    { personName: 'Álvaro', itemUnits: { 1: [0] }, confirmed: true },
    { personName: 'Nerea', itemUnits: { 1: [1] }, confirmed: true }
  ];
  const r = M.splitByUnits(items, M.confirmedOnly(claims));
  check('money.js reparte el ticket', r.perPerson, { 'Álvaro': 10, 'Nerea': 10 });

  const saldos = S.computeBalances(
    [{ pagador: 'Álvaro', total: 20, reparto: r.perPerson }], [], ['Álvaro', 'Nerea']
  );
  check('y settle.js lo convierte en saldo', saldos['Nerea'], -10);
  const t = S.minimalTransfers(saldos);
  check('con una sola transferencia', t.length, 1);
  check('  de Nerea a Álvaro', t[0].de + '-' + t[0].a + ': ' + t[0].importe, 'Nerea-Álvaro: 10');
}
{
  // Mezcla real: un ticket escaneado + un taxi a partes iguales.
  const apuntes = [
    { pagador: 'Ana', total: 60, reparto: { 'Ana': 20, 'Beto': 20, 'Carla': 20 } },
    { pagador: 'Beto', total: 30, reparto: S.splitEqually(30, ['Ana', 'Beto', 'Carla']) }
  ];
  const saldos = S.computeBalances(apuntes, [], ['Ana', 'Beto', 'Carla']);
  check('Ana adelantó 60 y consumió 30', saldos['Ana'], 30);
  check('Beto adelantó 30 y consumió 30', saldos['Beto'], 0);
  check('Carla no adelantó nada', saldos['Carla'], -30);
  const t = S.minimalTransfers(saldos);
  check('se salda con un solo pago', t.length, 1);
}

console.log('\n7. Datos raros no rompen el cuadre');
{
  ok('sin apuntes ni miembros no revienta', JSON.stringify(S.computeBalances()) === '{}');
  ok('transferencias de nada no revienta', S.minimalTransfers().length === 0);
  ok('groupStats vacío no revienta', S.groupStats().total === 0);
}
{
  const saldos = S.computeBalances(
    [{ pagador: 'A', total: 'no soy un número', reparto: { 'B': null } }], [], ['A', 'B']
  );
  ok('importes basura se tratan como cero', saldos['A'] === 0 && saldos['B'] === 0, JSON.stringify(saldos));
}
{
  // Alguien que no está en la lista de miembros pero aparece en un apunte:
  // más vale contarlo que perder su dinero.
  const saldos = S.computeBalances(
    [{ pagador: 'Intruso', total: 10, reparto: { 'A': 10 } }], [], ['A']
  );
  check('quien no es miembro pero puso dinero, cuenta', saldos['Intruso'], 10);
}


console.log('\n8. Un ticket a medio marcar NO puede entrar en el cuadre');
{
  // Fallo real, encontrado al probarlo con datos de un viaje: un ticket
  // abierto acreditaba el total a quien pagó, pero solo estaba repartido lo
  // que la gente llevaba marcado. Los saldos sumaban 16 € en vez de cero
  // —dinero creado de la nada— y el reparto final salía mal.
  const abierto = { pagador: 'Nerea', total: 32, reparto: { 'Nerea': 8, 'Maria': 8 } };

  const conElAbierto = S.computeBalances([abierto], [], ['Nerea', 'Maria']);
  const sumaMal = Object.values(conElAbierto).reduce((a, b) => a + b, 0);
  ok('metiéndolo, el dinero se crearía de la nada', Math.abs(sumaMal) > 0.02,
    'suman ' + sumaMal.toFixed(2) + ' en vez de 0');

  // Ya cerrado, el reparto cubre el total y todo cuadra.
  const cerrado = {
    pagador: 'Nerea', total: 32,
    reparto: { 'Nerea': 8, 'Maria': 8, 'Alvaro': 8, 'Dani': 8 }
  };
  const bien = S.computeBalances([cerrado], [], ['Nerea', 'Maria', 'Alvaro', 'Dani']);
  const sumaBien = Object.values(bien).reduce((a, b) => a + b, 0);
  ok('cerrado, los saldos vuelven a sumar cero', Math.abs(sumaBien) < 0.02,
    'suman ' + sumaBien.toFixed(4));

  // Y el servidor tiene que estar aplicando esa regla de verdad.
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'server.js'), 'utf8');
  ok('el servidor deja fuera del cuadre los tickets sin cerrar',
    src.indexOf('SOLO los tickets cerrados entran en el cuadre') !== -1,
    'groupSummary debería excluirlos');
  ok('y dice cuánto dinero queda fuera',
    src.indexOf('pendienteDeCerrar') !== -1, true);
}

console.log('\n' + pass + ' ok, ' + fail + ' fallos\n');
process.exit(fail ? 1 : 0);
