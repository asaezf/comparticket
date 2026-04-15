// comparTICKET — Gemini Vision ticket extraction
// Uses gemini-2.5-flash-lite (fast, cheap, great for OCR + reasoning).
// All photos of the SAME bill are sent in a single request — the model gets
// the whole context at once and can stitch a receipt split across pages.

const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `
Eres un experto OCR de tickets de restaurante, bar y comercio. Tu tarea es
leer una o varias fotografías de un MISMO ticket/recibo y devolver su
contenido estructurado en JSON — limpio, preciso y listo para cuadrar cuentas
entre comensales.

REGLAS OBLIGATORIAS:

1. MULTI-IMAGEN = MISMO TICKET. Si hay varias fotos, trátalas como un único
   ticket partido (continuaciones verticales, reverso, detalle). Concatena
   ítems sin duplicar. El total que devuelves es el total del ticket real,
   no la suma de totales por foto.

2. IDENTIFICA EL NEGOCIO. Extrae el nombre del restaurante/bar/comercio tal
   cual aparece en la cabecera, en MAYÚSCULAS. Si no hay, devuelve null.

3. FECHA. Si el ticket tiene fecha visible, devuélvela en ISO (YYYY-MM-DD).
   Si no, null.

4. ÍTEMS. Para cada línea de consumo:
   - name: nombre del plato/producto LIMPIO, sin códigos ni sufijos raros.
     Capitaliza la primera letra (ej: "Cerveza Mahou", "Patatas bravas").
   - quantity: número entero de unidades (1 si no se indica).
   - unitPrice: precio por UNA unidad, en euros (number, no string).
   - totalPrice: quantity × unitPrice (number).
   - shared: true SOLO si el artículo es típicamente para compartir
     (bravas, pizza familiar, jarras de sangría, raciones, entrantes
     grandes). false para consumos individuales (una cerveza, un café,
     un plato principal por persona).

5. IGNORA líneas de propina, servicio, impuestos separados, "tarjeta",
   "efectivo", códigos de pago. Solo interesan productos consumidos.

6. TOTAL. Devuelve el total final del ticket (lo que se paga), como number.

7. NO INVENTES. Si algo no se lee bien, mejor omítelo que alucinar. Si el
   ticket no es legible o no es un ticket, devuelve items: [] y total: 0.

FORMATO DE SALIDA (JSON estricto, sin markdown, sin explicaciones):
{
  "restaurant": "NOMBRE DEL LOCAL" | null,
  "date": "2026-04-15" | null,
  "items": [
    { "name": "Patatas bravas", "quantity": 1, "unitPrice": 5.5, "totalPrice": 5.5, "shared": true }
  ],
  "total": 42.5
}
`;

const MODEL = 'gemini-2.5-flash-lite';

/**
 * Extract ticket items from one or more image buffers.
 * @param {Array<{ buffer: Buffer, mimeType: string }>} images
 * @returns {Promise<{ restaurant: string|null, date: string|null, items: Array, total: number }>}
 */
async function extractItemsFromImages(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('No images provided to AI');
  }

  // Build multimodal content: one inlineData part per image + one text part
  const parts = images.map(img => ({
    inlineData: {
      mimeType: img.mimeType || 'image/jpeg',
      data: img.buffer.toString('base64')
    }
  }));
  parts.push({
    text: images.length > 1
      ? `Hay ${images.length} fotografías del MISMO ticket. Extrae todos los ítems combinando las fotos.`
      : 'Extrae los ítems de este ticket.'
  });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  });

  let parsed;
  try {
    parsed = JSON.parse(response.text || '{}');
  } catch (err) {
    console.error('Gemini returned non-JSON:', response.text);
    throw new Error('Respuesta de Gemini no es JSON válido');
  }

  return normalize(parsed);
}

// Sanitize the model output — assign sequential ids, coerce numbers, round
// to 2 decimals, guard against missing fields.
function normalize(raw) {
  const items = Array.isArray(raw.items) ? raw.items : [];
  const cleanItems = items
    .filter(i => i && i.name)
    .map((it, idx) => {
      const quantity = Number.isFinite(+it.quantity) && +it.quantity > 0 ? Math.round(+it.quantity) : 1;
      const unitPrice = +(+it.unitPrice || 0).toFixed(2);
      const totalPrice = +(+it.totalPrice || unitPrice * quantity).toFixed(2);
      return {
        id: idx + 1,
        name: String(it.name).trim(),
        quantity,
        unitPrice,
        totalPrice,
        shared: !!it.shared
      };
    });

  const total = Number.isFinite(+raw.total) && +raw.total > 0
    ? +(+raw.total).toFixed(2)
    : +cleanItems.reduce((s, it) => s + it.totalPrice, 0).toFixed(2);

  return {
    restaurant: raw.restaurant ? String(raw.restaurant).trim() : null,
    date: raw.date ? String(raw.date).trim() : null,
    items: cleanItems,
    total
  };
}

module.exports = { extractItemsFromImages };
