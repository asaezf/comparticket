/**
 * Service worker de comparTICKET — deliberadamente vacío.
 *
 * Existe por una sola razón: el navegador no ofrece instalar la aplicación en
 * la pantalla de inicio si la página no tiene uno registrado.
 *
 * NO cachea nada, a propósito. Aquí se manejan importes: un caché serviría
 * una versión vieja de la página o del código que reparte el dinero, y el
 * usuario vería cifras que ya no son las que hay en el servidor sin tener
 * forma de saberlo. Un ticket que se cierra mal por leer datos viejos es un
 * problema mucho peor que abrir sin conexión.
 *
 * Si algún día se quiere funcionamiento sin conexión, hay que hacerlo al
 * revés: cachear solo la carcasa (HTML, CSS, tipografías) y NUNCA las
 * respuestas de /api. Y con versionado, para que un despliegue nuevo no se
 * quede atrapado detrás de un caché antiguo.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// El navegador exige un manejador de `fetch` para considerar la aplicación
// instalable. Este se limita a dejar pasar la petición a la red.
self.addEventListener('fetch', () => { /* a la red, como si no existiera */ });
