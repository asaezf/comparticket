#!/usr/bin/env node
/**
 * Los días sin pagar cuentan desde que se CIERRA el ticket.
 *   node scripts/test-dias.js
 *
 * Hasta que un ticket no se cierra, lo que debe cada uno todavía puede
 * cambiar: no hay ninguna deuda que reclamar y no tiene sentido contarle los
 * días a nadie. Un ticket escaneado hace diez días y cerrado hoy no lleva
 * diez días sin pagarse — lleva cero.
 *
 * Aquí se prueba la regla, que es la parte que se puede equivocar, sin tocar
 * la base de datos.
 */

const hace = d => new Date(Date.now() - d * 86400000).toISOString();

// La misma cuenta que hace groupSummary() en server.js.
function diasQuieto(expenses, tickets, payments) {
  const fechas = []
    .concat(expenses.map(e => e.createdAt))
    .concat(tickets.map(t => t.closedAt || t.createdAt))
    .concat(payments.map(p => p.createdAt))
    .filter(Boolean)
    .map(f => new Date(f).getTime())
    .filter(n => !isNaN(n));
  const ultimo = fechas.length ? Math.max.apply(null, fechas) : null;
  return ultimo ? Math.max(0, Math.floor((Date.now() - ultimo) / 86400000)) : 0;
}

let ok = 0, mal = 0;
function check(t, got, want) {
  const bien = got === want;
  bien ? ok++ : mal++;
  console.log((bien ? '  ok    ' : '  FALLA ') + String(t).padEnd(58) +
    got + (bien ? '' : '  (esperaba ' + want + ')'));
}

check('creado hace 10 días y cerrado hoy → 0 días',
  diasQuieto([], [{ createdAt: hace(10), closedAt: hace(0) }], []), 0);
check('creado hace 30 y cerrado hace 5 → 5 días',
  diasQuieto([], [{ createdAt: hace(30), closedAt: hace(5) }], []), 5);
check('sin cerrar: cuenta desde que se creó',
  diasQuieto([], [{ createdAt: hace(7) }], []), 7);
check('un gasto suelto de hoy reinicia el contador',
  diasQuieto([{ createdAt: hace(0) }], [{ createdAt: hace(20), closedAt: hace(20) }], []), 0);
check('un pago hecho hoy reinicia el contador',
  diasQuieto([], [{ createdAt: hace(40), closedAt: hace(40) }], [{ createdAt: hace(0) }]), 0);
check('grupo vacío → 0',
  diasQuieto([], [], []), 0);
check('manda el movimiento MÁS RECIENTE de todos',
  diasQuieto([{ createdAt: hace(9) }], [{ createdAt: hace(30), closedAt: hace(3) }], [{ createdAt: hace(12) }]), 3);

// --- Y que se use donde importa -----------------------------------------
//
// El color del canto en el reparto ya NO depende de esto: cuenta desde que se
// bloquea el reparto, que es cuando la deuda existe de verdad, y eso lo prueba
// test-reparto.js.
//
// Lo que sigue vivo aquí es cuánto tardó en pagar cada uno. Se apunta en el
// momento del pago —después es imposible, porque en cuanto entra otro gasto
// el grupo vuelve a moverse— y usa esta misma regla del cierre.
{
  const fs = require('fs');
  const path = require('path');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const bd  = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');

  check('cerrar un ticket apunta la fecha',
    /campos\.closedAt = new Date\(\)\.toISOString\(\)/.test(bd), true);
  check('no se pisa la fecha si ya estaba cerrado',
    /!snap\.data\(\)\.closedAt/.test(bd), true);
  check('la espera de un pago prefiere closedAt a createdAt',
    /t\.closedAt \|\| t\.createdAt/.test(srv), true);
  check('para la espera solo cuentan los tickets ya cerrados',
    /filter\(t => t\.status === 'closed'\)/.test(srv), true);
  check('la espera se guarda dentro del pago',
    /esperoDias/.test(bd), true);
  check('closedAt llega al navegador dentro de cada ticket',
    /closedAt: t\.closedAt \|\| null/.test(srv), true);
}

console.log('\n' + ok + ' ok, ' + mal + ' fallos\n');
process.exit(mal ? 1 : 0);
