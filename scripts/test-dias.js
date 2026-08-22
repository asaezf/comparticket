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

// --- Y que el servidor use de verdad la fecha de cierre ------------------
{
  const fs = require('fs');
  const path = require('path');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const bd = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');

  check('el resumen del grupo prefiere closedAt a createdAt',
    /t\.closedAt \|\| t\.createdAt/.test(srv), true);
  check('closedAt llega al navegador dentro de cada ticket',
    /closedAt: t\.closedAt \|\| null/.test(srv), true);
  check('cerrar un ticket apunta la fecha',
    /campos\.closedAt = new Date\(\)\.toISOString\(\)/.test(bd), true);
  check('no se pisa la fecha si ya estaba cerrado',
    /!snap\.data\(\)\.closedAt/.test(bd), true);
}

// --- La escala de color de la etiqueta -----------------------------------
//
//     0 días   nada          algo se ha movido hoy
//     1-6      gris          normal, nadie se alarma
//     7-13     naranja       ya lleva una semana
//     14-29    rojo suave    dos semanas
//     30+      rojo macizo   un mes
{
  // La misma regla que etiquetaDias() en group.js.
  const nivel = d => d < 1 ? '' : (d >= 30 ? 'd3' : d >= 14 ? 'd2' : d >= 7 ? 'd1' : 'd0');

  check('0 días: no sale etiqueta',   nivel(0),  '');
  check('1 día: gris',                nivel(1),  'd0');
  check('6 días: sigue gris',         nivel(6),  'd0');
  check('7 días: naranja',            nivel(7),  'd1');
  check('13 días: sigue naranja',     nivel(13), 'd1');
  check('14 días: rojo suave',        nivel(14), 'd2');
  check('29 días: sigue rojo suave',  nivel(29), 'd2');
  check('30 días: rojo macizo',       nivel(30), 'd3');

  const g = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'public', 'js', 'group.js'), 'utf8');
  check('group.js usa esa misma escala',
    /d >= 30 \? 'd3' : d >= 14 \? 'd2' : d >= 7 \? 'd1' : 'd0'/.test(g), true);
  check('la etiqueta sale ya desde el primer día',
    /if \(d < 1\) return ''/.test(g), true);
}

console.log('\n' + ok + ' ok, ' + mal + ' fallos\n');
process.exit(mal ? 1 : 0);
