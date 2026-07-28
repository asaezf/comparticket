// comparTICKET — cálculo del dinero
//
// Toda la aritmética de la cuenta vive aquí y en ningún otro sitio, porque es
// lo único de la app que la gente se paga entre sí. Lo usan el servidor (para
// no dejar compartir ni cerrar cuentas que no cuadran) y el navegador (para
// enseñar el descuadre en pantalla). Sin dependencias a propósito.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Money = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Un céntimo de margen: con precios unitarios derivados de una división
  // (3 cafés a 2,25 € → 0,75 €) el redondeo a 2 decimales puede desviar algo.
  const TOL = 0.02;

  const round2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;

  /**
   * Importe con el formato del país. En español la coma es el separador
   * decimal y el símbolo va detrás con espacio: "20,00 €". Escribir "20.00€"
   * en una app española canta muchísimo, y esto sale impreso en la imagen que
   * la gente comparte.
   */
  function formatEUR(n, lang) {
    const v = round2(+n || 0);
    if (lang === 'en') return `€${v.toFixed(2)}`;
    return `${v.toFixed(2).replace('.', ',')} €`;
  }

  /** Suma de las líneas del ticket. */
  function itemsSum(items) {
    if (!Array.isArray(items)) return 0;
    return round2(items.reduce((s, i) => {
      const qty = +i.quantity || 0;
      const unit = +i.unitPrice || 0;
      return s + qty * unit;
    }, 0));
  }

  /**
   * ¿Cuadra el ticket extraído? delta > 0 significa que el total del ticket es
   * mayor que la suma de las líneas: falta algo por desglosar (servicio,
   * cubierto, una línea que la IA no leyó). delta < 0 suele ser un descuento.
   */
  function reconcileTicket(items, total) {
    const sum = itemsSum(items);
    const declared = round2(+total || 0);
    const delta = round2(declared - sum);
    return {
      sum,
      total: declared,
      delta,
      balanced: Math.abs(delta) <= TOL,
      kind: Math.abs(delta) <= TOL ? 'ok' : (delta > 0 ? 'falta' : 'sobra')
    };
  }

  /** Normaliza un claim a { [itemId]: [índices de unidad] }. */
  function unitsFromClaim(claim) {
    const out = {};
    if (!claim) return out;
    if (claim.itemUnits && typeof claim.itemUnits === 'object') {
      Object.keys(claim.itemUnits).forEach(id => {
        const arr = claim.itemUnits[id];
        if (Array.isArray(arr) && arr.length) out[id] = arr.slice();
      });
      return out;
    }
    if (claim.itemCounts) {
      Object.keys(claim.itemCounts).forEach(id => {
        out[id] = Array.from({ length: +claim.itemCounts[id] || 0 }, (_, u) => u);
      });
    } else if (Array.isArray(claim.itemIds)) {
      claim.itemIds.forEach(id => { out[id] = [0]; });
    }
    return out;
  }

  /**
   * Reparto por unidad: cada unidad reclamada se divide entre quienes la
   * marcaron. Devuelve lo que paga cada persona y cuánto queda sin asignar.
   *
   * Una unidad que nadie ha marcado queda "sin asignar" — es exactamente el
   * dinero que hoy se come el pagador en silencio.
   */
  function splitByUnits(items, claims) {
    const list = Array.isArray(items) ? items : [];
    const all = Array.isArray(claims) ? claims : [];

    // unitClaimants[itemId][unidad] = [nombres]
    const unitClaimants = {};
    all.forEach(c => {
      const units = unitsFromClaim(c);
      Object.keys(units).forEach(id => {
        if (!unitClaimants[id]) unitClaimants[id] = {};
        units[id].forEach(u => {
          if (!unitClaimants[id][u]) unitClaimants[id][u] = [];
          if (!unitClaimants[id][u].includes(c.personName)) {
            unitClaimants[id][u].push(c.personName);
          }
        });
      });
    });

    const perPerson = {};
    all.forEach(c => { perPerson[c.personName] = 0; });

    let assigned = 0;
    let unclaimedUnits = 0;

    list.forEach(item => {
      const qty = Math.max(1, +item.quantity || 1);
      const unit = +item.unitPrice || 0;
      for (let u = 0; u < qty; u++) {
        const claimants = (unitClaimants[item.id] && unitClaimants[item.id][u]) || [];
        if (claimants.length === 0) {
          unclaimedUnits += 1;
          continue;
        }
        const share = unit / claimants.length;
        claimants.forEach(name => {
          perPerson[name] = (perPerson[name] || 0) + share;
        });
        assigned += unit;
      }
    });

    Object.keys(perPerson).forEach(n => { perPerson[n] = round2(perPerson[n]); });
    return { perPerson, assigned: round2(assigned), unclaimedUnits };
  }

  /** Solo quien ha pulsado "Confirmar". Los claims viejos no llevan el campo. */
  function confirmedOnly(claims) {
    return (Array.isArray(claims) ? claims : []).filter(c => c && c.confirmed !== false);
  }

  /**
   * ¿Se puede cerrar la cuenta? Solo si lo que paga la gente suma el total
   * del ticket. Compara contra el total declarado, no contra la suma de
   * líneas, porque el total es lo que de verdad cobró el establecimiento.
   *
   * Cuenta únicamente los claims confirmados: quien sigue eligiendo puede
   * cerrar la app sin terminar, y ese dinero no lo está pagando nadie todavía.
   */
  function reconcileClaims(items, total, claims) {
    const { perPerson, assigned, unclaimedUnits } = splitByUnits(items, confirmedOnly(claims));
    const declared = round2(+total || 0);
    const pending = round2(declared - assigned);
    return {
      perPerson,
      assigned,
      total: declared,
      pending,
      unclaimedUnits,
      balanced: Math.abs(pending) <= TOL
    };
  }

  /**
   * Línea de ajuste para absorber un descuadre del ticket (servicio, cubierto,
   * propina o descuento) como un artículo más, repartible entre la gente.
   */
  function adjustmentItem(items, delta, label) {
    const maxId = (Array.isArray(items) ? items : [])
      .reduce((m, i) => Math.max(m, +i.id || 0), 0);
    const amount = round2(delta);
    return {
      id: maxId + 1,
      name: label || (amount >= 0 ? 'Servicio / otros' : 'Descuento'),
      quantity: 1,
      unitPrice: amount,
      totalPrice: amount,
      shared: true,
      isAdjustment: true
    };
  }

  return {
    TOL, round2, formatEUR, itemsSum, reconcileTicket, confirmedOnly,
    unitsFromClaim, splitByUnits, reconcileClaims, adjustmentItem
  };
});
