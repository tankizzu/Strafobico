/**
 * ============================================================
 *  TURNI DI LAVORO — app web per Google Calendar + Google Sheets
 *  Turni personalizzabili (nome, sigla, icona, colore, orari),
 *  importazione da immagine, calcolo ore, straordinari e stipendio.
 * ============================================================
 *  Come funziona: chi apre il link dell'app e dà il consenso si
 *  ritrova nel PROPRIO Google Drive le cartelle "AppTurni › Strafobico"
 *  con il foglio dei turni, e nel PROPRIO Google Calendar il calendario
 *  "Turni lavoro". I dati di ognuno restano nel suo account.
 *
 *  Pubblicazione (solo tu, una volta):
 *   1. script.google.com → Nuovo progetto
 *   2. Impostazioni progetto → spunta "Mostra il file manifest
 *      appsscript.json" → incolla appsscript.json
 *   3. Incolla questo file in "Codice.gs"
 *   4. "+" → HTML → chiamalo esattamente  App  → incolla App.html
 *   5. Distribuisci → Nuovo deployment → tipo "App web"
 *      Esegui come: "Utente che accede all'app web"
 *      Chi ha accesso: "Chiunque abbia un account Google"
 *   6. Il link "App web" è quello da mandare (anche a te stesso)
 * ============================================================
 */

// Struttura su Drive: Il mio Drive › AppTurni › Strafobico › (foglio e cartelle dell'app)
const CARTELLE = ['AppTurni', 'Strafobico'];
const NOME_FOGLIO = 'Turni lavoro';
const NOME_CALENDARIO = 'Turni lavoro';
const FOGLI = { IMP: 'Impostazioni', TIPI: 'Tipi turno', TURNI_VECCHIO: 'Turni', RIEP_VECCHIO: 'Riepilogo' };
// Un foglio di turni e un tabellone per ogni anno: "Turni 2026", "Tabellone 2026"
const PREF_TURNI = 'Turni ', PREF_TAB = 'Tabellone ';
const RE_TURNI = /^Turni (\d{4})$/, RE_TAB = /^Tabellone (\d{4})$/;
const VERSIONE_DATI = '6';
// Archivio delle buste paga: AppTurni › Strafobico › Buste paga › 2026 …
const CARTELLA_BUSTE = 'Buste paga', FOGLIO_BUSTE = 'Buste paga';
const INTESTAZIONI_BUSTE = ['Mese', 'Lordo €', 'Trattenute €', 'Netto €', 'Ferie residue', 'Unità ferie', 'PDF', 'Caricata il'];

// Colonne del foglio Turni (0 = colonna A)
const COL = { DATA: 0, TIPO: 1, INIZIO: 2, FINE: 3, PAUSA: 4, OREMAN: 5, ORE: 6, ORD: 7, STRA: 8, FEST: 9, LORDO: 10, NOTE: 11, ID: 12 };
const NCOL = 13;
const INTESTAZIONI_TURNI = ['Data', 'Turno', 'Inizio', 'Fine', 'Pausa (min)', 'Ore corso', 'Ore lavorate', 'Ordinarie',
  'Straordinario', 'Festivo', 'Lordo €', 'Note', 'ID evento'];

// [chiave, etichetta nel foglio, valore predefinito, nota]
const IMPOSTAZIONI = [
  ['paga', 'Paga oraria lorda (€)', '10', 'Paga base oraria del tuo contratto (la trovi in busta paga)'],
  ['oreMese', 'Ore mensili (oltre scatta lo straordinario)', '', 'Ore da contratto in un mese: ogni ora lavorata in più nel mese è straordinario. Vuoto = nessuno straordinario'],
  ['pStra', 'Maggiorazione straordinario (%)', '25', 'Scrivi 25 per +25%'],
  ['pFest', 'Maggiorazione festiva (%)', '30', 'Applicata a tutte le ore lavorate in un giorno festivo'],
  ['domenica', 'Domenica come festivo', 'Sì', 'Sì / No'],
  ['locali', 'Festività locali (gg/mm)', '', 'Es. santo patrono 24/06 — più date separate da virgola'],
  ['tratt', 'Trattenute stimate per il netto (%)', '30', 'Stima di contributi e IRPEF: confrontala con una tua busta paga e correggila'],
  ['nomeTab', 'Il tuo nome nella tabella turni', '', 'Usato dall\'importazione da immagine: scrivilo come compare nella tabella'],
  ['calId', 'ID calendario turni', '', 'Compilato in automatico. Puoi incollare l\'ID di un altro tuo calendario'],
  ['ferieUnita', 'Ferie contate in', 'giorni', 'giorni / ore (come in busta paga)'],
  ['ferieAnno', 'Ferie all\'anno', '26', 'Dal contratto, nell\'unità scelta sopra'],
  ['ferieResiduo', 'Ferie residue dell\'anno prima', '0', 'Ferie non godute che porti nell\'anno in corso'],
  ['ferieSabato', 'Il sabato conta come ferie', 'Sì', 'No = settimana corta (lun-ven)'],
  ['ferieSaldo', 'Saldo ferie dall\'ultima busta paga', '', 'Compilato quando carichi una busta paga'],
  ['ferieSaldoMese', 'Mese di quel saldo (aaaa-mm)', '', 'Compilato quando carichi una busta paga'],
];
const CHIAVI_DAL_PANNELLO = ['nomeTab', 'oreMese', 'paga', 'pStra', 'pFest', 'domenica', 'locali', 'tratt', 'ferieAnno', 'ferieResiduo', 'ferieUnita', 'ferieSabato'];

// Nome | Sigla | Inizio | Fine | Pausa (min) | Categoria | Ore (assenze / predefinite) | Colore (1-11) | Icona | Attivo
const INTESTAZIONI_TIPI = ['Nome', 'Sigla', 'Inizio', 'Fine', 'Pausa (min)', 'Categoria', 'Ore (assenze / predefinite)', 'Colore (1-11)', 'Icona', 'Attivo'];
const NTIPI = INTESTAZIONI_TIPI.length;
const TIPI_DEFAULT = [
  ['Mattino', 'M', '08:00', '13:00', 0, 'Lavoro', '', 5, '☀️', 'Sì'],
  ['Pomeriggio', 'P', '14:00', '19:00', 0, 'Lavoro', '', 6, '🌇', 'Sì'],
  ['Corso', 'C', '', '', 0, 'Ore variabili', 4, 3, '📚', 'Sì'],
  ['Ferie', 'F', '', '', 0, 'Retribuita', 6, 10, '🏖️', 'Sì'],
];
const CATEGORIE = ['Lavoro', 'Ore variabili', 'Retribuita', 'Non retribuita', 'Riposo'];
const COLORI = { 1: '#7986CB', 2: '#33B679', 3: '#8E24AA', 4: '#E67C73', 5: '#F6BF26', 6: '#F4511E',
  7: '#039BE5', 8: '#616161', 9: '#3F51B5', 10: '#0B8043', 11: '#D50000' };
const NOMI_COLORI = '1 Lavanda · 2 Salvia · 3 Vinaccia · 4 Fenicottero · 5 Banana · 6 Mandarino · 7 Pavone · 8 Grafite · 9 Mirtillo · 10 Basilico · 11 Pomodoro';
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/* ======================= APP WEB ======================= */

function doGet() {
  const out = HtmlService.createHtmlOutputFromFile('App')
    .setTitle('Strafobico')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  // icona della pagina (scheda del browser e collegamento sulla schermata Home, dove il telefono la usa)
  const icona = PropertiesService.getScriptProperties().getProperty('ICONA_ID');
  if (icona) { try { out.setFaviconUrl('https://lh3.googleusercontent.com/d/' + icona + '#.png'); } catch (e) { } }
  return out;
}

/**
 * DA ESEGUIRE UNA VOLTA SOLA DAL PROPRIETARIO, nell'editor: scegli "pubblicaIcona" e premi Esegui.
 * Salva l'icona dell'app nel tuo Drive (AppTurni › Strafobico), la rende visibile a chi ha il link
 * e la imposta come icona della pagina per tutti gli utenti.
 */
function pubblicaIcona() {
  const props = PropertiesService.getScriptProperties();
  const vecchia = props.getProperty('ICONA_ID');
  if (vecchia) { try { Drive.Files.update({ trashed: true }, vecchia); } catch (e) { } }
  const blob = Utilities.newBlob(Utilities.base64Decode(ICONA_PNG_B64), 'image/png', 'Strafobico-icona.png');
  const f = Drive.Files.create({ name: 'Strafobico-icona.png', mimeType: 'image/png', parents: [cartellaApp_()] }, blob);
  Drive.Permissions.create({ role: 'reader', type: 'anyone' }, f.id);
  props.setProperty('ICONA_ID', f.id);
  Logger.log('Icona pubblicata ✓  https://lh3.googleusercontent.com/d/' + f.id);
}

/* ============ PRIMO ACCESSO: cartella, foglio, calendario ============ */

let NUOVO_UTENTE = false; // true solo nell'esecuzione che crea lo spazio dell'utente

/** Restituisce il foglio dell'utente, creandolo (con cartelle e calendario) se non c'è ancora. */
function prepara_() {
  let ss = ss_();
  if (ss) { manutenzione_(ss); return ss; }
  return conLock_(() => {
    let s2 = ss_();
    if (s2) return s2;

    const cartellaId = cartellaApp_();
    const file = Drive.Files.create({
      name: NOME_FOGLIO, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [cartellaId],
    });
    s2 = SpreadsheetApp.openById(file.id);
    const up = PropertiesService.getUserProperties();
    up.setProperty('SS_ID', file.id);
    up.setProperty('VERSIONE', VERSIONE_DATI);
    SS_CACHE = s2;
    NUOVO_UTENTE = true;
    try { s2.setSpreadsheetTimeZone(CalendarApp.getDefaultCalendar().getTimeZone()); } catch (e) { }
    try { s2.setSpreadsheetLocale('it_IT'); } catch (e) { }

    impostaFogli_(s2);
    collegaCalendario_();
    creaTrigger_(s2);
    ricalcola_();
    return s2;
  });
}

/** Cartella dell'app (AppTurni › Strafobico), creata se manca. Restituisce l'id dell'ultima. */
function cartellaApp_() {
  let padre = 'root';
  CARTELLE.forEach(nome => {
    const q = "mimeType='application/vnd.google-apps.folder' and name='" + nome.replace(/'/g, "\\'") + "' and trashed=false and '" + padre + "' in parents";
    const res = Drive.Files.list({ q, fields: 'files(id)', pageSize: 1 });
    padre = (res.files && res.files.length) ? res.files[0].id
      : Drive.Files.create({ name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [padre] }).id;
  });
  return padre;
}

/** Aggiornamenti una tantum per chi usava una versione precedente dell'app. */
function manutenzione_(ss) {
  const up = PropertiesService.getUserProperties(), v = up.getProperty('VERSIONE') || '';
  if (v === VERSIONE_DATI) { controllaAnno_(ss); return; }
  if (v === '5') { conLock_(() => { preparaBuste_(ss); sistemaAnni_(ss); up.setProperty('VERSIONE', VERSIONE_DATI); }); return; }
  if (v === '4') { conLock_(() => { aggiungiFerie_(ss); preparaBuste_(ss); CALC_CACHE = null; ricalcola_(); sistemaAnni_(ss); up.setProperty('VERSIONE', VERSIONE_DATI); }); return; }
  if (v === '3') { conLock_(() => { aggiungiFerie_(ss); preparaBuste_(ss); dividiPerAnno_(ss); up.setProperty('VERSIONE', VERSIONE_DATI); }); return; }
  conLock_(() => {
    // 1) sposta il foglio dentro AppTurni › Strafobico (e cestina la vecchia cartella se è rimasta vuota)
    try {
      const dest = cartellaApp_(), f = Drive.Files.get(ss.getId(), { fields: 'parents' }), vecchi = f.parents || [];
      if (vecchi.indexOf(dest) < 0) {
        Drive.Files.update({}, ss.getId(), null, { addParents: dest, removeParents: vecchi.join(','), fields: 'id' });
        vecchi.forEach(id => {
          try {
            const figli = Drive.Files.list({ q: "'" + id + "' in parents and trashed=false", fields: 'files(id)', pageSize: 1 });
            const info = Drive.Files.get(id, { fields: 'name' });
            if ((!figli.files || !figli.files.length) && /^Turni/i.test(info.name)) Drive.Files.update({ trashed: true }, id);
          } catch (e) { }
        });
      }
    } catch (e) { }
    // 2) foglio "Tipi turno": nuove colonne Icona e Attivo
    const sh = ss.getSheetByName(FOGLI.TIPI);
    if (sh) {
      sh.getRange(1, 1, 1, NTIPI).setValues([INTESTAZIONI_TIPI]);
      stileIntestazione_(sh, NTIPI);
      const n = sh.getLastRow() - 1;
      if (n > 0) {
        const rng = sh.getRange(2, 1, n, NTIPI), v = rng.getValues();
        const icone = { mattino: '☀️', pomeriggio: '🌇', corso: '📚' };
        v.forEach(r => {
          if (r[8] === '') r[8] = icone[String(r[0]).trim().toLowerCase()] || '';
          if (r[9] === '') r[9] = 'Sì';
        });
        rng.setValues(v);
      }
    }
    aggiungiFerie_(ss);
    preparaBuste_(ss);
    dividiPerAnno_(ss);
    up.setProperty('VERSIONE', VERSIONE_DATI);
  });
}

/**
 * Versione 4: il vecchio foglio "Turni" viene diviso in un foglio per anno ("Turni 2025", "Turni 2026"…),
 * il vecchio "Riepilogo" lascia il posto ai tabelloni annuali, le Impostazioni vengono nascoste.
 */
function dividiPerAnno_(ss) {
  const tz = ss.getSpreadsheetTimeZone(), vecchio = ss.getSheetByName(FOGLI.TURNI_VECCHIO);
  if (vecchio) {
    const n = vecchio.getLastRow() - 1, perAnno = {}, anno = annoCorrente_(ss);
    if (n > 0) {
      vecchio.getRange(2, 1, n, NCOL).getValues().forEach(r => {
        if (r.every(c => c === '')) return;
        const d = dataIso_(r[COL.DATA], tz), y = d ? +d.slice(0, 4) : anno;
        (perAnno[y] = perAnno[y] || []).push(r);
      });
    }
    Object.keys(perAnno).forEach(y => {
      const sh = foglioTurni_(ss, +y, true), righe = perAnno[y];
      sh.getRange(sh.getLastRow() + 1, 1, righe.length, NCOL).setValues(righe);
      ordina_(sh);
    });
    foglioTurni_(ss, anno, true);
    ss.deleteSheet(vecchio);
  }
  const riep = ss.getSheetByName(FOGLI.RIEP_VECCHIO);
  if (riep) ss.deleteSheet(riep);
  const imp = ss.getSheetByName(FOGLI.IMP);
  if (imp && !imp.isSheetHidden()) imp.hideSheet();
  CALC_CACHE = null;
  ricalcola_();
  sistemaAnni_(ss);
}

/** Versione 5: aggiunge il tipo "Ferie" a chi non ce l'ha ancora (se c'è già un turno ferie, lo usa). */
function aggiungiFerie_(ss) {
  const sh = ss.getSheetByName(FOGLI.TIPI); if (!sh) return;
  TIPI_CACHE = null;
  if (tipoFerie_(leggiTipi_())) return;
  const sigle = leggiTipi_().lista.map(t => t.sigla.toUpperCase());
  const sigla = ['F', 'FE', 'FER'].filter(s => sigle.indexOf(s) < 0)[0] || 'FF';
  sh.getRange(Math.max(2, sh.getLastRow() + 1), 1, 1, NTIPI).setValues([['Ferie', sigla, '', '', 0, 'Retribuita', 6, 10, '🏖️', 'Sì']]);
  TIPI_CACHE = null;
}

/** Il tipo di turno che rappresenta le ferie: si chiama "Ferie" (o ha l'icona 🏖️) ed è un'assenza pagata. */
function tipoFerie_(tipi) {
  return tipi.lista.filter(t => /^ferie\b/i.test(t.nome))[0] || tipi.lista.filter(t => t.icona === '🏖️' && t.cat === 'Retribuita')[0] || null;
}

/** Un giorno di ferie "conta" se non è domenica né festività (né sabato, con la settimana corta). */
function giornoFerie_(iso, s) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10), w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w !== 0 && !festivitaNome_(iso, s) && !(w === 6 && !s.ferieSabato);
}

/* ======================= BUSTE PAGA ======================= */

/** Cartella "Buste paga" (e, se indicato, la sottocartella dell'anno), create se mancano. Gli id restano in memoria. */
function cartellaBuste_(anno) {
  const up = PropertiesService.getUserProperties(), chiave = 'BUSTE_' + (anno || 'radice');
  const id = up.getProperty(chiave);
  if (id) { try { if (!Drive.Files.get(id, { fields: 'trashed' }).trashed) return id; } catch (e) { } }
  const padre = anno ? cartellaBuste_(null) : cartellaApp_(), nome = anno ? String(anno) : CARTELLA_BUSTE;
  const q = "mimeType='application/vnd.google-apps.folder' and name='" + nome + "' and trashed=false and '" + padre + "' in parents";
  const res = Drive.Files.list({ q, fields: 'files(id)', pageSize: 1 });
  const nuovo = (res.files && res.files.length) ? res.files[0].id
    : Drive.Files.create({ name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [padre] }).id;
  up.setProperty(chiave, nuovo);
  return nuovo;
}
const linkCartella_ = id => 'https://drive.google.com/drive/folders/' + id;

/** Prepara l'archivio: cartella Buste paga con la cartella dell'anno in corso, e il foglio "Buste paga". */
function preparaBuste_(ss) {
  try { cartellaBuste_(annoCorrente_(ss)); } catch (e) { }
  foglioBuste_(ss);
}

function foglioBuste_(ss) {
  let sh = ss.getSheetByName(FOGLIO_BUSTE);
  if (sh) return sh;
  sh = ss.insertSheet(FOGLIO_BUSTE);
  sh.getRange(1, 1, 1, INTESTAZIONI_BUSTE.length).setValues([INTESTAZIONI_BUSTE]);
  stileIntestazione_(sh, INTESTAZIONI_BUSTE.length);
  sh.getRange('A2:A').setNumberFormat('@');
  sh.getRange('B2:D').setNumberFormat('#,##0.00 €');
  sh.getRange('E2:E').setNumberFormat('0.##');
  sh.getRange('H2:H').setNumberFormat('dd/mm/yyyy');
  sh.setColumnWidths(1, INTESTAZIONI_BUSTE.length, 110);
  sh.setColumnWidth(7, 160);
  return sh;
}

/** Buste paga registrate: { 'aaaa-mm': { mese, lordo, trattenute, netto, ferie, unita, link, riga } } */
function leggiBuste_(ss) {
  const sh = ss.getSheetByName(FOGLIO_BUSTE), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const n = sh.getLastRow() - 1, v = sh.getRange(2, 1, n, 8).getValues(), f = sh.getRange(2, 7, n, 1).getFormulas();
  v.forEach((r, i) => {
    const m = String(r[0]).match(/(\d{4})-(\d{2})/); if (!m) return;
    const link = (String(f[i][0]).match(/HYPERLINK\("([^"]+)"/i) || [])[1] || '';
    out[m[0]] = { mese: m[0], lordo: num_(r[1]), trattenute: num_(r[2]), netto: num_(r[3]), ferie: r[4] === '' ? null : num_(r[4]), unita: r[5], link, riga: i + 2 };
  });
  return out;
}

/**
 * Archivia una busta paga (PDF o foto) nella cartella del suo anno e aggiorna il foglio "Buste paga".
 * d = { mese: 'aaaa-mm', lordo, trattenute, netto, ferie, unita, aggFerie, aggTratt, nomeFile, tipo }, b64 = contenuto del file
 * Se richiesto aggiorna il saldo ferie e le trattenute stimate.
 */
function salvaBustaPaga(d, b64, anno, mese) {
  prepara_();
  const m = String(d && d.mese || '').match(/^(\d{4})-(\d{2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) throw new Error('Mese della busta paga non valido');
  const ss = ss_(), y = +m[1], chiaveMese = m[0];
  // 1) file nell'archivio (fuori dal blocco: il caricamento può richiedere qualche secondo)
  let fileId = '', link = '';
  if (b64) {
    const pdf = /pdf/i.test(d.tipo || '') || /\.pdf$/i.test(d.nomeFile || '');
    const est = pdf ? 'pdf' : ((String(d.nomeFile || '').match(/\.(\w{2,4})$/) || [])[1] || 'jpg').toLowerCase();
    const mime = pdf ? 'application/pdf' : (d.tipo || 'image/jpeg');
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, 'Busta paga ' + chiaveMese + '.' + est);
    const f = Drive.Files.create({ name: 'Busta paga ' + MESI[+m[2] - 1] + ' ' + y + '.' + est, mimeType: mime, parents: [cartellaBuste_(y)] }, blob);
    fileId = f.id; link = 'https://drive.google.com/file/d/' + f.id + '/view';
  }
  conLock_(() => {
    const sh = foglioBuste_(ss), buste = leggiBuste_(ss), vecchia = buste[chiaveMese];
    const n2 = v => v === '' || v == null ? '' : Math.round(num_(v) * 100) / 100;
    const riga = [chiaveMese, n2(d.lordo), n2(d.trattenute), n2(d.netto), n2(d.ferie), d.ferie === '' || d.ferie == null ? '' : (d.unita === 'ore' ? 'ore' : 'giorni'),
      link ? '=HYPERLINK("' + link + '";"📄 Busta paga ' + MESI[+m[2] - 1] + '")' : (vecchia && vecchia.link ? '=HYPERLINK("' + vecchia.link + '";"📄 Busta paga ' + MESI[+m[2] - 1] + '")' : ''),
      new Date()];
    if (vecchia) {
      // la busta precedente dello stesso mese va nel cestino (resta recuperabile da Drive)
      const vid = (vecchia.link.match(/\/d\/([^/]+)/) || [])[1];
      if (fileId && vid) { try { Drive.Files.update({ trashed: true }, vid); } catch (e) { } }
      sh.getRange(vecchia.riga, 1, 1, riga.length).setValues([riga]);
    } else {
      sh.getRange(sh.getLastRow() + 1, 1, 1, riga.length).setValues([riga]);
    }
    const nn = sh.getLastRow() - 1;
    if (nn > 1) sh.getRange(2, 1, nn, riga.length).sort([{ column: 1, ascending: false }]);
    // 2) ferie: il saldo della busta diventa il punto di partenza del conteggio
    const s = leggiImpostazioni_();
    if (d.aggFerie && d.ferie !== '' && d.ferie != null) {
      const unita = d.unita === 'ore' ? 'ore' : 'giorni';
      if (unita !== s.ferieUnita) { // cambia l'unità: converto anche le ferie annue e il residuo
        const tf = tipoFerie_(leggiTipi_()), og = tf && tf.oreRetr > 0 ? tf.oreRetr : 8, k = unita === 'ore' ? og : 1 / og;
        scriviImpostazione_('ferieAnno', String(Math.round(s.ferieAnno * k * 100) / 100));
        scriviImpostazione_('ferieResiduo', String(Math.round(s.ferieResiduo * k * 100) / 100));
        scriviImpostazione_('ferieUnita', unita);
      }
      const ultimo = leggiImpostazioni_().ferieSaldoMese;
      if (!ultimo || chiaveMese >= ultimo) { // conta la busta più recente
        scriviImpostazione_('ferieSaldo', String(Math.round(num_(d.ferie) * 100) / 100));
        scriviImpostazione_('ferieSaldoMese', chiaveMese);
      }
    }
    // 3) trattenute stimate dal rapporto netto / lordo
    const l = num_(d.lordo), nt = num_(d.netto);
    if (d.aggTratt && l > 0 && nt > 0 && nt < l) scriviImpostazione_('tratt', String(Math.round((1 - nt / l) * 1000) / 10));
    CALC_CACHE = null;
    ricalcola_();
  });
  const r = datiMese(anno, mese);
  r.tipi = tipiPerPannello_();
  r.archivio = linkCartella_(cartellaBuste_(null));
  r.file = link;
  return r;
}

/** Anno di oggi (fuso orario del foglio). */
function annoCorrente_(ss) {
  return +Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy');
}

/** Al primo accesso di un anno nuovo: crea "Turni <anno>" e "Tabellone <anno>" e nasconde i turni dell'anno prima. */
function controllaAnno_(ss) {
  const up = PropertiesService.getUserProperties(), anno = String(annoCorrente_(ss));
  if (up.getProperty('ANNO_FOGLI') === anno) return;
  conLock_(() => { CALC_CACHE = null; ricalcola_(); sistemaAnni_(ss); try { cartellaBuste_(+anno); } catch (e) { } });
}

/**
 * Ordine e visibilità delle pagine: Tabellone dell'anno, Turni dell'anno, Tipi turno, poi i tabelloni degli anni passati.
 * I turni degli anni passati e le Impostazioni restano nascosti (i dati ci sono e l'app continua a usarli).
 */
function sistemaAnni_(ss) {
  const anno = annoCorrente_(ss);
  const turniOra = foglioTurni_(ss, anno, true), tabOra = foglioTabellone_(ss, anno);
  ss.getSheets().forEach(s => {
    const m = s.getName().match(RE_TURNI);
    if (!m) return;
    if (+m[1] < anno) { if (!s.isSheetHidden()) s.hideSheet(); }
    else if (s.isSheetHidden()) s.showSheet();
  });
  const imp = ss.getSheetByName(FOGLI.IMP);
  if (imp && !imp.isSheetHidden()) imp.hideSheet();
  // ordine delle linguette
  const tabPassati = ss.getSheets().filter(s => { const m = s.getName().match(RE_TAB); return m && +m[1] !== anno; })
    .sort((a, b) => b.getName().localeCompare(a.getName()));
  const ordine = [tabOra, turniOra, ss.getSheetByName(FOGLIO_BUSTE), ss.getSheetByName(FOGLI.TIPI)].concat(tabPassati).filter(Boolean);
  ordine.forEach((s, i) => { ss.setActiveSheet(s); ss.moveActiveSheet(i + 1); });
  ss.setActiveSheet(tabOra);
  PropertiesService.getUserProperties().setProperty('ANNO_FOGLI', String(anno));
}

/** Tutti i fogli "Turni <anno>" (anche quelli nascosti). */
function fogliTurni_(ss) {
  return ss.getSheets().filter(s => RE_TURNI.test(s.getName()));
}

/** Foglio dei turni di un anno; se manca e crea=true lo crea già impostato. */
function foglioTurni_(ss, anno, crea) {
  let sh = ss.getSheetByName(PREF_TURNI + anno);
  if (sh || !crea) return sh;
  sh = ss.insertSheet(PREF_TURNI + anno);
  impostaFoglioTurni_(ss, sh);
  if (anno < annoCorrente_(ss)) sh.hideSheet();
  return sh;
}

function impostaFoglioTurni_(ss, sh) {
  sh.getRange(1, 1, 1, NCOL).setValues([INTESTAZIONI_TURNI]);
  stileIntestazione_(sh, NCOL);
  sh.getRange('A2:A').setNumberFormat('ddd dd/mm/yyyy');
  sh.getRange('C2:D').setNumberFormat('@');
  sh.getRange('G2:I').setNumberFormat('0.00');
  sh.getRange('K2:K').setNumberFormat('#,##0.00 €');
  const tipi = ss.getSheetByName(FOGLI.TIPI);
  if (tipi) sh.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(tipi.getRange('A2:A'), true).setAllowInvalid(true).build());
  sh.setColumnWidth(1, 130); sh.setColumnWidth(2, 110); sh.setColumnWidth(COL.NOTE + 1, 220);
  sh.hideColumns(COL.ID + 1);
}

function impostaFogli_(ss) {
  // Impostazioni
  let sh = foglio_(ss, FOGLI.IMP);
  if (sh.getLastRow() < 2) {
    sh.getRange('B:B').setNumberFormat('@');
    sh.getRange(1, 1, 1, 3).setValues([['Impostazione', 'Valore', 'Note']]);
    sh.getRange(2, 1, IMPOSTAZIONI.length, 3).setValues(IMPOSTAZIONI.map(r => [r[1], r[2], r[3]]));
    stileIntestazione_(sh, 3);
    sh.setColumnWidth(1, 300); sh.setColumnWidth(2, 150); sh.setColumnWidth(3, 480);
  } else {
    const presenti = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0]).trim());
    IMPOSTAZIONI.filter(r => presenti.indexOf(r[1]) < 0).forEach(r => sh.appendRow([r[1], r[2], r[3]]));
  }

  // Tipi turno
  sh = foglio_(ss, FOGLI.TIPI);
  if (sh.getLastRow() < 2) {
    sh.getRange('C:D').setNumberFormat('@');
    sh.getRange(1, 1, 1, NTIPI).setValues([INTESTAZIONI_TIPI]);
    sh.getRange(2, 1, TIPI_DEFAULT.length, NTIPI).setValues(TIPI_DEFAULT);
    stileIntestazione_(sh, NTIPI);
    sh.setColumnWidths(1, NTIPI, 130);
  }
  sh.getRange('F1').setNote('Lavoro = turno con orario fisso (Mattino, Pomeriggio)\n' +
    'Ore variabili = ti chiede quante ore (Corso)\n' +
    'Retribuita = assenza pagata (ferie, permesso…): conta le ore della colonna G\n' +
    'Non retribuita = assenza non pagata\nRiposo = giorno libero, nessun evento in calendario');
  sh.getRange('G1').setNote('Per "Retribuita": ore pagate per quel giorno.\nPer "Ore variabili": ore proposte di default quando lo scegli.');
  sh.getRange('H1').setNote('Colori di Google Calendar:\n' + NOMI_COLORI.replace(/ · /g, '\n'));
  sh.getRange('J1').setNote('No = turno nascosto dal menu (resta nei calcoli dei turni già inseriti)');
  sh.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CATEGORIE, true).build());
  sh.getRange('H2:H').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 11).setAllowInvalid(false).build());

  // Turni e tabellone dell'anno (le Impostazioni restano nascoste: si cambiano dall'app)
  const anno = annoCorrente_(ss);
  foglioTurni_(ss, anno, true);
  foglioTabellone_(ss, anno);
  preparaBuste_(ss);
  ['Foglio1', 'Foglio 1', 'Sheet1'].forEach(n => {
    const f = ss.getSheetByName(n);
    if (f && f.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(f);
  });
  sistemaAnni_(ss);
}

/**
 * Calendario "Turni lavoro" dell'utente. Se non esiste (o è stato cancellato) lo crea,
 * visibile e selezionato, e fa ricreare tutti gli eventi dei turni.
 */
function collegaCalendario_() {
  const s = leggiImpostazioni_();
  let cal = s.calId ? CalendarApp.getCalendarById(s.calId) : null;
  if (!cal) {
    cal = CalendarApp.getCalendarsByName(NOME_CALENDARIO)[0] || null;
    if (!cal) {
      let tz = 'Europe/Rome';
      try { tz = CalendarApp.getDefaultCalendar().getTimeZone(); } catch (e) { }
      cal = CalendarApp.createCalendar(NOME_CALENDARIO, {
        summary: 'Turni di lavoro gestiti dall\'app Turni', timeZone: tz, color: CalendarApp.Color.BLUE, hidden: false, selected: true,
      });
    }
    try { cal.setHidden(false); cal.setSelected(true); } catch (e) { }
    const vecchio = s.calId;
    scriviImpostazione_('calId', cal.getId());
    if (vecchio && vecchio !== cal.getId()) azzeraEventi_(); // gli eventi erano nel calendario cancellato
  }
  return cal;
}

/** Svuota la colonna "ID evento": tutti gli eventi verranno ricreati da sincronizzaCalendario(). */
function azzeraEventi_() {
  fogliTurni_(ss_()).forEach(sh => {
    const n = sh.getLastRow() - 1;
    if (n > 0) sh.getRange(2, COL.ID + 1, n, 1).clearContent();
  });
  PropertiesService.getUserProperties().deleteProperty('CODA_CAL');
}

/** Stato del collegamento con Google Calendar, per il pannello Impostazioni. */
function statoCalendario() {
  if (!ss_()) return null;
  return conLock_(() => {
    const ss = ss_(), tz = ss.getSpreadsheetTimeZone(), up = PropertiesService.getUserProperties();
    let cal = null, errore = up.getProperty('ERR_CAL') || '';
    try { cal = calendario_(leggiImpostazioni_()); } catch (e) { errore = String(e.message || e); }
    const turni = leggiTuttiTurni_(ss, tz);
    let coda = [];
    try { coda = JSON.parse(up.getProperty('CODA_CAL') || '[]'); } catch (e) { }
    const email = emailUtente_();
    return {
      email, link: cal ? linkCalendario_(cal.getId(), email) : '',
      nome: cal ? cal.getName() : NOME_CALENDARIO, id: cal ? cal.getId() : '',
      visibile: cal ? !cal.isHidden() && cal.isSelected() : false,
      turni: turni.length, conEvento: turni.filter(t => t.id && t.id !== '-').length,
      inAttesa: turni.filter(t => !t.id).length + coda.length, errore,
    };
  });
}

/** Link diretti a un calendario e a un evento, aperti nell'account giusto. */
function linkCalendario_(calId, email) {
  return 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(calId) + (email ? '&authuser=' + encodeURIComponent(email) : '');
}
function linkEvento_(ev, calId, email) {
  const eid = Utilities.base64EncodeWebSafe(ev.getId().split('@')[0] + ' ' + calId).replace(/=+$/, '');
  return 'https://calendar.google.com/calendar/event?eid=' + eid + (email ? '&authuser=' + encodeURIComponent(email) : '');
}
function emailUtente_() { try { return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail(); } catch (e) { return ''; } }

/**
 * Prova completa del collegamento con Google Calendar: si assicura che il calendario "Turni lavoro"
 * esista e sia visibile, crea un evento di prova per oggi e restituisce account e link per controllarlo.
 */
function provaCalendario() {
  prepara_();
  const email = emailUtente_();
  try {
    return conLock_(() => {
      const up = PropertiesService.getUserProperties(), ss = ss_(), tz = ss.getSpreadsheetTimeZone();
      const cal = calendario_(leggiImpostazioni_());
      try { cal.setHidden(false); cal.setSelected(true); } catch (e) { }
      const vecchia = up.getProperty('PROVA_EV');
      if (vecchia) { eliminaEvento_(cal, vecchia); up.deleteProperty('PROVA_EV'); }
      const oggi = Utilities.parseDate(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), tz, 'yyyy-MM-dd');
      const ev = cal.createAllDayEvent('✅ Prova Strafobico', oggi, { description: 'Evento di prova creato dall\'app Strafobico. Puoi cancellarlo.' });
      up.setProperty('PROVA_EV', ev.getId());
      return { ok: true, email, calNome: cal.getName(), calId: cal.getId(), linkCal: linkCalendario_(cal.getId(), email), linkEvento: linkEvento_(ev, cal.getId(), email) };
    });
  } catch (e) {
    return { ok: false, email, errore: String(e.message || e) };
  }
}

/** Cancella l'evento di prova creato da provaCalendario(). */
function eliminaProvaCalendario() {
  const up = PropertiesService.getUserProperties(), id = up.getProperty('PROVA_EV');
  if (!id || !ss_()) return true;
  conLock_(() => { try { eliminaEvento_(calendario_(leggiImpostazioni_()), id); } catch (e) { } up.deleteProperty('PROVA_EV'); });
  return true;
}

/** Ricostruisce da zero gli eventi dei turni da oggi in avanti (e rende visibile il calendario). */
function riparaCalendario() {
  prepara_();
  conLock_(() => {
    const ss = ss_(), tz = ss.getSpreadsheetTimeZone();
    const cal = calendario_(leggiImpostazioni_());
    try { cal.setHidden(false); cal.setSelected(true); } catch (e) { }
    const oggi = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), vecchi = [];
    leggiTuttiTurni_(ss, tz).forEach(t => {
      if (t.date < oggi) return;
      if (t.id && t.id !== '-') vecchi.push(t.id);
      t.sh.getRange(t.row, COL.ID + 1).setValue('');
    });
    accodaEliminazioni_(vecchi);
  });
  return sincronizzaCalendario();
}

/** Trigger personali dell'utente: modifica manuale del foglio + importazione dal calendario. */
function creaTrigger_(ss) {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['alModifica', 'importaAutomatico'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('alModifica').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('importaAutomatico').timeBased().everyHours(2).create();
}

/* =================== FUNZIONI USATE DAL PANNELLO =================== */

function datiIniziali(anno, mese) {
  const ss = prepara_();
  const r = datiMese(anno, mese);
  r.tipi = tipiPerPannello_();
  r.ssUrl = ss.getUrl();
  try { const tab = ss.getSheetByName(PREF_TAB + annoCorrente_(ss)); if (tab) r.ssUrl += '#gid=' + tab.getSheetId(); } catch (e) { }
  r.cartella = CARTELLE.join(' › ');
  try { const idB = PropertiesService.getUserProperties().getProperty('BUSTE_radice'); if (idB) r.linkBuste = linkCartella_(idB); } catch (e) { }
  r.nuovo = NUOVO_UTENTE;
  try { r.email = Session.getActiveUser().getEmail(); } catch (e) { r.email = ''; }
  try { r.urlApp = ScriptApp.getService().getUrl(); } catch (e) { r.urlApp = ''; }
  r.nomeTab = leggiImpostazioni_().nomeTab;
  const up = PropertiesService.getUserProperties();
  r.suggHome = up.getProperty('vistoHome') !== '1';
  r.nascondiSoldi = up.getProperty('nascondiSoldi') === '1';
  return r;
}

/** Preferenze personali del pannello (valgono su tutti i dispositivi dell'utente). */
function salvaPreferenza(chiave, valore) {
  if (['vistoHome', 'nascondiSoldi'].indexOf(chiave) < 0) return false;
  PropertiesService.getUserProperties().setProperty(chiave, valore ? '1' : '0');
  return true;
}

/** Ricorda che l'utente ha già visto/seguito un suggerimento (es. "aggiungi alla schermata Home"). */
function segnaVisto(chiave) {
  return salvaPreferenza(chiave, true);
}

function tipiPerPannello_() {
  return leggiTipi_().lista.map(t => ({
    nome: t.nome, sigla: t.sigla || t.nome.slice(0, 2), cat: t.cat, colore: t.colore, testo: contrasto_(t.colore), colCal: t.colCal,
    inizio: t.inizioStr, fine: t.fineStr, pausa: t.pausa, oreDef: t.oreRetr, icona: t.icona, attivo: t.attivo,
  }));
}

function datiMese(anno, mese) {
  const x = calcolaTutti_();
  const pref = anno + '-' + pad2_(mese);
  const giorni = {};
  x.turni.forEach(t => {
    if (t.date.indexOf(pref) !== 0) return;
    const voce = { nome: t.tipoNome };
    if (t.tipoObj && t.tipoObj.cat === 'Ore variabili') voce.ore = t.oreMan != null ? t.oreMan : t.tipoObj.oreRetr;
    (giorni[t.date] = giorni[t.date] || []).push(voce);
  });
  const festivi = [], festivita = {};
  const n = new Date(anno, mese, 0).getDate();
  for (let d = 1; d <= n; d++) {
    const iso = pref + '-' + pad2_(d);
    if (isFestivo_(iso, x.s)) festivi.push(iso);
    const nf = festivitaNome_(iso, x.s);
    if (nf) festivita[iso] = nf;
  }
  const riepilogo = x.mesi[pref] || meseVuoto_();
  const r2 = v => Math.round(v * 100) / 100;
  // dettaglio giorno per giorno, usato dai pannelli "dettagli" del riepilogo
  const dettaglio = x.turni.filter(t => t.date.indexOf(pref) === 0).map(t => ({
    date: t.date, nome: t.tipoNome, sigla: t.tipoObj ? t.tipoObj.sigla : '', cat: t.calc.cat,
    inizio: t.inizioStr, fine: t.fineStr, ore: r2(t.calc.ore), ord: r2(t.calc.ord), stra: r2(t.calc.stra),
    fest: t.calc.fest, lordo: r2(t.calc.lordo),
    e: { ord: r2(t.calc.e.ord), stra: r2(t.calc.e.stra), fest: r2(t.calc.e.fest), ass: r2(t.calc.e.ass) },
  }));
  const s = x.s;
  const regole = { paga: s.paga, pStra: s.pStra, pFest: s.pFest, oreMese: s.oreMese, tratt: s.tratt, domenica: s.domenica, locali: s.localiRaw,
    ferieAnno: s.ferieAnno, ferieResiduo: s.ferieResiduo, ferieUnita: s.ferieUnita, ferieSabato: s.ferieSabato,
    ferieSaldo: s.ferieSaldo, ferieSaldoMese: s.ferieSaldoMese };
  const tf = tipoFerie_(x.tipi);
  const ferie = tf ? { nome: tf.nome, oreGiorno: tf.oreRetr,
    date: x.turni.filter(t => t.tipoObj === tf && t.date.indexOf(anno + '-') === 0).map(t => t.date) } : null;
  let busta = null;
  try { const b = leggiBuste_(x.ss)[pref]; if (b) busta = { mese: b.mese, lordo: b.lordo, trattenute: b.trattenute, netto: b.netto, link: b.link }; } catch (e) { }
  return { giorni, festivi, festivita, riepilogo, dettaglio, regole, ferie, busta };
}

/**
 * modifiche = { 'aaaa-mm-gg': [{ nome: 'Mattino' }, { nome: 'Corso', ore: 3 }] }
 * → ogni giorno indicato avrà esattamente quei turni.
 */
function salvaGiorni(modifiche, anno, mese) {
  prepara_();
  conLock_(() => {
    const ss = ss_(), tz = ss.getSpreadsheetTimeZone();
    const tipi = leggiTipi_();
    const perData = {};
    leggiTuttiTurni_(ss, tz).forEach(t => (perData[t.date] = perData[t.date] || []).push(t));

    const elimina = [], nuove = [];
    Object.keys(modifiche || {}).forEach(date => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const voluti = [];
      (modifiche[date] || []).forEach(v => {
        const nome = typeof v === 'string' ? v : v && v.nome;
        const tipo = tipi.mappa[String(nome || '').toLowerCase()];
        if (!tipo) return;
        const ore = tipo.cat === 'Ore variabili' ? (num_(v.ore) > 0 ? num_(v.ore) : tipo.oreRetr) : null;
        voluti.push({ tipo, ore });
      });
      (perData[date] || []).forEach(t => {
        const tt = tipi.mappa[t.tipo.toLowerCase()];
        const i = tt ? voluti.findIndex(v => v.tipo === tt && (tt.cat !== 'Ore variabili' || v.ore === t.oreMan)) : -1;
        if (i >= 0) voluti.splice(i, 1); else elimina.push(t);
      });
      voluti.forEach(v => nuove.push({ date, tipo: v.tipo, ore: v.ore }));
    });

    // gli eventi del calendario si aggiornano subito dopo, con sincronizzaCalendario()
    accodaEliminazioni_(elimina.map(t => t.id));
    eliminaRigheTurni_(elimina);

    aggiungiRighe_(ss, nuove.map(({ date, tipo, ore }) => {
      const lav = tipo.cat === 'Lavoro';
      return riga_(Utilities.parseDate(date, tz, 'yyyy-MM-dd'), tipo.nome, lav ? tipo.inizioStr : '', lav ? tipo.fineStr : '',
        lav ? tipo.pausa : '', ore == null ? '' : ore, '');
    }), nuove.map(x => +x.date.slice(0, 4)));
    ricalcola_();
  });
  return datiMese(anno, mese);
}

/**
 * Allinea Google Calendar al foglio: elimina gli eventi in coda e crea quelli mancanti.
 * Lavora a blocchi per restare veloce; restituisce quanti eventi restano da creare.
 */
function sincronizzaCalendario() {
  if (!ss_()) return { restano: 0 };
  return conLock_(() => {
    const up = PropertiesService.getUserProperties();
    try {
      const r = sincronizza_(40);
      if (r.errore) up.setProperty('ERR_CAL', r.errore); else up.deleteProperty('ERR_CAL');
      return r;
    } catch (e) {
      const msg = String(e.message || e);
      up.setProperty('ERR_CAL', msg);
      return { restano: -1, errore: msg };
    }
  });
}

function sincronizza_(max) {
  const ss = ss_(), tz = ss.getSpreadsheetTimeZone();
  const cal = calendario_(leggiImpostazioni_()), tipi = leggiTipi_(), up = PropertiesService.getUserProperties();
  let fatti = 0;
  // 1) eliminazioni in coda
  let coda = [];
  try { coda = JSON.parse(up.getProperty('CODA_CAL') || '[]'); } catch (e) { coda = []; }
  while (coda.length && fatti < max) {
    eliminaEvento_(cal, coda.shift()); fatti++;
    if (fatti % 10 === 0) Utilities.sleep(300);
  }
  up.setProperty('CODA_CAL', JSON.stringify(coda));
  // 2) eventi mancanti (colonna ID vuota)
  const mancanti = leggiTuttiTurni_(ss, tz).filter(t => !t.id);
  const daFare = mancanti.slice(0, Math.max(0, max - fatti));
  let errore = '', creati = 0;
  daFare.forEach(t => {
    const tipo = tipi.mappa[t.tipo.toLowerCase()] || null;
    let id = '';
    try { id = creaEvento_(cal, t, tipo, tz) || '-'; if (id !== '-') creati++; } // '-' = turno senza evento (es. riposo)
    catch (e) { id = ''; errore = 'Evento del ' + t.date + ' non creato: ' + (e.message || e); }
    if (id) t.sh.getRange(t.row, COL.ID + 1).setValue(id);
    fatti++;
    if (fatti % 10 === 0) Utilities.sleep(300);
  });
  return { restano: coda.length + (mancanti.length - daFare.length), creati, errore };
}

function accodaEliminazioni_(ids) {
  ids = (ids || []).filter(id => id && id !== '-');
  if (!ids.length) return;
  const up = PropertiesService.getUserProperties();
  let coda = [];
  try { coda = JSON.parse(up.getProperty('CODA_CAL') || '[]'); } catch (e) { coda = []; }
  coda = coda.concat(ids).slice(-250); // limite di sicurezza della memoria utente
  up.setProperty('CODA_CAL', JSON.stringify(coda));
}

/** Elimina le righe di più turni, anche su fogli di anni diversi. */
function eliminaRigheTurni_(turni) {
  const perFoglio = {};
  turni.forEach(t => { const k = t.sh.getName(); (perFoglio[k] = perFoglio[k] || { sh: t.sh, righe: [] }).righe.push(t.row); });
  Object.keys(perFoglio).forEach(k => eliminaRighe_(perFoglio[k].sh, perFoglio[k].righe));
}

/** Aggiunge righe ai fogli dei rispettivi anni (creandoli se mancano) e li riordina per data. */
function aggiungiRighe_(ss, righe, anni) {
  const perAnno = {};
  righe.forEach((r, i) => { (perAnno[anni[i]] = perAnno[anni[i]] || []).push(r); });
  Object.keys(perAnno).forEach(y => {
    const sh = foglioTurni_(ss, +y, true), rr = perAnno[y];
    sh.getRange(sh.getLastRow() + 1, 1, rr.length, NCOL).setValues(rr);
    ordina_(sh);
  });
}

/** Elimina più righe con poche operazioni (raggruppa le righe consecutive). */
function eliminaRighe_(sh, righe) {
  const r = righe.slice().sort((a, b) => b - a);
  let i = 0;
  while (i < r.length) {
    let j = i;
    while (j + 1 < r.length && r[j + 1] === r[j] - 1) j++;
    sh.deleteRows(r[j], j - i + 1);
    i = j + 1;
  }
}

/**
 * Crea o modifica un tipo di turno.
 * t = { nome, sigla, icona, colCal (1-11), cat, inizio, fine, pausa, ore }, originale = nome prima della modifica ('' se nuovo)
 * I turni già inseriti da oggi in avanti vengono aggiornati (nome, orari, colore, evento in calendario).
 */
function salvaTipo(t, originale, anno, mese) {
  prepara_();
  conLock_(() => {
    const ss = ss_(), tz = ss.getSpreadsheetTimeZone(), shT = ss.getSheetByName(FOGLI.TIPI);
    const nome = String(t.nome || '').trim().slice(0, 30), sigla = String(t.sigla || '').trim().toUpperCase().slice(0, 3);
    const cat = CATEGORIE.indexOf(t.cat) >= 0 ? t.cat : 'Lavoro';
    if (!nome) throw new Error('Scrivi un nome per il turno');
    if (!sigla) throw new Error('Scrivi una sigla (1-3 lettere)');
    const hi = toMin_(t.inizio), hf = toMin_(t.fine);
    if (cat === 'Lavoro' && (hi == null || hf == null)) throw new Error('Indica orario di inizio e di fine');
    const colCal = Math.min(11, Math.max(1, Math.round(num_(t.colCal)) || 1));
    const ore = Math.max(0, Math.min(24, num_(t.ore)));
    const icona = String(t.icona || '').slice(0, 8);

    const n = Math.max(0, shT.getLastRow() - 1);
    const righe = n ? shT.getRange(2, 1, n, NTIPI).getValues() : [];
    const orig = String(originale || '').trim().toLowerCase();
    const idx = orig ? righe.findIndex(r => String(r[0]).trim().toLowerCase() === orig) : -1;
    if (orig && idx < 0) throw new Error('Turno da modificare non trovato');
    righe.forEach((r, i) => {
      if (i === idx) return;
      if (String(r[0]).trim().toLowerCase() === nome.toLowerCase()) throw new Error('Esiste già un turno chiamato «' + nome + '»');
      if (String(r[1]).trim().toUpperCase() === sigla) throw new Error('La sigla «' + sigla + '» è già usata da «' + r[0] + '»');
    });
    const riga = [nome, sigla, cat === 'Lavoro' ? fmtMin_(hi) : '', cat === 'Lavoro' ? fmtMin_(hf) : '',
      cat === 'Lavoro' ? Math.max(0, Math.round(num_(t.pausa))) : 0, cat,
      (cat === 'Ore variabili' || cat === 'Retribuita') ? ore : '', colCal, icona, 'Sì'];
    if (idx >= 0) shT.getRange(idx + 2, 1, 1, NTIPI).setValues([riga]);
    else shT.getRange(n + 2, 1, 1, NTIPI).setValues([riga]);
    TIPI_CACHE = null; CALC_CACHE = null;
    if (idx < 0) return;

    // turni già inseriti: rinomina sempre; da oggi in avanti aggiorna anche orari ed evento
    const vecchio = righe[idx], vecchioNome = String(vecchio[0]).trim().toLowerCase(), vecchiaSigla = String(vecchio[1]).trim().toLowerCase();
    const oggi = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), daEliminare = [];
    leggiTuttiTurni_(ss, tz).forEach(r => {
      const sh = r.sh, tn = r.tipo.toLowerCase();
      if (tn !== vecchioNome && tn !== vecchiaSigla) return;
      if (r.tipo !== nome) sh.getRange(r.row, COL.TIPO + 1).setValue(nome);
      if (r.date < oggi) return;
      const lav = cat === 'Lavoro';
      const nuovi = [lav ? fmtMin_(hi) : '', lav ? fmtMin_(hf) : '', lav ? riga[4] : ''];
      sh.getRange(r.row, COL.INIZIO + 1, 1, 3).setValues([nuovi]);
      if (cat !== 'Ore variabili' && r.oreMan != null) sh.getRange(r.row, COL.OREMAN + 1).setValue('');
      // l'evento verrà ricreato con i nuovi dati da sincronizzaCalendario()
      if (r.id && r.id !== '-') daEliminare.push(r.id);
      sh.getRange(r.row, COL.ID + 1).setValue('');
    });
    accodaEliminazioni_(daEliminare);
    ricalcola_();
  });
  const r = datiMese(anno, mese);
  r.tipi = tipiPerPannello_();
  return r;
}

/**
 * Elimina un tipo di turno. Se è già stato usato viene solo nascosto dal menu
 * (i turni inseriti restano e continuano a essere contati).
 */
function eliminaTipo(nome, anno, mese) {
  prepara_();
  let esito = '';
  conLock_(() => {
    const ss = ss_(), shT = ss.getSheetByName(FOGLI.TIPI), tz = ss.getSpreadsheetTimeZone();
    const n = Math.max(0, shT.getLastRow() - 1);
    const righe = n ? shT.getRange(2, 1, n, NTIPI).getValues() : [];
    const idx = righe.findIndex(r => String(r[0]).trim().toLowerCase() === String(nome || '').trim().toLowerCase());
    if (idx < 0) throw new Error('Turno non trovato');
    const nm = String(righe[idx][0]).trim().toLowerCase(), sg = String(righe[idx][1]).trim().toLowerCase();
    const usato = leggiTuttiTurni_(ss, tz).some(t => t.tipo.toLowerCase() === nm || t.tipo.toLowerCase() === sg);
    if (usato) { shT.getRange(idx + 2, 10).setValue('No'); esito = 'nascosto'; }
    else { shT.deleteRow(idx + 2); esito = 'eliminato'; }
    TIPI_CACHE = null; CALC_CACHE = null;
    ricalcola_();
  });
  const r = datiMese(anno, mese);
  r.tipi = tipiPerPannello_();
  r.esito = esito;
  return r;
}

/**
 * Salva paga, soglia mensile e maggiorazioni dal pannello.
 * regole = { oreMese, paga, pStra, pFest, tratt } in ore / € / percentuali intere, domenica: bool, locali: "24/06, …"
 */
function salvaRegole(regole, anno, mese) {
  prepara_();
  conLock_(() => {
    const r = regole || {}, numero = (v, max) => { const n = num_(v); return n >= 0 && n <= max ? String(Math.round(n * 100) / 100) : null; };
    const valori = {
      oreMese: r.oreMese === '' || r.oreMese == null ? '' : numero(r.oreMese, 744),
      paga: (() => { const n = num_(r.paga); return n >= 0 && n <= 1000 ? String(Math.round(n * 1e5) / 1e5) : null; })(), pStra: numero(r.pStra, 500), pFest: numero(r.pFest, 500), tratt: numero(r.tratt, 90),
      domenica: r.domenica ? 'Sì' : 'No',
      locali: festiviLocali_(r.locali).map(md => md.slice(3) + '/' + md.slice(0, 2)).join(', '),
    };
    if (r.ferieAnno != null) {
      valori.ferieAnno = numero(r.ferieAnno, 3000); valori.ferieResiduo = numero(r.ferieResiduo, 3000);
      valori.ferieUnita = r.ferieUnita === 'ore' ? 'ore' : 'giorni'; valori.ferieSabato = r.ferieSabato ? 'Sì' : 'No';
    }
    Object.keys(valori).forEach(k => { if (valori[k] !== null && valori[k] !== undefined) scriviImpostazione_(k, valori[k]); });
    // ore pagate per un giorno di ferie: stanno nel tipo "Ferie"
    const oreF = r.ferieOre === '' || r.ferieOre == null ? null : num_(r.ferieOre), tf = tipoFerie_(leggiTipi_());
    if (tf && oreF != null && oreF >= 0 && oreF <= 24 && oreF !== tf.oreRetr) {
      const shT = ss_().getSheetByName(FOGLI.TIPI), n = shT.getLastRow() - 1;
      const nomi = shT.getRange(2, 1, n, 1).getValues().map(x => String(x[0]).trim().toLowerCase());
      const i = nomi.indexOf(tf.nome.toLowerCase());
      if (i >= 0) shT.getRange(i + 2, 7).setValue(Math.round(oreF * 100) / 100);
      TIPI_CACHE = null; CALC_CACHE = null;
    }
    ricalcola_();
  });
  const out = datiMese(anno, mese);
  out.tipi = tipiPerPannello_();
  return out;
}

/** Salva un'impostazione modificabile dal pannello (es. il nome nella tabella turni). */
function salvaImpostazioneUtente(chiave, valore) {
  if (CHIAVI_DAL_PANNELLO.indexOf(chiave) < 0) throw new Error('Impostazione non modificabile dal pannello');
  prepara_();
  conLock_(() => scriviImpostazione_(chiave, String(valore || '').slice(0, 100)));
  return true;
}

/* ================ TRIGGER: MODIFICA MANUALE DEL FOGLIO ================ */

function alModifica(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet(), nome = sh.getName();
  if (nome === FOGLI.IMP || nome === FOGLI.TIPI) { conLock_(ricalcola_); return; }
  if (!RE_TURNI.test(nome)) return;
  const r0 = Math.max(2, e.range.getRow()), r1 = Math.min(e.range.getLastRow(), sh.getMaxRows());
  if (r1 < r0 || e.range.getColumn() > COL.OREMAN + 1) return; // note o colonne calcolate: niente da fare

  conLock_(() => {
    const ss = ss_(), tz = ss.getSpreadsheetTimeZone(), tipi = leggiTipi_();
    let cal = null;
    try { cal = calendario_(leggiImpostazioni_()); } catch (err) { }
    const n = r1 - r0 + 1, rng = sh.getRange(r0, 1, n, NCOL);
    const v = rng.getValues(), d = rng.getDisplayValues();
    const be = [], ids = [];
    for (let i = 0; i < n; i++) {
      const date = dataIso_(v[i][COL.DATA], tz);
      let tipoNome = String(v[i][COL.TIPO]).trim();
      const tipo = tipoNome ? tipi.mappa[tipoNome.toLowerCase()] || null : null;
      if (tipo) tipoNome = tipo.nome; // "M" diventa "Mattino"
      let hi = toMin_(d[i][COL.INIZIO]), hf = toMin_(d[i][COL.FINE]), pausa = d[i][COL.PAUSA], oreMan = d[i][COL.OREMAN];
      if (tipo && tipo.cat === 'Lavoro') {
        if (hi == null) hi = tipo.inizio;
        if (hf == null) hf = tipo.fine;
        if (pausa === '') pausa = tipo.pausa;
      }
      if (tipo && tipo.cat === 'Ore variabili' && oreMan === '') oreMan = tipo.oreRetr;
      const his = hi == null ? '' : fmtMin_(hi), hfs = hf == null ? '' : fmtMin_(hf);
      be.push([tipoNome, his, hfs, pausa, oreMan]);

      let id = String(v[i][COL.ID] || '');
      if (cal && eliminaEvento_(cal, id)) {
        if (i && i % 10 === 0) Utilities.sleep(400);
        id = (date && tipoNome)
          ? creaEvento_(cal, { date, tipo: tipoNome, inizioStr: his, fineStr: hfs, oreMan: oreMan === '' ? null : num_(oreMan) }, tipo, tz)
          : '';
      }
      ids.push([id]);
    }
    sh.getRange(r0, COL.TIPO + 1, n, 5).setValues(be);
    sh.getRange(r0, COL.ID + 1, n, 1).setValues(ids);
    ricalcola_();
  });
}

/* ======================= CALENDARIO ======================= */

function importaAutomatico() {
  if (!ss_()) return;
  conLock_(() => { sincronizza_(80); importa_(); });
}

/** Importa nel foglio gli eventi aggiunti a mano nel calendario "Turni lavoro" (es. "M", "Corso 3h"). */
function importa_() {
  const ss = ss_(), tz = ss.getSpreadsheetTimeZone();
  const tipi = leggiTipi_(), cal = calendario_(leggiImpostazioni_());
  const noti = new Set(leggiTuttiTurni_(ss, tz).filter(t => t.id && t.id !== '-').map(t => t.id + '|' + t.date));
  const da = new Date(); da.setDate(da.getDate() - 62);
  const a = new Date(); a.setDate(a.getDate() + 180);
  const nuove = [], anni = [];

  cal.getEvents(da, a).forEach(ev => {
    const tutto = ev.isAllDayEvent();
    const date = Utilities.formatDate(tutto ? ev.getAllDayStartDate() : ev.getStartTime(), tz, 'yyyy-MM-dd');
    const id = ev.getId();
    if (noti.has(id + '|' + date)) return;
    const trovato = trovaTipo_(ev.getTitle(), tipi);
    if (!trovato) return;
    const tipo = trovato.tipo, lav = tipo.cat === 'Lavoro';
    let hi = '', hf = '', ore = '';
    if (lav) {
      if (tutto) { hi = tipo.inizioStr; hf = tipo.fineStr; }
      else { hi = Utilities.formatDate(ev.getStartTime(), tz, 'HH:mm'); hf = Utilities.formatDate(ev.getEndTime(), tz, 'HH:mm'); }
    }
    if (tipo.cat === 'Ore variabili') {
      ore = trovato.ore != null ? trovato.ore
        : (!tutto ? Math.round((ev.getEndTime() - ev.getStartTime()) / 36e5 * 100) / 100 : tipo.oreRetr);
    }
    nuove.push(riga_(Utilities.parseDate(date, tz, 'yyyy-MM-dd'), tipo.nome, hi, hf, lav ? tipo.pausa : '', ore, id));
    anni.push(+date.slice(0, 4));
    noti.add(id + '|' + date);
    if (tipo.colCal) { try { ev.setColor(String(tipo.colCal)); } catch (e) { } }
  });

  if (nuove.length) {
    aggiungiRighe_(ss, nuove, anni);
    ricalcola_();
  }
  return nuove.length;
}

function creaEvento_(cal, t, tipo, tz) {
  if (tipo && tipo.cat === 'Riposo') return '';
  let titolo = tipo ? (tipo.icona ? tipo.icona + ' ' : '') + tipo.nome + (tipo.sigla ? ' (' + tipo.sigla + ')' : '') : t.tipo;
  if (tipo && tipo.cat === 'Ore variabili') {
    const ore = t.oreMan != null && t.oreMan !== '' ? num_(t.oreMan) : tipo.oreRetr;
    titolo += ' · ' + String(ore).replace('.', ',') + ' h';
  }
  const opzioni = { description: 'Turno gestito dall\'app Turni' };
  let ev;
  if (t.inizioStr && t.fineStr && (!tipo || tipo.cat === 'Lavoro')) {
    const inizio = Utilities.parseDate(t.date + ' ' + t.inizioStr, tz, 'yyyy-MM-dd HH:mm');
    let fine = Utilities.parseDate(t.date + ' ' + t.fineStr, tz, 'yyyy-MM-dd HH:mm');
    if (fine <= inizio) fine = new Date(fine.getTime() + 864e5); // turno che passa la mezzanotte
    ev = cal.createEvent(titolo, inizio, fine, opzioni);
  } else {
    ev = cal.createAllDayEvent(titolo, Utilities.parseDate(t.date, tz, 'yyyy-MM-dd'), opzioni);
  }
  if (tipo && tipo.colCal) { try { ev.setColor(String(tipo.colCal)); } catch (e) { } }
  return ev.getId();
}

/** true se l'evento è stato eliminato (o non esiste), false se è ricorrente e va lasciato */
function eliminaEvento_(cal, id) {
  if (!id || id === '-') return true;
  try {
    const ev = cal.getEventById(id);
    if (!ev) return true;
    if (ev.isRecurringEvent()) return false;
    ev.deleteEvent();
  } catch (e) { }
  return true;
}

function calendario_(s) {
  const cal = s.calId ? CalendarApp.getCalendarById(s.calId) : null;
  return cal || collegaCalendario_();
}

/** Riconosce "Mattino", "M", "Mattino (M)", "Corso (C) · 3 h", "C 2,5h" → { tipo, ore } */
function trovaTipo_(titolo, tipi) {
  let t = String(titolo).trim().toLowerCase().replace(/^[^a-z0-9\u00e0-\u00fc]+/, ''), ore = null;
  const mo = t.match(/^(.*?)\s*[·\-:]?\s*(\d+(?:[.,]\d+)?)\s*(?:h|ore)\s*$/);
  if (mo && mo[1]) { t = mo[1].trim(); ore = num_(mo[2]); }
  let tipo = tipi.mappa[t] || null;
  if (!tipo) {
    const m = t.match(/^(.*?)\s*\((.+)\)\s*$/);
    if (m) tipo = tipi.mappa[m[1].trim()] || tipi.mappa[m[2].trim()] || null;
  }
  return tipo ? { tipo, ore } : null;
}

/* ======================= CALCOLI ======================= */

function calcolaTutti_() {
  if (CALC_CACHE) return CALC_CACHE;
  const ss = ss_(), tz = ss.getSpreadsheetTimeZone();
  const s = leggiImpostazioni_(), tipi = leggiTipi_();
  const turni = leggiTuttiTurni_(ss, tz).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (a.inizio == null ? 1e4 : a.inizio) - (b.inizio == null ? 1e4 : b.inizio));
  const perMese = {};
  turni.forEach(t => {
    t.tipoObj = tipi.mappa[t.tipo.toLowerCase()] || null;
    t.tipoNome = t.tipoObj ? t.tipoObj.nome : t.tipo;
    t.calc = calcolaTurno_(t, t.tipoObj, s, perMese);
  });
  CALC_CACHE = { ss, tz, s, tipi, turni, mesi: riepilogaMesi_(turni, s, tipi) };
  return CALC_CACHE;
}

/**
 * Calcola un turno. I turni vanno passati in ordine cronologico:
 * `perMese` accumula le ore già lavorate nel mese; oltre "Ore mensili" è straordinario.
 */
function calcolaTurno_(t, tipo, s, perMese) {
  const cat = tipo ? tipo.cat : 'Lavoro';
  const r = { cat, ore: 0, ord: 0, stra: 0, fest: isFestivo_(t.date, s), lordo: 0,
    e: { ord: 0, stra: 0, fest: 0, ass: 0 } };
  if (cat === 'Riposo' || cat === 'Non retribuita') return r;
  if (cat === 'Retribuita') {
    r.ore = r.ord = tipo.oreRetr;
    r.lordo = r.e.ass = r.ore * s.paga;
    return r;
  }

  let ore;
  if (cat === 'Ore variabili') {
    ore = t.oreMan != null ? t.oreMan : tipo.oreRetr;
  } else {
    if (t.inizio == null || t.fine == null) return r;
    let fine = t.fine;
    if (fine <= t.inizio) fine += 1440;
    const durata = fine - t.inizio;
    const pausa = t.pausa != null ? t.pausa : (tipo ? tipo.pausa : 0);
    ore = Math.max(0, durata - pausa) / 60;
  }
  ore = Math.max(0, ore || 0);

  const mk = t.date.slice(0, 7), usato = perMese[mk] || 0;
  const resta = s.oreMese > 0 ? Math.max(0, s.oreMese - usato) : Infinity;
  const ord = Math.min(ore, resta), stra = ore - ord;
  perMese[mk] = usato + ore;

  r.ore = ore; r.ord = ord; r.stra = stra;
  r.e.ord = s.paga * ord;
  r.e.stra = s.paga * stra * (1 + s.pStra);
  r.e.fest = r.fest ? s.paga * ore * s.pFest : 0;
  r.lordo = r.e.ord + r.e.stra + r.e.fest;
  return r;
}

function meseVuoto_() {
  return { giorniLav: 0, ore: 0, ord: 0, stra: 0, festive: 0, corso: 0, assenze: 0, ferie: 0, lordo: 0, netto: 0,
    e: { ord: 0, stra: 0, fest: 0, ass: 0 } };
}

function riepilogaMesi_(turni, s, tipi) {
  const mesi = {}, tf = tipi ? tipoFerie_(tipi) : null;
  turni.forEach(t => {
    const k = t.date.slice(0, 7), c = t.calc;
    const m = mesi[k] || (mesi[k] = Object.assign({ _g: {} }, meseVuoto_()));
    if ((c.cat === 'Lavoro' || c.cat === 'Ore variabili') && c.ore > 0) {
      m._g[t.date] = 1;
      m.ore += c.ore; m.ord += c.ord; m.stra += c.stra;
      if (c.fest) m.festive += c.ore;
      if (c.cat === 'Ore variabili') m.corso += c.ore;
    }
    if (c.cat === 'Retribuita') m.assenze += c.ore;
    if (tf && t.tipoObj === tf && giornoFerie_(t.date, s)) m.ferie++;
    m.lordo += c.lordo;
    Object.keys(c.e).forEach(k => { m.e[k] += c.e[k]; });
  });
  Object.keys(mesi).forEach(k => {
    const m = mesi[k];
    m.giorniLav = Object.keys(m._g).length;
    delete m._g;
    m.netto = m.lordo * (1 - s.tratt);
  });
  return mesi;
}

function ricalcola_() {
  CALC_CACHE = null;
  const x = calcolaTutti_();
  // colonne calcolate di ogni foglio "Turni <anno>"
  const z = v => v ? Math.round(v * 100) / 100 : '';
  const fogli = {};
  fogliTurni_(x.ss).forEach(sh => {
    const n = sh.getLastRow() - 1;
    if (n < 1) return;
    const f = fogli[sh.getName()] = { sh, n, out: [], bg: [], fc: [] };
    for (let i = 0; i < n; i++) { f.out.push(['', '', '', '', '']); f.bg.push([null]); f.fc.push(['#000000']); }
  });
  x.turni.forEach(t => {
    const f = fogli[t.sh.getName()]; if (!f) return;
    const c = t.calc, i = t.row - 2;
    f.out[i] = [z(c.ore), z(c.ord), z(c.stra), c.fest ? (festivitaNome_(t.date, x.s) || 'Domenica') : '', z(c.lordo)];
    if (t.tipoObj) { f.bg[i] = [t.tipoObj.colore]; f.fc[i] = [contrasto_(t.tipoObj.colore)]; }
  });
  Object.keys(fogli).forEach(k => {
    const f = fogli[k];
    f.sh.getRange(2, COL.ORE + 1, f.n, 5).setValues(f.out);
    f.sh.getRange(2, COL.TIPO + 1, f.n, 1).setBackgrounds(f.bg).setFontColors(f.fc);
  });
  scriviTabelloni_(x);
  return x;
}

/* ======================= TABELLONE ANNUALE ======================= */
// Un foglio per anno: in alto il riepilogo (un mese per riga + totale), sotto il calendario (mesi × giorni).
// Le colonne B…AF sono i giorni (strette); nel riepilogo ogni valore occupa 3 colonne unite.
const TB = { TITOLO: 1, SOTTO: 2, R_SEZ: 4, R_TESTA: 5, R_MESE: 6, R_TOT: 18, C_SEZ: 20, C_TESTA: 21, C_MESE: 22, LEG: 35, NOTA: 36 };
const TB_NCOL = 35; // A + 31 giorni + Turni, Ore, Straordinario
const TB_RIEP = ['Giorni lavorati', 'Ore lavorate', 'di cui corso', 'Ordinarie', 'Straordinario', 'Ore nei festivi', 'Assenze pagate (ore)', 'Ferie (giorni)', 'Lordo stimato', 'Netto stimato'];
const TB_C_TURNI = 2 + TB_RIEP.length * 3; // colonna "Turni del mese" (AF)
const TB_COLORI = { testa: '#1a73e8', testaCal: '#202124', festa: '#fce8e6', vuoto: '#eceff1', tot: '#e8f0fe', sez: '#f1f3f4' };

/** Tabellone di un anno (creato e impostato se manca). */
function foglioTabellone_(ss, anno) {
  let sh = ss.getSheetByName(PREF_TAB + anno);
  if (sh && sh.getRange(TB.R_TESTA, 1).getValue() === 'Mese' && sh.getRange(TB.C_TESTA, 1).getValue() === 'Mese' &&
    sh.getRange(TB.R_TESTA, TB_C_TURNI).getValue() === 'Turni del mese') return sh;
  if (!sh) sh = ss.insertSheet(PREF_TAB + anno);
  creaTabellone_(sh, anno);
  return sh;
}

function creaTabellone_(sh, anno) {
  sh.clear();
  try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); } catch (e) { }
  if (sh.getMaxColumns() < TB_NCOL) sh.insertColumnsAfter(sh.getMaxColumns(), TB_NCOL - sh.getMaxColumns());
  if (sh.getMaxRows() < TB.NOTA + 2) sh.insertRowsAfter(sh.getMaxRows(), TB.NOTA + 2 - sh.getMaxRows());
  sh.setColumnWidth(1, 110);
  sh.setColumnWidths(2, 31, 34);
  sh.setColumnWidths(33, 3, 64);
  sh.setFrozenColumns(1);
  sh.setHiddenGridlines(true);

  // titolo
  sh.getRange(TB.TITOLO, 1).setValue('Strafobico · ' + anno).setFontSize(18).setFontWeight('bold');
  sh.getRange(TB.SOTTO, 1).setValue('Aggiornato in automatico dall\'app. In alto il riepilogo dell\'anno, sotto il calendario giorno per giorno ' +
    '(passa sopra una cella per i dettagli). Valori indicativi: la busta paga resta il riferimento.').setFontColor('#5f6368').setFontStyle('italic');

  // riepilogo: intestazioni
  sh.getRange(TB.R_SEZ, 1, 1, TB_NCOL).merge().setValue('📊  RIEPILOGO ' + anno).setFontWeight('bold').setFontSize(12).setBackground(TB_COLORI.sez);
  const testa = sh.getRange(TB.R_TESTA, 1, 1, TB_NCOL);
  const t = new Array(TB_NCOL).fill('');
  t[0] = 'Mese';
  TB_RIEP.forEach((x, i) => { t[1 + i * 3] = x; });
  t[TB_C_TURNI - 1] = 'Turni del mese';
  testa.setValues([t]).setBackground(TB_COLORI.testa).setFontColor('#ffffff').setFontWeight('bold')
    .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
  sh.setRowHeight(TB.R_TESTA, 38);
  for (let i = 0; i < TB_RIEP.length; i++) sh.getRange(TB.R_TESTA, 2 + i * 3, TB.R_TOT - TB.R_TESTA + 1, 3).mergeAcross();
  sh.getRange(TB.R_TESTA, TB_C_TURNI, TB.R_TOT - TB.R_TESTA + 1, TB_NCOL - TB_C_TURNI + 1).mergeAcross();
  const nEuro = 6, cEuro = TB_C_TURNI - nEuro;
  sh.getRange(TB.R_MESE, 2, 13, TB_C_TURNI - 2).setHorizontalAlignment('center');
  sh.getRange(TB.R_MESE, 2, 13, cEuro - 2).setNumberFormat('0.##');       // giorni e ore
  sh.getRange(TB.R_MESE, cEuro, 13, nEuro).setNumberFormat('#,##0.00 €');  // lordo e netto
  sh.getRange(TB.R_MESE, TB_C_TURNI, 13, TB_NCOL - TB_C_TURNI + 1).setHorizontalAlignment('left');
  sh.getRange(TB.R_TOT, 1, 1, TB_NCOL).setFontWeight('bold').setBackground(TB_COLORI.tot);
  sh.getRange(TB.R_TESTA, 1, TB.R_TOT - TB.R_TESTA + 1, TB_NCOL).setBorder(true, true, true, true, null, true, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);

  // calendario
  sh.getRange(TB.C_SEZ, 1, 1, TB_NCOL).merge().setValue('📅  CALENDARIO ' + anno).setFontWeight('bold').setFontSize(12).setBackground(TB_COLORI.sez);
  const tc = ['Mese'];
  for (let d = 1; d <= 31; d++) tc.push(d);
  tc.push('Turni', 'Ore', 'Straord.');
  sh.getRange(TB.C_TESTA, 1, 1, TB_NCOL).setValues([tc]).setBackground(TB_COLORI.testaCal).setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center');
  const cal = sh.getRange(TB.C_MESE, 1, 12, TB_NCOL);
  cal.setHorizontalAlignment('center').setVerticalAlignment('middle').setFontSize(9);
  sh.getRange(TB.C_MESE, 1, 12, 1).setHorizontalAlignment('left').setFontWeight('bold').setFontSize(10);
  sh.getRange(TB.C_MESE, 34, 12, 2).setNumberFormat('0.##');
  sh.setRowHeights(TB.C_MESE, 12, 24);
  sh.getRange(TB.C_TESTA, 1, 13, TB_NCOL).setBorder(true, true, true, true, true, true, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);

  // legenda: fino a 11 tipi, 3 colonne ciascuno
  sh.getRange(TB.LEG, 1).setValue('Legenda').setFontWeight('bold');
  sh.getRange(TB.LEG, 2, 1, 33).setHorizontalAlignment('center').setFontWeight('bold').setFontSize(9);
  for (let i = 0; i < 11; i++) sh.getRange(TB.LEG, 2 + i * 3, 1, 3).merge();
  sh.getRange(TB.NOTA, 1).setValue('Celle rosa = domeniche e festivi · 🎉 = festività · più turni nello stesso giorno: sigle una dopo l\'altra (es. MP) · C4 = 4 ore di corso')
    .setFontColor('#5f6368').setFontSize(9);
  try { sh.protect().setDescription('Tabellone aggiornato dall\'app').setWarningOnly(true); } catch (e) { }
}

/** Riscrive i dati dei tabelloni: anno in corso e anni con turni. */
function scriviTabelloni_(x) {
  const anni = {};
  anni[annoCorrente_(x.ss)] = 1;
  x.turni.forEach(t => { anni[+t.date.slice(0, 4)] = 1; });
  Object.keys(anni).forEach(y => scriviTabellone_(x, +y));
}

function scriviTabellone_(x, anno) {
  const sh = foglioTabellone_(x.ss, anno), s = x.s;
  const r2 = v => Math.round(v * 100) / 100, oreTxt = v => String(r2(v)).replace('.', ',');
  const tipiOrd = x.tipi.lista;
  const ordine = t => { const i = tipiOrd.indexOf(t); return i < 0 ? 99 : i; };
  const delAnno = x.turni.filter(t => +t.date.slice(0, 4) === anno);
  const perGiorno = {}, conta = {};
  delAnno.forEach(t => {
    (perGiorno[t.date] = perGiorno[t.date] || []).push(t);
    const m = +t.date.slice(5, 7), c = conta[m] = conta[m] || {};
    const k = t.tipoObj ? t.tipoObj.sigla || t.tipoObj.nome : t.tipo;
    c[k] = (c[k] || 0) + 1;
  });
  const oggi = Utilities.formatDate(new Date(), x.tz, 'yyyy-MM');

  // --- riepilogo ---
  const riep = [], fcR = [];
  const tot = { g: 0, ore: 0, corso: 0, ord: 0, stra: 0, fest: 0, ass: 0, ferie: 0, lordo: 0, netto: 0, turni: {} };
  for (let m = 1; m <= 12; m++) {
    const k = anno + '-' + pad2_(m), M = x.mesi[k], riga = new Array(TB_NCOL).fill('');
    riga[0] = MESI[m - 1];
    if (M) {
      const v = [M.giorniLav, r2(M.ore), r2(M.corso), r2(M.ord), r2(M.stra), r2(M.festive), r2(M.assenze), M.ferie, r2(M.lordo), r2(M.netto)];
      v.forEach((val, i) => { riga[1 + i * 3] = val || (i === 0 ? 0 : ''); });
      tot.g += M.giorniLav; tot.ore += M.ore; tot.corso += M.corso; tot.ord += M.ord; tot.stra += M.stra;
      tot.fest += M.festive; tot.ass += M.assenze; tot.ferie += M.ferie; tot.lordo += M.lordo; tot.netto += M.netto;
    }
    const c = conta[m] || {};
    riga[TB_C_TURNI - 1] = Object.keys(c).sort((a, b) => ordine(x.tipi.mappa[a.toLowerCase()]) - ordine(x.tipi.mappa[b.toLowerCase()]))
      .map(sg => sg + ' ' + c[sg]).join(' · ');
    Object.keys(c).forEach(sg => { tot.turni[sg] = (tot.turni[sg] || 0) + c[sg]; });
    riep.push(riga);
    const futuro = k > oggi;
    fcR.push(new Array(TB_NCOL).fill(futuro && !M ? '#9aa0a6' : '#202124').map((col, i) => (i === 13 && M && M.stra > 0) ? '#c5221f' : col));
  }
  const rt = new Array(TB_NCOL).fill('');
  rt[0] = 'TOTALE ' + anno;
  [tot.g, r2(tot.ore), r2(tot.corso), r2(tot.ord), r2(tot.stra), r2(tot.fest), r2(tot.ass), tot.ferie, r2(tot.lordo), r2(tot.netto)]
    .forEach((val, i) => { rt[1 + i * 3] = val || (i === 0 ? 0 : ''); });
  rt[TB_C_TURNI - 1] = Object.keys(tot.turni).sort((a, b) => ordine(x.tipi.mappa[a.toLowerCase()]) - ordine(x.tipi.mappa[b.toLowerCase()]))
    .map(sg => sg + ' ' + tot.turni[sg]).join(' · ');
  riep.push(rt);
  fcR.push(new Array(TB_NCOL).fill('#202124'));
  sh.getRange(TB.R_MESE, 1, 13, TB_NCOL).setValues(riep).setFontColors(fcR);

  // --- calendario ---
  const val = [], bg = [], fc = [], note = [];
  for (let m = 1; m <= 12; m++) {
    const n = new Date(anno, m, 0).getDate(), k = anno + '-' + pad2_(m), M = x.mesi[k];
    const rv = [MESI[m - 1]], rb = [null], rf = ['#202124'], rn = [''];
    let nT = 0;
    for (let d = 1; d <= 31; d++) {
      if (d > n) { rv.push(''); rb.push(TB_COLORI.vuoto); rf.push('#202124'); rn.push(''); continue; }
      const iso = k + '-' + pad2_(d), lista = (perGiorno[iso] || []).slice().sort((a, b) => ordine(a.tipoObj) - ordine(b.tipoObj));
      const festa = festivitaNome_(iso, s), rosa = isFestivo_(iso, s);
      const giorno = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'][new Date(anno, m - 1, d).getDay()] + ' ' + d + ' ' + MESI[m - 1];
      if (!lista.length) {
        rv.push(festa ? '🎉' : ''); rb.push(rosa ? TB_COLORI.festa : null); rf.push('#202124');
        rn.push(festa ? giorno + '\n🎉 ' + festa : '');
        continue;
      }
      nT += lista.length;
      const sigla = t => {
        const tp = t.tipoObj, sg = tp ? (tp.sigla || tp.nome.slice(0, 2)) : String(t.tipo).slice(0, 2);
        return tp && tp.cat === 'Ore variabili' ? sg + oreTxt(t.calc.ore) : sg;
      };
      rv.push(lista.map(sigla).join(''));
      const tp0 = lista[0].tipoObj;
      rb.push(tp0 ? tp0.colore : '#9aa0a6'); rf.push(tp0 ? contrasto_(tp0.colore) : '#ffffff');
      rn.push(giorno + (festa ? '\n🎉 ' + festa : '') + '\n' + lista.map(t => {
        const tp = t.tipoObj, nome = (tp && tp.icona ? tp.icona + ' ' : '') + t.tipoNome;
        if (tp && tp.cat === 'Ore variabili') return nome + ' · ' + oreTxt(t.calc.ore) + ' h';
        return nome + (t.inizioStr && t.fineStr ? ' ' + t.inizioStr + '–' + t.fineStr : '') + (t.calc.ore ? ' (' + oreTxt(t.calc.ore) + ' h)' : '');
      }).join('\n'));
    }
    rv.push(nT || '', M && M.ore ? r2(M.ore) : '', M && M.stra ? r2(M.stra) : '');
    rb.push(null, null, null); rf.push('#202124', '#202124', '#c5221f'); rn.push('', '', '');
    val.push(rv); bg.push(rb); fc.push(rf); note.push(rn);
  }
  sh.getRange(TB.C_MESE, 1, 12, TB_NCOL).setValues(val).setBackgrounds(bg).setFontColors(fc).setNotes(note);

  // --- legenda ---
  const lv = new Array(33).fill(''), lb = new Array(33).fill(null), lf = new Array(33).fill('#202124');
  tipiOrd.filter(t => t.attivo || delAnno.some(u => u.tipoObj === t)).slice(0, 11).forEach((t, i) => {
    lv[i * 3] = (t.icona ? t.icona + ' ' : '') + (t.sigla ? t.sigla + ' ' : '') + t.nome;
    lb[i * 3] = t.colore; lf[i * 3] = contrasto_(t.colore);
  });
  sh.getRange(TB.LEG, 2, 1, 33).setValues([lv]).setBackgrounds([lb]).setFontColors([lf]);
}

/* ======================= FESTIVITÀ E DATE ======================= */

/** Giorno festivo ai fini della paga: domenica (se attivata) o festività. */
function isFestivo_(iso, s) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  if (s.domenica && new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0) return true;
  return !!festivitaNome_(iso, s);
}

/** Nome della festività (calendario italiano + festività locali), oppure null. */
function festivitaNome_(iso, s) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10), md = iso.slice(5);
  const fisse = {
    '01-01': 'Capodanno', '01-06': 'Epifania', '04-25': 'Festa della Liberazione', '05-01': 'Festa del Lavoro',
    '06-02': 'Festa della Repubblica', '08-15': 'Ferragosto', '11-01': 'Ognissanti', '12-08': 'Immacolata Concezione',
    '12-25': 'Natale', '12-26': 'Santo Stefano',
  };
  if (fisse[md]) return fisse[md];
  if (y >= 2026 && md === '10-04') return 'San Francesco d\'Assisi'; // festa nazionale dal 2026
  const pasqua = pasqua_(y), pasquetta = new Date(pasqua.getTime() + 864e5);
  if (pasqua.getUTCMonth() + 1 === m && pasqua.getUTCDate() === d) return 'Pasqua';
  if (pasquetta.getUTCMonth() + 1 === m && pasquetta.getUTCDate() === d) return 'Lunedì dell\'Angelo (Pasquetta)';
  if (s.locali.indexOf(md) >= 0) return 'Festività locale';
  return null;
}

function pasqua_(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mese - 1, giorno));
}

/* ======================= LETTURA DEI FOGLI ======================= */

let IMP_CACHE = null, TIPI_CACHE = null, CALC_CACHE = null; // validi solo nella singola esecuzione

function leggiImpostazioni_() {
  if (IMP_CACHE) return IMP_CACHE;
  IMP_CACHE = leggiImpostazioniDalFoglio_();
  return IMP_CACHE;
}

function leggiImpostazioniDalFoglio_() {
  const sh = ss_().getSheetByName(FOGLI.IMP), mappa = {};
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(r => { mappa[r[0].trim()] = r[1].trim(); });
  }
  const raw = {};
  IMPOSTAZIONI.forEach(([k, label, def]) => { raw[k] = mappa[label] ? mappa[label] : def; });
  return {
    paga: num_(raw.paga), oreMese: num_(raw.oreMese),
    pStra: num_(raw.pStra) / 100, pFest: num_(raw.pFest) / 100, tratt: num_(raw.tratt) / 100,
    domenica: /^s/i.test(raw.domenica), locali: festiviLocali_(raw.locali), localiRaw: raw.locali,
    calId: raw.calId, nomeTab: raw.nomeTab,
    ferieAnno: num_(raw.ferieAnno), ferieResiduo: num_(raw.ferieResiduo), ferieUnita: /^ore/i.test(raw.ferieUnita) ? 'ore' : 'giorni',
    ferieSabato: !/^n/i.test(raw.ferieSabato),
    ferieSaldo: raw.ferieSaldo === '' ? null : num_(raw.ferieSaldo), ferieSaldoMese: /^\d{4}-\d{2}$/.test(raw.ferieSaldoMese) ? raw.ferieSaldoMese : '',
  };
}

function scriviImpostazione_(chiave, valore) {
  IMP_CACHE = null; CALC_CACHE = null;
  const voce = IMPOSTAZIONI.filter(r => r[0] === chiave)[0];
  const sh = ss_().getSheetByName(FOGLI.IMP);
  const n = sh.getLastRow() - 1;
  const col = n > 0 ? sh.getRange(2, 1, n, 1).getValues() : [];
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim() === voce[1]) { sh.getRange(i + 2, 2).setValue(valore); return; }
  }
  sh.appendRow([voce[1], valore, voce[3]]);
}

function leggiTipi_() {
  if (TIPI_CACHE) return TIPI_CACHE;
  TIPI_CACHE = leggiTipiDalFoglio_();
  return TIPI_CACHE;
}

function leggiTipiDalFoglio_() {
  const sh = ss_().getSheetByName(FOGLI.TIPI), lista = [], mappa = {};
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, NTIPI).getDisplayValues().forEach(r => {
      const nome = r[0].trim();
      if (!nome) return;
      const cat = CATEGORIE.filter(c => c.toLowerCase() === r[5].trim().toLowerCase())[0] || 'Lavoro';
      const inizio = toMin_(r[2]), fine = toMin_(r[3]), colCal = Math.round(num_(r[7]));
      lista.push({
        nome, sigla: r[1].trim(), inizio, fine,
        inizioStr: inizio == null ? '' : fmtMin_(inizio), fineStr: fine == null ? '' : fmtMin_(fine),
        pausa: num_(r[4]), cat, oreRetr: num_(r[6]),
        colCal: colCal >= 1 && colCal <= 11 ? colCal : 0, colore: COLORI[colCal] || '#9AA0A6',
        icona: (r[8] || '').trim(), attivo: !/^no$/i.test((r[9] || '').trim()),
      });
    });
  }
  lista.forEach(t => { mappa[t.nome.toLowerCase()] = t; });
  lista.forEach(t => { if (t.sigla && !mappa[t.sigla.toLowerCase()]) mappa[t.sigla.toLowerCase()] = t; });
  return { lista, mappa };
}

function leggiTurni_(sh, tz) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const rng = sh.getRange(2, 1, n, NCOL), v = rng.getValues(), d = rng.getDisplayValues(), out = [];
  for (let i = 0; i < n; i++) {
    const date = dataIso_(v[i][COL.DATA], tz), tipo = String(v[i][COL.TIPO]).trim();
    if (!date || !tipo) continue;
    const inizio = toMin_(d[i][COL.INIZIO]), fine = toMin_(d[i][COL.FINE]);
    out.push({
      sh, row: i + 2, date, tipo, inizio, fine,
      inizioStr: inizio == null ? '' : fmtMin_(inizio), fineStr: fine == null ? '' : fmtMin_(fine),
      pausa: d[i][COL.PAUSA] === '' ? null : num_(d[i][COL.PAUSA]),
      oreMan: d[i][COL.OREMAN] === '' ? null : num_(d[i][COL.OREMAN]),
      id: String(v[i][COL.ID] || ''),
    });
  }
  return out;
}

/** Turni di tutti gli anni (ogni turno sa in quale foglio e riga si trova). */
function leggiTuttiTurni_(ss, tz) {
  return fogliTurni_(ss).reduce((tutti, sh) => tutti.concat(leggiTurni_(sh, tz)), []);
}

/* ======================= UTILITÀ ======================= */

/** Foglio dell'utente che sta usando l'app (null se non ancora creato o cestinato). */
let SS_CACHE = null; // valido solo durante la singola esecuzione

function ss_() {
  if (SS_CACHE) return SS_CACHE;
  const props = PropertiesService.getUserProperties(), id = props.getProperty('SS_ID');
  if (!id) return null;
  try {
    const cache = CacheService.getUserCache(), chiave = 'ok_' + id;
    if (!cache.get(chiave)) {
      const f = Drive.Files.get(id, { fields: 'trashed' });
      if (f.trashed) { props.deleteProperty('SS_ID'); return null; }
      cache.put(chiave, '1', 21600);
    }
    SS_CACHE = SpreadsheetApp.openById(id);
    return SS_CACHE;
  } catch (e) {
    props.deleteProperty('SS_ID');
    return null;
  }
}

function riga_(data, tipo, inizio, fine, pausa, oreMan, id) {
  const r = new Array(NCOL).fill('');
  r[COL.DATA] = data; r[COL.TIPO] = tipo; r[COL.INIZIO] = inizio; r[COL.FINE] = fine;
  r[COL.PAUSA] = pausa; r[COL.OREMAN] = oreMan; r[COL.ID] = id;
  return r;
}

/** Blocco per utente: due persone diverse non si aspettano a vicenda. */
function conLock_(fn) {
  const lock = LockService.getUserLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function foglio_(ss, nome) { return ss.getSheetByName(nome) || ss.insertSheet(nome); }

function ordina_(sh) {
  const n = sh.getLastRow() - 1;
  if (n > 1) sh.getRange(2, 1, n, NCOL).sort([{ column: 1, ascending: true }, { column: 3, ascending: true }]);
}

function stileIntestazione_(sh, n) {
  sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  sh.setFrozenRows(1);
}

function dataIso_(v, tz) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v || '');
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  return '';
}

function toMin_(v) {
  if (v == null || v === '') return null;
  const m = String(v).match(/(\d{1,2})(?:[:.,h](\d{2}))?/);
  if (!m) return null;
  const h = +m[1], mi = +(m[2] || 0);
  if (h > 24 || mi > 59) return null;
  return (h % 24) * 60 + mi;
}

function fmtMin_(min) { return pad2_(Math.floor(min / 60)) + ':' + pad2_(min % 60); }
function pad2_(n) { return String(n).padStart(2, '0'); }

function num_(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v == null ? '' : v).replace(/[^\d,.\-]/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function festiviLocali_(str) {
  const out = [];
  String(str || '').replace(/(\d{1,2})[\/.\-](\d{1,2})/g, (_, d, m) => { out.push(pad2_(m) + '-' + pad2_(d)); return ''; });
  return out;
}

function contrasto_(hex) {
  const h = String(hex).replace('#', '');
  const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#000000' : '#ffffff';
}

/* Icona dell'app Strafobico (PNG 192×192), usata da pubblicaIcona(). */
const ICONA_PNG_B64 = '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';
