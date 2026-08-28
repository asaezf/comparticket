#!/usr/bin/env node
/**
 * El reparto congelado — arregla que "quién paga a quién" se reordenara
 * solo conforme la gente iba pagando.
 *   node scripts/test-settlement-plan.js
 *
 * Contexto del fallo real: medido en la sesión anterior con
 * scripts/test-settle.js — pagando EXACTAMENTE lo que la app sugería, en
 * el 20% de los grupos reales de 3+ personas el resto del reparto cambiaba
 * de pareja. El dinero nunca se perdía (eso ya estaba probado), pero la
 * gente dejaba de fiarse en cuanto veía que "su" deuda cambiaba de dueño.
 *
 * La solución: el reparto se calcula UNA VEZ al bloquear el grupo
 * (settlementPlan) y desde ahí cada pago descuenta de SU línea concreta
 * (Settle.applyPlan), sin tocar las demás.
 *
 * Aquí se prueban dos cosas por separado:
 *   1. Que el fallo original ya no ocurre (la propiedad que se quería).
 *   2. Qué tipos de problemas NUEVOS podía causar esta solución, y que cada
 *      uno queda cubierto: pagos duplicados, de más, a la persona
 *      equivocada, y grupos que ya estaban bloqueados antes de este cambio.
 */

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const PUB = path.join(RAIZ, 'public');
const S = require(path.join(RAIZ, 'settle'));

let pass = 0, fail = 0;
function check(label, got, want) {
  const bien = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${bien ? 'ok   ' : 'FALLA'}  ${label}`);
  if (!bien) console.log(`         obtenido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`);
  bien ? pass++ : fail++;
}
function ok(label, cond, detalle) {
  console.log(`  ${cond ? 'ok   ' : 'FALLA'}  ${label}`);
  if (!cond && detalle !== undefined) console.log('         ' + detalle);
  cond ? pass++ : fail++;
}

function generarPlan(saldos) {
  return S.minimalTransfers(saldos).map((t, i) => Object.assign({ id: 'e' + i }, t));
}

console.log('\n1. applyPlan: los casos básicos, uno por uno');
{
  const plan = [
    { id: 'e1', de: 'A', a: 'C', importe: 30 },
    { id: 'e2', de: 'B', a: 'C', importe: 20 }
  ];

  let r = S.applyPlan(plan, [{ de: 'A', a: 'C', importe: 30, planEdgeId: 'e1' }]);
  check('pagar una línea entera, con su id, la quita de pendientes',
    r.pendientes.map(x => x.id), ['e2']);
  check('  y no deja nada fuera de plan', r.fueraDePlan, []);

  r = S.applyPlan(plan, [{ de: 'A', a: 'C', importe: 10, planEdgeId: 'e1' }]);
  check('pagar solo una parte deja el resto en esa misma línea',
    r.pendientes.find(x => x.id === 'e1').importe, 20);

  r = S.applyPlan(plan, []);
  check('sin pagos, las dos líneas siguen enteras', r.pendientes.length, 2);
}

console.log('\n2. La propiedad que se quería: pagar lo sugerido nunca reordena las demás líneas');
{
  // La MISMA simulación que reveló el fallo original (500 grupos, se paga
  // una transferencia sugerida entera y tal cual), pero esta vez contra un
  // plan congelado en vez de recalculando minimalTransfers desde cero.
  let semilla = 777;
  const rnd = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;

  function grupoAleatorio(gente, nApuntes) {
    const apuntes = [];
    for (let i = 0; i < nApuntes; i++) {
      const pagador = gente[Math.floor(rnd() * gente.length)];
      const cuantos = 2 + Math.floor(rnd() * (gente.length - 1));
      const entre = gente.slice().sort(() => rnd() - 0.5).slice(0, cuantos);
      const total = Math.round((5 + rnd() * 195) * 100) / 100;
      apuntes.push({ pagador, total, reparto: S.splitEqually(total, entre) });
    }
    return apuntes;
  }

  let casos = 0, seReordeno = 0;
  for (let prueba = 0; prueba < 500; prueba++) {
    const nGente = 3 + Math.floor(rnd() * 5);
    const gente = Array.from({ length: nGente }, (_, i) => 'P' + i);
    const apuntes = grupoAleatorio(gente, 4 + Math.floor(rnd() * 10));

    const saldosAlBloquear = S.computeBalances(apuntes, [], gente);
    const plan = generarPlan(saldosAlBloquear);
    if (plan.length < 3) continue;

    const idx = Math.floor(rnd() * plan.length);
    const pagada = plan[idx];
    const pagos = [{ de: pagada.de, a: pagada.a, importe: pagada.importe, planEdgeId: pagada.id }];

    const { pendientes, fueraDePlan } = S.applyPlan(plan, pagos);
    const esperado = plan.filter((_, i) => i !== idx)
      .map(e => ({ id: e.id, de: e.de, a: e.a, importe: e.importe }));

    casos++;
    const igual = JSON.stringify(pendientes.map(p => ({ id: p.id, de: p.de, a: p.a, importe: p.importe })))
      === JSON.stringify(esperado);
    if (!igual || fueraDePlan.length) seReordeno++;
  }

  ok('con ' + casos + ' casos de 3+ líneas, ninguno reordenó las demás al pagar una entera',
    seReordeno === 0, seReordeno + ' de ' + casos + ' cambiaron algo que no debían');
}

console.log('\n3. Qué tipos de problemas podía causar esta solución, y que quedan cubiertos');
{
  const plan = [
    { id: 'e1', de: 'Alvaro', a: 'Daniel', importe: 40 },
    { id: 'e2', de: 'Nerea', a: 'Daniel', importe: 25 }
  ];

  // (a) El mismo pago anotado dos veces -doble toque, o dos personas
  // marcándolo a la vez- no debe hacer que Daniel reciba el doble sin que
  // se note, ni debe restarle a la otra línea de Nerea.
  {
    const pagos = [
      { de: 'Alvaro', a: 'Daniel', importe: 40, planEdgeId: 'e1' },
      { de: 'Alvaro', a: 'Daniel', importe: 40, planEdgeId: 'e1' }
    ];
    const r = S.applyPlan(plan, pagos);
    ok('(a) un pago duplicado no desaparece: se ve como fuera de plan',
      r.fueraDePlan.length === 1 && Math.abs(r.fueraDePlan[0].importe - 40) < 0.01,
      JSON.stringify(r.fueraDePlan));
    check('    y la línea de Nerea, que no tiene nada que ver, sigue intacta',
      r.pendientes.find(x => x.id === 'e2').importe, 25);
  }

  // (b) Alguien paga más de lo que esa línea pedía (redondea "para
  // arriba"). El sobrante no debe colarse silenciosamente como si fuera un
  // pago de la línea de Nerea.
  {
    const r = S.applyPlan(plan, [{ de: 'Alvaro', a: 'Daniel', importe: 50, planEdgeId: 'e1' }]);
    check('(b) la línea pagada de más queda en cero, no en negativo',
      r.pendientes.some(x => x.id === 'e1'), false);
    ok('    y los 10 € de más salen aparte, no desaparecen ni tocan a Nerea',
      r.fueraDePlan.length === 1 && Math.abs(r.fueraDePlan[0].importe - 10) < 0.01,
      JSON.stringify(r.fueraDePlan));
    check('    la línea de Nerea sigue en 25, no en 15',
      r.pendientes.find(x => x.id === 'e2').importe, 25);
  }

  // (c) Alguien paga a una persona con la que el plan no le emparejaba
  // -por ejemplo, Alvaro le da el dinero a Nerea en persona para que ella
  // se lo dé a Daniel, en vez de pagarle a Daniel directamente.
  {
    const r = S.applyPlan(plan, [{ de: 'Alvaro', a: 'Nerea', importe: 40 }]);
    ok('(c) un pago a una pareja que no está en el plan se aparta entero',
      r.fueraDePlan.length === 1 && r.fueraDePlan[0].de === 'Alvaro' && r.fueraDePlan[0].a === 'Nerea',
      JSON.stringify(r.fueraDePlan));
    check('    las dos líneas originales siguen intactas, nadie se ha quedado sin su deuda',
      r.pendientes.map(x => x.importe), [40, 25]);
  }

  // (d) Pagos de ANTES de que existiera este sistema -sin planEdgeId
  // porque no existía la columna todavía- tienen que seguir encajando por
  // (de, a), o todos los grupos que ya estaban bloqueados se romperían.
  {
    const r = S.applyPlan(plan, [{ de: 'Nerea', a: 'Daniel', importe: 25 }]);
    check('(d) un pago antiguo sin planEdgeId encaja igualmente por (de, a)',
      r.pendientes.map(x => x.id), ['e1']);
    check('    y no queda nada fuera de plan', r.fueraDePlan, []);
  }

  // (e) Migración: un grupo bloqueado ANTES de este cambio no tiene
  // settlementPlan guardado todavía. server.js debe generarle uno con los
  // saldos actuales -que ya cuentan los pagos que hubiera- la primera vez
  // que se lea, y guardarlo para no reordenar más a partir de ahí.
  {
    const src = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
    ok('server.js genera un plan cuando el grupo está bloqueado y no tiene uno',
      /if \(!plan\)/.test(src) && /setGroupSettlementPlan/.test(src),
      'no se encontró la migración perezosa en groupSummary');
  }
}

console.log('\n4. El dinero sigue sin descuadrarse con el sistema nuevo');
{
  // La misma prueba de convergencia de antes, pero pagando siempre a través
  // de applyPlan (el camino real: el plan se fija una vez, cada pago
  // descuenta de su línea).
  let semilla = 4242;
  const rnd = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;

  function grupoAleatorio(gente, nApuntes) {
    const apuntes = [];
    for (let i = 0; i < nApuntes; i++) {
      const pagador = gente[Math.floor(rnd() * gente.length)];
      const cuantos = 2 + Math.floor(rnd() * (gente.length - 1));
      const entre = gente.slice().sort(() => rnd() - 0.5).slice(0, cuantos);
      const total = Math.round((5 + rnd() * 195) * 100) / 100;
      apuntes.push({ pagador, total, reparto: S.splitEqually(total, entre) });
    }
    return apuntes;
  }

  let peorDescuadre = 0, maxPasos = 0, problemas = 0;
  for (let sim = 0; sim < 300; sim++) {
    const nGente = 3 + Math.floor(rnd() * 6);
    const gente = Array.from({ length: nGente }, (_, i) => 'P' + i);
    const apuntes = grupoAleatorio(gente, 5 + Math.floor(rnd() * 10));

    const saldosAlBloquear = S.computeBalances(apuntes, [], gente);
    const plan = generarPlan(saldosAlBloquear);
    const deudaTotal = plan.reduce((s, t) => s + t.importe, 0);

    const pagos = [];
    let pendientes = plan;
    let pasos = 0;
    while (pendientes.length && pasos++ < 200) {
      const elegida = pendientes[Math.floor(rnd() * pendientes.length)];
      pagos.push({ de: elegida.de, a: elegida.a, importe: elegida.importe, planEdgeId: elegida.id });
      const aplicado = S.applyPlan(plan, pagos);
      pendientes = aplicado.pendientes;
    }
    maxPasos = Math.max(maxPasos, pasos);

    // Los saldos de verdad -no el plan- son los que dicen si cuadra.
    const pagosParaSaldo = pagos.map(p => ({ de: p.de, a: p.a, importe: p.importe }));
    const saldosFinales = S.computeBalances(apuntes, pagosParaSaldo, gente);
    const descuadre = Math.max(0, ...Object.values(saldosFinales).map(Math.abs));
    peorDescuadre = Math.max(peorDescuadre, descuadre);

    const totalPagado = pagos.reduce((s, p) => s + p.importe, 0);
    if (pasos >= 200 || descuadre > 0.02 || Math.abs(totalPagado - deudaTotal) > 0.02) problemas++;
  }

  ok('1) 300 grupos saldados a través del plan: descuadre final 0 (peor: ' + peorDescuadre.toFixed(4) + ' €)',
    peorDescuadre < 0.02);
  ok('2) nunca hicieron falta más de ' + maxPasos + ' pasos, ni ningún bucle sin fin', maxPasos < 200);
  ok('3) ninguna simulación tuvo un problema real', problemas === 0, problemas + ' de 300');
}

console.log('\n5. El resto de la fontanería está conectada');
{
  const dbSrc = fs.readFileSync(path.join(RAIZ, 'db.js'), 'utf8');
  ok('db.js exporta setGroupSettlementPlan', /setGroupSettlementPlan,/.test(dbSrc));
  ok('addGroupPayment guarda planEdgeId', /planEdgeId: payment\.planEdgeId/.test(dbSrc));
  ok('setGroupLocked congela settlementPlan al bloquear', /settlementPlan: bloqueado \? \(plan/.test(dbSrc));
  ok('desbloquear borra el plan (si no, un re-bloqueo heredaría uno viejo)',
    /lockedAt: bloqueado \? new Date\(\)\.toISOString\(\) : null/.test(dbSrc));
  ok('liquidar el grupo también borra el plan', /lockedAt: null, settlementPlan: null/.test(dbSrc));

  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  ok('el endpoint de bloquear calcula el plan antes de guardar',
    /plan = settle\.minimalTransfers\(resumenActual\.balances\)/.test(srv));
  ok('existe la ruta de recalcular a mano', /\/api\/groups\/:id\/replan/.test(srv));
  ok('recalcular exige que el grupo esté bloqueado',
    /NOT_LOCKED/.test(srv));
  ok('el endpoint de pagos valida planEdgeId contra el plan real del grupo',
    /group\.settlementPlan \|\| \[\]\)\.some\(e => e && e\.id === planEdgeId\)/.test(srv));
  ok('groupSummary devuelve fueraDePlan', /fueraDePlan,\n\s*stats/.test(srv) || /fueraDePlan;/.test(srv) || /fueraDePlan = aplicado\.fueraDePlan/.test(srv));

  const js = fs.readFileSync(path.join(PUB, 'js', 'group.js'), 'utf8');
  ok('marcarPagado manda planEdgeId', /planEdgeId: t\.id \|\| null/.test(js));
  ok('existe recalcularReparto() y llama a /replan', /function recalcularReparto[\s\S]{0,300}\/replan/.test(js));
  ok('el botón de recalcular tiene su listener', /getElementById\('recalcularBtn'\)\.addEventListener/.test(js));
  ok('se pinta el aviso de fuera de plan', /fueraDePlanNote/.test(js));

  const html = fs.readFileSync(path.join(PUB, 'group.html'), 'utf8');
  ok('el HTML tiene el hueco del aviso', /id="fueraDePlanNote"/.test(html));
  ok('  con su importe', /id="fueraDePlanAmount"/.test(html));
  ok('  y su botón de recalcular', /id="recalcularBtn"/.test(html));
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
