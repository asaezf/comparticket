// comparTICKET — crear un grupo (viaje, piso compartido)
//
// Un grupo tiene una LISTA CERRADA de miembros, y esa es la decisión de diseño
// que sostiene todo lo demás: dentro del grupo nadie escribe su nombre, lo
// toca de una lista. Así "Álvaro", "alvaro" y "Alvarito" no pueden acabar
// siendo tres personas distintas al cuadrar el viaje.

let miembros = [];

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

/** Se recuerda el nombre habitual para proponerlo como primer miembro: quien
 *  crea el grupo casi siempre va en él. */
function nombreHabitual() {
  try { return localStorage.getItem('ct_name') || ''; } catch (_) { return ''; }
}

function pintar() {
  const cont = document.getElementById('memberChips');
  cont.innerHTML = '';
  miembros.forEach((nombre, i) => {
    const chip = document.createElement('span');
    chip.className = 'member-chip';
    chip.innerHTML = esc(nombre) + '<button type="button" title="Quitar">&times;</button>';
    chip.querySelector('button').addEventListener('click', () => {
      miembros.splice(i, 1);
      pintar();
    });
    cont.appendChild(chip);
  });

  // Hacen falta un nombre de grupo y al menos dos personas: un grupo de uno no
  // reparte nada.
  const nombre = document.getElementById('groupNameInput').value.trim();
  document.getElementById('createBtn').disabled = !nombre || miembros.length < 2;

  fitTicket();
}

function anadirMiembro() {
  const input = document.getElementById('memberInput');
  const nombre = input.value.trim();
  if (!nombre) return input.focus();

  // Dos personas con el mismo nombre harían que sus gastos se sumaran como si
  // fueran una sola, y el viaje cuadraría mal sin que nadie lo notase.
  if (miembros.some(m => m.toLowerCase() === nombre.toLowerCase())) {
    toast('Ese nombre ya está en el grupo');
    input.select();
    return;
  }
  if (miembros.length >= 50) return toast('Demasiada gente para un grupo');

  miembros.push(nombre);
  input.value = '';
  input.focus();
  pintar();
}

document.getElementById('addMemberBtn').addEventListener('click', anadirMiembro);

// Enter añade, que es como espera cualquiera escribir una lista seguida.
document.getElementById('memberInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); anadirMiembro(); }
});

document.getElementById('groupNameInput').addEventListener('input', pintar);

document.getElementById('createBtn').addEventListener('click', async () => {
  const btn = document.getElementById('createBtn');
  if (btn.disabled) return;

  const name = document.getElementById('groupNameInput').value.trim();
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creando…';

  try {
    const r = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, members: miembros })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'No se ha podido crear el grupo');
    }
    const data = await r.json();

    // La clave de creador se guarda en este móvil, igual que con los tickets.
    try { localStorage.setItem('gk_' + data.group.id, data.creatorKey); } catch (_) {}

    window.location.href = data.redirect || ('/g/' + data.group.id);
  } catch (e) {
    // Un corte de red llega como TypeError y ese mensaje no le dice nada a nadie.
    toast(e instanceof TypeError ? 'Sin conexión. Inténtalo otra vez.' : e.message);
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
});

// Arranque: se propone el nombre de quien crea, para no empezar en blanco.
const habitual = nombreHabitual();
if (habitual) miembros.push(habitual);
pintar();
document.getElementById('groupNameInput').focus();

Tour.iniciar('newgroup', [
  {
    selector: '#groupNameInput',
    titulo: t.tourNewGroupNameTitle,
    cuerpo: t.tourNewGroupNameBody
  },
  {
    selector: '#memberInput',
    titulo: t.tourNewGroupMembersTitle,
    cuerpo: t.tourNewGroupMembersBody
  }
]);
