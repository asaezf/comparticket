#!/usr/bin/env node
/**
 * Los gestos de las dos pantallas donde hay dinero de por medio.
 *   node scripts/test-gestos.js
 *
 *   1. CONFIRMAR SE PULSA Y YA. Hubo aquí un gesto de mantener el dedo 750 ms.
 *      La idea era defendible —confirmar es el único paso sin vuelta atrás—
 *      pero la gente lo rechazó en bloque: no es intuitivo, y un botón que no
 *      responde al primer toque se lee como roto, no como seguro. Las pruebas
 *      de esa sección existen para que el gesto no vuelva por descuido.
 *
 *   2. LAS CIFRAS DE LA CUENTA CERRADA LATEN. Copian el importe al tocarlas
 *      desde hace tiempo, y eso no se veía por ninguna parte: son texto, sin
 *      borde ni fondo, iguales que las de al lado que no hacen nada. Quien no
 *      lo sabía, no lo descubría.
 *
 *   3. EL RECUADRO CON EL ENLACE ESCRITO. Sobraba: con "copiar enlace" y
 *      "compartir" justo debajo nadie lo iba a teclear a mano. Se quitó, y lo
 *      que hay que vigilar es que copiar siga copiando: los dos botones leían
 *      el enlace de ese recuadro.
 *
 * Miran el fuente: aquí no hay navegador. No demuestran que se vea bien —eso
 * se comprueba mirándolo—, pero sí que nadie deshaga esto sin enterarse.
 */

const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');

const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
const claimJs = fs.readFileSync(path.join(PUB, 'js', 'claim.js'), 'utf8');
const claimHtml = fs.readFileSync(path.join(PUB, 'claim.html'), 'utf8');
const summaryJs = fs.readFileSync(path.join(PUB, 'js', 'summary.js'), 'utf8');
const groupJs = fs.readFileSync(path.join(PUB, 'js', 'group.js'), 'utf8');

let pass = 0, fail = 0;
function check(label, ok, detalle) {
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${label}`);
  if (!ok && detalle) console.log(`         ${detalle}`);
  ok ? pass++ : fail++;
}

// Devuelve el cuerpo de las reglas de un selector, juntando todas sus
// apariciones. Entiende los selectores agrupados con coma: buscar
// `.person-amount {` a secas no encontraba nada porque la regla se escribe
// `.person-amount,\n.pantalla-grupo .tr-amount {`, y la prueba daba por
// ausente una animación que estaba puesta.
function bloque(selector) {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Delante solo puede haber principio de fichero, salto de línea o coma: así
  // `.tr-amount` no cuela cuando lo que hay escrito es `.pantalla-grupo .tr-amount`.
  const re = new RegExp('(?:^|[\\n,])[ \\t]*' + escapado + '[ \\t]*(?=[,{])', 'g');
  let salida = '', m;
  while ((m = re.exec(css))) {
    const abre = css.indexOf('{', m.index + m[0].length - 1);
    if (abre === -1) continue;
    salida += css.slice(abre, css.indexOf('}', abre)) + '\n';
  }
  return salida || null;
}

console.log('\n1. Confirmar se pulsa y ya');
{
  // AQUI ESTUVO UN GESTO DE MANTENER EL DEDO 750 ms, con su círculo creciendo
  // y su vibración en rampa. La idea era defendible —confirmar es el único
  // paso sin vuelta atrás— pero la gente lo rechazó en bloque: no es
  // intuitivo, y un botón que no responde al primer toque se lee como roto, no
  // como seguro. Estas comprobaciones existen para que no vuelva por
  // descuido: si alguien reintroduce el gesto, fallan.
  const restos = ['RETENCION', 'MARGEN_FINAL', 'PUNTO_SIN_RETORNO',
                  'SUELO_PARA_SALTAR', 'VIBRA_MANTENIENDO', 'medirCirculo',
                  'empezarRetencion', 'soltarRetencion'];
  const vivos = restos.filter(x => new RegExp('\\b' + x + '\\b').test(claimJs));
  check('no queda nada del gesto de mantener pulsado', vivos.length === 0,
    'sigue habiendo: ' + vivos.join(', '));

  check('el botón confirma con un click normal',
    /btn\.addEventListener\('click', \(\) => \{[\s\S]{0,180}confirmar\(\)/.test(claimJs),
    'sin esto el botón no hace nada al pulsarlo');

  // Lo que NO puede volver: que soltar el dedo, salirse del botón o que el
  // navegador cancele el gesto tengan algún efecto. Ya no hay gesto.
  check('soltar el dedo ya no cancela nada',
    !/pointerup|pointerleave|pointercancel/.test(claimJs));

  // Un `preventDefault` en el click era lo que impedía confirmar al pulsar.
  check('el click ya no se anula',
    !/addEventListener\('click', e => e\.preventDefault\(\)\)/.test(claimJs));

  // Con un <button> de verdad, Enter y espacio disparan el click solos: ya no
  // hace falta el manejador de teclado que hubo que añadir para el gesto.
  check('el teclado funciona sin manejador aparte',
    !/e\.key === 'Enter'/.test(claimJs));
}

console.log('\n2. Un toque no puede mandarse dos veces');
{
  // Confirmar escribe en la base de datos. Si el botón sigue vivo mientras
  // viaja la petición, dos toques nerviosos mandan dos confirmaciones.
  check('el botón se desactiva al confirmar',
    /btn\.classList\.add\('confirmado', 'enviando'\);\s*\n\s*btn\.disabled = true;/.test(claimJs));
  check('y el manejador se planta si ya está desactivado',
    /if \(btn\.disabled\) return;/.test(claimJs));

  // Y si la petición falla, tiene que volver a poder pulsarse: un botón ámbar
  // y muerto deja a la persona sin forma de confirmar su parte.
  check('si falla la red, el botón revive',
    /catch \(err\) \{[\s\S]{0,160}btn\.disabled = false;[\s\S]{0,160}remove\('confirmado', 'enviando'\)/.test(claimJs));
  // Lo mismo si la validación corta antes de mandar nada.
  check('si la validación corta, el botón revive',
    /const abortar = \(\) => \{[\s\S]{0,220}b\.disabled = false;/.test(claimJs));
}

console.log('\n3. El ámbar es el de las casillas compartidas');
{
  check('el botón lleva su capa de relleno', /class="cb-fill"/.test(claimHtml));
  const fill = bloque('.cb-fill') || '';
  check('es un círculo', /border-radius:\s*50%/.test(fill));
  // #F59E0B es exactamente el de .unit-pill.shared. No es decoración: es el
  // único color de la pantalla que ya significa "esto es de varios", y
  // confirmar es cuando tu parte pasa a serlo.
  check('usa el ámbar de las casillas compartidas', /#F59E0B/i.test(fill));
  const compartida = bloque('.unit-pill.shared') || '';
  check('y es literalmente el mismo tono', /#F59E0B/i.test(compartida));

  // Nace donde se toca: es lo que hace que se lea como respuesta al dedo y no
  // como una barra de carga que va por su cuenta.
  check('el círculo nace en el punto que se toca',
    /--cb-x/.test(fill) && /--cb-x/.test(claimJs));
  check('el diámetro cubre el botón desde cualquier esquina',
    /Math\.hypot/.test(claimJs));

  const boton = bloque('.btn-confirmar') || '';
  check('el botón recorta el círculo con su propia forma',
    /overflow:\s*hidden/.test(boton) && /position:\s*relative/.test(boton));

  // Corto: es un acuse de recibo, no una espera. Si dura mucho vuelve a
  // parecer una barra de progreso, que es de lo que veníamos.
  const dur = fill && (bloque('.btn-confirmar.confirmado .cb-fill') || '').match(/cb-llenar (\d+)ms/);
  check('el relleno es corto (menos de 400 ms)', !!dur && +dur[1] < 400,
    dur ? 'dura ' + dur[1] + ' ms' : 'no se encuentra la duración');
}

console.log('\n4. Volver atrás no deja el botón muerto');
{
  // Al pulsar "atrás" el navegador NO recarga: saca la página de memoria con
  // el botón tal y como se dejó —ámbar y desactivado—. `pageshow` con
  // `persisted` es el único aviso que da; `load` no se dispara.
  check('se escucha la vuelta desde la memoria del navegador',
    /addEventListener\('pageshow'[\s\S]{0,120}persisted/.test(claimJs));
  check('y ahí se le quita el ámbar',
    /persisted[\s\S]{0,400}remove\('confirmado', 'enviando'\)/.test(claimJs));
  check('y se recalcula si debe estar activo',
    /persisted[\s\S]{0,600}update\(\);/.test(claimJs));
}

console.log('\n5. Compartir el enlace sin enseñarlo escrito');
{
  const ticketHtml = fs.readFileSync(path.join(PUB, 'ticket.html'), 'utf8');
  const ticketJs = fs.readFileSync(path.join(PUB, 'js', 'ticket.js'), 'utf8');
  // Sobraba: con "copiar enlace" y "compartir" justo debajo nadie lo iba a
  // teclear a mano, y ocupaba tres líneas de texto ilegible sobre los botones.
  check('el recuadro con el enlace escrito ya no está',
    !/share-link/.test(ticketHtml) && !/id="shareUrl"/.test(ticketHtml));
  check('ni su CSS', !/^\.share-link/m.test(css));
  // Lo que NO puede pasar: que al quitar el recuadro, copiar deje de copiar.
  // Los dos botones lo leían de ahí.
  check('copiar sigue copiando el enlace',
    /writeText\(enlaceCompartir\)/.test(ticketJs),
    'los botones leían el enlace del recuadro; sin él necesitan la variable');
  check('y el enlace se guarda al abrir la pantalla de compartir',
    /enlaceCompartir = url;/.test(ticketJs));
}

console.log('\n6. Las cifras que se copian dicen que se tocan');
{
  const cifra = bloque('.person-amount') || '';
  check('la cifra del resumen late', /animation:\s*cifra-late/.test(cifra));
  const trans = bloque('.pantalla-grupo .tr-amount') || '';
  check('la del reparto del grupo también', /animation:\s*cifra-late/.test(trans));

  // Solo la escala. El color no se toca: el rojo de "este paga" significa algo
  // y no puede parpadear.
  const kf = css.slice(css.indexOf('@keyframes cifra-late'),
                       css.indexOf('}', css.indexOf('@keyframes cifra-late') + 200));
  check('solo se mueve, no cambia de color',
    /transform:\s*scale/.test(kf) && !/color/.test(kf),
    'el rojo de "este paga" significa algo y no puede parpadear');

  // En cuanto copia una, ya sabe que se tocan: a partir de ahí solo sería una
  // cifra de dinero moviéndose sin motivo.
  check('dejan de latir en cuanto se copia una',
    /body\.ya-copio/.test(css) &&
    /classList\.add\('ya-copio'\)/.test(summaryJs) &&
    /classList\.add\('ya-copio'\)/.test(groupJs));

  check('respetan "reducir movimiento"',
    /prefers-reduced-motion[\s\S]{0,400}cifra-late|cifra-late[\s\S]{0,200}animation:\s*none/.test(css) ||
    /\.person-amount, \.pantalla-grupo \.tr-amount \{ animation: none; \}/.test(css));
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
