#!/usr/bin/env node
/**
 * Cuenta los tokens del prompt de sistema y de la imagen por separado.
 * Sirve para decidir si merece la pena el context caching y cuánto se ahorra
 * redimensionando la foto antes de subirla.
 *
 *   node scripts/measure-tokens.js fixtures/*.jpeg
 */

const fs = require('fs');
const path = require('path');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '..', '..', '.env')]) {
  if (fs.existsSync(p)) { require('dotenv').config({ path: p }); break; }
}

const { GoogleGenAI } = require('@google/genai');
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

// Mismo prompt que usa la app, leído del fichero para no duplicarlo.
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'ai.js'), 'utf8')
  .split('const SYSTEM_PROMPT = `')[1].split('`;')[0];

(async () => {
  const sys = await genai.models.countTokens({
    model: MODEL, contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT }] }]
  });
  console.log(`\nModelo: ${MODEL}`);
  console.log(`Prompt de sistema: ${sys.totalTokens} tokens (idénticos en CADA llamada)\n`);

  for (const f of process.argv.slice(2)) {
    const buf = fs.readFileSync(f);
    const r = await genai.models.countTokens({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: MIME[path.extname(f).toLowerCase()] || 'image/jpeg', data: buf.toString('base64') } }] }]
    });
    console.log(`  ${path.basename(f).padEnd(34)} ${(buf.length / 1024).toFixed(0).padStart(5)} KB  →  ${String(r.totalTokens).padStart(5)} tokens`);
  }

  console.log(`\n  El prompt de sistema es fijo: es el candidato a caché.`);
  console.log(`  La imagen es lo único que se puede reducir en origen.\n`);
})();
