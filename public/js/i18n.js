// comparTICKET — i18n auto-detect ES/EN
const translations = {
  es: {
    brand: 'compar',
    brandAccent: 'TICKET',
    subtitle: 'Divide la cuenta en segundos',
    uploadTitle: 'Escanea tu ticket',
    uploadHint: 'Haz una foto o elige de la galería',
    scanBtn: 'Escanear',
    retakeBtn: 'Repetir',
    processing: 'Imprimiendo ticket',
    editTitle: 'Revisa los ítems',
    addItem: '+ Añadir línea',
    total: 'Total',
    perPerson: 'Por persona a partes iguales',
    shareBtn: 'Compartir enlace',
    shareTitle: 'Comparte con tus amigos',
    shareHint: 'Marca lo tuyo',
    copyLink: 'Copiar enlace',
    copied: '¡Enlace copiado!',
    share: 'Compartir',
    viewSummary: 'Ver resumen',
    claimTitle: 'Marca lo tuyo',
    claimMine: 'Marcar lo mío',
    yourName: 'Tu nombre',
    yourNamePlaceholder: 'Tu nombre real, evita apodos',
    confirm: 'Confirmar selección',
    summaryTitle: 'Resumen de los pagos pendientes',
    people: 'Personas',
    paid: 'Pagado',
    unpaid: 'Pendiente',
    paymentStatus: 'Estado del pago',
    closeBtn: 'Cerrar cuenta',
    closed: 'CERRADA',
    open: 'PENDIENTE',
    closedMsg: '¡Cuenta cerrada!',
    refresh: 'Actualizar',
    shareImage: 'Compartir resumen',
    downloadImage: 'Descargar imagen',
    noOneYet: 'Aún nadie ha seleccionado',
    back: 'Atrás',
    sendReminder: 'Enviar recordatorio',
    downloadInvoice: 'Descargar factura',
    items: 'ítems',
    restaurant: 'Restaurante',
    date: 'Fecha',
    colItem: 'Ítem',
    colQty: 'Ud.',
    colUnit: 'P/ud.',
    colTotal: 'Total',
    itemName: 'Nombre del ítem',
    payer: 'PAGADOR',
    payerLabel: 'QUIÉN PAGÓ',
    shared: 'COMPARTIDO',
    sharedWith: 'compartido con',
    tutTitle: '¿Cómo funciona?',
    tut1: 'Haz o sube una o varias fotos de un mismo ticket o factura.',
    tut2: 'La app leerá todos los artículos o platos automáticamente.',
    tut3: 'Comparte el enlace con tus amigos para que cada persona marque lo suyo.',
    addMore: 'Añadir otra foto',
    continueBtn: 'Continuar',
    participants: 'PARTICIPANTES',
    participantsHint: '¿Cuántas personas van a participar? (incluyéndote)',
    participantsShort: 'Participantes',
    waitingFor: 'Faltan',
    ofN: 'de',
    allReady: '¡Todos listos!',
    unit: 'Ud.',
    mineBadge: 'tú',
    sharedBadge: 'compartida',
    pickUnitsHint: 'Toca las unidades que has consumido',
    perUnit: '/ud',
    needParticipants: 'Indica el nº de participantes',
    needPayer: 'Indica quién pagó la cuenta',
    sharing: 'Generando enlace…',
    shareFailed: 'No se ha podido compartir. Inténtalo otra vez.',
    downloadOnlyClosed: 'Podrás descargarla cuando la cuenta esté cerrada',
    waitingParticipants: 'Esperando a que participen todos',
    ctut1: 'Escribe tu nombre real arriba — sin apodos, así tus amigos te identifican.',
    ctut2: 'Toca las píldoras de cada artículo según las unidades que has consumido.',
    ctut3: 'Si una unidad ya tiene el nombre de otra persona, al tocarla se compartirá automáticamente entre vosotros.',
    onlyCreatorCanClose: 'Solo quien creó el ticket puede cerrarlo',
    cameraLabel: 'Cámara',
    galleryLabel: 'Galería',
    // Cuadre de la cuenta
    sumLines: 'Suma líneas',
    mismatchFalta: 'El total del ticket es mayor que la suma de las líneas. Revisa los importes de arriba o elige:',
    mismatchSobra: 'Las líneas suman más que el total del ticket. Revisa los importes de arriba o elige:',
    mmAddLine: 'Añadir la diferencia como línea',
    mmUseSum: 'Usar la suma como total',
    adjustmentName: 'Servicio / otros',
    discountName: 'Descuento',
    unassigned: 'Faltan por marcar',
    claimedSum: 'Suma de lo marcado',
    showPending: 'Ver qué falta por marcar',
    pendingHint: 'Quedan {n} unidades sin marcar, señaladas en rojo',
    reviewHelpTitle: '¿Falta algo o no cuadra?',
    reviewHelpBody: 'Si falta algún artículo en la lista, o el total no cuadra con la suma de líneas, añade las líneas a mano con «+ Añadir línea» \no vuelve atrás y escanea la foto otra vez.',
    allAssigned: 'Todo marcado y asignado',
    cantCloseUnassigned: 'Quedan {x}€ sin asignar. Nadie los está pagando.',
    itemsLocked: 'Ya hay gente que ha marcado lo suyo — los artículos ya no se pueden cambiar.',
    // Tiempo real
    picking: '· eligiendo',
    each: 'cada uno',
    stillPicking: 'eligiendo ahora',
    tipFirstPill: 'Toca las unidades que hayas tomado',
    askName: '¿Cómo te llamas?',
    rotate: 'Girar',
    nameTaken: 'Ya hay una selección guardada a nombre de «{name}».',
    nameTakenMine: 'Soy yo',
    nameTakenOther: 'Soy otra persona',
    nameTakenPickAnother: 'Escribe tu nombre para marcar lo tuyo',
    markingAs: 'Marcando como',
    notMe: 'No soy yo'
  },
  en: {
    brand: 'compar',
    brandAccent: 'TICKET',
    subtitle: 'Split the bill in seconds',
    uploadTitle: 'Scan your receipt',
    uploadHint: 'Take a photo or pick from gallery',
    scanBtn: 'Scan',
    retakeBtn: 'Retake',
    processing: 'Printing ticket',
    editTitle: 'Review items',
    addItem: '+ Add line',
    total: 'Total',
    perPerson: 'Per person, split evenly',
    shareBtn: 'Share link',
    shareTitle: 'Share with friends',
    shareHint: 'Pick what you had',
    copyLink: 'Copy link',
    copied: 'Link copied!',
    share: 'Share',
    viewSummary: 'View summary',
    claimTitle: 'Pick yours',
    claimMine: 'Pick mine',
    yourName: 'Your name',
    yourNamePlaceholder: 'Your real name, avoid nicknames',
    confirm: 'Confirm selection',
    summaryTitle: 'Pending payments summary',
    people: 'People',
    paid: 'Paid',
    unpaid: 'Unpaid',
    paymentStatus: 'Payment Status',
    closeBtn: 'Close bill',
    closed: 'CLOSED',
    open: 'UNPAID',
    closedMsg: 'Bill closed!',
    refresh: 'Refresh',
    shareImage: 'Share summary',
    downloadImage: 'Download image',
    noOneYet: 'Nobody has selected yet',
    back: 'Back',
    sendReminder: 'Send Reminder',
    downloadInvoice: 'Download Invoice',
    items: 'items',
    restaurant: 'Restaurant',
    date: 'Date',
    colItem: 'Item',
    colQty: 'Qty',
    colUnit: 'Unit',
    colTotal: 'Total',
    itemName: 'Item name',
    payer: 'PAYER',
    payerLabel: 'WHO PAID',
    shared: 'SHARED',
    sharedWith: 'shared with',
    tutTitle: 'How does it work?',
    tut1: 'Take or upload one or several photos of the same receipt or invoice.',
    tut2: 'The app will read every item automatically.',
    tut3: 'Share the link with your friends so each person can pick their items.',
    addMore: 'Add another photo',
    continueBtn: 'Continue',
    participants: 'PARTICIPANTS',
    participantsHint: 'How many people will participate? (including you)',
    participantsShort: 'Participants',
    waitingFor: 'Waiting for',
    ofN: 'of',
    allReady: 'All ready!',
    unit: 'U.',
    mineBadge: 'you',
    sharedBadge: 'shared',
    pickUnitsHint: 'Tap the units you had',
    perUnit: '/unit',
    needParticipants: 'Set the nº of participants',
    needPayer: 'Set who paid the bill',
    sharing: 'Creating link…',
    shareFailed: "Couldn't share. Try again.",
    downloadOnlyClosed: "You'll be able to download it once the bill is closed",
    waitingParticipants: 'Waiting for everyone to join',
    ctut1: 'Enter your real name above — no nicknames, so your friends recognize you.',
    ctut2: 'Tap the pills of each item for the units you consumed.',
    ctut3: 'If a unit already has someone else\u2019s name, tapping it shares that unit between you both.',
    onlyCreatorCanClose: 'Only the ticket creator can close it',
    cameraLabel: 'Camera',
    galleryLabel: 'Gallery',
    // Bill reconciliation
    sumLines: 'Lines sum',
    mismatchFalta: 'The receipt total is higher than the sum of the lines. Check the amounts above or pick one:',
    mismatchSobra: 'The lines add up to more than the receipt total. Check the amounts above or pick one:',
    mmAddLine: 'Add the difference as a line',
    mmUseSum: 'Use the sum as the total',
    adjustmentName: 'Service / other',
    discountName: 'Discount',
    unassigned: 'Left to mark',
    claimedSum: 'Marked so far',
    showPending: 'See what is left to mark',
    pendingHint: '{n} units left to mark, highlighted in red',
    reviewHelpTitle: "Something missing or doesn't add up?",
    reviewHelpBody: "If an item is missing from the list, or the total doesn't match the sum of lines, add lines by hand with «+ Add line» — or go back and scan the photo again.",
    allAssigned: 'All marked and assigned',
    cantCloseUnassigned: '{x}€ still unassigned. Nobody is paying for it.',
    itemsLocked: 'People have already picked their items — the list can no longer be changed.',
    // Live updates
    picking: '· picking',
    each: 'each',
    stillPicking: 'picking now',
    tipFirstPill: 'Tap the units you had',
    askName: "What's your name?",
    rotate: 'Rotate',
    nameTaken: 'There is already a selection saved under «{name}».',
    nameTakenMine: "That's me",
    nameTakenOther: "I'm someone else",
    nameTakenPickAnother: 'Type your name to pick your items',
    markingAs: 'Picking as',
    notMe: 'Not me'
  }
};

function detectLang() {
  const n = navigator.language || navigator.userLanguage || 'en';
  return n.startsWith('es') ? 'es' : 'en';
}

const lang = detectLang();
const t = translations[lang];

/**
 * Termina la animación de "el ticket sale de la impresora" sin recortar nada.
 *
 * La animación crece el `max-height` desde 0, y como es `forwards` el valor
 * final se queda fijo para siempre. Con un tope fijo, cualquier ticket más
 * largo quedaba cortado de forma permanente — se comía el total en la pantalla
 * de revisión y media lista en la de marcar.
 *
 * Aquí se mide el alto real del contenido y se pasa al CSS, y en cuanto
 * termina la animación se le quitan todas las ataduras al ticket.
 *
 * Hay que llamarla DESPUÉS de pintar el contenido, y otra vez si el contenido
 * cambia de alto mientras aún se está imprimiendo (añadir una línea, desplegar
 * la ayuda).
 */
function fitTicket(el) {
  el = el || document.getElementById('ticket');
  if (!el) return;

  // Ya terminó: no hay nada que atar.
  if (el.classList.contains('printed')) return;

  const liberar = () => {
    el.classList.add('printed');
    el.classList.remove('printing');
  };

  if (!el.classList.contains('printing')) return liberar();

  // scrollHeight ignora el max-height que impone la animación, así que da el
  // alto de verdad del contenido. El margen extra evita que un redondeo deje
  // la última línea a medias.
  const alto = el.scrollHeight + 40;
  el.style.setProperty('--ticket-h', alto + 'px');

  if (!el.dataset.fitBound) {
    el.dataset.fitBound = '1';
    el.addEventListener('animationend', e => {
      if (e.animationName === 'ticketEmerge') liberar();
    });
    // Red de seguridad: si la animación no llega a emitir el evento (pestaña
    // en segundo plano, `prefers-reduced-motion`, un navegador raro), el
    // ticket se libera igual. Nunca puede quedarse recortado.
    setTimeout(liberar, 4200);
  }
}
