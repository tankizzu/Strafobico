/* =====================================================================
   Strafobico — dati sul dispositivo e calcoli (funziona anche offline)
   Tutto quello che prima faceva lo script di Google qui avviene sul telefono:
   turni, tipi di turno, impostazioni, calcolo ore/straordinari/paga, ferie, buste paga.
   La sincronizzazione con il proprio account Google è in google.js.
   ===================================================================== */
(function (glob) {
  'use strict';

  /* ---------------- costanti (uguali al foglio Google) ---------------- */
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const IMPOSTAZIONI = [
    ['paga', 'Paga oraria lorda (€)', '10', 'Paga base oraria del tuo contratto (la trovi in busta paga)'],
    ['oreMese', 'Ore mensili (oltre scatta lo straordinario)', '', 'Ore da contratto in un mese: ogni ora lavorata in più nel mese è straordinario. Vuoto = nessuno straordinario'],
    ['pStra', 'Maggiorazione straordinario (%)', '25', 'Scrivi 25 per +25%'],
    ['pFest', 'Maggiorazione festiva (%)', '30', 'Applicata a tutte le ore lavorate in un giorno festivo'],
    ['domenica', 'Domenica come festivo', 'Sì', 'Sì / No'],
    ['locali', 'Festività locali (gg/mm)', '', 'Es. santo patrono 24/06 — più date separate da virgola'],
    ['tratt', 'Trattenute stimate per il netto (%)', '30', 'Stima di contributi e IRPEF: confrontala con una tua busta paga e correggila'],
    ['nomeTab', 'Il tuo nome nella tabella turni', '', 'Usato dall\'importazione da immagine: scrivilo come compare nella tabella'],
    ['calId', 'ID calendario turni', '', 'Compilato in automatico'],
    ['ferieUnita', 'Ferie contate in', 'giorni', 'giorni / ore (come in busta paga)'],
    ['ferieAnno', 'Ferie all\'anno', '26', 'Dal contratto, nell\'unità scelta sopra'],
    ['ferieResiduo', 'Ferie residue dell\'anno prima', '0', 'Ferie non godute che porti nell\'anno in corso'],
    ['ferieSabato', 'Il sabato conta come ferie', 'Sì', 'No = settimana corta (lun-ven)'],
    ['ferieSaldo', 'Saldo ferie dall\'ultima busta paga', '', 'Compilato quando carichi una busta paga'],
    ['ferieSaldoMese', 'Mese di quel saldo (aaaa-mm)', '', 'Compilato quando carichi una busta paga'],
    ['rolSaldo', 'Permessi ROL residui', '', 'Dall\'ultima busta paga (o scritti a mano)'],
    ['exfestSaldo', 'Ex festività residue', '', 'Festività soppresse / non godute, dall\'ultima busta paga'],
    ['permUnita', 'Permessi contati in', 'ore', 'ore / giorni'],
    ['permSaldoMese', 'Mese dei saldi permessi (aaaa-mm)', '', 'Compilato quando carichi una busta paga'],
  ];
  const CHIAVI_DAL_PANNELLO = ['nomeTab', 'oreMese', 'paga', 'pStra', 'pFest', 'domenica', 'locali', 'tratt', 'ferieAnno', 'ferieResiduo', 'ferieUnita', 'ferieSabato'];
  // Nome | Sigla | Inizio | Fine | Pausa | Categoria | Ore | Colore (1-11) | Icona | Attivo
  const INTESTAZIONI_TIPI = ['Nome', 'Sigla', 'Inizio', 'Fine', 'Pausa (min)', 'Categoria', 'Ore (assenze / predefinite)', 'Colore (1-11)', 'Icona', 'Attivo'];
  const TIPI_DEFAULT = [
    ['Mattino', 'M', '08:00', '13:00', 0, 'Lavoro', '', 5, '☀️', 'Sì'],
    ['Pomeriggio', 'P', '14:00', '19:00', 0, 'Lavoro', '', 6, '🌇', 'Sì'],
    ['Corso', 'C', '', '', 0, 'Ore variabili', 4, 3, '📚', 'Sì'],
    ['Ferie', 'F', '', '', 0, 'Retribuita', 6, 10, '🏖️', 'Sì'],
  ];
  const CATEGORIE = ['Lavoro', 'Ore variabili', 'Retribuita', 'Non retribuita', 'Riposo'];
  const COLORI = { 1: '#7986CB', 2: '#33B679', 3: '#8E24AA', 4: '#E67C73', 5: '#F6BF26', 6: '#F4511E', 7: '#039BE5', 8: '#616161', 9: '#3F51B5', 10: '#0B8043', 11: '#D50000' };

  /* ---------------- utilità ---------------- */
  const pad2 = n => String(n).padStart(2, '0');
  const num = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v == null ? '' : v).replace(/[^\d,.\-]/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  const toMin = v => {
    if (v == null || v === '') return null;
    const m = String(v).match(/(\d{1,2})(?:[:.,h](\d{2}))?/); if (!m) return null;
    const h = +m[1], mi = +(m[2] || 0); if (h > 24 || mi > 59) return null;
    return (h % 24) * 60 + mi;
  };
  const fmtMin = min => pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
  const oggiIso = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const annoCorrente = () => new Date().getFullYear();
  const festiviLocali = str => { const out = []; String(str || '').replace(/(\d{1,2})[\/.\-](\d{1,2})/g, (_, d, m) => { out.push(pad2(m) + '-' + pad2(d)); return ''; }); return out; };
  const contrasto = hex => { const h = String(hex).replace('#', ''); const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#000000' : '#ffffff'; };
  const r2 = v => Math.round(v * 100) / 100;
  const copia = o => JSON.parse(JSON.stringify(o));

  function pasqua(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
  }
  function festivitaNome(iso, s) {
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10), md = iso.slice(5);
    const fisse = { '01-01': 'Capodanno', '01-06': 'Epifania', '04-25': 'Festa della Liberazione', '05-01': 'Festa del Lavoro', '06-02': 'Festa della Repubblica',
      '08-15': 'Ferragosto', '11-01': 'Ognissanti', '12-08': 'Immacolata Concezione', '12-25': 'Natale', '12-26': 'Santo Stefano' };
    if (fisse[md]) return fisse[md];
    if (y >= 2026 && md === '10-04') return 'San Francesco d\'Assisi';
    const p = pasqua(y), pq = new Date(p.getTime() + 864e5);
    if (p.getUTCMonth() + 1 === m && p.getUTCDate() === d) return 'Pasqua';
    if (pq.getUTCMonth() + 1 === m && pq.getUTCDate() === d) return 'Lunedì dell\'Angelo (Pasquetta)';
    if (s.locali.indexOf(md) >= 0) return 'Festività locale';
    return null;
  }
  const giornoSett = iso => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();
  const isFestivo = (iso, s) => (s.domenica && giornoSett(iso) === 0) || !!festivitaNome(iso, s);
  const giornoFerie = (iso, s) => { const w = giornoSett(iso); return w !== 0 && !festivitaNome(iso, s) && !(w === 6 && !s.ferieSabato); };

  /* ---------------- archivio sul dispositivo (IndexedDB) ---------------- */
  const DB_NOME = 'strafobico', DB_VER = 1;
  let dbProm = null;
  function db() {
    if (dbProm) return dbProm;
    dbProm = new Promise((ok, ko) => {
      if (!glob.indexedDB) return ok(null);
      const r = indexedDB.open(DB_NOME, DB_VER);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); if (!d.objectStoreNames.contains('file')) d.createObjectStore('file'); };
      r.onsuccess = () => ok(r.result); r.onerror = () => ok(null);
    });
    return dbProm;
  }
  const memoria = { kv: {}, file: {} }; // riserva se IndexedDB non c'è (es. navigazione privata)
  async function idbGet(store, k) {
    const d = await db(); if (!d) return memoria[store][k];
    return new Promise(ok => { const t = d.transaction(store).objectStore(store).get(k); t.onsuccess = () => ok(t.result); t.onerror = () => ok(undefined); });
  }
  async function idbSet(store, k, v) {
    const d = await db(); if (!d) { memoria[store][k] = v; return; }
    return new Promise(ok => { const t = d.transaction(store, 'readwrite'); if (v === undefined) t.objectStore(store).delete(k); else t.objectStore(store).put(v, k); t.oncomplete = ok; t.onerror = ok; });
  }

  /* ---------------- stato ---------------- */
  // D = tutti i dati dell'utente sul dispositivo
  let D = null;
  const vuoto = () => ({
    tipi: copia(TIPI_DEFAULT),
    imp: Object.fromEntries(IMPOSTAZIONI.map(r => [r[0], r[2]])),
    turni: [],          // { date, tipo, inizio, fine, pausa, oreMan, note, ev }
    buste: {},          // 'aaaa-mm' → { mese, lordo, trattenute, netto, ferie, unita, link, fileId, caricata }
    pref: {},           // vistoHome, nascondiSoldi
    pend: { giorni: {}, tipi: 0, imp: {}, buste: {}, evDel: [] }, // modifiche da mandare a Google (con l'ora della modifica)
    meta: { creato: Date.now() },
  });
  let salvaTimer = null, ascoltatori = [];
  async function carica() {
    if (D) return D;
    D = (await idbGet('kv', 'dati')) || null;
    if (!D) { D = vuoto(); D.meta.nuovo = true; await salva(); }
    // campi aggiunti nelle versioni successive
    const base = vuoto();
    Object.keys(base).forEach(k => { if (D[k] == null) D[k] = base[k]; });
    Object.keys(base.pend).forEach(k => { if (D.pend[k] == null) D.pend[k] = base.pend[k]; });
    IMPOSTAZIONI.forEach(r => { if (D.imp[r[0]] == null) D.imp[r[0]] = r[2]; });
    aggiungiFerieSeManca();
    return D;
  }
  function salva() { return idbSet('kv', 'dati', D); }
  function cambiato() { CALC = null; TIPI = null; salva(); ascoltatori.forEach(f => { try { f(); } catch (e) { } }); }
  /** Il tipo "Ferie" serve al conteggio ferie: se manca lo aggiungo (true se aggiunto). */
  function aggiungiFerieSeManca() {
    TIPI = null;
    if (tipoFerie(leggiTipi())) return false;
    D.tipi.push(['Ferie', siglaLibera(['F', 'FE', 'FER']), '', '', 0, 'Retribuita', 6, 10, '🏖️', 'Sì']);
    TIPI = null; return true;
  }
  const siglaLibera = lista => { const usate = D.tipi.map(r => String(r[1]).toUpperCase()); return lista.find(s => usate.indexOf(s) < 0) || 'FF'; };

  /* ---------------- lettura ---------------- */
  function leggiImpostazioni() {
    const raw = D.imp;
    return {
      paga: num(raw.paga), oreMese: num(raw.oreMese), pStra: num(raw.pStra) / 100, pFest: num(raw.pFest) / 100, tratt: num(raw.tratt) / 100,
      domenica: /^s/i.test(raw.domenica), locali: festiviLocali(raw.locali), localiRaw: raw.locali || '', calId: raw.calId || '', nomeTab: raw.nomeTab || '',
      ferieAnno: num(raw.ferieAnno), ferieResiduo: num(raw.ferieResiduo), ferieUnita: /^ore/i.test(raw.ferieUnita) ? 'ore' : 'giorni',
      ferieSabato: !/^n/i.test(raw.ferieSabato || 'Sì'),
      ferieSaldo: raw.ferieSaldo === '' || raw.ferieSaldo == null ? null : num(raw.ferieSaldo),
      ferieSaldoMese: /^\d{4}-\d{2}$/.test(raw.ferieSaldoMese || '') ? raw.ferieSaldoMese : '',
      rolSaldo: raw.rolSaldo === '' || raw.rolSaldo == null ? null : num(raw.rolSaldo), exfestSaldo: raw.exfestSaldo === '' || raw.exfestSaldo == null ? null : num(raw.exfestSaldo),
      permUnita: /^g/i.test(raw.permUnita || '') ? 'giorni' : 'ore', permSaldoMese: /^\d{4}-\d{2}$/.test(raw.permSaldoMese || '') ? raw.permSaldoMese : '',
    };
  }
  let TIPI = null, CALC = null;
  function leggiTipi() {
    if (TIPI) return TIPI;
    const lista = [], mappa = {};
    D.tipi.forEach(r => {
      const nome = String(r[0] || '').trim(); if (!nome) return;
      const cat = CATEGORIE.find(c => c.toLowerCase() === String(r[5] || '').trim().toLowerCase()) || 'Lavoro';
      const inizio = toMin(r[2]), fine = toMin(r[3]), colCal = Math.round(num(r[7]));
      lista.push({ nome, sigla: String(r[1] || '').trim(), inizio, fine, inizioStr: inizio == null ? '' : fmtMin(inizio), fineStr: fine == null ? '' : fmtMin(fine),
        pausa: num(r[4]), cat, oreRetr: num(r[6]), colCal: colCal >= 1 && colCal <= 11 ? colCal : 0, colore: COLORI[colCal] || '#9AA0A6',
        icona: String(r[8] || '').trim(), attivo: !/^no$/i.test(String(r[9] || '').trim()) });
    });
    lista.forEach(t => { mappa[t.nome.toLowerCase()] = t; });
    lista.forEach(t => { if (t.sigla && !mappa[t.sigla.toLowerCase()]) mappa[t.sigla.toLowerCase()] = t; });
    TIPI = { lista, mappa };
    return TIPI;
  }
  function tipoFerie(tipi) {
    return tipi.lista.find(t => /^ferie\b/i.test(t.nome)) || tipi.lista.find(t => t.icona === '🏖️' && t.cat === 'Retribuita') || null;
  }
  const turnoLetto = t => {
    const inizio = toMin(t.inizio), fine = toMin(t.fine);
    return { ref: t, date: t.date, tipo: String(t.tipo || '').trim(), inizio, fine, inizioStr: inizio == null ? '' : fmtMin(inizio), fineStr: fine == null ? '' : fmtMin(fine),
      pausa: t.pausa === '' || t.pausa == null ? null : num(t.pausa), oreMan: t.oreMan === '' || t.oreMan == null ? null : num(t.oreMan), id: t.ev || '' };
  };

  /* ---------------- calcoli ---------------- */
  function calcolaTurno(t, tipo, s, perMese) {
    const cat = tipo ? tipo.cat : 'Lavoro';
    const r = { cat, ore: 0, ord: 0, stra: 0, fest: isFestivo(t.date, s), lordo: 0, e: { ord: 0, stra: 0, fest: 0, ass: 0 } };
    if (cat === 'Riposo' || cat === 'Non retribuita') return r;
    if (cat === 'Retribuita') { r.ore = r.ord = tipo.oreRetr; r.lordo = r.e.ass = r.ore * s.paga; return r; }
    let ore;
    if (cat === 'Ore variabili') ore = t.oreMan != null ? t.oreMan : tipo.oreRetr;
    else {
      if (t.inizio == null || t.fine == null) return r;
      let fine = t.fine; if (fine <= t.inizio) fine += 1440;
      const pausa = t.pausa != null ? t.pausa : (tipo ? tipo.pausa : 0);
      ore = Math.max(0, fine - t.inizio - pausa) / 60;
    }
    ore = Math.max(0, ore || 0);
    const mk = t.date.slice(0, 7), usato = perMese[mk] || 0;
    const resta = s.oreMese > 0 ? Math.max(0, s.oreMese - usato) : Infinity;
    const ord = Math.min(ore, resta), stra = ore - ord;
    perMese[mk] = usato + ore;
    r.ore = ore; r.ord = ord; r.stra = stra;
    r.e.ord = s.paga * ord; r.e.stra = s.paga * stra * (1 + s.pStra); r.e.fest = r.fest ? s.paga * ore * s.pFest : 0;
    r.lordo = r.e.ord + r.e.stra + r.e.fest;
    return r;
  }
  const meseVuoto = () => ({ giorniLav: 0, ore: 0, ord: 0, stra: 0, festive: 0, corso: 0, assenze: 0, ferie: 0, lordo: 0, netto: 0, e: { ord: 0, stra: 0, fest: 0, ass: 0 } });
  function riepilogaMesi(turni, s, tipi) {
    const mesi = {}, tf = tipoFerie(tipi);
    turni.forEach(t => {
      const k = t.date.slice(0, 7), c = t.calc, m = mesi[k] || (mesi[k] = Object.assign({ _g: {} }, meseVuoto()));
      if ((c.cat === 'Lavoro' || c.cat === 'Ore variabili') && c.ore > 0) {
        m._g[t.date] = 1; m.ore += c.ore; m.ord += c.ord; m.stra += c.stra;
        if (c.fest) m.festive += c.ore;
        if (c.cat === 'Ore variabili') m.corso += c.ore;
      }
      if (c.cat === 'Retribuita') m.assenze += c.ore;
      if (tf && t.tipoObj === tf && giornoFerie(t.date, s)) m.ferie++;
      m.lordo += c.lordo;
      Object.keys(c.e).forEach(x => { m.e[x] += c.e[x]; });
    });
    Object.keys(mesi).forEach(k => { const m = mesi[k]; m.giorniLav = Object.keys(m._g).length; delete m._g; m.netto = m.lordo * (1 - s.tratt); });
    return mesi;
  }
  function calcolaTutti() {
    if (CALC) return CALC;
    const s = leggiImpostazioni(), tipi = leggiTipi();
    const turni = D.turni.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.tipo).map(turnoLetto).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : (a.inizio == null ? 1e4 : a.inizio) - (b.inizio == null ? 1e4 : b.inizio));
    const perMese = {};
    turni.forEach(t => { t.tipoObj = tipi.mappa[t.tipo.toLowerCase()] || null; t.tipoNome = t.tipoObj ? t.tipoObj.nome : t.tipo; t.calc = calcolaTurno(t, t.tipoObj, s, perMese); });
    CALC = { s, tipi, turni, mesi: riepilogaMesi(turni, s, tipi) };
    return CALC;
  }

  /* ---------------- funzioni chiamate dall'interfaccia (stessi nomi dello script Google) ---------------- */
  function tipiPerPannello() {
    return leggiTipi().lista.map(t => ({ nome: t.nome, sigla: t.sigla || t.nome.slice(0, 2), cat: t.cat, colore: t.colore, testo: contrasto(t.colore), colCal: t.colCal,
      inizio: t.inizioStr, fine: t.fineStr, pausa: t.pausa, oreDef: t.oreRetr, icona: t.icona, attivo: t.attivo }));
  }
  function datiMese(anno, mese) {
    const x = calcolaTutti(), pref = anno + '-' + pad2(mese), giorni = {};
    x.turni.forEach(t => {
      if (t.date.indexOf(pref) !== 0) return;
      const voce = { nome: t.tipoNome };
      if (t.tipoObj && t.tipoObj.cat === 'Ore variabili') voce.ore = t.oreMan != null ? t.oreMan : t.tipoObj.oreRetr;
      (giorni[t.date] = giorni[t.date] || []).push(voce);
    });
    const festivi = [], festivita = {}, n = new Date(anno, mese, 0).getDate();
    for (let d = 1; d <= n; d++) {
      const iso = pref + '-' + pad2(d);
      if (isFestivo(iso, x.s)) festivi.push(iso);
      const nf = festivitaNome(iso, x.s); if (nf) festivita[iso] = nf;
    }
    const dettaglio = x.turni.filter(t => t.date.indexOf(pref) === 0).map(t => ({
      date: t.date, nome: t.tipoNome, sigla: t.tipoObj ? t.tipoObj.sigla : '', cat: t.calc.cat, inizio: t.inizioStr, fine: t.fineStr,
      ore: r2(t.calc.ore), ord: r2(t.calc.ord), stra: r2(t.calc.stra), fest: t.calc.fest, lordo: r2(t.calc.lordo),
      e: { ord: r2(t.calc.e.ord), stra: r2(t.calc.e.stra), fest: r2(t.calc.e.fest), ass: r2(t.calc.e.ass) } }));
    const s = x.s;
    const regole = { paga: s.paga, pStra: s.pStra, pFest: s.pFest, oreMese: s.oreMese, tratt: s.tratt, domenica: s.domenica, locali: s.localiRaw,
      ferieAnno: s.ferieAnno, ferieResiduo: s.ferieResiduo, ferieUnita: s.ferieUnita, ferieSabato: s.ferieSabato, ferieSaldo: s.ferieSaldo, ferieSaldoMese: s.ferieSaldoMese,
      rolSaldo: s.rolSaldo, exfestSaldo: s.exfestSaldo, permUnita: s.permUnita, permSaldoMese: s.permSaldoMese };
    const tf = tipoFerie(x.tipi);
    const ferie = tf ? { nome: tf.nome, oreGiorno: tf.oreRetr, date: x.turni.filter(t => t.tipoObj === tf && t.date.indexOf(anno + '-') === 0).map(t => t.date) } : null;
    const b = D.buste[pref];
    const busta = b ? { mese: b.mese, lordo: b.lordo, trattenute: b.trattenute, netto: b.netto, link: b.link || '' } : null;
    return { giorni, festivi, festivita, riepilogo: x.mesi[pref] || meseVuoto(), dettaglio, regole, ferie, busta };
  }
  function datiIniziali(anno, mese) {
    const r = datiMese(anno, mese);
    r.tipi = tipiPerPannello();
    r.nomeTab = D.imp.nomeTab || '';
    r.nuovo = !!D.meta.nuovo; D.meta.nuovo = false; salva();
    r.suggHome = !D.pref.vistoHome;
    r.nascondiSoldi = !!D.pref.nascondiSoldi;
    r.ssUrl = D.meta.ssUrl || '';
    r.linkBuste = D.meta.busteId ? 'https://drive.google.com/drive/folders/' + D.meta.busteId : '';
    r.email = D.meta.email || '';
    r.cartella = 'AppTurni › Strafobico';
    return r;
  }

  /** modifiche = { 'aaaa-mm-gg': [{ nome: 'Mattino' }, { nome: 'Corso', ore: 3 }] } → ogni giorno avrà esattamente quei turni. */
  function salvaGiorni(modifiche, anno, mese) {
    const tipi = leggiTipi();
    Object.keys(modifiche || {}).forEach(date => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const voluti = [];
      (modifiche[date] || []).forEach(v => {
        const tipo = tipi.mappa[String((v && v.nome) || v || '').toLowerCase()]; if (!tipo) return;
        voluti.push({ tipo, ore: tipo.cat === 'Ore variabili' ? (num(v.ore) > 0 ? num(v.ore) : tipo.oreRetr) : null });
      });
      const esistenti = D.turni.filter(t => t.date === date), tenuti = [];
      esistenti.forEach(t => {
        const tt = tipi.mappa[String(t.tipo).toLowerCase()], om = t.oreMan === '' || t.oreMan == null ? null : num(t.oreMan);
        const i = tt ? voluti.findIndex(v => v.tipo === tt && (tt.cat !== 'Ore variabili' || v.ore === om)) : -1;
        if (i >= 0) { voluti.splice(i, 1); tenuti.push(t); } else if (t.ev && t.ev !== '-') D.pend.evDel.push(t.ev);
      });
      D.turni = D.turni.filter(t => t.date !== date || tenuti.indexOf(t) >= 0);
      voluti.forEach(v => {
        const lav = v.tipo.cat === 'Lavoro';
        D.turni.push({ date, tipo: v.tipo.nome, inizio: lav ? v.tipo.inizioStr : '', fine: lav ? v.tipo.fineStr : '', pausa: lav ? v.tipo.pausa : '',
          oreMan: v.ore == null ? '' : v.ore, note: '', ev: '' });
      });
      D.pend.giorni[date] = Date.now();
    });
    cambiato();
    return datiMese(anno, mese);
  }

  function salvaTipo(t, originale, anno, mese) {
    const nome = String(t.nome || '').trim().slice(0, 30), sigla = String(t.sigla || '').trim().toUpperCase().slice(0, 3);
    const cat = CATEGORIE.indexOf(t.cat) >= 0 ? t.cat : 'Lavoro';
    if (!nome) throw new Error('Scrivi un nome per il turno');
    if (!sigla) throw new Error('Scrivi una sigla (1-3 lettere)');
    const hi = toMin(t.inizio), hf = toMin(t.fine);
    if (cat === 'Lavoro' && (hi == null || hf == null)) throw new Error('Indica orario di inizio e di fine');
    const colCal = Math.min(11, Math.max(1, Math.round(num(t.colCal)) || 1)), ore = Math.max(0, Math.min(24, num(t.ore)));
    const orig = String(originale || '').trim().toLowerCase();
    const idx = orig ? D.tipi.findIndex(r => String(r[0]).trim().toLowerCase() === orig) : -1;
    if (orig && idx < 0) throw new Error('Turno da modificare non trovato');
    D.tipi.forEach((r, i) => {
      if (i === idx) return;
      if (String(r[0]).trim().toLowerCase() === nome.toLowerCase()) throw new Error('Esiste già un turno chiamato «' + nome + '»');
      if (String(r[1]).trim().toUpperCase() === sigla) throw new Error('La sigla «' + sigla + '» è già usata da «' + r[0] + '»');
    });
    const riga = [nome, sigla, cat === 'Lavoro' ? fmtMin(hi) : '', cat === 'Lavoro' ? fmtMin(hf) : '', cat === 'Lavoro' ? Math.max(0, Math.round(num(t.pausa))) : 0,
      cat, (cat === 'Ore variabili' || cat === 'Retribuita') ? ore : '', colCal, String(t.icona || '').slice(0, 8), 'Sì'];
    const vecchio = idx >= 0 ? D.tipi[idx] : null;
    if (idx >= 0) D.tipi[idx] = riga; else D.tipi.push(riga);
    D.pend.tipi = Date.now();
    if (vecchio) {
      const vn = String(vecchio[0]).trim().toLowerCase(), vs = String(vecchio[1]).trim().toLowerCase(), oggi = oggiIso();
      D.turni.forEach(r => {
        const tn = String(r.tipo).toLowerCase(); if (tn !== vn && tn !== vs) return;
        r.tipo = nome; D.pend.giorni[r.date] = Date.now();
        if (r.date < oggi) return;
        const lav = cat === 'Lavoro';
        r.inizio = lav ? fmtMin(hi) : ''; r.fine = lav ? fmtMin(hf) : ''; r.pausa = lav ? riga[4] : '';
        if (cat !== 'Ore variabili') r.oreMan = '';
        if (r.ev && r.ev !== '-') D.pend.evDel.push(r.ev); // l'evento verrà ricreato con i nuovi dati
        r.ev = '';
      });
    }
    cambiato();
    const out = datiMese(anno, mese); out.tipi = tipiPerPannello(); return out;
  }

  function eliminaTipo(nome, anno, mese) {
    const idx = D.tipi.findIndex(r => String(r[0]).trim().toLowerCase() === String(nome || '').trim().toLowerCase());
    if (idx < 0) throw new Error('Turno non trovato');
    const nm = String(D.tipi[idx][0]).trim().toLowerCase(), sg = String(D.tipi[idx][1]).trim().toLowerCase();
    const usato = D.turni.some(t => String(t.tipo).toLowerCase() === nm || String(t.tipo).toLowerCase() === sg);
    let esito;
    if (usato) { D.tipi[idx][9] = 'No'; esito = 'nascosto'; } else { D.tipi.splice(idx, 1); esito = 'eliminato'; }
    D.pend.tipi = Date.now(); cambiato();
    const out = datiMese(anno, mese); out.tipi = tipiPerPannello(); out.esito = esito; return out;
  }

  function scriviImp(k, v) { D.imp[k] = String(v); D.pend.imp[k] = Date.now(); }
  function salvaRegole(regole, anno, mese) {
    const r = regole || {}, numero = (v, max) => { const n = num(v); return n >= 0 && n <= max ? String(Math.round(n * 100) / 100) : null; };
    const valori = {
      oreMese: r.oreMese === '' || r.oreMese == null ? '' : numero(r.oreMese, 744),
      paga: (() => { const n = num(r.paga); return n >= 0 && n <= 1000 ? String(Math.round(n * 1e5) / 1e5) : null; })(),
      pStra: numero(r.pStra, 500), pFest: numero(r.pFest, 500), tratt: numero(r.tratt, 90), domenica: r.domenica ? 'Sì' : 'No',
      locali: festiviLocali(r.locali).map(md => md.slice(3) + '/' + md.slice(0, 2)).join(', '),
    };
    if (r.ferieAnno != null) {
      valori.ferieAnno = numero(r.ferieAnno, 3000); valori.ferieResiduo = numero(r.ferieResiduo, 3000);
      valori.ferieUnita = r.ferieUnita === 'ore' ? 'ore' : 'giorni'; valori.ferieSabato = r.ferieSabato ? 'Sì' : 'No';
    }
    if (r.rolSaldo != null) {
      const s0 = leggiImpostazioni(), vr = r.rolSaldo === '' ? '' : numero(r.rolSaldo, 3000), ve = r.exfestSaldo === '' ? '' : numero(r.exfestSaldo, 3000);
      // scritti a mano: se cambiano rispetto alla busta, non sono più "dalla busta paga"
      if (String(vr == null ? '' : vr) !== String(s0.rolSaldo == null ? '' : s0.rolSaldo) || String(ve == null ? '' : ve) !== String(s0.exfestSaldo == null ? '' : s0.exfestSaldo)) valori.permSaldoMese = '';
      valori.rolSaldo = vr; valori.exfestSaldo = ve; valori.permUnita = r.permUnita === 'giorni' ? 'giorni' : 'ore';
    }
    Object.keys(valori).forEach(k => { if (valori[k] !== null && valori[k] !== undefined) scriviImp(k, valori[k]); });
    const tf = tipoFerie(leggiTipi()), oreF = r.ferieOre === '' || r.ferieOre == null ? null : num(r.ferieOre);
    if (tf && oreF != null && oreF >= 0 && oreF <= 24 && oreF !== tf.oreRetr) {
      const row = D.tipi.find(x => String(x[0]).trim().toLowerCase() === tf.nome.toLowerCase());
      if (row) { row[6] = r2(oreF); D.pend.tipi = Date.now(); }
    }
    cambiato();
    const out = datiMese(anno, mese); out.tipi = tipiPerPannello(); return out;
  }
  function salvaImpostazioneUtente(chiave, valore) {
    if (CHIAVI_DAL_PANNELLO.indexOf(chiave) < 0) throw new Error('Impostazione non modificabile dal pannello');
    scriviImp(chiave, String(valore || '').slice(0, 100)); cambiato(); return true;
  }
  function salvaPreferenza(chiave, valore) {
    if (['vistoHome', 'nascondiSoldi'].indexOf(chiave) < 0) return false;
    D.pref[chiave] = !!valore; salva(); return true;
  }
  const segnaVisto = chiave => salvaPreferenza(chiave, true);

  /** Busta paga: i valori si salvano subito; il file va in coda e viene caricato su Drive alla prossima sincronizzazione. */
  async function salvaBustaPaga(d, b64, anno, mese) {
    const m = String(d && d.mese || '').match(/^(\d{4})-(\d{2})$/);
    if (!m || +m[2] < 1 || +m[2] > 12) throw new Error('Mese della busta paga non valido');
    const k = m[0], n2 = v => v === '' || v == null ? '' : r2(num(v)), vecchia = D.buste[k] || {};
    D.buste[k] = { mese: k, lordo: n2(d.lordo), trattenute: n2(d.trattenute), netto: n2(d.netto), ferie: n2(d.ferie),
      unita: d.ferie === '' || d.ferie == null ? '' : (d.unita === 'ore' ? 'ore' : 'giorni'),
      rol: n2(d.rol), exfest: n2(d.exfest), unitaPermessi: (d.rol === '' || d.rol == null) && (d.exfest === '' || d.exfest == null) ? '' : (d.unitaPermessi === 'giorni' ? 'giorni' : 'ore'), link: b64 ? '' : (vecchia.link || ''), fileId: b64 ? '' : (vecchia.fileId || ''),
      vecchioFile: b64 && vecchia.fileId ? vecchia.fileId : (vecchia.vecchioFile || ''), caricata: Date.now() };
    if (b64) await idbSet('file', k, { b64, nome: d.nomeFile || '', tipo: d.tipo || '' });
    D.pend.buste[k] = Date.now();
    const s = leggiImpostazioni();
    const haPerm = v => v !== '' && v != null;
    if (d.aggFerie && (haPerm(d.rol) || haPerm(d.exfest)) && (!s.permSaldoMese || k >= s.permSaldoMese)) {
      if (haPerm(d.rol)) scriviImp('rolSaldo', String(r2(num(d.rol))));
      if (haPerm(d.exfest)) scriviImp('exfestSaldo', String(r2(num(d.exfest))));
      scriviImp('permUnita', d.unitaPermessi === 'giorni' ? 'giorni' : 'ore'); scriviImp('permSaldoMese', k);
    }
    if (d.aggFerie && d.ferie !== '' && d.ferie != null) {
      const unita = d.unita === 'ore' ? 'ore' : 'giorni';
      if (unita !== s.ferieUnita) {
        const tf = tipoFerie(leggiTipi()), og = tf && tf.oreRetr > 0 ? tf.oreRetr : 8, f = unita === 'ore' ? og : 1 / og;
        scriviImp('ferieAnno', String(r2(s.ferieAnno * f))); scriviImp('ferieResiduo', String(r2(s.ferieResiduo * f))); scriviImp('ferieUnita', unita);
      }
      if (!s.ferieSaldoMese || k >= s.ferieSaldoMese) { scriviImp('ferieSaldo', String(r2(num(d.ferie)))); scriviImp('ferieSaldoMese', k); }
    }
    const l = num(d.lordo), nt = num(d.netto);
    if (d.aggTratt && l > 0 && nt > 0 && nt < l) scriviImp('tratt', String(Math.round((1 - nt / l) * 1000) / 10));
    cambiato();
    const out = datiMese(anno, mese); out.tipi = tipiPerPannello();
    out.archivio = D.meta.busteId ? 'https://drive.google.com/drive/folders/' + D.meta.busteId : '';
    return out;
  }

  /* ---------------- esportazione per Google (righe dei fogli) ---------------- */
  const COLONNE_TURNI = ['Data', 'Turno', 'Inizio', 'Fine', 'Pausa (min)', 'Ore corso', 'Ore lavorate', 'Ordinarie', 'Straordinario', 'Festivo', 'Lordo €', 'Note', 'ID evento'];
  /** Righe del foglio "Turni <anno>" con i calcoli (stesso formato del vecchio script). */
  function righeTurni(anno) {
    const x = calcolaTutti(), z = v => v ? r2(v) : '';
    return x.turni.filter(t => +t.date.slice(0, 4) === anno).map(t => {
      const c = t.calc, r = t.ref;
      return { valori: [t.date, t.tipoNome, t.inizioStr, t.fineStr, r.pausa === '' || r.pausa == null ? '' : num(r.pausa), r.oreMan === '' || r.oreMan == null ? '' : num(r.oreMan),
        z(c.ore), z(c.ord), z(c.stra), c.fest ? (festivitaNome(t.date, x.s) || 'Domenica') : '', z(c.lordo), r.note || '', r.ev || ''], colore: t.tipoObj ? t.tipoObj.colore : null };
    });
  }

  glob.Strafobico = {
    MESI, IMPOSTAZIONI, INTESTAZIONI_TIPI, CATEGORIE, COLORI, COLONNE_TURNI,
    carica, salva, cambiato, onCambio: f => ascoltatori.push(f), dati: () => D, sostituisci: nuovo => { D = nuovo; CALC = null; TIPI = null; },
    idbGet, idbSet, aggiungiFerieSeManca, scriviImp, pad2, num, toMin, fmtMin, contrasto, festivitaNome, isFestivo, giornoFerie, annoCorrente, oggiIso,
    leggiImpostazioni, leggiTipi, tipoFerie, calcolaTutti, righeTurni, invalida: () => { CALC = null; TIPI = null; },
    // stesse funzioni dello script Google, chiamate dall'interfaccia
    api: { datiIniziali, datiMese, salvaGiorni, salvaTipo, eliminaTipo, salvaRegole, salvaImpostazioneUtente, salvaPreferenza, segnaVisto, salvaBustaPaga },
  };
})(typeof window !== 'undefined' ? window : globalThis);
