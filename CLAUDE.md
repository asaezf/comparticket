# comparTICKET — cómo se trabaja aquí

App para dividir cuentas: se fotografía un ticket, la IA lo lee, cada uno marca
lo suyo y al final dice quién le paga a quién. Express + Firestore + Gemini,
desplegada en Vercel. **Tiene usuarios reales**: gente que se está repartiendo
dinero de verdad después de un viaje.

## Lo que no se negocia

**Es dinero.** Cualquier cambio que toque `settle.js`, `money.js` o el cuadre de
un grupo necesita pruebas que demuestren las invariantes: los saldos suman cero,
las transferencias saldan a todo el mundo, y nadie paga de más. Si una prueba no
puede demostrarlo, el cambio no está terminado.

**El servidor no se fía del navegador.** El cálculo bueno lo hace el servidor.
`settle.js` y `money.js` se sirven al navegador desde el mismo fichero que usa el
servidor (ver las rutas en `server.js`), para que la pantalla no pueda decir que
la cuenta cuadra mientras el servidor opina lo contrario.

**No hay cuentas de usuario, y es a propósito.** La identidad es un testigo en el
`localStorage` de un navegador (`ct_tok_<grupo>`), y el enlace es la llave. Eso
trae problemas conocidos —se pierde al borrar datos, no viaja entre móviles, el
navegador interno de WhatsApp guarda aparte— y hay medidas concretas para cada
uno (rescate del creador, enlace personal `?tok=`, avisos). Antes de proponer
cuentas: el coste es la fricción de registro, que es justo lo que hace que la
gente la use.

## Pruebas

`npm test` ejecuta las 17 suites (~670 pruebas). No necesitan ni base de datos ni
clave de IA. La CI las ejecuta en cada push.

Las pruebas de aquí no comprueban que el código haga lo que hace: comprueban
**el fallo real que se encontró**, y el comentario cuenta cuál fue. Ejemplos que
merece la pena leer antes de escribir una nueva:

- `test-settlement-plan.js` — el reparto se reordenaba solo al ir pagando la
  gente. Incluye la simulación de 500 grupos que lo reprodujo.
- `test-correcciones.js` — tres fallos encontrados usando la app en un viaje.
- `test-settle.js` — las invariantes del dinero.

`test-extract.js` es distinto: es un banco de pruebas manual que gasta llamadas
de IA de verdad. No entra en `npm test`.

## Comentarios

En castellano, y explican **por qué**, no qué. Un comentario que repite lo que ya
dice el código sobra; uno que cuenta qué se rompió, o qué se probó y no
funcionó, evita que alguien lo deshaga dentro de seis meses. Este estilo está en
todo el repositorio: seguirlo.

## Git y despliegue

- **Siempre desde la ruta del worktree**, nunca desde la raíz del repositorio.
  La raíz la comparte otra sesión, y trabajar ahí por error acaba en commits
  directos a `main` que no tocaban.
- Si un `git commit` sale como `[main ...]` en vez de `[claude/... ...]`: parar
  antes de hacer push y corregir la rama.
- `main` se actualiza por fast-forward desde la rama. Si el push se rechaza es
  que la otra sesión ha subido algo: `git rebase origin/main`, volver a pasar
  `npm test`, y subir. **Nunca forzar sobre `main`.**
- Después de desplegar, **comprobarlo en producción de verdad** antes de decir
  que está hecho. Vercel tarda entre 30 y 90 segundos.

## Dos sesiones, un repositorio

Este repositorio lo tocan dos conversaciones distintas: una de administración
(facturación, marca, plan) y otra de código. Los cambios que aparecen sin que
esta sesión los haya hecho vienen de la otra — mirar `git log` antes de
extrañarse.

## Fecha límite conocida

Los modelos de Gemini 2.5 que usa `ai.js` se retiran el **16 de octubre de
2026**. La migración no es opcional.
