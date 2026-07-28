# Tickets de prueba

Fotos de tickets reales que sirven de banco de pruebas. Cuantos más haya, más
seguro es tocar el prompt o cambiar de modelo de IA.

> **Las imágenes de esta carpeta NO se suben a git.** El repositorio es
> público y un ticket real lleva fecha, hora, comercio, localidad, lo que
> compraste y los últimos dígitos de la tarjeta. Están en `.gitignore`; este
> README sí se versiona.

**Guarda aquí la foto del Mercadona del 25/07/2026 (84,50 €)** — es la que
falla por longitud y la que hay que verificar. Nómbrala `mercadona-84.50.jpg`.

## Uso

```bash
# Un ticket
node scripts/test-extract.js fixtures/mercadona-84.50.jpg

# Varias fotos del MISMO ticket, en una sola llamada (como hace la app)
node scripts/test-extract.js --same fixtures/parte1.jpg fixtures/parte2.jpg

# Probar otro modelo sin tocar el código
GEMINI_MODEL=gemini-3.1-flash-lite node scripts/test-extract.js fixtures/*.jpg
```

El script imprime los artículos extraídos y, lo importante, si la suma de las
líneas cuadra con el total del ticket.

## Tests que no gastan API

```bash
node scripts/test-normalize.js
```

Convención: si sabes el total real del ticket, ponlo en el nombre del fichero
(`mercadona-84.50.jpg`) para poder comparar de un vistazo.
