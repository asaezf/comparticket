// comparTICKET — preparación de imágenes antes de subirlas
//
// Vercel rechaza con un 413 cualquier petición cuyo cuerpo pase de 4,5 MB, y
// lo hace ANTES de que el servidor vea nada: no hay forma de dar un error
// decente desde el código. Una foto de un móvil actual ronda los 3-8 MB, así
// que subir dos ya se pasaba del límite. Por eso las fotos se reducen aquí,
// en el navegador, antes de salir.
//
// Reducir NO abarata la llamada a la IA (Gemini normaliza la imagen a un
// número fijo de tokens), pero evita el 413 y acorta mucho la subida por
// datos móviles, que es donde se iba el tiempo de espera.

const ImgPrep = (() => {

  const MAX_EDGE = 2000;        // lado largo: de sobra para leer un ticket
  const QUALITY = 0.85;
  const BUDGET = 3.6 * 1024 * 1024;  // margen bajo los 4,5 MB de Vercel

  /** Decodifica respetando la orientación EXIF: un ticket girado no se lee. */
  async function decode(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (_) {
        try { return await createImageBitmap(file); } catch (_) {}
      }
    }
    // Navegadores viejos: <img> ya aplica la orientación al pintar.
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function draw(bitmap, scale) {
    const w = Math.max(1, Math.round((bitmap.width || bitmap.naturalWidth) * scale));
    const h = Math.max(1, Math.round((bitmap.height || bitmap.naturalHeight) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas;
  }

  function toBlob(canvas, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  }

  /**
   * Copia pequeña para guardar, no para leer.
   *
   * La que se manda a la IA va a 2000 px porque tiene que poder leer letra de
   * ticket. Esta solo tiene que servir para que una persona mire la foto y
   * reconozca el sitio y el importe, así que 1000 px al 60% sobra — y baja de
   * unos 1,5 MB a unos 120 KB.
   *
   * El tamaño no es un capricho: cada foto se guarda en su propio documento
   * de Firestore, que tiene un tope duro de 1 MB, y al codificarla en base64
   * crece un tercio. A 120 KB caben de sobra; a 1,5 MB no cabría ninguna.
   */
  async function archive(file) {
    try {
      const bmp = await decode(file);
      const w = bmp.width || bmp.naturalWidth;
      const h = bmp.height || bmp.naturalHeight;
      if (!w || !h) return null;

      const scale = Math.min(1, 1000 / Math.max(w, h));
      const blob = await toBlob(draw(bmp, scale), 0.6);
      if (bmp.close) bmp.close();
      if (!blob) return null;

      const name = (file.name || 'ticket').replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
    } catch (_) {
      // Sin copia de archivo el ticket funciona igual: simplemente no tendrá
      // foto que enseñar. No es motivo para romper el escaneo.
      return null;
    }
  }

  /**
   * Reduce una foto. Si algo falla (formato que el navegador no decodifica,
   * por ejemplo HEIC en según qué sitio) devuelve el original: más vale
   * intentar subirlo que quedarse sin nada.
   */
  async function shrink(file, maxEdge) {
    try {
      const bmp = await decode(file);
      const w = bmp.width || bmp.naturalWidth;
      const h = bmp.height || bmp.naturalHeight;
      if (!w || !h) return file;

      const scale = Math.min(1, (maxEdge || MAX_EDGE) / Math.max(w, h));
      const blob = await toBlob(draw(bmp, scale), QUALITY);
      if (bmp.close) bmp.close();

      // Si no hemos ganado nada, nos quedamos con el original.
      if (!blob || blob.size >= file.size) return file;

      const name = (file.name || 'ticket').replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
    } catch (_) {
      return file;
    }
  }

  /**
   * Gira una foto 90° en sentido horario.
   *
   * Ningún modelo de IA lee bien un ticket tumbado — medido: desvíos de 20 €
   * sobre una cuenta de 84 €. No se gira automáticamente porque hay facturas
   * legítimamente apaisadas y adivinarlo por la forma rompería esas; se deja
   * el botón y decide quien hizo la foto.
   */
  async function rotate(file) {
    try {
      const bmp = await decode(file);
      const w = bmp.width || bmp.naturalWidth;
      const h = bmp.height || bmp.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = h;
      canvas.height = w;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(h / 2, w / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(bmp, -w / 2, -h / 2);
      if (bmp.close) bmp.close();
      const blob = await toBlob(canvas, 0.92);
      if (!blob) return file;
      const name = (file.name || 'ticket').replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
    } catch (_) {
      return file;
    }
  }

  /** Un ticket es casi siempre más alto que ancho: si no, probablemente esté tumbado. */
  async function looksSideways(file) {
    try {
      const bmp = await decode(file);
      const w = bmp.width || bmp.naturalWidth;
      const h = bmp.height || bmp.naturalHeight;
      if (bmp.close) bmp.close();
      return w > h * 1.15;
    } catch (_) {
      return false;
    }
  }

  /**
   * Prepara todas las fotos de un ticket y garantiza que el conjunto cabe en
   * el límite de Vercel. Si tras la primera pasada aún se pasa (muchas fotos),
   * baja la resolución por escalones hasta que entre.
   */
  async function prepare(files) {
    let edge = MAX_EDGE;
    let out = await Promise.all(files.map(f => shrink(f, edge)));

    while (out.reduce((s, f) => s + f.size, 0) > BUDGET && edge > 700) {
      edge = Math.round(edge * 0.75);
      out = await Promise.all(files.map(f => shrink(f, edge)));
    }
    return out;
  }

  return { prepare, shrink, archive, rotate, looksSideways, MAX_EDGE, BUDGET };
})();
