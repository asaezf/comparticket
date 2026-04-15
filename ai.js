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
- NO uses el número del nombre del artículo como cantidad
  (ej: "1/2 Jamón" es UN medio de jamón, quantity=1, no 0.5).

=== REGLAS DE SALIDA ===

1. MULTI-IMAGEN = MISMO TICKET. Varias fotos son del mismo recibo.
   Concatena ítems sin duplicar. Usa el total del ticket real.

2. NEGOCIO. Extrae el nombre del restaurante/bar de la cabecera,
   en MAYÚSCULAS. Si no hay, null.

3. FECHA. Formato ISO: YYYY-MM-DD. Si no hay, null.

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
  "items": [
    { "name": "1/2 Jamón con queso y tomate", "quantity": 1, "unitPrice": 3.60, "totalPrice": 3.60, "shared": false }
  ],
  "total": 21.20
}
`;

// Use gemini-2.5-flash for better OCR accuracy (flash-lite struggles with
// receipt layouts, column alignment, and sub-item grouping).
const MODEL = 'gemini-2.5-flash';

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
      ? `Hay ${images.length} fotografías del MISMO ticket. Extrae todos los ítems combinando las fotos. Lee con mucho cuidado cada línea y su precio.`
      : 'Extrae los ítems de este ticket. Lee con mucho cuidado cada línea, su cantidad y su precio.'
  });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.05, // Very low — we want precise OCR, zero creativity
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
