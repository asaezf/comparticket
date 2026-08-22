// comparTICKET — avisos dentro de la aplicación
//
// El grupo ya se refrescaba solo cuando alguien tocaba algo, pero lo hacía en
// silencio: las cifras cambiaban delante de ti sin decirte por qué. Esto pone
// nombre a ese cambio — "Nerea ha añadido un gasto", "se ha cerrado el
// ticket de la Tasca" — para que la pantalla no se mueva sola sin explicarse.
//
// Qué NO es esto, y conviene tenerlo claro: no son notificaciones del sistema
// operativo. Solo se ven con la aplicación abierta en esa pantalla. Avisar
// con el móvil bloqueado necesita un servidor de push (claves VAPID, permiso
// del usuario, y el service worker recibiéndolas), que es otra guerra.
const Avisos = (function () {

  const MAX_A_LA_VEZ = 3;    // más de tres tapan la pantalla que quieres ver
  const DURACION = 6500;

  let pila = null;

  function contenedor() {
    if (pila && document.body.contains(pila)) return pila;
    pila = document.createElement('div');
    pila.className = 'avisos-pila';
    document.body.appendChild(pila);
    return pila;
  }

  /**
   * Enseña un aviso.
   *
   * `icono` es un emoji o un carácter suelto: se ve igual en todos los
   * sistemas sin cargar nada, y en una tarjeta de dos líneas un SVG propio
   * no aportaría nada.
   */
  function mostrar({ icono, titulo, cuerpo, tono, alTocar }) {
    const caja = contenedor();

    // Si ya hay demasiados, se va el más viejo: el que acaba de pasar importa
    // más que el de hace diez segundos.
    while (caja.children.length >= MAX_A_LA_VEZ) {
      cerrar(caja.firstElementChild, true);
    }

    const el = document.createElement('div');
    el.className = 'aviso' + (tono ? ' aviso-' + tono : '');
    el.innerHTML =
      '<span class="av-ico">' + esc(icono || '•') + '</span>' +
      '<span class="av-txt">' +
        '<span class="av-tit">' + esc(titulo) + '</span>' +
        (cuerpo ? '<span class="av-cue">' + esc(cuerpo) + '</span>' : '') +
      '</span>' +
      '<button type="button" class="av-x" aria-label="Cerrar">&times;</button>';

    el.querySelector('.av-x').addEventListener('click', (ev) => {
      ev.stopPropagation();
      cerrar(el);
    });

    if (typeof alTocar === 'function') {
      el.classList.add('av-clicable');
      el.addEventListener('click', () => { cerrar(el); alTocar(); });
    }

    caja.appendChild(el);

    // Se va solo. El temporizador se guarda en el propio elemento para poder
    // pararlo si se cierra antes a mano.
    el._irse = setTimeout(() => cerrar(el), DURACION);
    return el;
  }

  function cerrar(el, deInmediato) {
    if (!el || el._cerrando) return;
    el._cerrando = true;
    clearTimeout(el._irse);
    if (deInmediato) return el.remove();
    el.classList.add('saliendo');
    setTimeout(() => el.remove(), 220);
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  return { mostrar, cerrar };
})();
