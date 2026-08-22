// comparTICKET — tutoriales guiados
//
// Antes cada pantalla se las apañaba sola: la portada tenía un bloque de
// texto siempre visible, y la pantalla de marcar tenía una única etiqueta
// flotante que se posicionaba con `left = centro del objetivo` sin comprobar
// los bordes de la pantalla — en un objetivo pegado a la izquierda o a la
// derecha, la etiqueta se salía.
//
// Este fichero sustituye todo eso por un motor único, compartido por las
// siete pantallas: una burbuja que señala al elemento del que habla, pero
// que SIEMPRE se mantiene dentro de la pantalla. Se intenta debajo del
// elemento; si no cabe, encima; si tampoco cabe, se centra verticalmente
// y pierde el piquito — mejor sin apuntar exactamente que recortada.
//
// Cada tutorial se ve una sola vez por pantalla y por navegador: se recuerda
// en localStorage con una clave propia, así que un tutorial nuevo (uno que
// nunca se ha guardado) siempre se enseña, y no hace falta migrar nada al
// cambiar el contenido de uno que ya existía.
const Tour = (function () {

  function clave(id) { return 'ct_tour_' + id; }

  function visto(id) {
    try { return !!localStorage.getItem(clave(id)); } catch (_) { return true; }
  }

  function marcarVisto(id) {
    try { localStorage.setItem(clave(id), '1'); } catch (_) {}
  }

  let activa = null;   // { pasos, i, id, bubble }

  /**
   * Arranca un tutorial si no se ha visto antes en esta pantalla.
   *
   * `pasos` es una lista de { selector, titulo, cuerpo }. Un paso sin
   * `selector`, o cuyo selector no encuentra nada en la página en este
   * momento (el elemento no existe todavía, o esta vez no se ha pintado),
   * se enseña igual pero centrado, sin señalar a nada: mejor un paso sin
   * flecha que una pantalla sin ese paso.
   */
  function iniciar(id, pasos) {
    if (visto(id)) return;
    if (!pasos || !pasos.length) return;
    // Una pantalla puede recargar sus datos varias veces (el reparto del
    // grupo se actualiza solo, por ejemplo) y llamar a iniciar() otra vez de
    // paso. Si ya hay uno de este mismo tutorial en marcha, no se reinicia.
    if (activa && activa.id === id) return;
    // Un tutorial que arranca antes de que la pantalla haya terminado de
    // pintar señalaría a elementos que todavía no existen. Se da un respiro.
    //
    // Con setTimeout y no con requestAnimationFrame a propósito: rAF depende
    // de que el navegador esté componiendo fotogramas, y en una pestaña en
    // segundo plano —o en un panel de vista previa que no está a la vista—
    // puede no dispararse nunca, dejando el tutorial sin arrancar.
    setTimeout(() => {
      activa = { id, pasos, i: 0 };
      pintarPaso();
    }, 30);
  }

  /**
   * `selector` puede ser un string o una lista de strings — dos versiones de
   * la misma pantalla (con grupo o sin grupo, con nombre elegido o con
   * botones) donde solo una está visible cada vez. Se prueban en orden y se
   * usa la primera que exista Y se vea: un `querySelector` con varios
   * selectores separados por coma no sirve aquí, porque devuelve el primero
   * en el documento aunque esté oculto, no el primero visible.
   */
  function objetivoDelPaso(paso) {
    if (!paso.selector) return null;
    const lista = Array.isArray(paso.selector) ? paso.selector : [paso.selector];
    for (const sel of lista) {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width) return el;
    }
    return null;
  }

  function pintarPaso() {
    quitarBurbuja();
    const { pasos, i } = activa;
    const paso = pasos[i];
    const objetivo = objetivoDelPaso(paso);

    const bubble = document.createElement('div');
    bubble.className = 'tour-bubble';
    bubble.setAttribute('role', 'dialog');

    const esUltimo = i === pasos.length - 1;
    bubble.innerHTML =
      '<div class="tb-head">' +
        (pasos.length > 1
          ? '<span class="tb-count">' + (i + 1) + ' ' + (window.t ? t.ofN : 'de') + ' ' + pasos.length + '</span>'
          : '<span></span>') +
        '<button type="button" class="tb-skip" aria-label="' + (window.t ? esc(t.tourSkip) : 'Saltar') + '">&times;</button>' +
      '</div>' +
      '<div class="tb-title">' + esc(paso.titulo) + '</div>' +
      '<div class="tb-body">' + esc(paso.cuerpo) + '</div>' +
      '<button type="button" class="tb-next">' +
        esc(window.t ? (esUltimo ? t.tourDone : t.tourNext) : (esUltimo ? 'Entendido' : 'Siguiente')) +
      '</button>';

    document.body.appendChild(bubble);
    activa.bubble = bubble;
    activa.objetivo = objetivo;

    if (objetivo) {
      objetivo.classList.add('tour-target');
      // El objetivo puede estar más abajo de lo que se ve ahora mismo (p.ej.
      // el botón de compartir, al final del ticket).
      //
      // El scroll es INSTANTÁNEO y no suave a propósito: con "smooth" hay una
      // animación de varios cientos de milisegundos, y si posicionar() mide
      // antes de que termine, calcula la burbuja para donde el objetivo
      // ESTABA, no para donde va a quedar — y una burbuja fijada a esa
      // posición vieja puede acabar fuera de la pantalla. Instantáneo, la
      // medida de después ya es la definitiva.
      objetivo.scrollIntoView({ behavior: 'instant', block: 'center' });
    }

    posicionar();
    // Red de seguridad: por si el motor de scroll tarda un respiro en
    // asentarse (algún navegador, o un layout que todavía se está pintando).
    setTimeout(posicionar, 260);

    bubble.querySelector('.tb-skip').addEventListener('click', finalizar);
    bubble.querySelector('.tb-next').addEventListener('click', siguiente);

    window.addEventListener('resize', posicionar);
    window.addEventListener('scroll', posicionar, { passive: true });

    // Red de seguridad: si nadie lo toca —una pestaña que se queda abierta y
    // olvidada—, el tutorial no se queda parpadeando para siempre.
    clearTimeout(activa.temporizador);
    activa.temporizador = setTimeout(siguiente, 16000);
  }

  /**
   * Coloca la burbuja. Se intenta pegada al elemento que señala —debajo
   * primero, encima si no cabe—, pero SIEMPRE dentro de los márgenes de la
   * pantalla. Cuando ni encima ni debajo caben —un objetivo enorme en un
   * móvil bajito—, se centra en mitad de la pantalla y pierde el piquito:
   * es la idea de "que se intenten centrar dentro de lo posible" llevada
   * al límite, en vez de dejar que la burbuja se recorte por un borde.
   */
  function posicionar() {
    if (!activa || !activa.bubble || !document.body.contains(activa.bubble)) return;
    const bubble = activa.bubble;
    const objetivo = activa.objetivo;
    const margen = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const anchoDeseado = Math.min(340, vw - margen * 2);
    bubble.style.width = anchoDeseado + 'px';
    const alto = bubble.offsetHeight;

    let left, top, piquito = null;

    if (objetivo) {
      const r = objetivo.getBoundingClientRect();
      const centroX = r.left + r.width / 2;

      const cabeDebajo = r.bottom + 14 + alto <= vh - margen;
      const cabeEncima = r.top - 14 - alto >= margen;

      if (cabeDebajo) {
        top = r.bottom + 14;
        piquito = 'arriba';   // el piquito sale del borde de ARRIBA de la burbuja
      } else if (cabeEncima) {
        top = r.top - 14 - alto;
        piquito = 'abajo';    // el piquito sale del borde de ABAJO de la burbuja
      } else {
        top = Math.max(margen, (vh - alto) / 2);
        piquito = null;
      }

      left = clamp(centroX - anchoDeseado / 2, margen, vw - anchoDeseado - margen);

      if (piquito) {
        const puntaX = clamp(centroX - left, 22, anchoDeseado - 22);
        bubble.style.setProperty('--punta-x', puntaX + 'px');
      }
    } else {
      // Sin objetivo que señalar: centrada del todo, como pide el enunciado.
      top = Math.max(margen, (vh - alto) / 2);
      left = Math.max(margen, (vw - anchoDeseado) / 2);
      piquito = null;
    }

    // Última red de seguridad: por mucho que diga el cálculo de arriba, la
    // burbuja termina SIEMPRE dentro de los márgenes verticales. Cubre el
    // caso de un objetivo que todavía no ha terminado de llegar a la vista
    // —el scroll de un navegador lento, un layout que se está recolocando—
    // y cuya posición vieja daría, si no, una burbuja fuera de la pantalla.
    top = clamp(top, margen, Math.max(margen, vh - alto - margen));

    bubble.style.left = Math.round(left) + 'px';
    bubble.style.top = Math.round(top) + 'px';
    bubble.classList.toggle('con-piquito-arriba', piquito === 'arriba');
    bubble.classList.toggle('con-piquito-abajo', piquito === 'abajo');
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, max >= min ? n : min));
  }

  function siguiente() {
    if (!activa) return;
    activa.i++;
    if (activa.i >= activa.pasos.length) return finalizar();
    pintarPaso();
  }

  function quitarBurbuja() {
    if (!activa) return;
    clearTimeout(activa.temporizador);
    window.removeEventListener('resize', posicionar);
    window.removeEventListener('scroll', posicionar);
    if (activa.objetivo) activa.objetivo.classList.remove('tour-target');
    if (activa.bubble) activa.bubble.remove();
  }

  function finalizar() {
    if (!activa) return;
    marcarVisto(activa.id);
    quitarBurbuja();
    activa = null;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  /**
   * Cierra el tutorial en marcha, si hay uno.
   *
   * Para cuando el usuario ya ha hecho lo que el paso actual explicaba —toca
   * la primera píldora antes de leer del todo— y seguir insistiendo con el
   * resto de pasos sobraría: ya ha demostrado que lo ha entendido.
   */
  function terminar() {
    finalizar();
  }

  return { iniciar, visto, marcarVisto, terminar };
})();
