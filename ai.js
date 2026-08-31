// comparTICKET — Gemini Vision ticket extraction
// Uses gemini-2.5-flash (more accurate than flash-lite for OCR tasks).
// All photos of the SAME bill are sent in a single request.

const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `
Eres un sistema OCR especializado en tickets y recibos de restaurantes,
bares, cafeterías y comercios. Tu tarea es leer las fotografías y devolver
un JSON estructurado con los artículos consumidos.

=== REGLAS CRÍTICAS PARA LA LECTURA ===

ESTRUCTURA DE UN TICKET ESPAÑOL TÍPICO:
Un ticket español suele tener columnas: Uds | Producto | Precio | Importe
- "Uds" = cantidad de unidades
- "Precio" = precio por UNA unidad
- "Importe" = precio total de esa línea (Uds × Precio)
- A veces los complementos (C. QUESO, C. TOMATE, C. MANTEQUILLA) aparecen
  como sub-líneas debajo del producto principal con su propio precio unitario.

REGLA DE ORO: Cada línea con "Uds" (cantidad) al principio es un artículo
independiente. Los sub-artículos indentados o que empiezan por "C." son
complementos/extras que se suman al artículo padre.

CÓMO AGRUPAR ARTÍCULOS CON COMPLEMENTOS:
Cuando un artículo tiene complementos debajo (líneas con "C." como
C. QUESO, C. TOMATE, C. MANTEQUILLA, C. PAN SIN GLUTEN, etc.):
- El nombre del artículo principal incluye los complementos relevantes.
  Ejemplo: "1/2 Jamón" con "C. Queso" y "C. Tomate" →
  name: "1/2 Jamón con queso y tomate"
- El unitPrice es la SUMA del precio del artículo + sus complementos.
- El totalPrice es lo que dice la columna "Importe" (el total de esa línea
  completa incluyendo complementos).

PRECIOS — LEE CON CUIDADO:
- En tickets españoles, la coma es separador decimal (2,50 = 2.50 euros).
- Devuelve SIEMPRE números con punto decimal (2.50, no "2,50").
- No confundas el precio unitario de un complemento con el del artículo.
- El "Importe" (columna derecha) es el TOTAL de esa línea = Uds × Precio.
- Si hay una columna de "Precio" y otra de "Importe", usa "Importe" ÷ Uds
  para calcular el unitPrice real.

CANTIDAD (quantity):
- Lee el número que aparece en la columna "Uds" (la primera columna).
- Si no hay columna de unidades, la cantidad es 1.
- quantity SIEMPRE es un entero >= 1. NUNCA devuelvas decimales.
- NO uses el número del nombre del artículo como cantidad
  (ej: "1/2 Jamón" es UN medio de jamón, quantity=1, no 0.5).

ARTÍCULOS A PESO (supermercados):
Cuando una línea se cobra por peso o volumen (kg, g, L) con un precio del
tipo "2,20 €/kg", por ejemplo:
  "1 TOMATE CANARIO / 0,378 kg  2,20 €/kg  →  0,83"
NO uses el peso como quantity. Devuelve SIEMPRE:
  quantity: 1, unitPrice: <el Importe de la línea>, totalPrice: <el mismo Importe>
El peso puede ir en el nombre si ayuda ("Tomate canario (0,378 kg)").
Motivo: cada unidad se reparte entre personas y no se puede repartir 0,378
de una unidad.

=== REGLAS DE SALIDA ===

1. MULTI-IMAGEN = MISMO TICKET. Varias fotos son del mismo recibo.
   Concatena ítems sin duplicar. Usa el total del ticket real.

2. NEGOCIO. Extrae el nombre del restaurante/bar de la cabecera,
   en MAYÚSCULAS. Si no hay, null.

3. FECHA Y HORA. Fecha en formato ISO: YYYY-MM-DD. Si no hay, null.
   Hora en formato HH:MM (24h). Búscala cerca de la fecha en el ticket
   (ej: "05/04/2026 11:08" → date: "2026-04-05", time: "11:08").
   Si no hay hora visible, null.

3b. DIRECCIÓN. Extrae la dirección o localidad del negocio si aparece
    en la cabecera del ticket (ej: "03201 Elche - Alicante" →
    address: "Elche, Alicante"). Formato limpio y corto. Si no hay, null.

4. ÍTEMS. Para cada artículo consumido:
   - name: nombre limpio y descriptivo (incluye complementos si los tiene).
     Capitaliza primera letra. Sin códigos ni abreviaturas raras.
   - quantity: entero (1 si no se indica).
   - unitPrice: precio por UNA unidad, en euros (número).
   - totalPrice: quantity × unitPrice (número).
   - shared: true SOLO para artículos típicamente compartidos entre varias
     personas (raciones, bravas, pizzas grandes, jarras, para compartir).
     false para consumos individuales (café, cerveza, bocadillo, tostada).

5. IGNORA líneas de: subtotales, impuestos/IVA desglosado, propina,
   servicio, método de pago, "tarjeta", "efectivo", "cambio", base
   imponible, cuota. Solo interesan PRODUCTOS consumidos.

6. TOTAL: el importe final a pagar (con impuestos incluidos). Número.

7. NO INVENTES. Si algo no se lee, omítelo. Si no es un ticket,
   devuelve items: [] y total: 0.

=== VERIFICACIÓN MATEMÁTICA ===
Antes de responder, verifica:
- Cada totalPrice == quantity × unitPrice (con margen de ±0.02€ por redondeo).
- La suma de todos los totalPrice debe ser cercana al total del ticket
  (puede diferir ligeramente por impuestos/redondeos, eso es normal).

FORMATO DE SALIDA (JSON puro, sin markdown, sin explicaciones):
{
  "restaurant": "NOMBRE DEL LOCAL" | null,
  "date": "2026-04-15" | null,
  "time": "11:08" | null,
  "address": "Elche, Alicante" | null,
  "items": [
    { "name": "1/2 Jamón con queso y tomate", "quantity": 1, "unitPrice": 3.60, "totalPrice": 3.60, "shared": false }
  ],
  "total": 21.20
}
`;

// Elegido midiendo, no a ojo. Contra el mismo ticket de 35 líneas fotografiado
// en seis condiciones reales (girado, oscuro, torcido, borroso, con reflejo de
// flash y reenviado por WhatsApp), 3.1-flash-lite cuadró 5 de 6 en ~4,7 s
// mientras que 2.5-flash cuadró 3 de 6 en 6,4-14,2 s. Además 2.5 lo apaga
// Google el 16/10/2026. Se puede cambiar por entorno para volver a comparar.
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash';

// Los Flash "grandes" (3.x sin -lite) devuelven 400 si se les pide no razonar:
// exigen un mínimo de 128. Los lite y los 2.5 aceptan 0, que es lo que
// queremos, porque transcribir un ticket no requiere razonar.
function thinkingBudgetFor(model) {
  if (Number.isFinite(+process.env.GEMINI_THINKING_BUDGET)) {
    return +process.env.GEMINI_THINKING_BUDGET;
  }
  return /-lite|^gemini-2\.5-/.test(model) ? 0 : 128;
}

// Long receipts (a supermarket ticket can carry 40+ lines) need plenty of
// output room. 2.5/3.x Flash are thinking models and Google bills those
// thinking tokens against the SAME budget as the visible answer — leaving it
// unset let a long receipt burn the budget on reasoning and return truncated
// JSON, which is what made big tickets fail. Thinking is off: this is
// transcription, not reasoning.
const MAX_OUTPUT_TOKENS = 16384;

// Forcing a schema means the model cannot return malformed JSON at all,
// so JSON.parse stops being a failure mode.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    restaurant: { type: 'STRING', nullable: true },
    date: { type: 'STRING', nullable: true },
    time: { type: 'STRING', nullable: true },
    address: { type: 'STRING', nullable: true },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'INTEGER' },
          unitPrice: { type: 'NUMBER' },
          totalPrice: { type: 'NUMBER' },
          shared: { type: 'BOOLEAN' }
        },
        required: ['name', 'quantity', 'unitPrice', 'totalPrice', 'shared'],
        propertyOrdering: ['name', 'quantity', 'unitPrice', 'totalPrice', 'shared']
      }
    },
    total: { type: 'NUMBER' }
  },
  required: ['items', 'total'],
  propertyOrdering: ['restaurant', 'date', 'time', 'address', 'items', 'total']
};

/**
 * One Gemini call. Throws a tagged Error so the caller can decide whether the
 * failure is worth retrying.
 */
async function callGemini(model, parts) {
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.05,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingBudget: thinkingBudgetFor(model) }
    }
  });

  const candidate = response.candidates && response.candidates[0];
  const finishReason = candidate && candidate.finishReason;
  const usage = response.usageMetadata || {};

  // Los tokens en caché se cobran a ~10% del precio normal. El prompt de
  // sistema son ~1.500 tokens idénticos en cada llamada, así que es el
  // candidato natural — pero hasta ahora no se registraba, y sin este número
  // no hay forma de saber si el descuento se está aplicando ya o no.
  const cached = usage.cachedContentTokenCount || 0;

  console.log(
    `[ai] ${model} finish=${finishReason || 'n/a'} ` +
    `in=${usage.promptTokenCount || 0} out=${usage.candidatesTokenCount || 0} ` +
    `thoughts=${usage.thoughtsTokenCount || 0} cache=${cached}`
  );

  // A truncated answer is the long-receipt failure: surface it by name instead
  // of letting it fall through as a confusing parse error.
  if (finishReason === 'MAX_TOKENS') {
    const err = new Error(
      `Respuesta truncada: el ticket es demasiado largo para ${MAX_OUTPUT_TOKENS} tokens de salida.`
    );
    err.code = 'TRUNCATED';
    throw err;
  }
  if (finishReason && finishReason !== 'STOP') {
    const err = new Error(`Gemini terminó con finishReason=${finishReason}`);
    err.code = 'BAD_FINISH';
    throw err;
  }

  const text = (response.text || '').trim();
  if (!text) {
    const err = new Error('Gemini devolvió una respuesta vacía');
    err.code = 'EMPTY';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    const err = new Error('Gemini devolvió un JSON no válido');
    err.code = 'BAD_JSON';
    throw err;
  }

  const result = normalize(parsed);
  // An empty extraction is not a success — it means the photo was unreadable
  // or wasn't a receipt. Creating a blank ticket silently is worse than failing.
  if (result.items.length === 0) {
    const err = new Error('No se ha podido leer ningún artículo del ticket');
    err.code = 'NO_ITEMS';
    throw err;
  }

  // Consumo de esta llamada, para poder decidir con datos y no a ojo qué
  // conviene optimizar. No cambia nada de lo que se le pide al modelo.
  result.uso = {
    modelo: model,
    entrada: usage.promptTokenCount || 0,
    salida: usage.candidatesTokenCount || 0,
    pensamiento: usage.thoughtsTokenCount || 0,
    enCache: cached
  };
  return result;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Transient failures worth another attempt. Empty/invalid/truncated responses
// are included: they are usually a model hiccup, and previously a bad parse
// aborted the whole request on the first try.
function isRetryable(err) {
  if (['EMPTY', 'BAD_JSON', 'BAD_FINISH', 'TRUNCATED'].includes(err.code)) return true;
  const msg = err.message || '';
  return msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand')
    || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Please retry')
    || msg.includes('500') || msg.includes('INTERNAL');
}

/**
 * Extract ticket items from one or more image buffers.
 * @param {Array<{ buffer: Buffer, mimeType: string }>} images
 */
async function extractItemsFromImages(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('No images provided to AI');
  }

  const parts = images.map(img => ({
    inlineData: {
      mimeType: img.mimeType || 'image/jpeg',
      data: img.buffer.toString('base64')
    }
  }));
  parts.push({
    text: images.length > 1
      ? `Hay ${images.length} fotografías del MISMO ticket. Extrae todos los ítems combinando las fotos. Lee con mucho cuidado cada línea y su precio.`
      : 'Extrae los ítems de este ticket. Lee con mucho cuidado cada línea, su cantidad y su precio.'
  });

  // Try primary model with retries, then fallback
  const ATTEMPTS = 3;
  let lastError;
  const empezado = Date.now();
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const ok = await callGemini(PRIMARY_MODEL, parts);
      ok.uso.intentos = attempt + 1;
      ok.uso.conRespaldo = false;
      ok.uso.ms = Date.now() - empezado;
      return ok;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) throw err; // Non-retryable error — bail out
      if (attempt === ATTEMPTS - 1) break; // Last try — don't sleep, go to fallback
      const msg = err.message || '';
      const waitMatch = msg.match(/retry in ([\d.]+)s/i);
      const waitSec = waitMatch ? Math.min(Math.ceil(parseFloat(waitMatch[1])), 15) : 2 * (attempt + 1);
      console.log(`[ai] ${PRIMARY_MODEL} intento ${attempt + 1}/${ATTEMPTS} falló (${err.code || 'API'}), reintento en ${waitSec}s...`);
      await sleep(waitSec * 1000);
    }
  }

  // All retries exhausted — try fallback model.
  // OJO: el respaldo cuesta 6x la entrada y 5x la salida. Si esto sale a
  // menudo en los registros, pesa más que cualquier optimización del esquema
  // — y hasta ahora no quedaba constancia de cuándo pasaba.
  console.log(`[ai] Cayendo a ${FALLBACK_MODEL} (el caro) tras ${ATTEMPTS} intentos...`);
  try {
    const ok = await callGemini(FALLBACK_MODEL, parts);
    ok.uso.intentos = ATTEMPTS + 1;
    ok.uso.conRespaldo = true;
    ok.uso.ms = Date.now() - empezado;
    return ok;
  } catch (fallbackErr) {
    console.error('[ai] El modelo de respaldo también falló:', fallbackErr.message);
    throw lastError; // Surface the original failure, it's more informative
  }
}

// Sanitize the model output — assign sequential ids, coerce numbers, round
// to 2 decimals, guard against missing fields.
function normalize(raw) {
  const items = Array.isArray(raw.items) ? raw.items : [];
  const cleanItems = items
    .filter(i => i && i.name)
    .map((it, idx) => {
      const rawQty = +it.quantity;
      const rawUnit = +it.unitPrice;
      const rawTotal = +it.totalPrice;

      // Weighed lines ("0,378 kg a 2,20 €/kg") come back with a fractional
      // quantity. The claim screen draws one tappable pill per unit, so a
      // fraction of a unit cannot be split between people — and Math.round on
      // 0.378 used to yield 0, which silently dropped the line from the total.
      // Collapse any such line to a single unit priced at the line amount.
      let quantity = Number.isFinite(rawQty) ? Math.round(rawQty) : 1;
      if (!(quantity >= 1)) quantity = 1;

      // The whole app derives money from quantity × unitPrice, so make that
      // product match the receipt's line amount instead of trusting three
      // independently-read numbers to agree.
      const lineTotal = Number.isFinite(rawTotal) && rawTotal > 0
        ? rawTotal
        : (Number.isFinite(rawUnit) ? rawUnit * quantity : 0);
      const unitPrice = +(lineTotal / quantity).toFixed(2);

      return {
        id: idx + 1,
        name: String(it.name).trim(),
        quantity,
        unitPrice,
        totalPrice: +(unitPrice * quantity).toFixed(2),
        shared: !!it.shared
      };
    });

  const total = Number.isFinite(+raw.total) && +raw.total > 0
    ? +(+raw.total).toFixed(2)
    : +cleanItems.reduce((s, it) => s + it.totalPrice, 0).toFixed(2);

  return {
    restaurant: raw.restaurant ? String(raw.restaurant).trim() : null,
    date: raw.date ? String(raw.date).trim() : null,
    time: raw.time ? String(raw.time).trim() : null,
    address: raw.address ? String(raw.address).trim() : null,
    items: cleanItems,
    total
  };
}

// normalize se exporta para poder testearlo sin gastar llamadas a la API.
module.exports = { extractItemsFromImages, normalize, PRIMARY_MODEL, FALLBACK_MODEL };
