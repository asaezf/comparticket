#!/usr/bin/env node
/**
 * Idiomas y divisas.
 *   node scripts/test-idiomas.js
 *
 * Dos cosas que se rompen en silencio y no dan la cara hasta que alguien abre
 * la app en su idioma:
 *
 *   1. Un paquete de idioma al que le falta una clave. La pantalla no
 *      revienta: simplemente sale un hueco vacío donde debería haber texto.
 *   2. El formato de los importes. Al añadir las divisas se coló un espacio
 *      duro donde siempre hubo uno normal, y eso cambia de golpe TODOS los
 *      mensajes de WhatsApp y las vistas previas de los enlaces.
 */

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(label, got, want) {
  const bien = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${bien ? 'ok   ' : 'FALLA'}  ${label}`);
  if (!bien) {
    console.log(`         obtenido: ${JSON.stringify(got)}`);
    console.log(`         esperado: ${JSON.stringify(want)}`);
  }
  bien ? pass++ : fail++;
}

// --- Los paquetes de idioma ---------------------------------------------
const src = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'i18n.js'), 'utf8');
const translations = new Function(
  src.slice(0, src.indexOf('function detectLang')) + '; return translations;')();

const IDIOMAS = ['es', 'en', 'no', 'pl', 'fr', 'it', 'de'];
check('están los siete idiomas', Object.keys(translations).sort(), IDIOMAS.slice().sort());

const base = Object.keys(translations.es);
for (const l of IDIOMAS) {
  const pack = translations[l] || {};
  const faltan = base.filter(k => !(k in pack));
  const vacias = base.filter(k => k in pack && !String(pack[k]).trim());
  check(`${l}: no le falta ninguna clave`, faltan, []);
  check(`${l}: ninguna clave vacía`, vacias, []);
}

// Los textos con hueco tienen que conservarlo en todos los idiomas: si se
// pierde, el número no aparece por ninguna parte.
for (const l of IDIOMAS) {
  check(`${l}: {n} sigue en pendingHint`,
    /\{n\}/.test(translations[l].pendingHint), true);
  check(`${l}: {x} sigue en cantCloseUnassigned`,
    /\{x\}/.test(translations[l].cantCloseUnassigned), true);
  check(`${l}: {name} sigue en nameTaken`,
    /\{name\}/.test(translations[l].nameTaken), true);
}

// --- Las divisas ---------------------------------------------------------
const Money = require(path.join(RAIZ, 'money.js'));

check('euro, como siempre',        Money.format(1234.5, 'es', 'EUR'), '1234,50 €');
check('dólar, símbolo delante',    Money.format(1234.5, 'es', 'USD'), '$1234.50');
check('libra, símbolo delante',    Money.format(1234.5, 'es', 'GBP'), '£1234.50');
check('corona danesa',             Money.format(1234.5, 'es', 'DKK'), '1234,50 kr');
check('corona noruega',            Money.format(1234.5, 'es', 'NOK'), '1234,50 kr');
check('una divisa que no existe cae en euros',
  Money.format(10, 'es', 'XXX'), '10,00 €');

// El separador entre número y símbolo tiene que ser un espacio NORMAL. Con
// uno duro (160) cambian todos los mensajes de WhatsApp de golpe.
check('el separador es un espacio normal, no uno duro',
  Money.format(20, 'es', 'EUR').charCodeAt(5), 32);

// En el servidor no hay localStorage: formatEUR no puede reventar.
check('formatEUR sigue funcionando sin navegador', Money.formatEUR(20, 'es'), '20,00 €');
check('monedaActual cae en euros sin navegador', Money.monedaActual(), 'EUR');

// Redondeo: lo de siempre, pero en cada divisa.
for (const c of ['EUR', 'USD', 'GBP', 'DKK', 'NOK']) {
  check(`${c}: 0,1 + 0,2 se escribe 0,30`,
    /0[.,]30/.test(Money.format(0.1 + 0.2, 'es', c)), true);
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
