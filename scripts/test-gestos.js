#!/usr/bin/env node
/**
 * Los gestos de las dos pantallas donde hay dinero de por medio.
 *   node scripts/test-gestos.js
 *
 *   1. CONFIRMAR SE MANTIENE PULSADO. Confirmar es el único paso de la app que
 *      no tiene vuelta atrás: cierra tu parte del ticket y te saca de la
 *      pantalla. Iba con un `click` suelto, y un toque suelto es exactamente
 *      lo que pasa con el móvil en la mano encima de una mesa.
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
 * se comprueba mirándolo—, pero sí que nadie deshaga esto sin enterarse. Y el
 * primero importa más que la estética: si vuelve el `click`, vuelve a poder
 * cerrarse una cuenta con un roce.
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

console.log('\n1. Confirmar hay que mantenerlo pulsado');
{
  // ESTA ES LA IMPORTANTE. Si vuelve un `click` que confirme, vuelve a poder
  // cerrarse una cuenta con un roce, y cerrarla no tiene vuelta atrás.
  check('el botón escucha al apoyar el dedo, no al soltarlo',
    /btn\.addEventListener\('pointerdown'/.test(claimJs),
    'sin pointerdown no hay nada que mantener');
  check('soltar, salirse o que se cancele el gesto NO confirman',
    /'pointerup', 'pointerleave', 'pointercancel'/.test(claimJs),
    'si falta pointerleave, arrastrar el dedo fuera sigue confirmando');
  check('un click suelto ya no confirma',
    /btn\.addEventListener\('click', e => e\.preventDefault\(\)\)/.test(claimJs),
    'con un click que confirme vuelve el problema entero');

  // La espera es lo que separa un roce de una decisión. Ni tan corta que la
  // dispare el rebote del dedo ni tan larga que parezca que se ha colgado.
  const m = claimJs.match(/const RETENCION = (\d+);/);
  check('la espera está entre 300 y 900 ms', !!m && +m[1] >= 300 && +m[1] <= 900,
    m ? 'ahora son ' + m[1] + ' ms' : 'no se encuentra RETENCION');

  check('la espera se cancela al soltar', /clearTimeout\(retencion\)/.test(claimJs));

  // Con teclado no hay gesto que mantener. Sin esto, quien navega con teclado
  // se queda sin poder confirmar: el click ya no vale.
  check('con teclado se confirma con Enter o espacio',
    /e\.key === 'Enter' \|\| e\.key === ' '/.test(claimJs),
    'si no, el teclado se queda sin forma de confirmar');
}

console.log('\n2. El relleno sale de donde tocas y es del ámbar de las compartidas');
{
  check('el botón lleva su capa de relleno', /class="cb-fill"/.test(claimHtml));
  const fill = bloque('.cb-fill') || '';
  check('es un círculo', /border-radius:\s*50%/.test(fill));
  // #F59E0B es exactamente el de .unit-pill.shared. No es decoración: es el
  // único color de la pantalla que ya significa "esto es de varios".
  check('usa el ámbar de las casillas compartidas', /#F59E0B/i.test(fill),
    'el ámbar tiene que ser el mismo que el de .unit-pill.shared');
  const compartida = bloque('.unit-pill.shared') || '';
  check('y es literalmente el mismo tono', /#F59E0B/i.test(compartida));

  // El círculo nace bajo el dedo: es lo que hace que se lea como que lo
  // empujas tú y no como una barra de carga que va por su cuenta.
  check('el círculo nace en el punto que se toca',
    /--cb-x/.test(fill) && /--cb-y/.test(claimJs),
    'sin las coordenadas sale siempre del centro');
  check('el diámetro cubre el botón desde cualquier esquina',
    /Math\.hypot/.test(claimJs));

  const boton = bloque('.btn-confirmar') || '';
  check('el botón recorta el círculo con su propia forma',
    /overflow:\s*hidden/.test(boton) && /position:\s*relative/.test(boton));
  // Un relleno parado a la mitad se lee como que algo ha fallado.
  const soltado = bloque('.btn-confirmar.soltado .cb-fill') || '';
  check('al soltar antes de tiempo el círculo se va, no se queda a medias',
    /transform:\s*scale\(0\)/.test(soltado));

  // iOS no vibra nunca -Safari no lo soporta-, así que esto es un extra en
  // Android, no la señal principal. La señal principal es el círculo.
  check('vibra al empezar y al completarse', /navigator\.vibrate/.test(claimJs));

  // EL MOVIL VIBRA TODO EL RATO, no solo al empezar. La API no deja regular la
  // fuerza, así que se finge con el ritmo: pulsos cada vez más largos y huecos
  // cada vez más cortos.
  const pat = claimJs.match(/const VIBRA_MANTENIENDO = \[([^\]]+)\]/);
  check('el patrón de vibración existe', !!pat);
  if (pat) {
    const nums = pat[1].split(',').map(x => +x.trim());
    const suma = nums.reduce((a2, b2) => a2 + b2, 0);
    const espera = +(claimJs.match(/const RETENCION = (\d+);/) || [])[1];
    // Si sumara más que la retención, el móvil seguiría vibrando después de
    // confirmar; si sumara menos, se apagaría a media espera.
    check('dura exactamente lo que el gesto', suma === espera,
      'el patrón suma ' + suma + ' ms y el gesto dura ' + espera);
    // Los pulsos van en las posiciones pares; tienen que ir a más.
    const pulsos = nums.filter((_, i) => i % 2 === 0);
    check('los pulsos van creciendo, no son todos iguales',
      pulsos.every((v, i) => i === 0 || v > pulsos[i - 1]),
      'sin la rampa no se nota que va a más: ' + pulsos.join(','));
  }
  check('la vibración se corta al soltar', /tocar\(0\)/.test(claimJs),
    'si se sigue notando después de soltar, parece que ha confirmado igual');
}

console.log('\n3. El botón tiembla mientras se mantiene');
{
  const ret = bloque('.btn-confirmar.reteniendo') || '';
  check('tiembla y se aprieta a la vez',
    /cb-tiembla/.test(ret) && /cb-aprieta/.test(ret));

  // Las dos van en propiedades DISTINTAS a propósito: una sola propiedad
  // `transform` solo admite una animación y la segunda pisaría a la primera.
  const tiembla = css.slice(css.indexOf('@keyframes cb-tiembla'),
                            css.indexOf('}', css.indexOf('@keyframes cb-tiembla') + 200));
  const aprieta = css.slice(css.indexOf('@keyframes cb-aprieta'),
                            css.indexOf('}', css.indexOf('@keyframes cb-aprieta') + 60));
  check('el temblor va en `translate` y el apriete en `scale`',
    /translate:/.test(tiembla) && /scale:/.test(aprieta) &&
    !/transform:/.test(tiembla) && !/transform:/.test(aprieta),
    'con las dos en `transform`, la segunda pisa a la primera');

  // Un temblor lento no es un temblor, es un balanceo.
  const dur = ret.match(/cb-tiembla (\d+)ms/);
  check('el temblor es rápido (menos de 120 ms por ciclo)',
    !!dur && +dur[1] < 120, dur ? dur[1] + ' ms' : 'sin duración');

  // Al soltar tiene que volver a su sitio: si no, se queda encogido y torcido.
  const soltado = bloque('.btn-confirmar.soltado') || '';
  check('al soltar vuelve a su sitio',
    /animation:\s*none/.test(soltado) && /translate:\s*0 0/.test(soltado) &&
    /scale:\s*1/.test(soltado));

  check('quien pide menos movimiento no ve el temblor',
    /prefers-reduced-motion[\s\S]{0,300}\.btn-confirmar\.reteniendo \{ animation: cb-aprieta/.test(css));
}

console.log('\n4. La curva: rápida al empezar, frenando al final');
{
  const fill = bloque('.btn-confirmar.reteniendo .cb-fill') || '';
  const cb = fill.match(/cb-llenar \d+ms cubic-bezier\(([\d.]+),\s*([\d.]+)/);
  check('el círculo arranca disparado', !!cb && +cb[2] > 0.55,
    cb ? 'el segundo punto de control es ' + cb[2] + ', y por debajo de 0,55 arranca lento'
       : 'no se encuentra la curva');
  check('y no es una `ease-in-out` de las de antes', !!cb && +cb[1] < 0.2);

  // EL PRECIO DE ESA CURVA, PAGADO. Con el círculo al 95 % cuando va la mitad
  // del gesto, el último tramo no tendría nada que enseñar y alguien soltaría
  // pensando que ya está. Lo que avanza al final es el color.
  check('el color madura durante todo el gesto para que el final avance',
    /cb-madura \d+ms linear/.test(fill),
    'sin esto, la mitad final del gesto no enseña nada y se suelta antes');
  const madura = css.slice(css.indexOf('@keyframes cb-madura'),
                           css.indexOf('}', css.indexOf('@keyframes cb-madura') + 80));
  check('y madura de claro a tostado, no al revés',
    /brightness\(1\.\d+\)[\s\S]*brightness\(0\.\d+\)/.test(madura));
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
