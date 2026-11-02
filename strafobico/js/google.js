/* =====================================================================
   Strafobico — sincronizzazione con il proprio account Google
   - accesso con Google (Google Identity Services, solo nel browser: nessun server)
   - Drive:    AppTurni › Strafobico › foglio «Turni lavoro» e Buste paga › anno
   - Fogli:    Tabellone <anno>, Turni <anno>, Buste paga, Tipi turno, Impostazioni (nascosto)
   - Calendar: calendario «Turni lavoro» con un evento per ogni turno
   I dati restano sempre anche sul telefono: senza rete l'app funziona e
   le modifiche vengono mandate a Google alla prima occasione.
   ===================================================================== */
(function (glob) {
  'use strict';
  const S = glob.Strafobico;
  const CFG = glob.STRAFOBICO_CONFIG || {};
  const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.app.created';
  const NOME_FOGLIO = 'Turni lavoro', NOME_CAL = 'Turni lavoro', CARTELLE = ['AppTurni', 'Strafobico'];
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome'; } catch (e) { return 'Europe/Rome'; } })();
  const MESI = S.MESI, pad2 = S.pad2;

  /* ---------------- stato visibile all'interfaccia ---------------- */
  const stato = { fase: 'locale', messaggio: '', errore: '', ultima: 0, inCorso: false };
  const ascolta = [];
  function avvisa(fase, messaggio, errore) {
    Object.assign(stato, { fase, messaggio: messaggio || '', errore: errore || '' });
    ascolta.forEach(f => { try { f(Object.assign({ inAttesa: inAttesa() }, stato)); } catch (e) { } });
  }
  function inAttesa() {
    const D = S.dati(); if (!D) return 0;
    const p = D.pend;
    return Object.keys(p.giorni).length + (p.tipi ? 1 : 0) + Object.keys(p.imp).length + Object.keys(p.buste).length + p.evDel.length +
      D.turni.filter(t => !t.ev).length;
  }
  class ServeAccesso extends Error { constructor() { super('serve l\'accesso a Google'); this.accesso = true; } }

  /* ---------------- accesso ---------------- */
  let client = null, token = null, scadenza = 0, attesaToken = null;
  function caricaScript(url) {
    return new Promise((ok, ko) => {
      if (document.querySelector('script[src="' + url + '"]')) return ok();
      const s = document.createElement('script'); s.src = url; s.async = true; s.onload = ok; s.onerror = () => ko(new Error('non riesco a contattare Google'));
      document.head.appendChild(s);
    });
  }
  async function preparaClient() {
    if (client) return client;
    if (!CFG.clientId || /INSERISCI/.test(CFG.clientId)) throw new Error('manca il Client ID di Google in js/config.js (vedi README)');
    await caricaScript('https://accounts.google.com/gsi/client');
    client = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId, scope: SCOPE,
      callback: r => {
        const a = attesaToken; attesaToken = null; if (!a) return;
        if (r.error) return a.ko(new Error(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/calendar.app.created'))
          return a.ko(new Error('per sincronizzare servono i permessi per Drive e Calendar: riprova e spunta tutte le caselle'));
        token = r.access_token; scadenza = Date.now() + (r.expires_in || 3600) * 1000;
        const D = S.dati(); D.meta.tok = token; D.meta.tokScad = scadenza; S.salva();
        a.ok(token);
      },
      error_callback: e => {
        const a = attesaToken; attesaToken = null; if (!a) return;
        const t = e && e.type;
        a.ko(new Error(t === 'popup_closed' ? 'accesso annullato' : t === 'popup_failed_to_open'
          ? 'il browser ha bloccato la finestra di accesso di Google: consenti i popup per questo sito e riprova' : 'accesso non riuscito'));
      },
    });
    return client;
  }
  /** Token valido; se è scaduto serve un tocco dell'utente (i browser bloccano le finestre di accesso automatiche). */
  function prendiToken(interattivo) {
    const D = S.dati();
    if (!token && D.meta.tok && D.meta.tokScad > Date.now() + 60000) { token = D.meta.tok; scadenza = D.meta.tokScad; }
    if (token && Date.now() < scadenza - 60000) return Promise.resolve(token);
    if (!interattivo) return Promise.reject(new ServeAccesso());
    // la finestra di Google va aperta subito, nello stesso tocco: i browser bloccano le finestre aperte dopo un'attesa
    const chiedi = () => new Promise((ok, ko) => {
      attesaToken = { ok, ko };
      client.requestAccessToken({ prompt: D.meta.email ? '' : 'consent', login_hint: D.meta.email || undefined });
    });
    return client ? chiedi() : preparaClient().then(chiedi);
  }
  async function accedi() {
    await prendiToken(true);
    const D = S.dati();
    try { const u = await api('GET', 'https://www.googleapis.com/oauth2/v3/userinfo'); if (u.email) { if (D.meta.email && D.meta.email !== u.email) cambioAccount(u.email); D.meta.email = u.email; } } catch (e) { }
    S.salva();
    return sincronizza(true);
  }
  /** Account diverso: il foglio e il calendario sono di un altro utente, si ricomincia da zero su Google. */
  function cambioAccount(email) {
    const D = S.dati();
    ['ssId', 'ssUrl', 'cartellaId', 'busteId', 'busteAnni', 'ultimaSync'].forEach(k => { delete D.meta[k]; });
    D.imp.calId = ''; D.turni.forEach(t => { t.ev = ''; }); D.pend.evDel = [];
    D.turni.forEach(t => { D.pend.giorni[t.date] = Date.now(); }); D.pend.tipi = Date.now();
  }
  function esci() {
    const D = S.dati();
    if (token && glob.google && google.accounts) { try { google.accounts.oauth2.revoke(token, () => { }); } catch (e) { } }
    token = null; scadenza = 0; delete D.meta.tok; delete D.meta.tokScad; delete D.meta.email; S.salva();
    avvisa('locale', 'Non collegato a Google: i dati restano su questo dispositivo');
  }

  /* ---------------- chiamate alle API ---------------- */
  async function api(metodo, url, corpo, opz) {
    opz = opz || {};
    const t = await prendiToken(false);
    const h = { Authorization: 'Bearer ' + t };
    let body = corpo;
    if (corpo != null && !opz.grezzo) { h['Content-Type'] = 'application/json'; body = JSON.stringify(corpo); }
    if (opz.tipo) h['Content-Type'] = opz.tipo;
    for (let tentativo = 0; ; tentativo++) {
      const r = await fetch(url, { method: metodo, headers: h, body });
      if (r.status === 401) { token = null; S.dati().meta.tok = null; throw new ServeAccesso(); }
      if ((r.status === 429 || r.status >= 500 || (r.status === 403 && /rateLimit|userRateLimit/i.test(await r.clone().text()))) && tentativo < 4) {
        await new Promise(ok => setTimeout(ok, 800 * Math.pow(2, tentativo))); continue;
      }
      if (opz.ok404 && (r.status === 404 || r.status === 410)) return null;
      if (!r.ok) {
        let m = r.status + ''; try { const j = await r.json(); m = (j.error && (j.error.message || j.error)) || m; } catch (e) { }
        throw new Error(m);
      }
      return r.status === 204 ? null : (opz.testo ? r.text() : r.json());
    }
  }
  const DRIVE = 'https://www.googleapis.com/drive/v3/files', SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets', CAL = 'https://www.googleapis.com/calendar/v3';
  const q = s => encodeURIComponent(s);

  /* ---------------- Drive: cartelle e foglio ---------------- */
  async function cartella(nome, padre) {
    const r = await api('GET', DRIVE + '?fields=files(id)&pageSize=1&q=' + q("mimeType='application/vnd.google-apps.folder' and name='" + nome.replace(/'/g, "\\'") + "' and trashed=false and '" + padre + "' in parents"));
    if (r.files && r.files.length) return r.files[0].id;
    return (await api('POST', DRIVE + '?fields=id', { name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [padre] })).id;
  }
  async function esiste(id) {
    if (!id) return false;
    const f = await api('GET', DRIVE + '/' + id + '?fields=id,trashed', null, { ok404: true });
    return !!(f && !f.trashed);
  }
  async function preparaDrive() {
    const D = S.dati(), M = D.meta;
    if (!(await esiste(M.cartellaId))) { let p = 'root'; for (const n of CARTELLE) p = await cartella(n, p); M.cartellaId = p; }
    if (!(await esiste(M.busteId))) { M.busteId = await cartella('Buste paga', M.cartellaId); M.busteAnni = {}; }
    M.busteAnni = M.busteAnni || {};
    const anno = S.annoCorrente();
    if (!M.busteAnni[anno]) M.busteAnni[anno] = await cartella(String(anno), M.busteId);
    let nuovo = false;
    if (!(await esiste(M.ssId))) {
      const r = await api('GET', DRIVE + '?fields=files(id)&pageSize=1&q=' + q("mimeType='application/vnd.google-apps.spreadsheet' and name='" + NOME_FOGLIO + "' and trashed=false and '" + M.cartellaId + "' in parents"));
      if (r.files && r.files.length) M.ssId = r.files[0].id;
      else {
        const ss = await api('POST', SHEETS, { properties: { title: NOME_FOGLIO, locale: 'it_IT', timeZone: TZ } });
        M.ssId = ss.spreadsheetId; nuovo = true;
        await api('PATCH', DRIVE + '/' + M.ssId + '?addParents=' + M.cartellaId + '&removeParents=root&fields=id', {});
      }
      M.ultimaSync = 0;
    }
    M.ssUrl = 'https://docs.google.com/spreadsheets/d/' + M.ssId + '/edit';
    S.salva();
    return nuovo;
  }
  async function cartellaAnno(y) {
    const M = S.dati().meta;
    if (!M.busteAnni[y]) { M.busteAnni[y] = await cartella(String(y), M.busteId); S.salva(); }
    return M.busteAnni[y];
  }

  /* ---------------- lettura del foglio ---------------- */
  const dataIso = v => {
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
    const s = String(v || ''); let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
    m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    return m ? (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2(m[2]) + '-' + pad2(m[1]) : '';
  };
  async function leggiFoglio() {
    const id = S.dati().meta.ssId;
    const info = await api('GET', SHEETS + '/' + id + '?fields=sheets.properties(sheetId,title,index,hidden)');
    const fogli = {}; (info.sheets || []).forEach(s => { fogli[s.properties.title] = s.properties; });
    const turniNomi = Object.keys(fogli).filter(n => /^Turni \d{4}$/.test(n));
    const vecchio = fogli['Turni'] ? ['Turni'] : []; // foglio della prima versione (un solo foglio per tutti gli anni)
    const intervalli = ['Tipi turno!A2:J', 'Impostazioni!A2:B', 'Buste paga!A1:K'].filter(r => fogli[r.split('!')[0]])
      .concat(turniNomi.concat(vecchio).map(n => "'" + n + "'!A2:M"));
    const remoto = { fogli, tipi: null, imp: null, buste: null, turni: [] };
    if (!intervalli.length) return remoto;
    const url = SHEETS + '/' + id + '/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&' + intervalli.map(r => 'ranges=' + q(r)).join('&');
    const vr = (await api('GET', url)).valueRanges || [];
    let formule = [];
    if (fogli['Buste paga']) formule = ((await api('GET', SHEETS + '/' + id + '/values/' + q('Buste paga!A1:K') + '?valueRenderOption=FORMULA')).values || []);
    vr.forEach(v => {
      const nome = v.range.split('!')[0].replace(/^'|'$/g, ''), righe = v.values || [];
      if (nome === 'Tipi turno') remoto.tipi = righe.filter(r => r[0]).map(r => Array.from({ length: 10 }, (_, i) => r[i] == null ? '' : r[i]));
      else if (nome === 'Impostazioni') {
        remoto.imp = {};
        righe.forEach(r => { const voce = S.IMPOSTAZIONI.find(x => x[1] === String(r[0] || '').trim()); if (voce) remoto.imp[voce[0]] = r[1] == null ? '' : String(r[1]); });
      } else if (nome === 'Buste paga') {
        remoto.buste = {};
        const testa = (righe[0] || []).map(x => String(x || '').trim()), col = n => testa.indexOf(n);
        const cPdf = col('PDF');
        righe.slice(1).forEach((r, i) => {
          const m = String(r[0] || '').match(/^(\d{4})-(\d{2})$/); if (!m) return;
          const val = n => { const c = col(n); return c < 0 || r[c] === '' || r[c] == null ? '' : r[c]; }, numero = n => { const v = val(n); return v === '' ? '' : S.num(v); };
          const f = cPdf < 0 ? '' : String((formule[i + 1] || [])[cPdf] || ''), link = (f.match(/HYPERLINK\("([^"]+)"/i) || [])[1] || '';
          remoto.buste[m[0]] = { mese: m[0], lordo: numero('Lordo €'), trattenute: numero('Trattenute €'), netto: numero('Netto €'), ferie: numero('Ferie residue'), unita: val('Unità ferie'),
            rol: numero('ROL residui'), exfest: numero('Ex festività residue'), unitaPermessi: val('Unità permessi'), link, fileId: (link.match(/\/d\/([^/]+)/) || [])[1] || '' };
        });
      } else {
        righe.forEach(r => {
          const date = dataIso(r[0]), tipo = String(r[1] == null ? '' : r[1]).trim(); if (!date || !tipo) return;
          const ora = v => typeof v === 'number' ? S.fmtMin(Math.round(v * 1440) % 1440) : String(v == null ? '' : v);
          remoto.turni.push({ date, tipo, inizio: ora(r[2]), fine: ora(r[3]), pausa: r[4] === '' || r[4] == null ? '' : S.num(r[4]),
            oreMan: r[5] === '' || r[5] == null ? '' : S.num(r[5]), note: r[11] == null ? '' : String(r[11]), ev: r[12] == null ? '' : String(r[12]) });
        });
      }
    });
    return remoto;
  }

  /** Unisce il foglio (modificabile anche a mano o da un altro dispositivo) con le modifiche fatte qui e non ancora inviate. */
  function unisci(remoto, istantanea) {
    const D = S.dati(), p = D.pend;
    // turni: per ogni giorno modificato qui vince la versione locale, per gli altri quella del foglio
    const locali = {}; D.turni.forEach(t => { (locali[t.date] = locali[t.date] || []).push(t); });
    const perData = {}; remoto.turni.forEach(t => { (perData[t.date] = perData[t.date] || []).push(t); });
    const risultato = [];
    Object.keys(perData).forEach(d => {
      if (p.giorni[d]) {
        const tenuti = new Set((locali[d] || []).map(t => t.ev).filter(Boolean));
        perData[d].forEach(t => { if (t.ev && t.ev !== '-' && !tenuti.has(t.ev)) p.evDel.push(t.ev); });
      } else risultato.push(...perData[d]);
    });
    Object.keys(locali).forEach(d => { if (p.giorni[d] || (!perData[d] && !istantanea.giaSincronizzato)) risultato.push(...locali[d]); });
    // giorni che esistevano solo qui e che dal foglio sono stati tolti (dopo la prima sincronizzazione): restano tolti
    D.turni = risultato;
    if (!istantanea.giaSincronizzato) Object.keys(locali).forEach(d => { if (!perData[d]) p.giorni[d] = p.giorni[d] || Date.now(); });
    if (remoto.tipi && remoto.tipi.length && !p.tipi) D.tipi = remoto.tipi;
    if (remoto.imp) Object.keys(remoto.imp).forEach(k => { if (!p.imp[k]) D.imp[k] = remoto.imp[k]; });
    if (remoto.buste) Object.keys(remoto.buste).forEach(k => { if (!p.buste[k]) D.buste[k] = remoto.buste[k]; });
    if (S.aggiungiFerieSeManca()) p.tipi = Date.now();
    S.invalida();
  }

  /* ---------------- buste paga: caricamento dei file ---------------- */
  async function caricaBuste() {
    const D = S.dati();
    for (const k of Object.keys(D.pend.buste)) {
      const b = D.buste[k], f = await S.idbGet('file', k);
      if (!b || !f) continue;
      const y = +k.slice(0, 4), pdf = /pdf/i.test(f.tipo) || /\.pdf$/i.test(f.nome);
      const est = pdf ? 'pdf' : ((f.nome.match(/\.(\w{2,4})$/) || [])[1] || 'jpg').toLowerCase(), mime = pdf ? 'application/pdf' : (f.tipo || 'image/jpeg');
      const meta = { name: 'Busta paga ' + MESI[+k.slice(5) - 1] + ' ' + y + '.' + est, mimeType: mime, parents: [await cartellaAnno(y)] };
      const confine = 'strafobico' + Math.random().toString(36).slice(2);
      const bin = atob(f.b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const corpo = new Blob(['--' + confine + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + confine + '\r\nContent-Type: ' + mime + '\r\n\r\n',
        bytes, '\r\n--' + confine + '--']);
      const r = await api('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', corpo, { grezzo: true, tipo: 'multipart/related; boundary=' + confine });
      b.fileId = r.id; b.link = 'https://drive.google.com/file/d/' + r.id + '/view';
      if (b.vecchioFile) { try { await api('PATCH', DRIVE + '/' + b.vecchioFile + '?fields=id', { trashed: true }, { ok404: true }); } catch (e) { } b.vecchioFile = ''; }
      await S.idbSet('file', k, undefined);
      S.salva();
    }
  }

  /* ---------------- Calendar ---------------- */
  async function calendario() {
    const D = S.dati();
    let id = D.imp.calId;
    if (id) { const c = await api('GET', CAL + '/calendars/' + q(id), null, { ok404: true }); if (!c) id = ''; }
    if (!id) {
      id = (await api('POST', CAL + '/calendars', { summary: NOME_CAL, description: 'Turni di lavoro gestiti dall\'app Strafobico', timeZone: TZ })).id;
      // calendario nuovo: tutti gli eventi vanno ricreati
      D.turni.forEach(t => { if (t.ev !== '-') t.ev = ''; }); D.pend.evDel = [];
      D.imp.calId = id; S.salva();
    }
    return id;
  }
  const giornoDopo = iso => { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + 1)); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); };
  function evento(t, tipo) {
    let titolo = tipo ? (tipo.icona ? tipo.icona + ' ' : '') + tipo.nome + (tipo.sigla ? ' (' + tipo.sigla + ')' : '') : t.tipo;
    if (tipo && tipo.cat === 'Ore variabili') titolo += ' · ' + String(t.oreMan !== '' && t.oreMan != null ? S.num(t.oreMan) : tipo.oreRetr).replace('.', ',') + ' h';
    const e = { summary: titolo, description: 'Turno gestito dall\'app Strafobico', reminders: { useDefault: false } };
    if (tipo && tipo.colCal) e.colorId = String(tipo.colCal);
    const hi = S.toMin(t.inizio), hf = S.toMin(t.fine);
    if (hi != null && hf != null && (!tipo || tipo.cat === 'Lavoro')) {
      const fineData = hf <= hi ? giornoDopo(t.date) : t.date;
      e.start = { dateTime: t.date + 'T' + S.fmtMin(hi) + ':00', timeZone: TZ }; e.end = { dateTime: fineData + 'T' + S.fmtMin(hf) + ':00', timeZone: TZ };
    } else { e.start = { date: t.date }; e.end = { date: giornoDopo(t.date) }; }
    return e;
  }
  async function sincronizzaEventi(max) {
    const D = S.dati(), calId = await calendario(), tipi = S.leggiTipi();
    let fatti = 0, errore = '';
    while (D.pend.evDel.length && fatti < max) {
      const id = D.pend.evDel[0];
      await api('DELETE', CAL + '/calendars/' + q(calId) + '/events/' + q(id), null, { ok404: true });
      D.pend.evDel.shift(); fatti++;
    }
    const mancanti = D.turni.filter(t => !t.ev);
    for (const t of mancanti) {
      if (fatti >= max) break;
      const tipo = tipi.mappa[String(t.tipo).toLowerCase()] || null;
      if (tipo && tipo.cat === 'Riposo') { t.ev = '-'; continue; }
      try { t.ev = (await api('POST', CAL + '/calendars/' + q(calId) + '/events?fields=id', evento(t, tipo))).id; }
      catch (e) { if (e.accesso) throw e; errore = 'Evento del ' + t.date + ' non creato: ' + e.message; break; }
      fatti++;
    }
    S.salva();
    return { restano: D.pend.evDel.length + D.turni.filter(t => !t.ev).length, errore };
  }

  /* ---------------- scrittura dei fogli ---------------- */
  // Bozza di un foglio: celle con valori e formati, poi tradotta in una sola richiesta alle API di Fogli.
  class Bozza {
    constructor() { this.c = {}; this.merges = []; this.larg = {}; this.alt = {}; this.nascoste = []; this.fissaR = 0; this.fissaC = 0; this.noGriglia = false; this.maxR = 0; this.maxC = 0; this.bordi = []; }
    set(r, c, o) { const k = r + ',' + c; this.c[k] = Object.assign(this.c[k] || {}, o); if (r > this.maxR) this.maxR = r; if (c > this.maxC) this.maxC = c; return this; }
    area(r, c, nr, nc, o) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) this.set(r + i, c + j, Object.assign({}, o)); return this; }
    riga(r, c, valori, o) { valori.forEach((v, j) => this.set(r, c + j, Object.assign({ v }, o || {}))); return this; }
    unisci(r, c, nr, nc) { this.merges.push([r, c, nr, nc]); return this; }
  }
  const rgb = hex => { const h = String(hex).replace('#', ''); return { red: parseInt(h.substr(0, 2), 16) / 255, green: parseInt(h.substr(2, 2), 16) / 255, blue: parseInt(h.substr(4, 2), 16) / 255 }; };
  const serial = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5 + 25569;
  function richieste(b, sheetId) {
    const R = [], cols = Math.max(b.maxC, 13), rows = Math.max(b.maxR + 20, 100);
    R.push({ unmergeCells: { range: { sheetId } } });
    R.push({ updateCells: { range: { sheetId }, fields: 'userEnteredValue,userEnteredFormat,note' } });
    R.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: rows, columnCount: cols, frozenRowCount: b.fissaR, frozenColumnCount: b.fissaC, hideGridlines: b.noGriglia } },
      fields: 'gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines' } });
    const righe = [];
    for (let r = 1; r <= b.maxR; r++) {
      const valori = [];
      for (let c = 1; c <= b.maxC; c++) {
        const x = b.c[r + ',' + c] || {}, cell = {}, f = {};
        if (x.data) { cell.userEnteredValue = { numberValue: serial(x.data) }; f.numberFormat = { type: 'DATE', pattern: 'ddd dd/mm/yyyy' }; }
        else if (x.formula) cell.userEnteredValue = { formulaValue: x.formula };
        else if (typeof x.v === 'number') cell.userEnteredValue = { numberValue: x.v };
        else if (x.v != null && x.v !== '') cell.userEnteredValue = { stringValue: String(x.v) };
        if (x.nf) f.numberFormat = x.nf;
        if (x.bg) f.backgroundColor = rgb(x.bg);
        const tf = {}; if (x.b) tf.bold = true; if (x.i) tf.italic = true; if (x.sz) tf.fontSize = x.sz; if (x.fc) tf.foregroundColor = rgb(x.fc);
        if (Object.keys(tf).length) f.textFormat = tf;
        if (x.al) f.horizontalAlignment = x.al; if (x.va) f.verticalAlignment = x.va; if (x.wrap) f.wrapStrategy = 'WRAP';
        if (Object.keys(f).length) cell.userEnteredFormat = f;
        if (x.nota) cell.note = x.nota;
        valori.push(cell);
      }
      righe.push({ values: valori });
    }
    if (righe.length) R.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: righe, fields: 'userEnteredValue,userEnteredFormat,note' } });
    b.merges.filter(([r, c, nr, nc]) => !((c - 1 < (b.fissaC || 0) && c - 1 + nc > (b.fissaC || 0)) || (r - 1 < (b.fissaR || 0) && r - 1 + nr > (b.fissaR || 0)))).forEach(([r, c, nr, nc]) => R.push({ mergeCells: { range: { sheetId, startRowIndex: r - 1, endRowIndex: r - 1 + nr, startColumnIndex: c - 1, endColumnIndex: c - 1 + nc }, mergeType: 'MERGE_ALL' } }));
    for (let c = 1; c <= cols; c++) R.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: c - 1, endIndex: c },
      properties: { pixelSize: b.larg[c] || 100, hiddenByUser: b.nascoste.indexOf(c) >= 0 }, fields: 'pixelSize,hiddenByUser' } });
    Object.keys(b.alt).forEach(r => R.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: r - 1, endIndex: +r }, properties: { pixelSize: b.alt[r] }, fields: 'pixelSize' } }));
    b.bordi.forEach(([r, c, nr, nc]) => {
      const st = { style: 'SOLID', color: rgb('#dadce0') };
      R.push({ updateBorders: { range: { sheetId, startRowIndex: r - 1, endRowIndex: r - 1 + nr, startColumnIndex: c - 1, endColumnIndex: c - 1 + nc }, top: st, bottom: st, left: st, right: st, innerHorizontal: st, innerVertical: st } });
    });
    return R;
  }
  const TESTA = { b: true, bg: '#1a73e8', fc: '#ffffff' };

  function bozzaTurni(anno) {
    const b = new Bozza(); b.fissaR = 1;
    b.riga(1, 1, S.COLONNE_TURNI, TESTA);
    S.righeTurni(anno).forEach((r, i) => {
      const v = r.valori, rr = i + 2;
      b.set(rr, 1, { data: v[0] });
      b.set(rr, 2, Object.assign({ v: v[1] }, r.colore ? { bg: r.colore, fc: S.contrasto(r.colore) } : {}));
      [2, 3].forEach(c => b.set(rr, c + 1, { v: v[c], nf: { type: 'TEXT' } }));
      [4, 5].forEach(c => b.set(rr, c + 1, { v: v[c] }));
      [6, 7, 8].forEach(c => b.set(rr, c + 1, { v: v[c], nf: { type: 'NUMBER', pattern: '0.00' } }));
      b.set(rr, 10, { v: v[9] }); b.set(rr, 11, { v: v[10], nf: { type: 'NUMBER', pattern: '#,##0.00 "€"' } });
      b.set(rr, 12, { v: v[11] }); b.set(rr, 13, { v: v[12] });
    });
    b.larg = { 1: 130, 2: 110, 12: 220 }; b.nascoste = [13]; b.maxC = 13;
    return b;
  }
  function bozzaTipi() {
    const b = new Bozza(); b.fissaR = 1;
    b.riga(1, 1, S.INTESTAZIONI_TIPI, TESTA);
    S.dati().tipi.forEach((r, i) => b.riga(i + 2, 1, r.map((v, j) => j === 2 || j === 3 ? String(v || '') : v)));
    b.set(1, 6, { nota: 'Lavoro = turno con orario fisso\nOre variabili = ti chiede quante ore (Corso)\nRetribuita = assenza pagata (ferie, permesso…)\nNon retribuita = assenza non pagata\nRiposo = giorno libero' });
    b.set(1, 8, { nota: '1 Lavanda · 2 Salvia · 3 Vinaccia · 4 Fenicottero · 5 Banana · 6 Mandarino · 7 Pavone · 8 Grafite · 9 Mirtillo · 10 Basilico · 11 Pomodoro'.replace(/ · /g, '\n') });
    for (let c = 1; c <= 10; c++) b.larg[c] = 130;
    return b;
  }
  function bozzaImpostazioni() {
    const b = new Bozza(), D = S.dati(); b.fissaR = 1;
    b.riga(1, 1, ['Impostazione', 'Valore', 'Note'], TESTA);
    S.IMPOSTAZIONI.forEach((r, i) => b.riga(i + 2, 1, [r[1], String(D.imp[r[0]] == null ? r[2] : D.imp[r[0]]), r[3]]).set(i + 2, 2, { nf: { type: 'TEXT' } }));
    b.larg = { 1: 300, 2: 150, 3: 480 };
    return b;
  }
  const COLONNE_BUSTE = ['Mese', 'Lordo €', 'Trattenute €', 'Netto €', 'Ferie residue', 'Unità ferie', 'ROL residui', 'Ex festività residue', 'Unità permessi', 'PDF', 'Caricata il'];
  function bozzaBuste() {
    const b = new Bozza(), D = S.dati(); b.fissaR = 1;
    b.riga(1, 1, COLONNE_BUSTE, TESTA);
    Object.keys(D.buste).sort().reverse().forEach((k, i) => {
      const x = D.buste[k], r = i + 2, eur = { type: 'NUMBER', pattern: '#,##0.00 "€"' };
      b.set(r, 1, { v: k, nf: { type: 'TEXT' } }); b.set(r, 2, { v: x.lordo, nf: eur }); b.set(r, 3, { v: x.trattenute, nf: eur }); b.set(r, 4, { v: x.netto, nf: eur });
      b.set(r, 5, { v: x.ferie }); b.set(r, 6, { v: x.unita });
      b.set(r, 7, { v: x.rol == null ? '' : x.rol }); b.set(r, 8, { v: x.exfest == null ? '' : x.exfest }); b.set(r, 9, { v: x.unitaPermessi || '' });
      if (x.link) b.set(r, 10, { formula: '=HYPERLINK("' + x.link + '";"📄 Busta paga ' + MESI[+k.slice(5) - 1] + '")' });
      if (x.caricata) { const d = new Date(x.caricata); b.set(r, 11, { data: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) }); b.set(r, 11, { nf: { type: 'DATE', pattern: 'dd/mm/yyyy' } }); }
    });
    for (let c = 1; c <= COLONNE_BUSTE.length; c++) b.larg[c] = c === 10 ? 170 : 110;
    return b;
  }

  // Tabellone: in alto il riepilogo dell'anno, sotto il calendario (mesi × giorni)
  const TB = { TITOLO: 1, SOTTO: 2, R_SEZ: 4, R_TESTA: 5, R_MESE: 6, R_TOT: 18, C_SEZ: 20, C_TESTA: 21, C_MESE: 22, LEG: 35, NOTA: 36 };
  const TB_NCOL = 35, TB_RIEP = ['Giorni lavorati', 'Ore lavorate', 'di cui corso', 'Ordinarie', 'Straordinario', 'Ore nei festivi', 'Assenze pagate (ore)', 'Ferie (giorni)', 'Lordo stimato', 'Netto stimato'];
  const TB_C_TURNI = 2 + TB_RIEP.length * 3;
  function bozzaTabellone(anno) {
    const x = S.calcolaTutti(), s = x.s, b = new Bozza();
    const r2 = v => Math.round(v * 100) / 100, oreTxt = v => String(r2(v)).replace('.', ',');
    b.noGriglia = true; b.fissaC = 1; b.larg[1] = 110; for (let c = 2; c <= 32; c++) b.larg[c] = 34; for (let c = 33; c <= 35; c++) b.larg[c] = 64;
    b.set(TB.TITOLO, 1, { v: 'Strafobico · ' + anno, sz: 18, b: true });
    b.set(TB.SOTTO, 1, { v: 'Aggiornato in automatico dall\'app. In alto il riepilogo dell\'anno, sotto il calendario giorno per giorno (passa sopra una cella per i dettagli). Valori indicativi: la busta paga resta il riferimento.', fc: '#5f6368', i: true });
    // riepilogo
    b.set(TB.R_SEZ, 1, { v: '📊  RIEPILOGO ' + anno, b: true, sz: 12 }); b.area(TB.R_SEZ, 1, 1, TB_NCOL, { bg: '#f1f3f4' }); b.unisci(TB.R_SEZ, 1, 1, TB_NCOL);
    b.area(TB.R_TESTA, 1, 1, TB_NCOL, Object.assign({ al: 'CENTER', va: 'MIDDLE', wrap: true }, TESTA));
    b.set(TB.R_TESTA, 1, { v: 'Mese' }); TB_RIEP.forEach((t, i) => b.set(TB.R_TESTA, 2 + i * 3, { v: t })); b.set(TB.R_TESTA, TB_C_TURNI, { v: 'Turni del mese' });
    b.alt[TB.R_TESTA] = 38;
    for (let r = TB.R_TESTA; r <= TB.R_TOT; r++) { for (let i = 0; i < TB_RIEP.length; i++) b.unisci(r, 2 + i * 3, 1, 3); b.unisci(r, TB_C_TURNI, 1, TB_NCOL - TB_C_TURNI + 1); }
    b.bordi.push([TB.R_TESTA, 1, TB.R_TOT - TB.R_TESTA + 1, TB_NCOL]);
    const tipiOrd = x.tipi.lista, ordine = t => { const i = tipiOrd.indexOf(t); return i < 0 ? 99 : i; };
    const ordSigle = (a, c) => ordine(x.tipi.mappa[a.toLowerCase()]) - ordine(x.tipi.mappa[c.toLowerCase()]);
    const delAnno = x.turni.filter(t => +t.date.slice(0, 4) === anno), perGiorno = {}, conta = {};
    delAnno.forEach(t => {
      (perGiorno[t.date] = perGiorno[t.date] || []).push(t);
      const m = +t.date.slice(5, 7), c = conta[m] = conta[m] || {}, k = t.tipoObj ? t.tipoObj.sigla || t.tipoObj.nome : t.tipo;
      c[k] = (c[k] || 0) + 1;
    });
    const oggi = S.oggiIso().slice(0, 7), eur = { type: 'NUMBER', pattern: '#,##0.00 "€"' }, ore = { type: 'NUMBER', pattern: '0.##' };
    const tot = { v: new Array(10).fill(0), turni: {} };
    for (let m = 1; m <= 12; m++) {
      const k = anno + '-' + pad2(m), M = x.mesi[k], r = TB.R_MESE + m - 1, grigio = k > oggi && !M;
      b.set(r, 1, { v: MESI[m - 1], fc: grigio ? '#9aa0a6' : '#202124' });
      if (M) {
        const v = [M.giorniLav, r2(M.ore), r2(M.corso), r2(M.ord), r2(M.stra), r2(M.festive), r2(M.assenze), M.ferie, r2(M.lordo), r2(M.netto)];
        v.forEach((val, i) => { tot.v[i] += val; b.set(r, 2 + i * 3, { v: val || (i === 0 ? 0 : ''), al: 'CENTER', nf: i >= 8 ? eur : ore, fc: i === 4 && val > 0 ? '#c5221f' : '#202124' }); });
      }
      const c = conta[m] || {};
      b.set(r, TB_C_TURNI, { v: Object.keys(c).sort(ordSigle).map(sg => sg + ' ' + c[sg]).join(' · ') });
      Object.keys(c).forEach(sg => { tot.turni[sg] = (tot.turni[sg] || 0) + c[sg]; });
    }
    b.area(TB.R_TOT, 1, 1, TB_NCOL, { b: true, bg: '#e8f0fe' });
    b.set(TB.R_TOT, 1, { v: 'TOTALE ' + anno });
    tot.v.forEach((val, i) => b.set(TB.R_TOT, 2 + i * 3, { v: i === 0 || i === 7 ? val : r2(val), al: 'CENTER', nf: i >= 8 ? eur : ore }));
    b.set(TB.R_TOT, TB_C_TURNI, { v: Object.keys(tot.turni).sort(ordSigle).map(sg => sg + ' ' + tot.turni[sg]).join(' · ') });
    // calendario
    b.set(TB.C_SEZ, 1, { v: '📅  CALENDARIO ' + anno, b: true, sz: 12 }); b.area(TB.C_SEZ, 1, 1, TB_NCOL, { bg: '#f1f3f4' }); b.unisci(TB.C_SEZ, 1, 1, TB_NCOL);
    const tc = ['Mese']; for (let d = 1; d <= 31; d++) tc.push(d); tc.push('Turni', 'Ore', 'Straord.');
    b.riga(TB.C_TESTA, 1, tc, { b: true, bg: '#202124', fc: '#ffffff', al: 'CENTER' });
    b.bordi.push([TB.C_TESTA, 1, 13, TB_NCOL]);
    for (let m = 1; m <= 12; m++) {
      const r = TB.C_MESE + m - 1, n = new Date(anno, m, 0).getDate(), k = anno + '-' + pad2(m), M = x.mesi[k];
      b.alt[r] = 24;
      b.set(r, 1, { v: MESI[m - 1], b: true });
      let nT = 0;
      for (let d = 1; d <= 31; d++) {
        const c = d + 1, base = { al: 'CENTER', va: 'MIDDLE', sz: 9 };
        if (d > n) { b.set(r, c, Object.assign({ bg: '#eceff1' }, base)); continue; }
        const iso = k + '-' + pad2(d), lista = (perGiorno[iso] || []).slice().sort((a, z) => ordine(a.tipoObj) - ordine(z.tipoObj));
        const festa = S.festivitaNome(iso, s), rosa = S.isFestivo(iso, s);
        const giorno = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'][new Date(anno, m - 1, d).getDay()] + ' ' + d + ' ' + MESI[m - 1];
        if (!lista.length) { b.set(r, c, Object.assign({ v: festa ? '🎉' : '', nota: festa ? giorno + '\n🎉 ' + festa : '' }, rosa ? { bg: '#fce8e6' } : {}, base)); continue; }
        nT += lista.length;
        const sigla = t => { const tp = t.tipoObj, sg = tp ? (tp.sigla || tp.nome.slice(0, 2)) : String(t.tipo).slice(0, 2); return tp && tp.cat === 'Ore variabili' ? sg + oreTxt(t.calc.ore) : sg; };
        const tp0 = lista[0].tipoObj;
        b.set(r, c, Object.assign({ v: lista.map(sigla).join(''), bg: tp0 ? tp0.colore : '#9aa0a6', fc: tp0 ? S.contrasto(tp0.colore) : '#ffffff',
          nota: giorno + (festa ? '\n🎉 ' + festa : '') + '\n' + lista.map(t => {
            const tp = t.tipoObj, nome = (tp && tp.icona ? tp.icona + ' ' : '') + t.tipoNome;
            if (tp && tp.cat === 'Ore variabili') return nome + ' · ' + oreTxt(t.calc.ore) + ' h';
            return nome + (t.inizioStr && t.fineStr ? ' ' + t.inizioStr + '–' + t.fineStr : '') + (t.calc.ore ? ' (' + oreTxt(t.calc.ore) + ' h)' : '');
          }).join('\n') }, base));
      }
      b.set(r, 33, { v: nT || '', al: 'CENTER' }); b.set(r, 34, { v: M && M.ore ? r2(M.ore) : '', al: 'CENTER', nf: ore });
      b.set(r, 35, { v: M && M.stra ? r2(M.stra) : '', al: 'CENTER', nf: ore, fc: '#c5221f' });
    }
    // legenda
    b.set(TB.LEG, 1, { v: 'Legenda', b: true });
    tipiOrd.filter(t => t.attivo || delAnno.some(u => u.tipoObj === t)).slice(0, 11).forEach((t, i) => {
      b.set(TB.LEG, 2 + i * 3, { v: (t.icona ? t.icona + ' ' : '') + (t.sigla ? t.sigla + ' ' : '') + t.nome, bg: t.colore, fc: S.contrasto(t.colore), b: true, sz: 9, al: 'CENTER' });
      b.unisci(TB.LEG, 2 + i * 3, 1, 3);
    });
    b.set(TB.NOTA, 1, { v: 'Celle rosa = domeniche e festivi · 🎉 = festività · più turni nello stesso giorno: sigle una dopo l\'altra (es. MP) · C4 = 4 ore di corso', fc: '#5f6368', sz: 9 });
    b.maxC = TB_NCOL;
    return b;
  }

  async function scriviFogli(remoto) {
    const D = S.dati(), id = D.meta.ssId, x = S.calcolaTutti(), annoOra = S.annoCorrente();
    const anni = new Set([annoOra]); x.turni.forEach(t => anni.add(+t.date.slice(0, 4)));
    const elenco = [...anni].sort((a, b) => b - a);
    const voluti = [];
    elenco.forEach(y => { voluti.push(['Tabellone ' + y, () => bozzaTabellone(y)]); });
    elenco.forEach(y => { voluti.push(['Turni ' + y, () => bozzaTurni(y), y < annoOra]); });
    voluti.push(['Buste paga', bozzaBuste], ['Tipi turno', bozzaTipi], ['Impostazioni', bozzaImpostazioni, true]);
    // ordine delle linguette: Tabellone dell'anno, Turni dell'anno, Buste paga, Tipi turno, poi gli anni passati
    const ordine = ['Tabellone ' + annoOra, 'Turni ' + annoOra, 'Buste paga', 'Tipi turno'].concat(elenco.filter(y => y !== annoOra).map(y => 'Tabellone ' + y), elenco.filter(y => y !== annoOra).map(y => 'Turni ' + y), ['Impostazioni']);
    const fogli = Object.assign({}, remoto.fogli);
    const nuovi = voluti.filter(v => !fogli[v[0]]).map(v => ({ addSheet: { properties: { title: v[0] } } }));
    if (nuovi.length) {
      const r = await api('POST', SHEETS + '/' + id + ':batchUpdate', { requests: nuovi });
      r.replies.forEach(rep => { const p = rep.addSheet.properties; fogli[p.title] = p; });
    }
    const R = [];
    voluti.forEach(([nome, crea, nascosto]) => {
      const sid = fogli[nome].sheetId;
      R.push(...richieste(crea(), sid));
      R.push({ updateSheetProperties: { properties: { sheetId: sid, hidden: !!nascosto, index: Math.max(0, ordine.indexOf(nome)) }, fields: 'hidden,index' } });
    });
    // fogli vuoti di partenza e il vecchio "Riepilogo"/"Turni" della prima versione: i dati sono già nei fogli per anno
    ['Foglio1', 'Foglio 1', 'Sheet1', 'Riepilogo', 'Turni'].forEach(n => { if (fogli[n]) R.push({ deleteSheet: { sheetId: fogli[n].sheetId } }); });
    await api('POST', SHEETS + '/' + id + ':batchUpdate', { requests: R });
    const tab = fogli['Tabellone ' + annoOra];
    if (tab) { D.meta.ssUrl = 'https://docs.google.com/spreadsheets/d/' + id + '/edit#gid=' + tab.sheetId; }
  }

  /* ---------------- sincronizzazione completa ---------------- */
  let inCorso = null, ancora = false;
  /**
   * 1) legge il foglio  2) unisce con le modifiche fatte qui  3) carica le buste paga
   * 4) aggiorna Google Calendar  5) riscrive i fogli (con i calcoli e il tabellone)
   */
  async function sincronizza(interattivo) {
    if (inCorso) { ancora = true; return inCorso; }
    inCorso = (async () => {
      const D = await S.carica();
      if (!navigator.onLine) { avvisa('offline', 'Senza connessione: le modifiche restano sul telefono e partono appena torna la rete'); return { restano: inAttesa(), offline: true }; }
      if (!D.meta.email && !interattivo) { avvisa('locale', 'Accedi con Google per salvare i turni nel tuo Drive e nel Calendario'); return { restano: inAttesa() }; }
      let esito = { restano: 0 };
      try {
        await prendiToken(!!interattivo);
        do {
          ancora = false;
          avvisa('sync', 'Sincronizzazione con Google…');
          const istantanea = { giaSincronizzato: !!D.meta.ultimaSync };
          await preparaDrive();
          if (!D.meta.ultimaSync) istantanea.giaSincronizzato = false;
          const remoto = await leggiFoglio();
          unisci(remoto, istantanea);
          istantanea.pend = JSON.parse(JSON.stringify(D.pend)); // quello che sto per inviare
          await caricaBuste();
          const ev = await sincronizzaEventi(120);
          await scriviFogli(remoto);
          // tolgo dalle modifiche in attesa solo quelle già inviate (quelle fatte nel frattempo restano)
          const p = D.pend, P = istantanea.pend;
          Object.keys(P.giorni).forEach(k => { if (p.giorni[k] <= P.giorni[k]) delete p.giorni[k]; });
          if (p.tipi && p.tipi <= P.tipi) p.tipi = 0;
          Object.keys(P.imp).forEach(k => { if (p.imp[k] <= P.imp[k]) delete p.imp[k]; });
          Object.keys(P.buste).forEach(k => { if (p.buste[k] <= P.buste[k]) delete p.buste[k]; });
          D.meta.ultimaSync = Date.now(); S.invalida(); await S.salva();
          esito = { restano: ev.restano, errore: ev.errore };
          if (ev.errore) D.meta.errCal = ev.errore; else delete D.meta.errCal;
          if (ev.restano > 0 && !ancora) ancora = true; // altri eventi da creare: un altro giro
        } while (ancora && navigator.onLine);
        stato.ultima = Date.now();
        avvisa('ok', esito.errore ? 'Sincronizzato, ma ' + esito.errore : 'Sincronizzato con Google ✓', esito.errore);
        S.cambiato();
      } catch (e) {
        if (e.accesso) avvisa('accesso', 'Tocca «Sincronizza» per collegarti a Google');
        else if (!navigator.onLine) avvisa('offline', 'Senza connessione: riprovo appena torna la rete');
        else avvisa('errore', 'Sincronizzazione non riuscita: ' + e.message, e.message);
        esito = { restano: inAttesa(), errore: e.accesso ? '' : e.message, accesso: !!e.accesso };
      }
      return esito;
    })();
    try { return await inCorso; } finally { inCorso = null; }
  }

  /* ---------------- funzioni del pannello "Google Calendar" ---------------- */
  async function statoCalendario() {
    const D = await S.carica(), id = D.imp.calId || '';
    return { email: D.meta.email || '', nome: NOME_CAL, id, link: id ? 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(id) + (D.meta.email ? '&authuser=' + encodeURIComponent(D.meta.email) : '') : '',
      visibile: !!id, turni: D.turni.length, conEvento: D.turni.filter(t => t.ev && t.ev !== '-').length,
      inAttesa: D.turni.filter(t => !t.ev).length + D.pend.evDel.length, errore: D.meta.errCal || (stato.fase === 'errore' ? stato.errore : '') };
  }
  async function provaCalendario() {
    const D = await S.carica();
    try {
      await prendiToken(true);
      const calId = await calendario(), oggi = S.oggiIso();
      if (D.meta.provaEv) { await api('DELETE', CAL + '/calendars/' + q(calId) + '/events/' + q(D.meta.provaEv), null, { ok404: true }); }
      const ev = await api('POST', CAL + '/calendars/' + q(calId) + '/events?fields=id,htmlLink', { summary: '✅ Prova Strafobico', description: 'Evento di prova creato dall\'app Strafobico. Puoi cancellarlo.', start: { date: oggi }, end: { date: giornoDopo(oggi) } });
      D.meta.provaEv = ev.id; S.salva();
      const st = await statoCalendario();
      return { ok: true, email: D.meta.email, calNome: NOME_CAL, calId, linkCal: st.link, linkEvento: ev.htmlLink + (D.meta.email ? '&authuser=' + encodeURIComponent(D.meta.email) : '') };
    } catch (e) { return { ok: false, email: D.meta.email || '', errore: e.message }; }
  }
  async function eliminaProvaCalendario() {
    const D = await S.carica(); if (!D.meta.provaEv || !D.imp.calId) return true;
    try { await api('DELETE', CAL + '/calendars/' + q(D.imp.calId) + '/events/' + q(D.meta.provaEv), null, { ok404: true }); } catch (e) { }
    delete D.meta.provaEv; S.salva(); return true;
  }
  async function riparaCalendario() {
    const D = await S.carica(), oggi = S.oggiIso();
    D.turni.forEach(t => { if (t.date < oggi) return; if (t.ev && t.ev !== '-') D.pend.evDel.push(t.ev); t.ev = ''; D.pend.giorni[t.date] = Date.now(); });
    await S.salva();
    return sincronizza(true);
  }

  /* ---------------- collegare un foglio già esistente (prima versione dell'app) ---------------- */
  async function scegliFoglioEsistente() {
    if (!CFG.apiKey || !CFG.appId) throw new Error('per scegliere un foglio esistente servono apiKey e appId in js/config.js (vedi README)');
    await prendiToken(true);
    await caricaScript('https://apis.google.com/js/api.js');
    await new Promise(ok => gapi.load('picker', ok));
    const scelto = await new Promise(ok => {
      const vista = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setMode(google.picker.DocsViewMode.LIST);
      new google.picker.PickerBuilder().addView(vista).setOAuthToken(token).setDeveloperKey(CFG.apiKey).setAppId(CFG.appId).setLocale('it')
        .setTitle('Scegli il foglio «Turni lavoro»').setCallback(d => {
          if (d.action === google.picker.Action.PICKED) ok(d.docs[0]); else if (d.action === google.picker.Action.CANCEL) ok(null);
        }).build().setVisible(true);
    });
    if (!scelto) return null;
    const D = S.dati(); D.meta.ssId = scelto.id; D.meta.ultimaSync = 0; await S.salva();
    return sincronizza(true);
  }

  /* ---------------- avvio: sincronizza quando torna la rete ---------------- */
  // preparo subito il collegamento a Google: al tocco di «Accedi» la finestra si apre senza attese
  setTimeout(() => { if (CFG.clientId && !/INSERISCI/.test(CFG.clientId) && glob.document && navigator.onLine) preparaClient().catch(() => { client = null; }); }, 1500);
  glob.addEventListener('online', () => { if (S.dati() && S.dati().meta.email) sincronizza(false); });
  glob.addEventListener('offline', () => avvisa('offline', 'Senza connessione: puoi continuare a usare l\'app'));

  glob.StrafobicoGoogle = {
    stato: () => Object.assign({ inAttesa: inAttesa() }, stato), onStato: f => ascolta.push(f),
    accedi, esci, sincronizza, scegliFoglioEsistente, configurato: () => !!(CFG.clientId && !/INSERISCI/.test(CFG.clientId)), puoScegliereFoglio: () => !!(CFG.apiKey && CFG.appId),
    api: { sincronizzaCalendario: () => sincronizza(false), statoCalendario, provaCalendario, eliminaProvaCalendario, riparaCalendario },
    // per i test
    _interni: { unisci, bozzaTabellone, bozzaTurni, richieste, leggiFoglio, evento },
  };
})(typeof window !== 'undefined' ? window : globalThis);
