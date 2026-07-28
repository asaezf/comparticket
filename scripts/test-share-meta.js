#!/usr/bin/env node
/**
 * Tests de la vista previa al compartir (Open Graph) — no gastan API ni base
 * de datos. Comprueban el texto según el estado de la cuenta y que las
 * etiquetas se sustituyen de verdad dentro del HTML.
 *
 *   node scripts/test-share-meta.js
 */

const fs = require('fs');
const path = require('path');
const money = require('../money');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = typeof want === 'string' ? got === want : !!got === !!want;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${label}`);
  if (!ok) console.log(`         obtenido: ${JSON.stringify(got)}\n         esperado: ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// Misma lógica que server.js. Se duplica aquí a propósito para que el test no
// tenga que cargar firebase-admin ni credenciales.
function shareMeta(ticket, claims) {
  const eur = money.formatEUR(ticket.total, 'es');
  const sitio = ticket.restaurant || 'La cuenta';
  const quien = (ticket.payerName || '').trim();
  const listos = money.confirmedOnly(claims).length;
  const esperados = ticket.expectedParticipants || 0;

  let description;
  if (ticket.status === 'closed') {
    description = `Cuenta cerrada. Mira cómo quedó el reparto de ${eur}.`;
  } else if (esperados && listos >= esperados) {
    description = `Ya han marcado todos. Mira cuánto te toca.`;
  } else if (listos > 0 && esperados) {
    description = `Ya han marcado ${listos} de ${esperados}. Faltas tú.`;
  } else if (listos > 0) {
    description = `Ya hay ${listos} marcando lo suyo. Te toca.`;
  } else if (quien) {
    description = `${quien} ha pagado ${eur}. Marca lo que has tomado para saber cuánto le debes. 💸`;
  } else {
    description = `${eur} sobre la mesa. Marca lo que has tomado para saber cuánto le debes. 💸`;
  }
  return { title: `${sitio} · ${eur}`, description };
}

const base = { restaurant: 'MERCADONA', total: 84.5, payerName: 'Álvaro', expectedParticipants: 6, status: 'shared' };

console.log('\n1. El texto cambia según el estado de la cuenta');
check('título con sitio e importe',
  shareMeta(base, []).title, 'MERCADONA · 84,50 €');
check('recién compartida: apela al pagador',
  shareMeta(base, []).description, 'Álvaro ha pagado 84,50 €. Marca lo que has tomado para saber cuánto le debes. 💸');
check('con gente dentro: presión social',
  shareMeta(base, [{ personName: 'A', confirmed: true }, { personName: 'B', confirmed: true }]).description,
  'Ya han marcado 2 de 6. Faltas tú.');
check('todos listos',
  shareMeta({ ...base, expectedParticipants: 2 }, [{ personName: 'A', confirmed: true }, { personName: 'B', confirmed: true }]).description,
  'Ya han marcado todos. Mira cuánto te toca.');
check('cerrada',
  shareMeta({ ...base, status: 'closed' }, []).description,
  'Cuenta cerrada. Mira cómo quedó el reparto de 84,50 €.');
check('sin pagador anotado',
  shareMeta({ ...base, payerName: null }, []).description,
  '84,50 € sobre la mesa. Marca lo que has tomado para saber cuánto le debes. 💸');
check('sin nombre de sitio',
  shareMeta({ ...base, restaurant: null }, []).title, 'La cuenta · 84,50 €');

console.log('\n2. Los borradores no cuentan como participantes listos');
check('quien sigue eligiendo no suma',
  shareMeta(base, [{ personName: 'A', confirmed: true }, { personName: 'B', confirmed: false }]).description,
  'Ya han marcado 1 de 6. Faltas tú.');

console.log('\n3. Las etiquetas se sustituyen de verdad en el HTML');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'claim.html'), 'utf8');
  const meta = shareMeta(base, []);
  const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const out = html
    .replace(/<meta property="og:title" content="[^"]*">/,
      `<meta property="og:title" content="${escAttr(meta.title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/,
      `<meta property="og:description" content="${escAttr(meta.description)}">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escAttr(meta.title)}</title>`);

  check('og:title sustituido', out.includes('<meta property="og:title" content="MERCADONA · 84,50 €">'), true);
  check('og:description sustituido', out.includes('para saber cuánto le debes'), true);
  check('el emoji sobrevive al escapado', out.includes('💸'), true);
  check('title de la pestaña sustituido', out.includes('<title>MERCADONA · 84,50 €</title>'), true);
  check('la imagen de marca sigue puesta', out.includes('<meta property="og:image" content="/og.png">'), true);
  check('el HTML no se ha roto', out.includes('</html>') && out.includes('id="itemsList"'), true);
}

console.log('\n4. Comillas en el nombre del sitio no rompen la etiqueta');
{
  const meta = shareMeta({ ...base, restaurant: 'BAR "EL 5"' }, []);
  const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  check('las comillas se escapan', escAttr(meta.title).includes('&quot;'), true);
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
