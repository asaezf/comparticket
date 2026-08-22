#!/usr/bin/env node
/**
 * El bloqueo del reparto y la escala del canto.
 *   node scripts/test-reparto.js
 *
 * Mientras el reparto está abierto, las deudas se recalculan con cada gasto:
 * no tiene sentido reclamarle nada a nadie ni ponerse a contar el tiempo. Al
 * bloquear se congela el momento y a partir de ahí sí.
 *
 * Aquí se prueba la regla —qué color toca según el tiempo, y qué se enseña en
 * cada estado— sin tocar la base de datos.
 */

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(label, got, want) {
  const bien = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${bien ? 'ok   ' : 'FALLA'}  ${label}`);
  if (!bien) console.log(`         obtenido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`);
  bien ? pass++ : fail++;
}

// La misma escala que ESCALA_DEUDA en group.js.
const ESCALA = [
  { desde: 7 * 24 * 3600, nivel: 'e6' },
  { desde: 5 * 24 * 3600, nivel: 'e5' },
  { desde: 3 * 24 * 3600, nivel: 'e4' },
  { desde: 2 * 24 * 3600, nivel: 'e3' },
  { desde: 1 * 24 * 3600, nivel: 'e2' },
  { desde: 3600,          nivel: 'e1' }
];
const nivel = seg => { for (const p of ESCALA) if (seg >= p.desde) return p.nivel; return ''; };

const H = 3600, D = 86400;

console.log('\n1. El canto sube con el tiempo, y solo en los saltos justos');
check('recién bloqueado: sin color',      nivel(0),        '');
check('59 min: todavía sin color',        nivel(59 * 60),  '');
check('1 hora: amarillo',                 nivel(H),        'e1');
check('23 h: sigue amarillo',             nivel(23 * H),   'e1');
check('1 día: naranja',                   nivel(D),        'e2');
check('47 h: sigue naranja',              nivel(47 * H),   'e2');
check('2 días: rojo',                     nivel(2 * D),    'e3');
check('3 días: rojo intenso',             nivel(3 * D),    'e4');
check('4 días: sigue rojo intenso',       nivel(4 * D),    'e4');
check('5 días: violeta',                  nivel(5 * D),    'e5');
check('6 días: sigue violeta',            nivel(6 * D),    'e5');
check('7 días: negro',                    nivel(7 * D),    'e6');
check('un mes: sigue negro',              nivel(30 * D),   'e6');

console.log('\n2. El reloj se lee corto');
function tiempoCorto(seg) {
  if (seg < 60) return 'ahora';
  const min = Math.floor(seg / 60);
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' h';
  const d = Math.floor(h / 24);
  if (d < 14) return d + (d === 1 ? ' día' : ' días');
  return Math.floor(d / 7) + ' sem';
}
check('30 s',    tiempoCorto(30),      'ahora');
check('45 min',  tiempoCorto(45 * 60), '45 min');
check('3 h',     tiempoCorto(3 * H),   '3 h');
check('1 día',   tiempoCorto(D),       '1 día');
check('6 días',  tiempoCorto(6 * D),   '6 días');
check('3 sem',   tiempoCorto(21 * D),  '3 sem');

console.log('\n3. Qué se enseña en cada estado');
{
  const js = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'group.js'), 'utf8');

  check('abierto se llama REPARTO ACTUAL',
    /'REPARTO ACTUAL'/.test(js), true);
  check('los botones de recordar y pagar solo salen bloqueado',
    /bloqueado\s*\n?\s*\?\s*'<div class="tr-actions">'/.test(js), true);
  check('el reloj solo sale bloqueado',
    /\(bloqueado \? relojDeuda\(\) : ''\)/.test(js), true);
  check('el color del canto solo se calcula bloqueado',
    /bloqueado \? nivelDeDeuda\(segundosDeDeuda\(\)\) : ''/.test(js), true);
  check('el tiempo se cuenta desde que se bloqueó, no desde el último gasto',
    /datos\.bloqueadoDesde/.test(js), true);
  check('la papelera solo aparece bloqueado',
    /papelera\.classList\.toggle\('hidden', !bloqueado/.test(js), true);
  check('liquidar pregunta dos veces',
    (js.match(/if \(!confirm\(/g) || []).length >= 2, true);
}

console.log('\n4. El servidor no deja entrar nada con el reparto bloqueado');
{
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const bd = fs.readFileSync(path.join(RAIZ, 'db.js'), 'utf8');

  check('existe la guarda', /async function grupoBloqueado/.test(srv), true);
  check('la usa la ruta de gastos sueltos',
    /expenses', ruta\(async \(req, res\) => \{\s*\n\s*if \(await grupoBloqueado/.test(srv), true);
  check('la usa la ruta que mete un ticket en el grupo',
    /if \(groupId && await grupoBloqueado\(groupId\)\)/.test(srv), true);
  check('responde 409, no 500', /status\(409\)\.json\(AVISO_BLOQUEADO\)/.test(srv), true);

  // Liquidar NO puede borrar: esto es dinero.
  check('liquidar archiva en vez de borrar',
    /archivedAt: ahora/.test(bd), true);
  check('liquidar no llama a delete', /clearGroupSettlement[\s\S]*?\n\}/.exec(bd)[0].includes('.delete('), false);
  check('lo archivado deja de contar en los gastos',
    /filter\(e => !e\.archivedAt\)/.test(bd), true);
  check('lo archivado deja de contar en los pagos',
    /filter\(p => !p\.archivedAt\)/.test(bd), true);
  check('lo archivado deja de contar en los tickets',
    /filter\(t => !t\.archivedAt\)/.test(bd), true);
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
