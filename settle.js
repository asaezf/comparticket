// comparTICKET — cuadre de un grupo
//
// Un grupo (un viaje, un piso compartido) acumula muchos tickets y gastos a lo
// largo de días. Al final nadie quiere "cada uno le paga a cada uno": quiere
// saber el MÍNIMO de transferencias que salda a todo el mundo.
//
// Este fichero no sabe nada de tickets, artículos ni unidades. Recibe hechos ya
// masticados —quién puso dinero y quién consumió cuánto— y devuelve saldos y
// transferencias. Así el cálculo del reparto dentro de cada ticket sigue
// viviendo íntegro en money.js, que ya está probado, y aquí solo se suma.
//
// Lo usan el servidor (para no fiarse del navegador) y el navegador (para
// pintar sin esperar), igual que money.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Settle = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Mismo margen que money.js: los repartos salen de divisiones y el redondeo
  // a céntimos puede desviar un pelo.
  const TOL = 0.02;
  const round2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;

  /** Normaliza un nombre para compararlo. En un grupo los nombres vienen de
   *  una lista cerrada, pero esto protege de datos antiguos o de un espacio
   *  de más escrito a mano. */
  function key(nombre) {
    return String(nombre == null ? '' : nombre).trim().toLowerCase();
  }

  /**
   * Saldo de cada persona del grupo.
   *
   *   saldo > 0  → puso más de lo que consumió: LE DEBEN
   *   saldo < 0  → consumió más de lo que puso: DEBE
   *
   * `apuntes` es la lista de cosas que han costado dinero. Cada una:
   *   { pagador: 'Álvaro', total: 84.5, reparto: { 'Álvaro': 20, 'Nerea': 64.5 } }
   *
   * `reparto` es exactamente lo que devuelve Money.splitByUnits para un ticket,
   * o el reparto a partes iguales de un gasto suelto. Aquí da igual de dónde
   * venga.
   *
   * `pagos` son las liquidaciones YA hechas entre personas:
   *   { de: 'Nerea', a: 'Álvaro', importe: 64.5 }
   * Restan de la deuda, porque ese dinero ya cambió de manos.
   */
  function computeBalances(apuntes, pagos, miembros) {
    const saldos = {};
    const nombreReal = {};

    // Todos los miembros aparecen aunque no hayan tocado nada: un grupo con
    // alguien a cero tiene que verse, no desaparecer de la lista.
    (miembros || []).forEach(m => {
      const n = typeof m === 'string' ? m : (m && m.name);
      if (!n) return;
      saldos[key(n)] = 0;
      nombreReal[key(n)] = n;
    });

    const anota = (nombre, delta) => {
      const k = key(nombre);
      if (!k) return;
      if (!(k in saldos)) { saldos[k] = 0; nombreReal[k] = nombre; }
      saldos[k] += delta;
    };

    (apuntes || []).forEach(a => {
      if (!a) return;
      const total = +a.total || 0;
      // Quien pagó adelantó el dinero de todos.
      anota(a.pagador, total);
      // Y cada uno carga con lo suyo.
      const reparto = a.reparto || {};
      Object.keys(reparto).forEach(n => anota(n, -(+reparto[n] || 0)));
    });

    // Un pago salda deuda: quien paga sube su saldo, quien cobra lo baja.
    (pagos || []).forEach(p => {
      if (!p) return;
      const importe = +p.importe || 0;
      anota(p.de, importe);
      anota(p.a, -importe);
    });

    const out = {};
    Object.keys(saldos).forEach(k => { out[nombreReal[k]] = round2(saldos[k]); });
    return out;
  }

  /**
   * El mínimo de transferencias que deja a todos a cero.
   *
   * Se empareja siempre al que más debe con al que más le deben, y se salda lo
   * máximo posible de una vez. Cada transferencia deja al menos a una de las
   * dos personas saldada, así que con N personas nunca salen más de N-1 pagos
   * — frente a los ~N²/2 de "cada uno le paga a cada uno".
   *
   * Con 6 personas: 5 pagos en lugar de 15.
   */
  function minimalTransfers(saldos) {
    const acreedores = [];   // les deben
    const deudores = [];     // deben

    Object.keys(saldos || {}).forEach(nombre => {
      const v = round2(saldos[nombre]);
      if (v > TOL) acreedores.push({ nombre, importe: v });
      else if (v < -TOL) deudores.push({ nombre, importe: -v });
    });

    // De mayor a menor. El desempate por nombre hace que el resultado sea
    // siempre el mismo: si cambiara de orden entre dos recargas, la gente
    // pensaría que la app se lo está inventando.
    const porImporte = (a, b) => b.importe - a.importe || a.nombre.localeCompare(b.nombre);
    acreedores.sort(porImporte);
    deudores.sort(porImporte);

    const transferencias = [];
    let i = 0, j = 0;
    // Tope de seguridad: sin él, un saldo que no baja por un redondeo raro
    // dejaría el bucle girando para siempre y colgaría la pantalla.
    let vueltas = 0;
    const MAX = 10000;

    while (i < deudores.length && j < acreedores.length && vueltas++ < MAX) {
      const debe = deudores[i], cobra = acreedores[j];
      const importe = round2(Math.min(debe.importe, cobra.importe));

      if (importe > TOL) {
        transferencias.push({ de: debe.nombre, a: cobra.nombre, importe });
      }

      debe.importe = round2(debe.importe - importe);
      cobra.importe = round2(cobra.importe - importe);
      if (debe.importe <= TOL) i++;
      if (cobra.importe <= TOL) j++;
    }

    return transferencias;
  }

  /**
   * Reparto a partes iguales de un gasto sin ticket (el taxi, las entradas).
   *
   * Los céntimos que sobran de la división NO se pierden: se reparten de uno en
   * uno entre los primeros. 10 € entre 3 son 3,34 / 3,33 / 3,33, no 3,33 tres
   * veces — que dejaría un céntimo sin pagar y el grupo no cuadraría nunca.
   */
  function splitEqually(importe, entre) {
    const gente = (entre || []).filter(Boolean);
    const out = {};
    if (!gente.length) return out;

    const totalCent = Math.round((+importe || 0) * 100);
    const base = Math.trunc(totalCent / gente.length);
    let resto = totalCent - base * gente.length;   // conserva el signo

    const paso = resto >= 0 ? 1 : -1;
    gente.forEach(nombre => {
      let cent = base;
      if (resto !== 0) { cent += paso; resto -= paso; }
      out[nombre] = round2(cent / 100);
    });
    return out;
  }

  /** ¿Está el grupo saldado? Todos a cero dentro del margen. */
  function isSettled(saldos) {
    return Object.keys(saldos || {}).every(n => Math.abs(saldos[n]) <= TOL);
  }

  /**
   * Cuánto dinero ha movido el grupo y quién ha adelantado más.
   * Sirve para la pantalla de resumen del viaje.
   */
  function groupStats(apuntes) {
    let total = 0;
    const puestoPor = {};
    (apuntes || []).forEach(a => {
      if (!a) return;
      const t = +a.total || 0;
      total += t;
      const k = a.pagador || '';
      if (k) puestoPor[k] = round2((puestoPor[k] || 0) + t);
    });
    return { total: round2(total), puestoPor, apuntes: (apuntes || []).length };
  }

  return {
    TOL,
    computeBalances,
    minimalTransfers,
    splitEqually,
    isSettled,
    groupStats
  };
});
