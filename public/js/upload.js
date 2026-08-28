// A que grupo pertenece lo que se escanee ahora, si se ha llegado desde uno.
const grupoDestino = new URLSearchParams(location.search).get('grupo') || '';

// comparTICKET — Upload page (multi-image, camera + gallery)
document.getElementById('uploadTitle').textContent = t.uploadTitle;
document.getElementById('uploadSub').textContent = t.uploadHint;
document.getElementById('retakeText').textContent = t.retakeBtn;
document.getElementById('scanText').textContent = t.scanBtn;
document.getElementById('procText').textContent = t.processing;
document.getElementById('cameraBtnText').textContent = t.cameraLabel || 'Cámara';
document.getElementById('galleryBtnText').textContent = t.galleryLabel || 'Galería';
const addHint = document.getElementById('addHintText');
if (addHint) addHint.textContent = t.addMore;

const cameraBtn = document.getElementById('cameraBtn');
const galleryBtn = document.getElementById('galleryBtn');
const cameraInput = document.getElementById('cameraInput');
const galleryInput = document.getElementById('galleryInput');
const uploadArea = document.getElementById('uploadArea');
const previewOverlay = document.getElementById('previewOverlay');
const previewThumbs = document.getElementById('previewThumbs');
const scanBtn = document.getElementById('scanBtn');
const retakeBtn = document.getElementById('retakeBtn');
const proc = document.getElementById('processing');

let files = []; // File[]

// Camera button → opens camera directly
cameraBtn.addEventListener('click', () => {
  cameraInput.value = '';
  cameraInput.click();
});

// Gallery button → opens file picker / gallery
galleryBtn.addEventListener('click', () => {
  galleryInput.value = '';
  galleryInput.click();
});

// Handle camera capture
cameraInput.addEventListener('change', e => {
  if (!e.target.files.length) return;
  [...e.target.files].forEach(f => addFile(f));
  renderThumbs();
  cameraInput.value = '';
  uploadArea.classList.add('hidden');
  previewOverlay.classList.remove('hidden');
});

// Handle gallery selection
galleryInput.addEventListener('change', e => {
  if (!e.target.files.length) return;
  [...e.target.files].forEach(f => addFile(f));
  renderThumbs();
  galleryInput.value = '';
  uploadArea.classList.add('hidden');
  previewOverlay.classList.remove('hidden');
});

function addFile(file) {
  if (files.length >= 6) return;
  files.push(file);
}

function removeFile(idx) {
  files.splice(idx, 1);
  renderThumbs();
  if (files.length === 0) {
    previewOverlay.classList.add('hidden');
    uploadArea.classList.remove('hidden');
  }
}

function renderThumbs() {
  previewThumbs.innerHTML = '';
  files.forEach((file, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.readAsDataURL(file);
    thumb.appendChild(img);

    const rm = document.createElement('button');
    rm.className = 'thumb-rm';
    rm.type = 'button';
    rm.textContent = '\u00d7';
    rm.setAttribute('aria-label', 'Quitar');
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(idx);
    });
    thumb.appendChild(rm);

    // Girar. Un ticket tumbado la IA no lo lee: sobre una cuenta de 84 \u20ac el
    // desv\u00edo medido fue de 20 \u20ac. Se gira a mano porque hay facturas
    // leg\u00edtimamente apaisadas y adivinarlo por la forma romper\u00eda esas.
    const rot = document.createElement('button');
    rot.className = 'thumb-rot';
    rot.type = 'button';
    rot.title = t.rotate || 'Girar';
    rot.setAttribute('aria-label', t.rotate || 'Girar');
    rot.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11a7.9 7.9 0 0 0-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.91v2.02c1.42-.23 2.76-.79 3.9-1.62l-1.44-1.44c-.75.54-1.59.89-2.46 1.04zm3.89-2.42l1.42 1.41c.83-1.13 1.39-2.47 1.62-3.9h-2.02c-.15.87-.5 1.72-1.02 2.49z"/></svg>';
    rot.addEventListener('click', async (e) => {
      e.stopPropagation();
      rot.disabled = true;
      files[idx] = await ImgPrep.rotate(files[idx]);
      renderThumbs();
    });
    thumb.appendChild(rot);

    previewThumbs.appendChild(thumb);
  });

  hintSideways();

  // Add-another tile (only if under limit)
  if (files.length < 6) {
    const add = document.createElement('button');
    add.className = 'thumb-add';
    add.type = 'button';
    add.textContent = '+';
    add.setAttribute('aria-label', t.addMore);
    add.addEventListener('click', () => galleryInput.click());
    previewThumbs.appendChild(add);
  }
}

/** Aviso suave si alguna foto sale más ancha que alta, que en un ticket es raro. */
async function hintSideways() {
  const hint = document.getElementById('addHintText');
  if (!hint) return;
  const checks = await Promise.all(files.map(f => ImgPrep.looksSideways(f)));
  const sideways = checks.some(Boolean);
  hint.textContent = sideways
    ? (lang === 'es'
        ? 'Alguna foto parece girada. Gírala con ⟳ para que se lea bien.'
        : 'A photo looks sideways. Use ⟳ so it can be read properly.')
    : t.addMore;
  hint.classList.toggle('warn', sideways);
}

retakeBtn.addEventListener('click', () => {
  previewOverlay.classList.add('hidden');
  uploadArea.classList.remove('hidden');
  files = [];
  previewThumbs.innerHTML = '';
});

scanBtn.addEventListener('click', async () => {
  if (!files.length) return;
  previewOverlay.classList.add('hidden');
  proc.classList.remove('hidden');

  try {
    // Reducir las fotos antes de subirlas. Sin esto, dos fotos de móvil pasan
    // de los 4,5 MB que admite Vercel y la petición muere con un 413 antes de
    // llegar al servidor, con lo que el usuario ve un error sin explicación.
    const prepared = await ImgPrep.prepare(files);
    const fd = new FormData();
    prepared.forEach(f => fd.append('images', f));

    const res = await fetch('/api/tickets', { method: 'POST', body: fd });
    if (!res.ok) {
      // Un 413 lo devuelve Vercel, no el servidor, y no viene en JSON.
      if (res.status === 413) {
        throw new Error(lang === 'es'
          ? 'Las fotos pesan demasiado. Prueba con menos fotos a la vez.'
          : 'The photos are too large. Try fewer photos at once.');
      }
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server error ${res.status}`);
    }
    const data = await res.json();
    // Persist creator key so only this device can close the bill later
    if (data.id && data.creatorKey) {
      try { localStorage.setItem('ck_' + data.id, data.creatorKey); } catch (_) {}
    }

    // Se guarda una copia reducida de las fotos para poder mirar despues el
    // papel original cuando una cifra no cuadra.
    //
    // Va en una peticion aparte y DESPUES de crear el ticket: la del escaneo
    // ya va justa contra el limite de 4,5 MB de Vercel, y si esto falla el
    // ticket tiene que quedar creado igualmente. La foto es un extra.
    if (data.id) {
      try {
        const copias = (await Promise.all(files.map(f => ImgPrep.archive(f)))).filter(Boolean);
        if (copias.length) {
          const fdFotos = new FormData();
          copias.forEach(f => fdFotos.append('photos', f));
          await fetch('/api/tickets/' + data.id + '/photos', { method: 'POST', body: fdFotos });
        }
      } catch (_) { /* sin foto guardada, el ticket funciona igual */ }
    }

    // Si se venia de un grupo ("escanear un ticket" desde su pantalla), el
    // ticket recien creado se mete dentro. Si esta llamada fallase, el ticket
    // sigue existiendo suelto y se puede asignar despues: no se pierde nada.
    if (grupoDestino && data.id) {
      try {
        // Se manda quién eres dentro del grupo para que el aviso pueda decir
        // "Nerea ha añadido un ticket" — y para no avisarte a ti mismo.
        let quienSoy = null;
        try { quienSoy = localStorage.getItem('ct_yo_' + grupoDestino) || null; } catch (_) {}

        await fetch('/api/tickets/' + data.id + '/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: grupoDestino, actor: quienSoy })
        });
      } catch (_) {}
    }
    if (data.redirect) window.location.href = data.redirect;
  } catch (err) {
    console.error('Upload error:', err);
    proc.classList.add('hidden');
    previewOverlay.classList.remove('hidden');
    // Show error toast
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = err.message || (lang === 'es'
        ? 'Error al procesar el ticket. Inténtalo de nuevo.'
        : 'Error processing receipt. Please try again.');
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 6000);
    }
  }
});

// Drag & drop
document.body.addEventListener('dragover', e => { e.preventDefault(); });
document.body.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer.files.length) {
    [...e.dataTransfer.files].forEach(f => addFile(f));
    renderThumbs();
    uploadArea.classList.add('hidden');
    previewOverlay.classList.remove('hidden');
  }
});

// --- Entrada a los grupos -------------------------------------------------
// Un ticket suelto resuelve una cena. Un grupo resuelve un viaje entero: por
// eso la portada ofrece las dos vias en vez de esconder esta.
const _groupCta = document.getElementById('groupCta');
if (_groupCta) {
  _groupCta.addEventListener('click', () => {
    window.location.href = '/new-group.html';
  });
}

// Etiquetas de las dos vias, para que se distingan de un vistazo: una cuenta
// suelta ahora mismo, o un grupo que acumula gastos durante semanas.
const _pon = (id, texto) => {
  const el = document.getElementById(id);
  if (el && texto) el.textContent = texto;
};
_pon('viaSueltaLabel', t.viaSuelta);
_pon('viaGrupoLabel', t.viaGrupo);
_pon('groupCtaText', t.createGroup);
_pon('groupCtaSub', t.createGroupSub);

/**
 * Los grupos en los que ya has entrado desde este movil.
 *
 * No es una sesion ni da acceso a nada: el enlace sigue siendo la llave. Es
 * solo que el movil se acuerda, para no tener que rebuscar el enlace en
 * WhatsApp cada vez que quieres apuntar un gasto.
 */
function pintarMisGrupos() {
  let lista = [];
  try { lista = JSON.parse(localStorage.getItem('ct_grupos') || '[]'); } catch (_) {}
  lista = (lista || []).filter(g => g && g.id && g.name);

  const cta  = document.getElementById('verGruposCta');
  const caja = document.getElementById('misGrupos');
  const cont = document.getElementById('misGruposLista');
  if (!cta || !caja || !cont) return;

  if (!lista.length) {
    cta.classList.add('hidden');
    caja.classList.add('hidden');
    return;
  }

  cta.classList.remove('hidden');
  const cuantos = document.getElementById('verGruposCuantos');
  if (cuantos) cuantos.textContent = lista.length;

  cta.onclick = () => {
    caja.classList.toggle('hidden');
    cta.classList.toggle('abierto', !caja.classList.contains('hidden'));
  };

  cont.innerHTML = '';
  lista.slice(0, 20).forEach(g => {
    const fila = document.createElement('div');
    fila.className = 'mg-row';

    // El enlace ocupa la fila entera menos la papelera: se entra tocando en
    // cualquier sitio menos ahi.
    const a = document.createElement('a');
    a.className = 'mg-link';
    a.href = '/g/' + encodeURIComponent(g.id);
    a.innerHTML =
      '<span class="mg-name"></span>' +
      '<span class="mg-meta"></span>';
    // textContent y no innerHTML: el nombre lo escribio un usuario.
    a.querySelector('.mg-name').textContent = g.name;

    // Lo que sirve para reconocer un grupo es con quien es y de cuando es.
    // El dinero no: en la portada, un total suelto no dice si es lo que has
    // gastado, lo que debes o lo que te deben.
    const trozos = [];
    if (g.gente) trozos.push(g.gente === 1 ? '1 persona' : g.gente + ' personas');
    const f = g.creado ? new Date(g.creado) : null;
    if (f && !isNaN(f)) {
      trozos.push('creado el ' + f.toLocaleDateString('es-ES',
        { day: '2-digit', month: 'short', year: 'numeric' }));
    }
    a.querySelector('.mg-meta').textContent = trozos.join(' · ');
    fila.appendChild(a);

    const borrar = document.createElement('button');
    borrar.className = 'mg-del';
    borrar.type = 'button';
    borrar.title = 'Quitar de esta lista';
    borrar.innerHTML = '&times;';
    borrar.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // Se quita de la lista de ESTE movil. El grupo sigue existiendo y el
      // enlace sigue funcionando: esto no borra nada de nadie.
      if (!confirm('¿Quitar «' + g.name + '» de esta lista?\n\n' +
                   'El grupo no se borra: si tienes el enlace, puedes volver a entrar.')) return;
      try {
        const act = JSON.parse(localStorage.getItem('ct_grupos') || '[]');
        localStorage.setItem('ct_grupos',
          JSON.stringify(act.filter(x => x && x.id !== g.id)));
      } catch (_) {}
      pintarMisGrupos();
    });
    fila.appendChild(borrar);

    cont.appendChild(fila);
  });
}

pintarMisGrupos();

/**
 * Modo grupo: escanear un ticket desde dentro de un grupo.
 *
 * Quien ya esta en un grupo no necesita que le presenten la aplicacion otra
 * vez. Se esconde todo lo que sobra —marca, tutorial, la otra via— y quedan
 * los dos botones de camara y galeria, que es lo unico a lo que ha venido.
 */
function modoGrupo() {
  if (!grupoDestino) return;
  document.body.classList.add('en-grupo');

  // De donde viene y a donde vuelve si se arrepiente.
  // La fila se ensena entera; el href va en la flecha, que es lo unico que
  // ahora es un boton.
  const fila = document.getElementById('volverGrupo');
  if (fila) fila.classList.remove('hidden');
  const flecha = document.getElementById('volverGrupoLink');
  if (flecha) flecha.href = '/g/' + encodeURIComponent(grupoDestino);

  // El nombre del grupo, para que se vea a que grupo va este ticket.
  fetch('/api/groups/' + encodeURIComponent(grupoDestino))
    .then(r => r.ok ? r.json() : null)
    .then(g => {
      if (!g) return;
      const el = document.getElementById('grupoDestinoNombre');
      if (el) el.textContent = g.name;
    })
    .catch(() => {});
}

modoGrupo();


// =========================================================================
// IDIOMA Y MONEDA
//
// Los dos se guardan en el movil y no en el servidor: no hay cuentas de
// usuario, y son cosa de quien mira la pantalla, no del grupo. Al cambiar
// cualquiera de los dos hace falta recargar, porque los textos y los
// importes se pintan al arrancar cada pantalla.
// =========================================================================

function montarAjustes() {
  const idioma = document.getElementById('selIdioma');
  const moneda = document.getElementById('selMoneda');
  if (!idioma || !moneda) return;

  document.getElementById('lblIdioma').textContent = t.langLabel;
  document.getElementById('lblMoneda').textContent = t.currencyLabel;
  document.getElementById('notaMoneda').textContent = t.currencyNote;

  idioma.value = lang;
  try { moneda.value = Money.monedaActual(); } catch (_) {}

  idioma.addEventListener('change', () => {
    try { localStorage.setItem('ct_idioma', idioma.value); } catch (_) {}
    location.reload();
  });
  moneda.addEventListener('change', () => {
    try { localStorage.setItem('ct_moneda', moneda.value); } catch (_) {}
    location.reload();
  });
}

montarAjustes();


// =========================================================================
// ACCESO DIRECTO EN LA PANTALLA DEL MOVIL
//
// Antes el boton dependia de que el navegador avisara por su cuenta
// (`beforeinstallprompt`, solo en Android/escritorio, y no siempre llega)
// o de adivinar el telefono por el user-agent. Las dos formas fallaban en
// silencio: si el aviso no llegaba, o si alguien tocaba algo que resulto
// no tener ningun listener enganchado, no pasaba nada y parecia roto.
//
// Ahora "Descargar como app" es un boton fijo, siempre visible salvo que
// ya este instalada. Al tocarlo se abren las dos opciones y es la propia
// persona quien elige su telefono:
//   - iPhone: se explica. iOS no tiene ninguna API para disparar el
//     instalado desde una pagina web -ni en Safari ni en ningun otro
//     navegador del sistema, todos corren sobre el mismo motor por
//     obligacion de Apple. Es una limitacion permanente, no de este
//     codigo.
//   - Android: si el navegador ya ha avisado que se puede instalar, se
//     dispara el dialogo real de un toque. Si todavia no ha avisado -pasa,
//     por ejemplo, si ya se cerro el aviso una vez-, se explica el camino
//     manual por el menu del navegador, igual que en iPhone: nunca se deja
//     el toque sin respuesta.
// =========================================================================

let promesaDeInstalar = null;

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3200);
}

function yaEstaInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

const ICONO_COMPARTIR = '<path d="M16 5l-1.42 1.42-1.59-1.59V16h-1.98V4.83'
  + 'L9.42 6.42 8 5l4-4 4 4z M20 10v11c0 1.1-.9 2-2 2H6c-1.11 0-2-.9-2-2'
  + 'V10c0-1.11.89-2 2-2h3v2H6v11h12V10h-3V8h3c1.1 0 2 .9 2 2z"/>';
const ICONO_MENU = '<path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z'
  + 'm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2'
  + ' 2 2 2-.9 2-2-.9-2-2-2z"/>';

function mostrarExplicacion(iconoSvg, texto, conPistaWhatsapp) {
  const explica = document.getElementById('atajoExplica');
  const icono = document.getElementById('atajoIcono');
  const instr = document.getElementById('atajoInstrucciones');
  const alt = document.getElementById('atajoAlt');
  if (!explica || !icono || !instr) return;
  icono.innerHTML = iconoSvg;
  instr.textContent = texto;
  document.getElementById('atajoElegir').classList.add('hidden');
  explica.classList.remove('hidden');
  if (alt) {
    if (conPistaWhatsapp) { alt.textContent = t.addToHomeIosAlt; alt.classList.remove('hidden'); }
    else alt.classList.add('hidden');
  }
}

function montarAtajo() {
  const caja = document.getElementById('atajo');
  const abrir = document.getElementById('atajoAbrir');
  const elegir = document.getElementById('atajoElegir');
  const btnIos = document.getElementById('atajoElegirIos');
  const btnAndroid = document.getElementById('atajoElegirAndroid');
  if (!caja || !abrir || !elegir || !btnIos || !btnAndroid) return;

  if (yaEstaInstalada()) { caja.classList.add('hidden'); return; }

  document.getElementById('atajoTitulo').textContent = t.addToHome;
  caja.classList.remove('hidden');

  // El navegador puede avisar en cualquier momento desde que carga la
  // pagina, se llegue a elegir Android o no: hay que estar escuchando ya.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promesaDeInstalar = e;
  });
  window.addEventListener('appinstalled', () => caja.classList.add('hidden'));

  abrir.addEventListener('click', () => {
    elegir.classList.toggle('hidden');
    document.getElementById('atajoExplica').classList.add('hidden');
  });

  btnIos.addEventListener('click', () => {
    mostrarExplicacion(ICONO_COMPARTIR, t.addToHomeIos, true);
  });

  btnAndroid.addEventListener('click', async () => {
    if (promesaDeInstalar) {
      const p = promesaDeInstalar;
      promesaDeInstalar = null;
      elegir.classList.add('hidden');
      p.prompt();
      try { await p.userChoice; } catch (_) {}
      return;
    }
    mostrarExplicacion(ICONO_MENU, t.addToHomeAndroidManual, false);
  });
}

montarAtajo();

// El navegador no ofrece instalar la aplicacion si no hay un service worker
// registrado. El nuestro no cachea nada a proposito —ver public/sw.js—: aqui
// se manejan importes, y servir una version vieja del codigo que reparte el
// dinero es peor que no poder abrir sin conexion.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// =========================================================================
// TUTORIAL DE LA PORTADA
//
// Solo la primera vez, y solo en la vía normal: quien llega desde el enlace
// de un grupo (?grupo=...) ya sabe lo que hace — viene de escanear otro
// ticket del mismo viaje — y no necesita que le presenten la aplicación.
// =========================================================================
if (!grupoDestino) {
  Tour.iniciar('index', [
    {
      selector: '.upload-btns-row',
      titulo: t.tourIdxScanTitle,
      cuerpo: t.tut1
    },
    {
      selector: '#groupCta',
      titulo: t.tourIdxGroupTitle,
      cuerpo: t.tourIdxGroupBody
    }
  ]);
}


// =========================================================================
// SILENCIAR LOS AVISOS
//
// Los avisos del grupo no suenan ni vibran: son tarjetas dentro de la
// aplicación y nada más. Silenciarlos, entonces, es dejar de enseñarlos.
//
// Se guarda en el móvil y no en el grupo: es una preferencia de quien mira
// la pantalla. Silenciar para ti no puede callar los avisos de los demás.
// =========================================================================

const CAMPANA_KEY = 'ct_avisos_silencio';

function avisosSilenciados() {
  try { return localStorage.getItem(CAMPANA_KEY) === '1'; } catch (_) { return false; }
}

function montarCampana() {
  const btn = document.getElementById('btnCampana');
  const txt = document.getElementById('txtCampana');
  if (!btn || !txt) return;

  const raya = btn.querySelector('.campana-tacha');

  const pintar = () => {
    const callado = avisosSilenciados();
    btn.classList.toggle('silenciado', callado);
    // La campana tachada ya dice el estado; el texto dice qué pasa al tocarla.
    txt.textContent = callado ? t.avisosOff : t.avisosOn;
    btn.setAttribute('aria-pressed', String(callado));

    // La raya se dibuja desde aquí y no desde el CSS a propósito: es estado
    // —depende de una variable— y así no hay que fiarse de que una regla gane
    // la cascada. La transición sigue siendo del CSS.
    if (raya) raya.style.strokeDashoffset = callado ? '0' : '26';
  };

  btn.addEventListener('click', () => {
    const nuevo = !avisosSilenciados();
    try { localStorage.setItem(CAMPANA_KEY, nuevo ? '1' : '0'); } catch (_) {}
    pintar();
  });

  pintar();
}

montarCampana();
