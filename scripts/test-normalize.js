#!/usr/bin/env node
/**
 * Tests de normalize() — no gastan llamadas a la API.
 *   node scripts/test-normalize.js
 *
 * Casos sacados del ticket real de Mercadona (25/07/2026, 84,50 €), que es
 * el que fallaba. Sirve de red de seguridad para tocar el prompt sin romper
 * el cálculo del dinero.
 */

const { normalize } = require('../ai');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = Math.abs(got - want) < 0.005;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${label.padEnd(48)} ${got}  (esperado ${want})`);
  ok ? pass++ : fail++;
}

console.log('\nArtículo a peso (el que rompía el total)');
{
  // Lo que devuelve la IA para "1 TOMATE CANARIO / 0,378 kg  2,20 €/kg → 0,83"
  // si interpreta el peso como cantidad.
  const out = normalize({
    items: [{ name: 'Tomate canario', quantity: 0.378, unitPrice: 2.20, totalPrice: 0.83, shared: false }],
    total: 0.83
  });
  const it = out.items[0];
  check('cantidad se convierte en 1 unidad entera', it.quantity, 1);
  check('el precio unitario pasa a ser el de la línea', it.unitPrice, 0.83);
  check('cantidad x precio = importe real', it.quantity * it.unitPrice, 0.83);
  check('no desaparece del total', out.total, 0.83);
}

console.log('\nLíneas normales del mismo ticket');
{
  const out = normalize({
    items: [
      { name: 'Energy tropic zero', quantity: 2, unitPrice: 1.00, totalPrice: 2.00, shared: false },
      { name: 'Ginebra',            quantity: 1, unitPrice: 13.50, totalPrice: 13.50, shared: true },
      { name: 'Font natura',        quantity: 3, unitPrice: 1.56, totalPrice: 4.68, shared: false },
      { name: 'Café leche cappuccino', quantity: 6, unitPrice: 0.75, totalPrice: 4.50, shared: false }
    ],
    total: 24.68
  });
  out.items.forEach(i =>
    check(`${i.name}: cantidad x unitario = importe`, +(i.quantity * i.unitPrice).toFixed(2), i.totalPrice)
  );
  check('suma de líneas', +out.items.reduce((s, i) => s + i.totalPrice, 0).toFixed(2), 24.68);
}

console.log('\nEntradas defectuosas de la IA');
{
  const out = normalize({
    items: [
      { name: 'Sin importe',   quantity: 2, unitPrice: 3.00 },              // falta totalPrice
      { name: 'Cantidad cero', quantity: 0, unitPrice: 5.00, totalPrice: 5.00 },
      { name: 'Cantidad rara', quantity: 'dos', unitPrice: 1.50, totalPrice: 3.00 },
      { name: '' },                                                          // se descarta
      null                                                                   // se descarta
    ]
  });
  check('items válidos conservados', out.items.length, 3);
  check('deriva el importe de cantidad x unitario', out.items[0].totalPrice, 6.00);
  check('cantidad 0 se sube a 1', out.items[1].quantity, 1);
  check('cantidad no numérica se sube a 1', out.items[2].quantity, 1);
  check('total se calcula si no viene', out.total, 14.00);
}

console.log('\nDescuadre entre líneas y total (lo que hay que detectar)');
{
  // Suma 47,30 pero el ticket dice 52,00: hay 4,70 de servicio sin desglosar.
  const out = normalize({
    items: [
      { name: 'Menú', quantity: 2, unitPrice: 20.00, totalPrice: 40.00 },
      { name: 'Vino', quantity: 1, unitPrice: 7.30, totalPrice: 7.30 }
    ],
    total: 52.00
  });
  const suma = +out.items.reduce((s, i) => s + i.totalPrice, 0).toFixed(2);
  check('respeta el total del ticket, no lo machaca', out.total, 52.00);
  check('el descuadre queda detectable', +(out.total - suma).toFixed(2), 4.70);
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
