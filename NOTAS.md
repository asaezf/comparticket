# comparTICKET — estado, bugs y hoja de ruta

Documento de trabajo entre Álvaro y Claude. Se actualiza según avanzamos.
Última revisión: **28/07/2026**. Bloques A-F cerrados.

Leyenda: `[ ]` pendiente · `[x]` hecho · **P0** rompe la app · **P1** afecta al
dinero o bloquea lanzar · **P2** mejora.

---

## 1. Arreglado (rama `claude/antigravity-project-analysis-0e7f74`, sin desplegar)

| # | Qué | Dónde |
|---|---|---|
| 1 | **P0** Pantalla de revisión completamente muerta: `#summaryLink` se borró del HTML pero seguía referenciado en el JS. Reventaba el script y no cargaba ni ítems, ni totales, ni el botón de compartir | `public/js/ticket.js` |
| 2 | **P0** Tickets largos fallaban: los *thinking tokens* se comían el presupuesto de salida y truncaban el JSON. Desactivado el thinking, subido `maxOutputTokens`, añadido `responseSchema` y comprobación de `finishReason` | `ai.js` |
| 3 | **P1** Un JSON mal formado se trataba como error no reintentable y abortaba a la primera — justo en el caso que fallaba | `ai.js` |
| 4 | **P1** Si la IA no sacaba artículos se creaba un ticket vacío en silencio. Ahora falla con mensaje claro | `ai.js`, `server.js` |
| 5 | **P1** Artículos a peso (`0,378 kg × 2,20 €/kg`): `Math.round(0.378)` daba **0**, el artículo desaparecía del total y en el reparto se cobraba el precio por kilo en vez del importe real | `ai.js` |
| 6 | **P2** Errores ilegibles (`AI failed: [object Object]`) → mensajes accionables | `server.js` |
| 7 | **P2** `comparticket.app` hardcodeado en la imagen compartida sin ser dueño del dominio → ahora usa el dominio real y se actualizará solo | `public/js/summary.js` |

**Herramientas nuevas:** `scripts/test-normalize.js` (16 tests del cálculo del
dinero, sin gastar API) y `scripts/test-extract.js` (pasa fotos reales por el
mismo camino que la app y comprueba si la suma cuadra con el total).

---

## 2. Bugs abiertos — dinero

Estos importan más que ningún otro porque la salida es una cifra que la gente
se paga entre sí.

- [x] **P1** ~~La cuenta no tiene que cuadrar y nadie avisa~~ → **Bloque A hecho.** Línea "Sin asignar" visible desde el primer claim y cierre bloqueado hasta que sea 0, validado también en el servidor.
- [x] **P1** ~~`updateTotal()` machaca el total real del ticket~~ → ahora se muestran los dos números (suma de líneas y total del ticket) y el descuadre hay que resolverlo antes de compartir.
- [x] **P1** ~~"Por persona" divide entre quien ha reclamado~~ → divide entre `expectedParticipants`.
- [x] **P1** ~~IDs de artículo no estables~~ → contador monótono que nunca reutiliza un id, y los artículos se congelan en cuanto hay un solo claim.
- [x] **P2** ~~`ticket.js` mostraba siempre 00:00~~ → usa `receiptTime`, igual que `summary.js`.
- [ ] **P1** Si el dueño borra un artículo ya reclamado, el dinero de esa persona desaparece del resumen sin aviso (`if (!item) return null`). *Mitigado* — ya no se pueden editar artículos con claims, pero el caso sigue vivo para tickets antiguos.
- [ ] **P2** Dos personas con el mismo nombre: la segunda borra las selecciones de la primera (borrado por nombre, sin distinción de identidad).
- [x] **P2** ~~`prefillMineFromName` en cada tecla~~ → **se mantiene a propósito**: es el atajo para volver y cambiar tu selección. Blindado para que no cree participantes fantasma (ver Bloque E).
- [ ] **P2** Fechas: `new Date("2026-04-15")` se interpreta como medianoche UTC → día anterior en zonas horarias negativas. En España va bien, en Latinoamérica no.

---

## 3. Seguridad — bloquea lanzar en público

- [ ] **P1** **No hay autorización.** El ID de 8 caracteres del enlace es la única credencial. Cualquiera que lo tenga puede reescribir todos los artículos y el total, cambiar quién pagó, cambiar el número de participantes, reclamar con el nombre de otro y **borrar el claim de cualquiera**. Solo cerrar valida el `creatorKey`.
- [x] **P1** ~~Sin rate limiting~~ → 8 peticiones por minuto y IP. **Parcial**: en Vercel el contador es por instancia, no global. El definitivo, con almacén compartido, en 8.2.
- [x] **P1** ~~Backdoor en `verifyCreatorKey`~~ → un ticket sin clave ya no lo cierra nadie, y la comparación es en tiempo constante.
- [x] **P2** ~~`npm audit`: 20 vulnerabilidades~~ → **8 moderadas, 0 críticas, 0 altas**. Las restantes exigen subir versiones mayores.
- [x] **P2** ~~`package-lock.json` en `.gitignore`~~ → ya se versiona, despliegues reproducibles.
- [x] **P2** ~~Sin cabeceras de seguridad~~ → `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- [ ] **P1** El `creatorKey` solo vive en `localStorage`. Cambias de móvil, limpias el navegador o abres el enlace desde el navegador interno de Instagram y pierdes para siempre el control de tu ticket. Sin recuperación. *(→ 8.2)*
- [ ] **P1** **El repositorio es público** (`github.com/asaezf/comparticket`). No hay secretos filtrados — el `.env` nunca se subió, verificado en todo el historial. Pero cualquiera puede leer dónde están los huecos. **Decidido: se mantiene público mientras solo lo prueben amigos.** *(→ 8.2)*
- [ ] **P2** El ID del proyecto de Firebase (`lifeos-74b8b`) está escrito en el código y **es un proyecto compartido con otra cosa tuya** ("lifeos"). Si alguien compromete comparTICKET, el radio de daño alcanza al otro proyecto. *(→ 8.2, y es requisito para el tiempo real por `onSnapshot`)*
- [x] **P2** ~~Fotos de tickets en el repositorio~~ → `fixtures/*.jpg` en `.gitignore`. Llevan fecha, hora, comercio, localidad, compra y últimos dígitos de tarjeta.

---

## 4. Problemas previstos — cosas que van a doler

### 4.1 Los modelos de IA se apagan el 16 de octubre de 2026 ✅ **RESUELTO**

Google apaga `gemini-2.5-flash` y `gemini-2.5-flash-lite` el **16/10/2026**.
La app ya **no usa ninguno de los dos**: primario `gemini-3.1-flash-lite`,
respaldo `gemini-3.6-flash`. Ver el Bloque B para la comparativa que llevó a
esa elección.

Precios por millón de tokens (entrada/salida), a julio de 2026:

| Modelo | Precio | Uso en la app |
|---|---|---|
| **Gemini 3.1 Flash-Lite** | **$0,25 / $1,50** | primario |
| Gemini 3.6 Flash | $1,50 / $7,50 | respaldo |
| Gemini 3.5 Flash-Lite | $0,30 / $2,50 | descartado: peor en OCR y más caro |

El modelo se puede cambiar sin desplegar con las variables `GEMINI_MODEL`,
`GEMINI_FALLBACK_MODEL` y `GEMINI_THINKING_BUDGET`. **Conviene repetir la
comparativa cuando salgan modelos nuevos**: el guion `scripts/test-extract.js`
y el banco de fotos en `fixtures/` están listos para eso.

### 4.2 Vercel: límite de 4,5 MB por petición ✅ **ARREGLADO**

**Esto era casi con seguridad la causa principal de los fallos que veían los
amigos de Álvaro.** Vercel rechaza con un **413** cualquier petición cuyo
cuerpo pase de **4,5 MB**, y lo hace *antes* de ejecutar la función: el código
del servidor nunca se entera y no puede dar un mensaje decente.

La configuración anterior aceptaba 10 MB por foto y hasta 6 fotos — hasta
60 MB. Una foto de móvil actual pesa 3-8 MB, así que **subir dos fotos ya se
pasaba del límite**. Coincide exactamente con el síntoma de "falla cuando
subimos varias fotos".

Arreglado en `public/js/imgprep.js`: las fotos se reducen en el navegador a
2.000 px de lado largo antes de salir, respetando la orientación EXIF (un
ticket girado no se lee), con presupuesto total de 3,6 MB y bajada escalonada
si hay muchas fotos. Si el navegador no sabe decodificar el formato, se manda
el original en vez de fallar.

Medido: 3 fotos de móvil pasan de 2.129 KB a 480 KB. Una foto que ya es
pequeña se deja intacta. **Verificado que no se pierde precisión**: la misma
foto original y reducida dan 35/35 artículos y 84,50 € las dos.

`multer` bajado a 4,5 MB con un manejador de errores propio, para que en local
el caso límite dé un mensaje claro y no un 500 genérico.

### 4.3 Vercel: tiempos y concurrencia 🔴

La llamada a la IA ocurre **dentro** de la función serverless, con el usuario
esperando y un límite de 60 s (`vercel.json`). Dos consecuencias:

- Con mucha gente a la vez hay muchas funciones abiertas simultáneamente, cada
  una esperando a Gemini sin hacer nada. Se paga por tiempo de función.
- Si Gemini va lento o reintenta, se puede agotar el límite y el usuario ve un
  error sin saber por qué.

**Solución a futuro:** sacar la llamada a una cola o trabajo en segundo plano y
que el cliente consulte el resultado, en vez de mantener la petición HTTP
abierta. No es urgente hoy, pero es la primera pared al escalar.

**Además:** el plan Hobby de Vercel es gratis pero su uso comercial requiere
Pro (~20 $/mes). Hay que confirmar las condiciones antes de monetizar.

### 4.4 Costes de la IA a escala

Medido sobre la app real (~1.800 tokens de entrada por escaneo, la mayoría del
prompt de sistema). Con `gemini-3.1-flash-lite`, unos **500 escaneos por dólar**:

| Volumen mensual | Coste aproximado |
|---|---|
| 1.000 escaneos | ~2 $ |
| 10.000 | ~20 $ |
| 100.000 | ~200 $ |
| 1.000.000 | ~2.000 $ |

**El coste de la IA no es el problema.** El límite real son las peticiones por
minuto de la cuenta (hay que mirarlas en el panel de AI Studio). No existe
ningún plan "ilimitado por una cuota fija" en ningún proveedor serio: todo es
pago por token. Lo más parecido es *provisioned throughput* de Vertex AI, que
es capacidad garantizada para empresas y se negocia con comercial.

**Palanca de ahorro pendiente:** el prompt de sistema son ~1.800 tokens
idénticos en cada llamada. Cachearlo (*context caching*) recorta coste real
cuando suba el volumen.

### 4.5 Otros

- [x] ~~Sin tiempo real~~ → **Bloque C hecho.** Queda pendiente pasar de sondeo a `onSnapshot` de Firestore cuando el volumen lo pida (ver Bloque C para el cálculo de cuota).
- [x] ~~Sin Open Graph~~ → **Bloque F hecho.** Enlace corto /t/:id con vista previa e imagen de marca.
- [x] ~~Sin favicon ni icono~~ → hechos (icon.svg, favicon.svg, og.png). **PWA descartada a propósito**: Álvaro quiere web-web y app-app, no una web disfrazada.
- [ ] Sin tests, sin linter, sin CI, sin monitorización de errores (Sentry), sin analítica. El bug nº1 de esta lista es exactamente lo que una prueba de humo de cinco líneas habría cazado antes de desplegar.
- [ ] La carpeta `uploads/` tiene 13 MB de basura de pruebas (memes y fondos de pantalla que subieron los amigos). No se usa desde la migración a Firestore — se puede borrar.

---

## 5. Bloques de trabajo

### Bloque A — Cerrar el ciclo del dinero ✅ **HECHO**
1. [x] Cuadre al generar: `money.js` calcula `total − Σ líneas`; si no cuadra, el botón de compartir se deshabilita y aparece un aviso con dos salidas (añadir la diferencia como línea repartible / usar la suma como total). Validado también en `POST /share`, que devuelve 409.
2. [x] Cuadre al cerrar: línea "Sin asignar: X €" visible desde el primer claim, en rojo, que pasa a "Todo repartido" en verde. Cierre bloqueado hasta 0, validado en `POST /close` con 409.
3. [x] IDs de artículo con contador monótono; `PUT /items` rechaza cambios en cuanto existe un solo claim.
4. [x] "Por persona" divide entre `expectedParticipants`.

**Cómo está montado:** toda la aritmética vive en `money.js`, y el servidor
sirve **ese mismo fichero** al navegador (`GET /js/money.js`). Cliente y
servidor no pueden desincronizarse. 31 tests en `scripts/test-money.js`.

### Bloque B — Migración de IA ✅ **HECHO** *(fecha límite 16/10/2026 cubierta)*

5. [x] **Modelo cambiado a `gemini-3.1-flash-lite`**, elegido midiendo. Se
   fotografió el mismo ticket de 35 líneas en seis condiciones reales:

   | Variante | `2.5-flash` (anterior) | `3.1-flash-lite` (nuevo) |
   |---|---|---|
   | Girada 90° | 31 art · desvío 20,39 € | 34 art · desvío 5,43 € |
   | Oscura (luz de bar) | cuadra | cuadra |
   | Torcida 6° | desvío 9,64 € | cuadra |
   | Borrosa | cuadra | cuadra |
   | Reflejo de flash | cuadra (14,2 s) | cuadra |
   | Reenviada por WhatsApp | desvío 0,10 € | cuadra |
   | **Resultado** | **3/6** · 6,4–14,2 s | **5/6** · 4,6–5,2 s |

   Respaldo: `gemini-3.6-flash`. El presupuesto de razonamiento se ajusta solo
   según el modelo, porque los Flash grandes devuelven **400 si se les pide
   `thinkingBudget: 0`** y exigen un mínimo de 128.

   **Ninguno lee bien un ticket girado 90°** — pendiente en el Bloque E:
   detectar la orientación y avisar, o rotar automáticamente.

6. [x] **Redimensionado en el navegador** (`public/js/imgprep.js`) — resultó ser
   mucho más importante de lo previsto, ver 4.2.
7. [x] **Context caching descartado, con motivo.** El caché implícito de Gemini
   es automático pero exige un mínimo de **2.048 tokens** y el prompt de
   sistema son **1.667**: no se activa nunca. Aunque se activara, el ahorro
   sería de ~0,0004 $ por llamada. No merece la pena. Si algún día el prompt
   crece por encima de 2.048 tokens, se activará solo.

**Corrección a lo que se creía antes:** redimensionar la foto **no ahorra nada
de coste de IA**. Medido: una foto de 116 KB y otra de 6 MB cuentan **259
tokens las dos** — Gemini normaliza la imagen internamente. El coste está en el
prompt de sistema (1.667 tokens), no en la foto.

### Bloque C — Tiempo real ✅ **HECHO**

**El problema de fondo no era el refresco.** Hasta ahora no se guardaba nada
hasta pulsar "Confirmar selección", así que dos personas eligiendo a la vez
eran literalmente invisibles la una para la otra: no había datos que mostrar.

8. [x] **La selección se guarda según se toca**, como borrador (`confirmed: false`),
   agrupando pulsaciones seguidas en una sola escritura (700 ms). Los demás lo
   ven en 2,5 s sin recargar. Efecto secundario útil: si cierras la app a media
   selección no pierdes nada — al volver se recupera.
9. [x] **Aviso al compartir una unidad**: al tocar algo que ya tiene otro sale
   *"compartido con María · 2,50 € cada uno"* en el momento.
   Además: panel de quién está en el ticket ahora mismo (naranja parpadeante si
   sigue eligiendo, verde si ya confirmó), punto de estado de conexión, y el
   resumen del dueño se actualiza solo.

**Decisión: descartado bloquear por turnos.** Diez personas en una mesa quieren
marcar a la vez; serializarlas multiplica por diez el tiempo y siempre hay
alguien que se va antes de que le toque.

**Un borrador no cuenta para cerrar la cuenta.** Se ve en vivo y aparece
atenuado en el resumen con la etiqueta "eligiendo ahora", pero no cuenta como
participante listo ni entra en el cuadre: quien está a medias puede cerrar la
app sin terminar, y ese dinero no lo paga nadie todavía.

**Coste en Firestore.** El sondeo pide solo un contador de versión
(`claimsVersion`) — **una** lectura de documento — y solo recarga la lista
completa cuando ese número cambia. Sin ese truco, diez personas eligiendo a la
vez harían ~12.000 lecturas por cena; con él, ~1.200. Aun así, **a escala hay
que pasar a `onSnapshot`**: con la cuota gratuita esto da para unas 12 cenas de
10 personas al día. Las escrituras (~150 por cena) no son problema. Está
pensado para migrar fácil: `onSnapshot` vigilaría el mismo campo.

**Bug encontrado probando con dos navegadores a la vez:** al confirmar se
navega al resumen, lo que dispara `pagehide`, y el guardado de emergencia
llegaba *después* de la confirmación y la degradaba otra vez a borrador. Se ve
en el log: `v6 CONFIRMA` → `v7 borrador`. Arreglado con una guarda.
**No se habría detectado sin la prueba de dos personas simultáneas.**

### Bloque D — Seguridad ✅ **hecho lo de ahora** *(el resto va a la sección 8)*

**Decisión de Álvaro (28/07/2026):** se mantiene en Vercel y con el repositorio
público de momento, para seguir probando con amigos testers. Lo que bloquea el
lanzamiento de verdad queda recogido en la **sección 8**.

Hecho ahora, porque es barato y protege la cartera:
- [x] **Límite de peticiones** en `POST /api/tickets`: 8 por minuto y IP. Aviso: en Vercel cada invocación puede caer en una instancia distinta, así que el contador en memoria **no es un límite global** — corta el caso obvio (alguien con un bucle), no un ataque repartido. El límite serio, con almacén compartido, está en la sección 8.
- [x] **Cerrada la puerta trasera de `verifyCreatorKey`**: un ticket sin clave ya no lo puede cerrar cualquiera. Además la comparación es en tiempo constante.
- [x] **Cabeceras de seguridad**: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Sin dependencias.
- [x] **Cuerpo JSON limitado a 1 MB**.
- [x] **`npm audit fix`**: de 20 vulnerabilidades (1 crítica, 5 altas) a **8 moderadas, 0 críticas, 0 altas**. Verificado que la IA sigue funcionando después.
- [x] **`package-lock.json` fuera del `.gitignore`**: los despliegues de Vercel pasan a ser reproducibles.

### Bloque E — Que se entienda a la primera ✅ **HECHO**

15. [x] **El nombre se recuerda en el móvil.** A partir de la segunda vez aparece
    solo: el paso *desaparece* en lugar de añadirse. Se descartó la idea inicial
    de una pantalla aparte para el nombre — habría añadido un paso, justo lo
    contrario del norte del producto. Si marcas sin nombre **no se bloquea**:
    marca igual y el campo se resalta.
16. [x] **Etiqueta flotante señalando la primera píldora**, *"Toca las unidades
    que hayas tomado"*. Sale **una sola vez en la vida** de ese navegador y se
    va al primer toque. Las tres líneas de texto pasan a un desplegable
    "¿Cómo funciona?": siguen disponibles para quien las busque, sin ocupar
    pantalla a quien ya sabe.
17. [ ] ~~Arreglar el prefill que salta en cada tecla~~ → **Álvaro decide
    mantenerlo**: escribir tu nombre recupera al instante tu selección y es la
    forma rápida de volver y cambiar algo. Se respeta tal cual.

    **Pero chocaba con el guardado en vivo del Bloque C.** Al teclear se pasa
    por nombres intermedios y, si uno coincide con otra persona ("Mar" camino
    de "Marta"), se cargan SUS unidades; con el guardado automático eso podía
    escribir un participante fantasma con las cosas de otro. Blindado sin tocar
    la función: se anota de quién se cargó para poder descartarlo si el nombre
    deja de coincidir, y el guardado espera 1,5 s a que se termine de escribir.
18. [x] **Botón de girar la foto** en la previsualización, más aviso suave si
    sale más ancha que alta. **No se gira automáticamente**: hay facturas
    legítimamente apaisadas y adivinarlo por la forma las rompería.

    Verificado con el ticket que fallaba: **tumbado da 34 artículos y 5,43 € de
    desvío; girado da 35 y 0,00 €.**

**Descartado por decisión de Álvaro:** avisar de nombres duplicados (la gente
añade el apellido sola) y el arreglo de fechas UTC (solo importa fuera de
España). Siguen anotados en la sección 2 por si cambian las circunstancias.

### Bloque F — Crecimiento ✅ **HECHO**

**Open Graph con enlace corto.** El enlace que se comparte pasa de
`/claim.html?id=abc` a **`/t/abc`** — más corto de pegar y con vista previa.
Va por una ruta propia para que **solo esa** pase por la función serverless y
el resto siga saliendo del CDN; y se cachea 60 s en el CDN para que diez
personas abriendo el enlace a la vez no despierten diez funciones.

El texto cambia según el estado de la cuenta, porque lo que empuja a tocar no
es lo mismo al compartir que cuando ya han marcado todos menos tú:

| Estado | Texto de la vista previa |
|---|---|
| Recién compartida | *Álvaro ha pagado 84,50 €. Marca lo que has tomado tú.* |
| Con gente dentro | *Ya han marcado 3 de 6. **Faltas tú.*** |
| Todos listos | *Ya han marcado todos. Mira cuánto te toca.* |
| Cerrada | *Cuenta cerrada. Mira cómo quedó el reparto de 84,50 €.* |

Título: `MERCADONA · 84,50 €`. Los borradores no cuentan como participantes
listos. 14 tests en `scripts/test-share-meta.js`.

**Icono e imagen de marca.** `public/icon.svg` (app, pantalla de inicio) y
`public/favicon.svg` (pestaña). Son dos porque el detallado se convierte en una
mancha por debajo de 48 px: la versión de pestaña quita los renglones y engorda
el corte naranja, y así aguanta a 32 px. Concepto: un ticket partido por la
mitad, con el papel crema, el borde dentado y el naranja de acento del
proyecto. Más `public/og.png` (1200×630) para la vista previa.

**Calidad de la imagen que se comparte.** Reescrita la generación:
- **Un solo recorrido mide y dibuja.** Antes la altura se calculaba aparte y se desviaba: sobraban ~60 px y el ticket quedaba descolgado con un hueco muerto. Ahora es exacta por construcción.
- **3× en vez de 2×**, porque WhatsApp recomprime.
- **Espera a que la tipografía esté lista.** En conexión lenta el canvas dibujaba con la fuente de reserva y quedaba congelada así.
- Muescas y borde dentado más limpios.

**Formato de moneda español.** Toda la app pasa de `20.00€` a **`20,00 €`**.
Escribir el punto decimal en una app española resta credibilidad, y salía
impreso en la imagen que comparte la gente. Formateador único en `money.js`,
que en inglés produce `€20.00`.

**Firma.** Fuera de la imagen compartida (la ven desconocidos); en la web pasa
a *"desarrollado por A.Sáez.F"*.

**Fuentes.** El `@import` dentro del CSS era el método más lento: el navegador
no descubría que hacían falta hasta descargar y leer la hoja entera. Ahora van
con `preconnect` + `link` en el `<head>`. **Mismas familias y pesos**, verificado
en navegador que se cargan y se aplican igual.

**Títulos de página propios** en las cuatro pantallas, más `meta description`.

**Descartado por decisión de Álvaro: la PWA.** Quiere una web que sea web y,
más adelante, una app que sea app — no una web disfrazada. El icono se hace
igualmente porque sirve para la pestaña, la vista previa y la futura app.

**Bug encontrado y arreglado durante el bloque:** al pasar los importes al
formateador, `claim.js` empezó a usar `Money` pero `claim.html` no cargaba
`money.js` — la pantalla de reparto quedó rota. Es exactamente la misma clase
de fallo que el bug nº1 de este documento. Añadido `scripts/test-pages.js`, que
comprueba que cada página carga los módulos que su JS usa y que existen todos
los ids que toca. **Eso ya no puede volver a pasar sin que salte.**

### Bloque G — El salto a app ← **siguiente**
21. Cuentas de usuario → tickets abiertos pendientes y carpetas por viaje
22. Capacitor → App Store y Play Store, con este mismo código

---

## 6. Decisiones tomadas

Para no volver a discutirlas:

| Decisión | Motivo |
|---|---|
| **Seguir en Firestore** | Da tiempo real (`onSnapshot`) y cuentas (Firebase Auth), que son justo los dos siguientes hitos. La cuota gratuita es permanente, no una prueba. |
| **Seguir en Gemini**, migrando a Flash-Lite | El prompt está afinado a su comportamiento y el precio/precisión es bueno. Se medirá antes de fijar modelo. |
| **Un solo código**: PWA → Capacitor | Un código nativo aparte significaría arreglar cada bug dos veces para siempre. Y lo que desbloquea "mis tickets" y "carpetas de viaje" son las **cuentas**, no lo nativo. |
| **Tiempo real, no bloqueo por turnos** | Bloquear rompe la tesis del producto: 10 personas en una mesa quieren marcar a la vez. |
| **Cuadre con salidas, no bloqueo duro** | Los tickets reales legítimamente no cuadran (servicio, redondeos). Un bloqueo sin salida deja al usuario atrapado. |
| **No reescribir en React/Next** | 4 pantallas y ~1.000 líneas. Un framework no aporta nada y cuesta la simplicidad de no tener build. |
| **No guardar las fotos** | No almacenarlas es una ventaja de privacidad. Mantener. |
| **No tocar la estética de impresora** | Es el carácter del producto. |

---

## 7. Pendiente de Álvaro

- [x] ~~Guardar la foto del Mercadona~~ → hecho. **Verificado: 35/35 artículos, 84,50 € = 84,50 €, desvío 0,00 €.** El fallo de tickets largos está resuelto.
- [ ] Probar el Bloque A con amigos antes de mergear a `main`
- [ ] Más fotos de tickets en `fixtures/` para ampliar el banco de pruebas (sobre todo de restaurante con servicio o cubierto, que es donde aparecen los descuadres)
- [ ] Captura de los límites de peticiones en el panel de AI Studio *(se puede posponer hasta tener la app lista para comercializar)*
- [ ] Decidir dominio propio *(pospuesto — de momento se usa el de Vercel automáticamente)*
- [ ] Revisar si el proyecto de Firebase está en plan Spark o Blaze

---

## 8. Lista de lanzamiento

Todo lo que **no** hace falta para probar con amigos pero **sí** antes de
abrirlo al público o cobrar por ello. Ahora mismo está bien tal como está:
Vercel, repositorio público y enlaces que solo circulan entre conocidos.

### 8.1 Privacidad y cumplimiento legal 🔴

Al aceptar usuarios que no son tus amigos, la app pasa a tratar datos
personales de terceros y entra de lleno en el RGPD.

- [ ] **Aviso de privacidad**, con lo que se trata y por qué. Hay un punto fuerte que hay que **decir en voz alta porque es una ventaja competitiva**: las fotos de los tickets **nunca se guardan** — van a memoria, se mandan a Gemini y se descartan.
- [ ] **Los nombres de los participantes SÍ se guardan** y son datos personales. Hoy quedan en Firestore para siempre. Hace falta: plazo de borrado automático (¿90 días tras cerrar la cuenta?), y una forma de que alguien pida que le borren.
- [ ] **Un ticket revela mucho más de lo que parece**: comercio, localidad, fecha, hora, qué comió cada uno y con quién. Cualquiera con el enlace lo ve. Con amigos vale; en público hay que decidir si los enlaces caducan.
- [ ] **Terceros a los que se manda información**: Google (Gemini) recibe las fotos, Google (Firebase) guarda los datos, Vercel procesa las peticiones. Hay que nombrarlos en el aviso y revisar las condiciones de tratamiento de datos de cada uno.
- [ ] **Verificar la política de Gemini sobre uso de los datos para entrenamiento** en el plan de pago. Es determinante para lo que se pueda prometer al usuario.
- [ ] **Términos de uso**, sobre todo un descargo claro: la IA se equivoca leyendo tickets y el reparto es orientativo. No queremos discusiones sobre dinero achacadas a la app.
- [ ] **Consentimiento de cookies** solo si se añade analítica. Si se elige una analítica sin cookies, este punto desaparece — es la vía recomendada.
- [ ] **Sin analítica no hay forma de saber dónde se atasca la gente.** Elegir una que no requiera consentimiento (Plausible, Umami o similar).

### 8.2 Seguridad pendiente 🔴

- [ ] **Autorización de verdad.** Sigue siendo el agujero grande: cualquiera con el enlace puede reescribir artículos, cambiar quién pagó y **borrar el claim de otro**. Entre amigos se sobrevive; en público no. Lo natural es hacerlo junto con las cuentas de usuario (Bloque G).
- [ ] **Repositorio en privado** o autorización arreglada. Hoy el código público documenta exactamente dónde están los huecos.
- [ ] **Proyecto de Firebase propio.** Hoy comparTICKET vive dentro de `lifeos-74b8b`, compartido con otro proyecto tuyo: si uno cae, el radio de daño alcanza al otro. Además, es **requisito** para poder abrir acceso desde el navegador (ver 8.4) sin arriesgar los datos del otro proyecto.
- [ ] **Límite de peticiones con almacén compartido** (Upstash Redis o similar). El actual es en memoria y en Vercel cada instancia tiene el suyo.
- [ ] **Reglas de seguridad de Firestore** revisadas, denegando por defecto.
- [ ] **Recuperar el control de un ticket** si pierdes el `localStorage` (cambio de móvil, navegador de Instagram, limpieza del navegador). Hoy se pierde para siempre.
- [ ] **Rotar la clave de Gemini** y revisar quién ha tenido acceso al `.env`.
- [ ] Las 8 vulnerabilidades moderadas restantes exigen `npm audit fix --force`, que sube versiones mayores: hacerlo con las pruebas delante.

### 8.3 Salir de Vercel, o quedarse con cabeza 🟠

Los dos límites de Vercel ya han mordido una vez cada uno:

| Límite | Qué provoca | Estado |
|---|---|---|
| 4,5 MB por petición | 413 antes de llegar al código | Esquivado reduciendo la foto en el navegador |
| 60 s por función | La llamada a la IA bloquea la función con el usuario esperando | **Pendiente** |

- [ ] **Sacar la llamada a la IA a una cola** y que el cliente consulte el resultado. Con mucha gente a la vez hay muchas funciones abiertas sin hacer nada más que esperar a Google, y se paga por tiempo. Es la primera pared al escalar.
- [ ] **Confirmar las condiciones de Vercel para uso comercial** (el plan Hobby es gratis pero no está pensado para negocio; Pro ronda los 20 $/mes).
- [ ] Si algún día se sale de Vercel, la app es Express puro: encaja en cualquier sitio (Fly.io, Render, Cloud Run). No hay nada atado a Vercel salvo `api/index.js` y `vercel.json`.

### 8.4 Tiempo real: pasar de sondeo a `onSnapshot` 🟠

Lo de ahora funciona bien (~350 ms con la mesa activa) pero es sondeo.
Medido: con la cuota gratuita de Firestore da para unas **12 cenas de 10
personas al día**.

- [ ] **Migrar a `onSnapshot`**: llega solo, en ~200 ms constantes, y se paga por documento cambiado en vez de por consulta. Es mejor **y** más barato.
- [ ] Requisito previo: **proyecto de Firebase propio** (8.2) más reglas de seguridad, porque implica abrir acceso de lectura desde el navegador.
- [ ] Está preparado para migrar: `onSnapshot` vigilaría el mismo campo `claimsVersion` que ya usa el sondeo.

### 8.5 Rendimiento y coste

- [ ] **Recortar el prompt de sistema.** Son 1.667 tokens fijos en cada llamada y suponen el ~86% de la entrada; la foto son 259. Es la única palanca real de coste. De paso: si pasara de 2.048 tokens se activaría el caché implícito de Gemini, así que **conviene recortar bastante o crecer bastante, pero no quedarse justo debajo**.
- [ ] **Repetir la comparativa de modelos** cuando salgan nuevos. `scripts/test-extract.js` y las fotos de `fixtures/` están listos.
- [x] ~~Las fuentes se cargaban con @import~~ → ahora preconnect + link en el head, mismas familias y pesos.
- [ ] **Borrar `uploads/`**: 13 MB de basura de pruebas que ya no se usa desde la migración a Firestore.

### 8.6 Antes de enseñarlo a desconocidos

- [ ] **Open Graph**: hoy el enlace en WhatsApp sale como texto pelado. Es lo de mayor impacto por minuto invertido de todo el proyecto.
- [ ] **PWA**: manifest, icono, instalable en la pantalla de inicio.
- [ ] **Monitorización de errores** (Sentry o similar). Sin esto, cuando falle a un usuario no te enteras.
- [x] ~~Quitar la firma de la imagen compartida~~ → fuera del PNG; en la web pasa a "desarrollado por A.Sáez.F".
- [ ] **Dominio propio.** El texto del pie de la imagen ya se adapta solo al dominio donde esté.
- [ ] **Una prueba de humo en CI** que abra las cuatro pantallas y falle si alguna revienta. El bug nº1 de este documento (pantalla completamente muerta en producción) es exactamente lo que habría cazado.
