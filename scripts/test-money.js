#!/usr/bin/env node
/**
 * Tests del cálculo del dinero — no gastan API.
 *   node scripts/test-money.js
 *
 * Cubre los dos fallos que Álvaro señaló como los más graves:
 *   1. Compartir un ticket cuyas líneas no suman el total.
 *   2. Cerrar una cuenta cuando lo que paga la gente no llega al total.
 */

const M = require('../money');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = typeof want === 'number' ? Math.abs(got - want) < 0.005 : got === want;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${label.padEnd(52)} ${JSON.stringify(got)}  (esperado ${JSON.stringify(want)})`);
  ok ? pass++ : fail++;
}

// Ticket real de Mercadona: 35 líneas, 84,50 €. Muestra representativa.
const mercadona = [
  { id: 1, name: 'Energy tropic zero', quantity: 2, unitPrice: 1.00 },
  { id: 2, name: 'Ginebra',            quantity: 1, unitPrice: 13.50 },
  { id: 3, name: 'Café leche capuccino', quantity: 6, unitPrice: 0.75 },
  { id: 4, name: 'Tomate canario (0,378 kg)', quantity: 1, unitPrice: 0.83 }
];
const mercadonaTotal = 20.83; // 2,00 + 13,50 + 4,50 + 0,83

console.log('\n1. Cuadre del ticket al extraerlo');
{
  const r = M.reconcileTicket(mercadona, mercadonaTotal);
  check('suma de líneas', r.sum, 20.83);
  check('cuadra', r.balanced, true);
  check('desvío cero', r.delta, 0);
}
{
  // El caso de un restaurante: 4,70 € de servicio no desglosado.
  const r = M.reconcileTicket([
    { id: 1, quantity: 2, unitPrice: 20.00 },
    { id: 2, quantity: 1, unitPrice: 7.30 }
  ], 52.00);
  check('detecta que faltan 4,70', r.delta, 4.70);
  check('no deja compartir', r.balanced, false);
  check('lo clasifica como "falta"', r.kind, 'falta');
}
{
  const r = M.reconcileTicket([{ id: 1, quantity: 1, unitPrice: 50.00 }], 45.00);
  check('detecta un descuento de 5', r.delta, -5.00);
  check('lo clasifica como "sobra"', r.kind, 'sobra');
}
{
  // Redondeo legítimo: 3 cafés de 2,25 € → 0,75 €/ud. No debe dar falso positivo.
  const r = M.reconcileTicket([{ id: 1, quantity: 3, unitPrice: 0.75 }], 2.26);
  check('tolera 1 céntimo de redondeo', r.balanced, true);
}

console.log('\n2. Reparto por unidad');
{
  // Álvaro y María comparten la ginebra; Álvaro se toma 2 cafés, María 1.
  const claims = [
    { personName: 'Álvaro', itemUnits: { 2: [0], 3: [0, 1] } },
    { personName: 'María',  itemUnits: { 2: [0], 3: [2] } }
  ];
  const r = M.splitByUnits(mercadona, claims);
  check('Álvaro: media ginebra + 2 cafés', r.perPerson['Álvaro'], 6.75 + 1.50);
  check('María: media ginebra + 1 café', r.perPerson['María'], 6.75 + 0.75);
  // 10 unidades en total, 4 marcadas → 6 sueltas: 2 energy + 3 cafés + 1 tomate.
  check('quedan unidades sin marcar', r.unclaimedUnits, 6);
  // 2,00 (energy) + 2,25 (3 cafés) + 0,83 (tomate) = 5,08 que hoy se come el pagador.
  check('lo sin marcar es dinero que nadie paga', M.reconcileClaims(mercadona, mercadonaTotal, claims).pending, 5.08);
}
{
  // La misma unidad marcada por 3 personas se divide entre 3.
  const items = [{ id: 1, quantity: 1, unitPrice: 30.00 }];
  const claims = [
    { personName: 'A', itemUnits: { 1: [0] } },
    { personName: 'B', itemUnits: { 1: [0] } },
    { personName: 'C', itemUnits: { 1: [0] } }
  ];
  const r = M.splitByUnits(items, claims);
  check('división a tres', r.perPerson['A'], 10.00);
  check('el importe no se duplica', r.assigned, 30.00);
}

console.log('\n3. Cierre de cuenta — el bloqueo que faltaba');
{
  const items = [{ id: 1, quantity: 2, unitPrice: 10.00 }];
  const claims = [{ personName: 'A', itemUnits: { 1: [0] } }]; // solo 1 de 2 unidades
  const r = M.reconcileClaims(items, 20.00, claims);
  check('asignado', r.assigned, 10.00);
  check('queda pendiente', r.pending, 10.00);
  check('NO deja cerrar', r.balanced, false);
}
{
  const items = [{ id: 1, quantity: 2, unitPrice: 10.00 }];
  const claims = [
    { personName: 'A', itemUnits: { 1: [0] } },
    { personName: 'B', itemUnits: { 1: [1] } }
  ];
  const r = M.reconcileClaims(items, 20.00, claims);
  check('todo asignado', r.pending, 0);
  check('deja cerrar', r.balanced, true);
  check('A paga lo suyo', r.perPerson['A'], 10.00);
}
{
  // Con servicio sin repartir, cerrar debe seguir bloqueado aunque todas las
  // unidades estén marcadas: el total del ticket es mayor que las líneas.
  const items = [{ id: 1, quantity: 1, unitPrice: 47.30 }];
  const claims = [{ personName: 'A', itemUnits: { 1: [0] } }];
  const r = M.reconcileClaims(items, 52.00, claims);
  check('detecta el servicio sin repartir', r.pending, 4.70);
  check('NO deja cerrar', r.balanced, false);
}

console.log('\n4. Línea de ajuste');
{
  const items = [{ id: 1, quantity: 2, unitPrice: 20.00 }, { id: 2, quantity: 1, unitPrice: 7.30 }];
  const adj = M.adjustmentItem(items, 4.70);
  check('id sin colisión', adj.id, 3);
  check('importe', adj.totalPrice, 4.70);
  check('marcado como compartido', adj.shared, true);
  const r = M.reconcileTicket(items.concat([adj]), 52.00);
  check('añadirla hace cuadrar el ticket', r.balanced, true);
}
{
  const adj = M.adjustmentItem([{ id: 1, quantity: 1, unitPrice: 50 }], -5.00);
  check('un descuento sale negativo', adj.totalPrice, -5.00);
  check('se etiqueta como descuento', adj.name, 'Descuento');
}

console.log('\n5. Borradores: quien todavía está eligiendo no cuenta');
{
  const items = [{ id: 1, quantity: 2, unitPrice: 10.00 }];
  // Ana ha confirmado; Beto está a medias.
  const claims = [
    { personName: 'Ana',  itemUnits: { 1: [0] }, confirmed: true },
    { personName: 'Beto', itemUnits: { 1: [1] }, confirmed: false }
  ];
  const r = M.reconcileClaims(items, 20.00, claims);
  check('solo se cuenta lo confirmado', r.assigned, 10.00);
  check('lo de Beto sigue pendiente', r.pending, 10.00);
  check('NO deja cerrar con alguien a medias', r.balanced, false);
  check('confirmedOnly filtra bien', M.confirmedOnly(claims).length, 1);

  // Beto confirma.
  claims[1].confirmed = true;
  const r2 = M.reconcileClaims(items, 20.00, claims);
  check('al confirmar, cuadra', r2.pending, 0);
  check('y deja cerrar', r2.balanced, true);
}
{
  // Un borrador SÍ se ve en la pantalla de reparto, para que los demás sepan
  // qué está cogiendo: splitByUnits sin filtrar lo incluye.
  const items = [{ id: 1, quantity: 2, unitPrice: 10.00 }];
  const claims = [{ personName: 'Beto', itemUnits: { 1: [0] }, confirmed: false }];
  check('el borrador se ve en vivo', M.splitByUnits(items, claims).perPerson['Beto'], 10.00);
  check('pero no cuenta para cerrar', M.reconcileClaims(items, 20.00, claims).assigned, 0);
}
{
  // Claims de antes de existir el campo: se tratan como confirmados.
  const claims = [{ personName: 'Viejo', itemUnits: { 1: [0] } }];
  check('claim antiguo cuenta como confirmado', M.confirmedOnly(claims).length, 1);
}

console.log('\n6. Claims antiguos (formato viejo)');
{
  const items = [{ id: 1, quantity: 3, unitPrice: 2.00 }];
  const r = M.splitByUnits(items, [{ personName: 'A', itemCounts: { 1: 2 } }]);
  check('itemCounts sigue funcionando', r.perPerson['A'], 4.00);
  const r2 = M.splitByUnits(items, [{ personName: 'B', itemIds: [1] }]);
  check('itemIds sigue funcionando', r2.perPerson['B'], 2.00);
}

console.log('\n7. Fila "suma de lo marcado" del resumen');
{
  // Misma regla que summary.js: gris mientras falte gente; con todos dentro,
  // verde solo si coincide EXACTO — un céntimo ya la pone en rojo. Esto es
  // más estricto que el criterio de cerrar, que tolera 0,02 € de redondeo.
  const estado = (items, total, claims, esperados) => {
    const c = M.reconcileClaims(items, total, claims);
    const listos = M.confirmedOnly(claims).length;
    if (!esperados || listos < esperados) return 'gris';
    return Math.abs(c.total - c.assigned) < 0.005 ? 'verde' : 'rojo';
  };

  const items = [{ id: 1, quantity: 2, unitPrice: 10 }];
  const dos = [
    { personName: 'A', itemUnits: { 1: [0] }, confirmed: true },
    { personName: 'B', itemUnits: { 1: [1] }, confirmed: true }
  ];

  check('falta gente → gris aunque no cuadre', estado(items, 20, [dos[0]], 2), 'gris');
  check('todos y cuadra → verde', estado(items, 20, dos, 2), 'verde');
  check('todos y falta 1 céntimo → rojo', estado(items, 20.01, dos, 2), 'rojo');
  check('todos y sobra 1 céntimo → rojo', estado(items, 19.99, dos, 2), 'rojo');
  check('un borrador no completa el grupo → gris',
    estado(items, 20, [dos[0], { ...dos[1], confirmed: false }], 2), 'gris');
  check('sin nº de participantes → gris', estado(items, 20, dos, 0), 'gris');

  // Y que sigan siendo criterios distintos: 1 céntimo pinta rojo pero no
  // impide cerrar.
  check('1 céntimo no bloquea el cierre',
    M.reconcileClaims(items, 20.01, dos).balanced, true);
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
