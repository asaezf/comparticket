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

    // Si se venia de un grupo ("escanear un ticket" desde su pantalla), el
    // ticket recien creado se mete dentro. Si esta llamada fallase, el ticket
    // sigue existiendo suelto y se puede asignar despues: no se pierde nada.
    if (grupoDestino && data.id) {
      try {
        await fetch('/api/tickets/' + data.id + '/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: grupoDestino })
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
// En Android el navegador avisa con `beforeinstallprompt` cuando se puede
// instalar, y entonces se ensena el boton: al tocarlo sale el dialogo del
// sistema. En iPhone eso NO existe —Apple no da ninguna API para provocarlo—
// asi que alli lo unico posible es explicar los dos toques que hay que dar.
//
// Y si ya esta instalada no se ensena nada: la aplicacion se abre en modo
// standalone, y ofrecer instalar algo que ya tienes solo confunde.
// =========================================================================

let promesaDeInstalar = null;

function yaEstaInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

function esIphone() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

function montarAtajo() {
  const caja = document.getElementById('atajo');
  const btn = document.getElementById('atajoBtn');
  if (!caja || !btn) return;

  const tit = document.getElementById('atajoTitulo');
  const sub = document.getElementById('atajoSub');

  if (yaEstaInstalada()) { caja.classList.add('hidden'); return; }

  if (esIphone()) {
    // Sin dialogo posible: se explica y se acabo.
    tit.textContent = t.addToHome;
    sub.textContent = t.addToHomeIos;
    btn.classList.add('solo-texto');
    caja.classList.remove('hidden');
    return;
  }

  // Android y escritorio: el boton solo aparece si el navegador dice que se
  // puede instalar. Sin eso, tocarlo no haria nada.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promesaDeInstalar = e;
    tit.textContent = t.addToHome;
    sub.textContent = t.addToHomeSub;
    caja.classList.remove('hidden');
  });

  btn.addEventListener('click', async () => {
    if (!promesaDeInstalar) return;
    promesaDeInstalar.prompt();
    try { await promesaDeInstalar.userChoice; } catch (_) {}
    promesaDeInstalar = null;
    caja.classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => caja.classList.add('hidden'));
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
