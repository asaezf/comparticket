#!/usr/bin/env node
/**
 * Banco de pruebas de extracción — comparTICKET
 *
 * Pasa fotos de tickets por el mismo camino que usa la app y muestra lo que
 * saca la IA, cuánto tarda y —lo más importante— si el total del ticket cuadra
 * con la suma de las líneas.
 *
 *   node scripts/test-extract.js uploads/ticket.jpg
 *   node scripts/test-extract.js fixtures/*.jpg
 *   GEMINI_MODEL=gemini-3.1-flash-lite node scripts/test-extract.js fixtures/mercadona.jpg
 *
 * Varias fotos del MISMO ticket van en una sola llamada, igual que en la app:
 *   node scripts/test-extract.js --same foto1.jpg foto2.jpg
 */

const fs = require('fs');
const path = require('path');

// El .env vive en la raíz del repo principal, no en el worktree.
const ENV_CANDIDATES = [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', '..', '..', '.env')
];
for (const p of ENV_CANDIDATES) {
  if (fs.existsSync(p)) { require('dotenv').config({ path: p }); break; }
}

if (!process.env.GEMINI_API_KEY) {
  console.error('Falta GEMINI_API_KEY. Revisa el .env.');
  process.exit(1);
}

const ai = require('../ai');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const eur = n => `${n.toFixed(2)}€`.padStart(9);

async function run(files, label) {
  const images = files.map(f => ({
    buffer: fs.readFileSync(f),
    mimeType: MIME[path.extname(f).toLowerCase()] || 'image/jpeg'
  }));
  const mb = (images.reduce((s, i) => s + i.buffer.length, 0) / 1048576).toFixed(1);

  console.log(`\n${'='.repeat(64)}`);
  console.log(`${label}  (${files.length} foto(s), ${mb} MB)`);
  console.log('='.repeat(64));

  const t0 = Date.now();
  let out;
  try {
    out = await ai.extractItemsFromImages(images);
  } catch (err) {
    console.log(`FALLO  [${err.code || 'API'}]  ${err.message}`);
    return { file: label, ok: false, error: err.code || err.message };
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`${out.restaurant || '(sin nombre)'} — ${out.date || 's/f'} ${out.time || ''} ${out.address || ''}`);
  console.log(`${out.items.length} artículos en ${secs}s\n`);

  out.items.forEach(i => {
    const q = String(i.quantity).padStart(2);
    console.log(`  ${q} × ${i.name.slice(0, 34).padEnd(34)} ${eur(i.unitPrice)} ${eur(i.totalPrice)}${i.shared ? '  [compartido]' : ''}`);
  });

  // El chequeo que de verdad importa: ¿cuadra la cuenta?
  const suma = +out.items.reduce((s, i) => s + i.totalPrice, 0).toFixed(2);
  const delta = +(out.total - suma).toFixed(2);
  const cuadra = Math.abs(delta) <= 0.02;
  console.log(`\n  ${'SUMA LÍNEAS'.padEnd(41)} ${eur(suma)}`);
  console.log(`  ${'TOTAL TICKET'.padEnd(41)} ${eur(out.total)}`);
  console.log(`  ${(cuadra ? 'CUADRA' : '>>> DESCUADRE').padEnd(41)} ${eur(delta)}`);

  return { file: label, ok: true, items: out.items.length, secs: +secs, total: out.total, suma, delta, cuadra };
}

(async () => {
  const argv = process.argv.slice(2);
  const same = argv.includes('--same');
  const files = argv.filter(a => a !== '--same');

  if (!files.length) {
    console.error('Uso: node scripts/test-extract.js <imagen...> [--same]');
    process.exit(1);
  }

  const results = [];
  if (same) {
    results.push(await run(files, files.map(f => path.basename(f)).join(' + ')));
  } else {
    for (const f of files) results.push(await run([f], path.basename(f)));
  }

  // El modelo real lo decide ai.js; repetirlo aquí se quedaba desfasado.
  console.log(`\n${'='.repeat(64)}\nRESUMEN (modelo: ${ai.PRIMARY_MODEL})\n${'='.repeat(64)}`);
  results.forEach(r => {
    if (!r.ok) return console.log(`  FALLO      ${r.file}  — ${r.error}`);
    console.log(`  ${(r.cuadra ? 'cuadra' : 'DESCUAD').padEnd(10)} ${r.file.padEnd(26)} ${String(r.items).padStart(3)} art  ${String(r.secs).padStart(5)}s  desvío ${r.delta.toFixed(2)}€`);
  });
  const ok = results.filter(r => r.ok);
  console.log(`\n  ${ok.length}/${results.length} extraídos · ${ok.filter(r => r.cuadra).length}/${ok.length} cuadran`);
})();
