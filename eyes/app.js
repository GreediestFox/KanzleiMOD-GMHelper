/* Kanzlei GM - "Eyes": the web UI of KanzleiMOD.  Plain ES5 on purpose (the game's embedded browser may be old).
 * Talks to the relay (/p/*), which talks to the game (Core).  ?demo=1 runs it with fake data and no game.
 * Data comes from the game: commands (shared/commands.kz via the server), the item/object catalog (Brain: client data\objects_types.xml + data\loc),
 * animals and ground materials (shared/animals.kz, ground.kz). Nothing about game content is hardcoded here. */
(function () {
  'use strict';
  var CFG = window.KZ_CONFIG || {};
  var Q = parseQuery(location.search);
  var DEMO = !!Q.demo;
  // icons: the game passes the address of its own art/2D folder (ib); otherwise the deployment default
  var ICONS = Q.ib !== undefined ? Q.ib : (CFG.iconBase || '');
  var S = {
    lang: (Q.lang === 'en' || Q.lang === 'de') ? Q.lang : (/^de/i.test(navigator.language || '') ? 'de' : 'en'),
    s: Q.s || '', p: Q.p || '',
    cmds: [], cmdById: {}, catalog: [], cats: {}, animals: [], ground: [], players: [],
    favs: [], favLoaded: false, god: false, gameAge: -1, evAfter: 0,
    ent: {}, list: [], bySection: { c: [], i: [], b: [], m: [], a: [], g: [] },
    tab: 'fav', section: 'c', claimTries: 0, durWant: null, themeLoaded: false, allCat: '', allFilter: '', catalogN: 0, dead: false, log: []
  };
  var SECTIONS = ['c', 'i', 'b', 'm', 'a', 'g'];
  var DANGER = { ban: 1, kick: 1, delobj: 1, 'delete': 1, adminland_delete: 1, kzreload: 1 };
  var KIND_CODE = { c: 'CMD', i: 'ITM', b: 'BLD', m: 'OBJ', a: 'ANI', g: 'GND' };
  var CAT_GLYPH = { Items: '⚒', Objects: '▣', Ground: '◢', Player: '♥', Players: '☺', Teleport: '➤', Moderation: '⚖', World: '☀', Economy: '¤', System: '⚙' };

  /* ---------------------------------------------------------------- helpers */
  function parseQuery(q) { var o = {}; q = (q || '').replace(/^\?/, ''); if (!q) return o; var a = q.split('&'); for (var i = 0; i < a.length; i++) { var kv = a[i].split('='); o[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' ')); } return o; }
  function $(id) { return document.getElementById(id); }
  function t(k) { var d = window.KZ_I18N[S.lang] || window.KZ_I18N.en; return d[k] !== undefined ? d[k] : (window.KZ_I18N.en[k] !== undefined ? window.KZ_I18N.en[k] : k); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag), k;
    if (attrs) for (k in attrs) { if (!attrs.hasOwnProperty(k)) continue; var v = attrs[k]; if (k === 'class') e.className = v; else if (k === 'text') e.appendChild(document.createTextNode(v)); else if (k.slice(0, 2) === 'on') e[k] = v; else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v); }
    if (kids) for (var i = 0; i < kids.length; i++) { if (kids[i]) e.appendChild(typeof kids[i] === 'string' ? document.createTextNode(kids[i]) : kids[i]); }
    return e;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function norm(s) {
    s = String(s || '').toLowerCase();
    s = s.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
    if (s.normalize) { try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { } }
    return s;
  }
  function xhr(method, url, body, cb) {
    var r = new XMLHttpRequest();
    r.open(method, url, true);
    if (body) r.setRequestHeader('Content-Type', 'application/json');
    r.onreadystatechange = function () {
      if (r.readyState !== 4) return;
      var j = null; try { j = JSON.parse(r.responseText); } catch (e) { }
      cb(r.status === 200 ? null : (r.status || 'net'), j, r.status);
    };
    try { r.send(body ? JSON.stringify(body) : null); } catch (e) { cb('net', null, 0); }
  }
  function ts() { var d = new Date(); function z(n) { return n < 10 ? '0' + n : '' + n; } return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()); }
  function indexOf(a, v) { for (var i = 0; i < a.length; i++) if (a[i] === v) return i; return -1; }
  function glyphOf(e) { var g = e.kind === 'c' ? (CAT_GLYPH[e.sub] || '✦') : String(e.name || '?').charAt(0).toUpperCase(); return g; }
  function iconNode(e, cls) {
    var box = el('div', { 'class': cls || 'ico' });
    box.appendChild(document.createTextNode(glyphOf(e)));
    if (e.icon && ICONS) {
      var img = new Image();
      img.onload = function () { clear(box); box.style.background = '#15110a'; box.appendChild(img); };
      img.src = ICONS + e.icon.split('/').map(encodeURIComponent).join('/');
    }
    return box;
  }

  /* ---------------------------------------------------------------- parsing of game data */
  function lines(txt) { return String(txt || '').split(/\r?\n/); }
  function parseCommands(txt) {
    var out = [], byId = {}, L = lines(txt);
    for (var i = 0; i < L.length; i++) {
      if (!L[i] || L[i].charAt(0) === '#') continue;
      var f = L[i].split('\t'); if (f.length < 7) continue;
      var c = { id: f[0], cat: f[1], via: f[2], tpl: f[3], args: parseArgs(f[4]), en: f[5], de: f[6], kw: f[7] || '' };
      out.push(c); byId[c.id] = c;
    }
    S.cmds = out; S.cmdById = byId;
  }
  function parseArgs(spec) {
    var out = [], a = (spec || '').split(','), i;
    for (i = 0; i < a.length; i++) {
      if (!a[i]) continue;
      var m = /^([a-z][a-z0-9_]*):([a-z]+)(\(([^)]*)\))?(=([^?]*))?(\?)?$/.exec(a[i]); if (!m) continue;
      out.push({ name: m[1], type: m[2], choices: m[4] ? m[4].split('|') : null, def: m[6] === undefined ? '' : m[6], opt: !!m[7] });
    }
    return out;
  }
  function parseCatalog(txt) {
    // C|catId|name   and   <b|m|i>|id|catId|name|icon
    var L = lines(txt), cats = {}, items = [];
    for (var i = 0; i < L.length; i++) {
      var f = L[i].split('|'); if (f.length < 3) continue;
      if (f[0] === 'C') cats[f[1]] = f[2];
      else if (f[0] === 'b' || f[0] === 'm' || f[0] === 'i') items.push({ kind: f[0], id: f[1], cat: f[2], name: f[3] || ('#' + f[1]), icon: f[4] || '' });
    }
    S.cats = cats; S.catalog = items; S.catalogN = items.length;
  }
  function parseTable(txt) { var out = [], L = lines(txt); for (var i = 0; i < L.length; i++) { if (!L[i] || L[i].charAt(0) === '#') continue; out.push(L[i].split('\t')); } return out; }

  /* ---------------------------------------------------------------- entities + search */
  function rebuild() {
    var ent = {}, list = [], sec = { c: [], i: [], b: [], m: [], a: [], g: [] }, i;
    function add(e) {
      e.key = e.kind + ':' + e.id; e.nameN = norm(e.name); e.subN = norm(e.sub); e.kwN = norm(e.kw || ''); e.words = e.nameN.split(/[^a-z0-9]+/);
      ent[e.key] = e; list.push(e); sec[e.kind].push(e);
    }
    for (i = 0; i < S.cmds.length; i++) { var c = S.cmds[i]; add({ kind: 'c', id: c.id, name: S.lang === 'de' ? c.de : c.en, sub: c.cat, kw: c.en + ' ' + c.de + ' ' + c.kw + ' ' + c.id, cmd: c }); }
    for (i = 0; i < S.catalog.length; i++) { var x = S.catalog[i]; add({ kind: x.kind, id: x.id, name: x.name, sub: S.cats[x.cat] || '', icon: x.icon, kw: '' }); }
    for (i = 0; i < S.animals.length; i++) add({ kind: 'a', id: S.animals[i][0], name: S.lang === 'de' ? (S.animals[i][2] || S.animals[i][1]) : S.animals[i][1], sub: t('sec_a'), kw: S.animals[i][0] });
    for (i = 0; i < S.ground.length; i++) add({ kind: 'g', id: S.ground[i][0], name: S.lang === 'de' ? (S.ground[i][3] || S.ground[i][2]) : S.ground[i][2], sub: t('sec_g'), kw: S.ground[i][0] });
    S.ent = ent; S.list = list; S.bySection = sec;
    var st = clear($('stats')); for (var kk = 0; kk < SECTIONS.length; kk++) { var kb = el('b'); kb.appendChild(document.createTextNode(KIND_CODE[SECTIONS[kk]] + ' ' + sec[SECTIONS[kk]].length)); st.appendChild(kb); }
    for (var k in sec) sec[k].sort(function (a, b) { return a.nameN < b.nameN ? -1 : a.nameN > b.nameN ? 1 : 0; });
  }
  function lev1(a, b) { // true when a and b differ by at most one edit
    if (a === b) return true; var la = a.length, lb = b.length; if (Math.abs(la - lb) > 1) return false;
    var i = 0, j = 0, edits = 0;
    while (i < la && j < lb) { if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; } if (++edits > 1) return false; if (la > lb) i++; else if (lb > la) j++; else { i++; j++; } }
    return edits + (la - i) + (lb - j) <= 1;
  }
  function scoreEnt(e, toks) {
    var total = 0;
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i], s = 0, w;
      if (e.id.toLowerCase() === tk) s = 100;
      else if (e.nameN === tk) s = 90;
      else if (e.nameN.indexOf(tk) === 0) s = 60;
      else { for (w = 0; w < e.words.length; w++) if (e.words[w].indexOf(tk) === 0) { s = 45; break; } }
      if (!s && e.nameN.indexOf(tk) >= 0) s = 25;
      if (!s && e.kwN.indexOf(tk) >= 0) s = 12;
      if (!s && e.subN.indexOf(tk) >= 0) s = 8;
      if (!s && tk.length >= 4) { for (w = 0; w < e.words.length; w++) { var wd = e.words[w]; if (wd.length >= 3 && (lev1(tk, wd) || lev1(tk, wd.slice(0, tk.length)))) { s = 4; break; } } }
      if (!s) return 0; total += s;
    }
    return total;
  }
  var searchCache = {};
  function search(q) {
    q = norm(q).replace(/^\s+|\s+$/g, ''); if (!q) return [];
    var key = S.list.length + '|' + S.lang + '|' + q; if (searchCache[key]) return searchCache[key];
    var toks = q.split(/\s+/), res = [];
    for (var i = 0; i < S.list.length; i++) { var sc = scoreEnt(S.list[i], toks); if (sc) res.push({ e: S.list[i], s: sc }); }
    res.sort(function (a, b) { return b.s - a.s || (a.e.nameN < b.e.nameN ? -1 : a.e.nameN > b.e.nameN ? 1 : 0); });
    var out = []; for (i = 0; i < res.length; i++) out.push(res[i].e);
    searchCache = {}; searchCache[key] = out; return out;
  }

  /* ---------------------------------------------------------------- favourites */
  function favSave() {
    try { localStorage.setItem('kz_favs', S.favs.join(',')); } catch (e) { }
    transport.send('kz_favsave', [S.favs.join(',')], true);
  }
  function isFav(e) { return indexOf(S.favs, e.key) >= 0; }
  function toggleFav(e) { var i = indexOf(S.favs, e.key); if (i >= 0) S.favs.splice(i, 1); else S.favs.push(e.key); favSave(); refreshView(); }
  function favMove(key, to) { var i = indexOf(S.favs, key); if (i < 0) return; S.favs.splice(i, 1); if (to < 0) to = 0; if (to > S.favs.length) to = S.favs.length; S.favs.splice(to, 0, key); favSave(); refreshView(); }

  /* ---------------------------------------------------------------- transport */
  var transport = {};
  function logMsg(kind, text) {
    S.log.push({ k: kind, t: text, at: ts() }); if (S.log.length > 200) S.log.shift();
    var lab = kind === 'ok' ? t('ok') : kind === 'err' ? t('err') : t('sent');
    var last = $('bar-last'); clear(last); last.appendChild(el('span', { 'class': 'msg ' + kind, text: lab })); last.appendChild(document.createTextNode(text || ''));
    var lg = $('bar-log'); if (lg.style.display !== 'none') renderLog();
  }
  function renderLog() { var lg = clear($('bar-log')); if (!S.log.length) { lg.appendChild(document.createTextNode(t('log_empty'))); return; } for (var i = S.log.length - 1; i >= 0; i--) { var m = S.log[i]; lg.appendChild(el('div', { 'class': 'logline' }, [el('span', { 'class': 'tm', text: m.at }), el('span', { 'class': 'msg ' + m.k, text: m.k === 'ok' ? t('ok') : m.k === 'err' ? t('err') : t('sent') }), m.t])); } }

  function handleEvent(ev) {
    var d = ev.data || '';
    if (ev.type === 'reply') { var lines2 = d.split('\\n'); logMsg(ev.id === 'err' ? 'err' : ev.id === 'ok' ? 'ok' : 'sent', lines2.join(' · ')); }
    else if (ev.type === 'info') logMsg('sent', d);
    else if (ev.type === 'dur') { var df = d.split('|'); if (S.durWant && S.durWant.type === df[0] && String(S.durWant.q) === df[1]) { clear(S.durWant.el).appendChild(document.createTextNode('\u2248 ' + df[2] + '   (' + (df[3] || '') + ')')); } }
    else if (ev.type === 'god') { S.god = ev.id === 'on'; $('god').style.display = S.god ? '' : 'none'; }
    else if (ev.type === 'players') { S.players = []; var a = d.split(';'); for (var i = 0; i < a.length; i++) { var f = a[i].split('|'); if (f[0]) S.players.push({ id: f[0], name: f[1] || f[0] }); } }
    else if (ev.type === 'fav') {
      if (!S.favLoaded) { S.favLoaded = true; S.favs = d ? d.split(',') : []; try { localStorage.setItem('kz_favs', S.favs.join(',')); } catch (e) { } refreshView(); }
    }
    else if (ev.type === 'eco') ecoLiveEvent(d);
    else if (ev.type === 'blob') loadBlob(ev.id, d);
  }
  function loadBlob(name, hash) {
    transport.blob(name, hash, function (txt) {
      if (name === 'theme') { if (!S.themeLoaded) { S.themeLoaded = true; var tt = txt.replace(/\s+$/, ''); if (tt) { window.KZTheme.load(tt); try { localStorage.setItem('kz_theme', window.KZTheme.serialize()); } catch (e) { } } } return; }
      if (name === 'fav') { if (!S.favLoaded) { S.favLoaded = true; var f = txt.replace(/\s+$/, ''); S.favs = f ? f.split(',') : []; try { localStorage.setItem('kz_favs', S.favs.join(',')); } catch (e) { } refreshView(); } return; }
      if (name === 'economy') { var er = parseEco(txt); if (er.length || !ECO.rows.length) ECO.rows = er; ECO.src = 'live'; ECO.fromCache = false; ECO.at = Date.now(); ecoSave(); ecoRerender(); return; }
      if (name === 'ecoitems') { parseEcoItems(txt); ECO.fromCache = false; ECO.at = Date.now(); ecoSave(); ecoRerender(); return; }
      if (name === 'cmds') parseCommands(txt);
      else if (name === 'catalog') parseCatalog(txt);
      else if (name === 'animals') S.animals = parseTable(txt);
      else if (name === 'ground') S.ground = parseTable(txt);
      rebuild(); refreshView();
    });
  }

  if (!DEMO) {
    transport.start = function () {
      xhr('POST', '/p/claim', { s: S.s, p: S.p }, function (err, j, st) {
        if (err && st === 404 && S.claimTries < 12) { S.claimTries++; setTimeout(transport.start, 1200); return; }   // the game registers the session a moment after opening the page
        if (err) { S.dead = true; logMsg('err', st === 404 ? t('session_gone') : t('err') + ' (' + err + ')'); setConn(); return; }
        if (j && j.lang && !Q.lang) { S.lang = j.lang === 'de' ? 'de' : 'en'; applyLang(); }
        poll();
      });
    };
    var pollTimer = 0;
    var poll = function () {
      if (S.dead) return;
      xhr('GET', '/p/events?s=' + S.s + '&p=' + S.p + '&after=' + S.evAfter, null, function (err, j, st) {
        if (!err && j) {
          S.gameAge = j.gameAge;
          for (var i = 0; i < j.events.length; i++) { S.evAfter = j.events[i].seq; try { handleEvent(j.events[i]); } catch (e) { if (window.console) console.log(e); } }
        } else if (st === 404) { S.dead = true; logMsg('err', t('session_gone')); }
        setConn();
        pollTimer = setTimeout(poll, CFG.pollMs || 800);
      });
    };
    transport.send = function (cmd, args, quiet) {
      xhr('POST', '/p/cmd', { s: S.s, p: S.p, cmd: cmd, args: args }, function (err, j, st) {
        if (err) logMsg('err', st === 429 ? t('queue_full') : (j && j.error) || String(err)); else if (!quiet) logMsg('sent', cmd + (args.length ? ' ' + args.join(' ') : ''));
      });
    };
    transport.blob = function (name, hash, cb) {
      xhr('GET', '/p/blob?s=' + S.s + '&p=' + S.p + '&name=' + name + (hash ? '&h=' + encodeURIComponent(hash) : ''), null, function (err, j) { if (!err && j) cb(j.data); });
    };
  }

  /* ---------------------------------------------------------------- generic UI parts */
  function setConn() {
    var c = $('conn'), tx = $('conn-t');
    if (DEMO) { c.className = 'conn on'; tx.firstChild ? tx.firstChild.nodeValue = t('conn_on') : tx.appendChild(document.createTextNode(t('conn_on'))); return; }
    var cls = S.gameAge < 0 ? 'wait' : (S.gameAge < 12 ? 'on' : 'off');
    c.className = 'conn ' + cls; clear(tx); tx.appendChild(document.createTextNode(t(cls === 'on' ? 'conn_on' : cls === 'wait' ? 'conn_wait' : 'conn_off')));
  }
  function applyLang() {
    document.documentElement.lang = S.lang; $('q').placeholder = t('search_ph');
    var tabs = document.querySelectorAll('.tab'); for (var i = 0; i < tabs.length; i++) clear(tabs[i].querySelector('.tl')).appendChild(document.createTextNode(t('tab_' + tabs[i].getAttribute('data-tab'))));
    clear($('lang')).appendChild(document.createTextNode(t('lang_btn')));
    clear($('theme')).appendChild(document.createTextNode('\u25D0 ' + t('theme')));
    var tg = clear($('bar-toggle')); tg.appendChild(document.createTextNode($('bar-log').style.display === 'none' ? t('log') : t('log_hide')));
    rebuild(); setConn(); refreshView();
  }
  function modal(cls, title, bodyNode, footNode, onClose) {
    var root = $('modal-root');
    var shade = el('div', { 'class': 'shade' });
    var box = el('div', { 'class': 'modal ' + cls });
    function close() { if (shade.parentNode) shade.parentNode.removeChild(shade); if (onClose) onClose(); document.removeEventListener('keydown', onKey, true); }
    function onKey(ev) { if (ev.keyCode === 27) { ev.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);
    box.appendChild(el('div', { 'class': 'm-head' }, [el('h3', { text: title }), el('button', { 'class': 'x', type: 'button', onclick: close, text: '×' })]));
    box.appendChild(bodyNode); if (footNode) box.appendChild(footNode);
    shade.appendChild(box);
    shade.onmousedown = function (ev) { if (ev.target === shade) close(); };
    root.appendChild(shade);
    return { close: close, box: box, shade: shade };
  }
  function pager(host, page, pages, total, from, to, goto_) {
    clear(host);
    var b = function (label, p, dis, on) { return el('button', { type: 'button', 'class': on ? 'on' : '', disabled: dis ? 'disabled' : null, onclick: function () { goto_(p); }, text: label }); };
    host.appendChild(b('«', 0, page === 0)); host.appendChild(b('‹ ' + t('prev'), page - 1, page === 0));
    var shown = {}, list = [0, pages - 1, page - 2, page - 1, page, page + 1, page + 2], i;
    for (i = 0; i < list.length; i++) if (list[i] >= 0 && list[i] < pages) shown[list[i]] = 1;
    var last = -1; for (i = 0; i < pages; i++) { if (!shown[i]) continue; if (last >= 0 && i - last > 1) host.appendChild(el('span', { 'class': 'info', text: '…' })); host.appendChild(b(String(i + 1), i, false, i === page)); last = i; }
    host.appendChild(b(t('next') + ' ›', page + 1, page >= pages - 1)); host.appendChild(b('»', pages - 1, page >= pages - 1));
    host.appendChild(el('span', { 'class': 'info', text: from + '–' + to + ' ' + t('of') + ' ' + total }));
  }

  /* ---------------------------------------------------------------- card + grid (paged, size follows the window) */
  var CARD_W = 204, CARD_H = 104;
  function card(e, opts) {
    opts = opts || {};
    var fav = isFav(e);
    var c = el('div', { 'class': 'card k-' + e.kind + (opts.fav ? ' fav' : ''), 'data-key': e.key, title: e.name + (e.sub ? '  ·  ' + e.sub : '') + '  ·  ' + (e.kind === 'c' ? e.id : '#' + e.id) });
    c.appendChild(iconNode(e));
    c.appendChild(el('div', { 'class': 'code', text: KIND_CODE[e.kind] }));
    c.appendChild(el('div', { 'class': 'nm', text: e.name }));
    c.appendChild(el('div', { 'class': 'sub', text: e.kind === 'c' ? e.sub : ('#' + e.id + (e.sub ? ' · ' + e.sub : '')) }));
    var st = el('button', { type: 'button', 'class': 'star' + (fav ? ' on' : ''), title: fav ? t('fav_del') : t('fav_add'), text: fav ? '★' : '☆' });
    st.onclick = function (ev) { ev.stopPropagation(); toggleFav(e); if (opts.onFav) opts.onFav(); };
    st.onmousedown = function (ev) { ev.stopPropagation(); };
    if (!opts.noStar) c.appendChild(st);
    if (opts.fav) {
      var mv = el('div', { 'class': 'mv' }, [
        el('button', { type: 'button', title: t('move_l'), text: '◀', onclick: function (ev) { ev.stopPropagation(); favMove(e.key, indexOf(S.favs, e.key) - 1); }, onmousedown: function (ev) { ev.stopPropagation(); } }),
        el('button', { type: 'button', title: t('move_r'), text: '▶', onclick: function (ev) { ev.stopPropagation(); favMove(e.key, indexOf(S.favs, e.key) + 1); }, onmousedown: function (ev) { ev.stopPropagation(); } })]);
      c.appendChild(mv);
    }
    c.onclick = function () { if (opts.suppressClick && opts.suppressClick()) return; (opts.onOpen || openEntity)(e); };
    return c;
  }
  function PagedGrid(host, getItems, opts) {
    var self = { page: 0 }, gridEl = el('div', { 'class': 'grid' }), pg = el('div', { 'class': 'pager' }), size = 1;
    host.appendChild(gridEl); host.appendChild(pg);
    function measure() {
      var w = host.clientWidth, h = host.clientHeight - 46; var cols = Math.max(1, Math.floor((w + 8) / CARD_W)), rows = Math.max(1, Math.floor((h + 8) / CARD_H)); size = cols * rows;
    }
    self.render = function () {
      var items = getItems(); measure();
      var pages = Math.max(1, Math.ceil(items.length / size)); if (self.page >= pages) self.page = pages - 1; if (self.page < 0) self.page = 0;
      var from = self.page * size, to = Math.min(items.length, from + size);
      clear(gridEl);
      if (!items.length) gridEl.appendChild(el('div', { 'class': 'empty', style: 'margin:30px 0' }, [t(opts.emptyKey || 'none')]));
      for (var i = from; i < to; i++) gridEl.appendChild(card(items[i], opts));
      if (items.length > size) pager(pg, self.page, pages, items.length, from + 1, to, function (p) { self.page = p; self.render(); }); else clear(pg);
    };
    self.next = function (d) { self.page += d; self.render(); };
    return self;
  }

  /* ---------------------------------------------------------------- views */
  var viewState = { grid: null, resizeT: 0 };
  function refreshView() { if (S.tab === 'fav') renderFav(); else if (S.tab === 'eco') renderEco(); else renderAll(); }
  function setTab(tab) {
    var was = S.tab; S.tab = tab; var b = document.querySelectorAll('.tab'); for (var i = 0; i < b.length; i++) b[i].className = 'tab' + (b[i].getAttribute('data-tab') === tab ? ' on' : '');
    if (was === 'eco' && tab !== 'eco') ecoStop();      // no refreshing while the dashboard is closed; the last values stay
    if (tab === 'eco') ecoOpened(); else refreshView();
  }

  function renderFav() {
    var v = clear($('view')); viewState.grid = null;
    var items = [], i; for (i = 0; i < S.favs.length; i++) if (S.ent[S.favs[i]]) items.push(S.ent[S.favs[i]]);
    if (!items.length) {
      v.appendChild(el('div', { 'class': 'empty' }, [el('h2', { text: t('fav_empty_t') }), el('div', { text: t('fav_empty') })]));
      return;
    }
    var grid = el('div', { 'class': 'grid' }); v.appendChild(grid);
    var drag = null;
    for (i = 0; i < items.length; i++) (function (e) {
      var c = card(e, { fav: true, suppressClick: function () { return drag && drag.moved; } });
      c.onmousedown = function (ev) {
        if (ev.button !== 0) return;
        drag = { key: e.key, node: c, sx: ev.clientX, sy: ev.clientY, moved: false, ghost: null, before: null };
        document.addEventListener('mousemove', onMove, true); document.addEventListener('mouseup', onUp, true);
      };
      grid.appendChild(c);
    })(items[i]);
    function onMove(ev) {
      if (!drag) return;
      if (!drag.moved && Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) > 7) {
        drag.moved = true; var r = drag.node.getBoundingClientRect(); drag.ghost = drag.node.cloneNode(true); drag.ghost.className = 'card ghost'; drag.ghost.style.width = r.width + 'px'; drag.ghost.style.height = r.height + 'px'; drag.dx = ev.clientX - r.left; drag.dy = ev.clientY - r.top;
        document.body.appendChild(drag.ghost); drag.node.className += ' drag';
      }
      if (!drag.moved) return;
      drag.ghost.style.left = (ev.clientX - drag.dx) + 'px'; drag.ghost.style.top = (ev.clientY - drag.dy) + 'px';
      var under = document.elementFromPoint(ev.clientX, ev.clientY), tgt = under; while (tgt && !(tgt.className && String(tgt.className).indexOf('card') >= 0 && tgt.getAttribute && tgt.getAttribute('data-key'))) tgt = tgt.parentNode;
      var all = grid.children, j; for (j = 0; j < all.length; j++) all[j].className = all[j].className.replace(' drop-before', '');
      drag.before = null;
      if (tgt && tgt !== drag.node) { var rr = tgt.getBoundingClientRect(); if (ev.clientX < rr.left + rr.width / 2) { drag.before = tgt.getAttribute('data-key'); tgt.className += ' drop-before'; } else { var nx = tgt.nextSibling; drag.before = nx ? nx.getAttribute('data-key') : '__end'; if (nx) nx.className += ' drop-before'; } }
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove, true); document.removeEventListener('mouseup', onUp, true);
      var d = drag; if (!d) return;
      if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
      if (d.moved && d.before !== null) {
        var from = indexOf(S.favs, d.key); S.favs.splice(from, 1);
        var to = d.before === '__end' ? S.favs.length : indexOf(S.favs, d.before); if (to < 0) to = S.favs.length;
        S.favs.splice(to, 0, d.key); favSave();
      }
      setTimeout(function () { drag = null; if (d.moved) renderFav(); }, 0);
    }
  }

  function renderAll() {
    var v = clear($('view')); v.className = ''; var wrap = el('div', { 'class': 'view-flex' }); v.appendChild(wrap);
    var seg = el('div', { 'class': 'seg' }), i;
    for (i = 0; i < SECTIONS.length; i++) (function (k) {
      var n = S.bySection[k].length;
      seg.appendChild(el('button', { type: 'button', 'class': k === S.section ? 'on' : '', onclick: function () { S.section = k; S.allCat = ''; S.allFilter = ''; renderAll(); } }, [t('sec_' + k), el('span', { 'class': 'n', text: String(n) })]));
    })(SECTIONS[i]);
    wrap.appendChild(seg);
    if (S.section !== 'a' && S.section !== 'g') {
      var cats = {}, arr = S.bySection[S.section]; for (i = 0; i < arr.length; i++) cats[arr[i].sub] = (cats[arr[i].sub] || 0) + 1;
      var names = []; for (var c in cats) names.push(c); names.sort();
      var tb = el('div', { 'class': 'toolbar' });
      var inp = el('input', { type: 'text', placeholder: t('filter_ph'), value: S.allFilter });
      var sel = el('select', null, [el('option', { value: '', text: t('all_cats') })]);
      for (i = 0; i < names.length; i++) { var o = el('option', { value: names[i], text: (names[i] || '-') + ' (' + cats[names[i]] + ')' }); if (names[i] === S.allCat) o.setAttribute('selected', 'selected'); sel.appendChild(o); }
      tb.appendChild(inp); if (names.length > 1) tb.appendChild(sel); wrap.appendChild(tb);
      var host = el('div', { 'class': 'grid-host' }); wrap.appendChild(host);
      var g = PagedGrid(host, function () {
        var out = [], a = S.bySection[S.section], f = norm(S.allFilter).split(/\s+/), j, k2;
        for (j = 0; j < a.length; j++) { if (S.allCat && a[j].sub !== S.allCat) continue; var ok = true; for (k2 = 0; k2 < f.length; k2++) if (f[k2] && (a[j].nameN + ' ' + a[j].id + ' ' + a[j].kwN).indexOf(f[k2]) < 0) { ok = false; break; } if (ok) out.push(a[j]); }
        return out;
      }, { emptyKey: S.section === 'c' ? 'none' : (S.catalogN ? 'none' : 'catalog_wait') });
      var tmr = 0; inp.onkeyup = inp.oninput = function () { if (S.allFilter === inp.value) return; S.allFilter = inp.value; clearTimeout(tmr); tmr = setTimeout(function () { g.page = 0; g.render(); }, 120); };
      sel.onchange = function () { S.allCat = sel.value; g.page = 0; g.render(); };
      viewState.grid = g; g.render();
    } else {
      var host2 = el('div', { 'class': 'grid-host' }); wrap.appendChild(host2);
      viewState.grid = PagedGrid(host2, function () { return S.bySection[S.section]; }, { emptyKey: 'sections_none' }); viewState.grid.render();
    }
  }
  window.onresize = function () { clearTimeout(viewState.resizeT); viewState.resizeT = setTimeout(function () { if (S.tab === 'all' && viewState.grid) viewState.grid.render(); if (resultsGrid) resultsGrid.render(); }, 150); };

  /* ---------------------------------------------------------------- search results window */
  var resultsGrid = null;
  function openResults(q0, popts) {
    popts = popts || null;
    var kinds = { all: 1 }, filter = 'all', modalRef = null, body = el('div', { 'class': 'm-body res' });
    var inp = el('input', { type: 'text', value: q0 || '', autocomplete: 'off', style: 'width:100%;padding:9px 12px;background:#0e0c08;border:1px solid #4a3e26;border-radius:5px;margin-bottom:10px;outline:0;color:#e3d9bd;font-size:15px' });
    var chips = el('div', { 'class': 'seg' }), host = el('div', { 'class': 'grid-host' });
    body.appendChild(inp); body.appendChild(chips); body.appendChild(host);
    var all = [], shown = [];
    function run() {
      all = (popts && popts.kinds && !inp.value.replace(/\s/g, '')) ? S.bySection[popts.kinds[0]].slice(0) : search(inp.value); if (popts && popts.kinds) all = all.filter(function (e) { return indexOf(popts.kinds, e.kind) >= 0; }); var cnt = { all: all.length, c: 0, i: 0, b: 0, m: 0, a: 0, g: 0 }, j; for (j = 0; j < all.length; j++) cnt[all[j].kind]++;
      clear(chips); var order = popts && popts.kinds ? ['all'] : ['all'].concat(SECTIONS);
      for (j = 0; j < order.length; j++) (function (k) { if (k !== 'all' && !cnt[k]) return; chips.appendChild(el('button', { type: 'button', 'class': k === filter ? 'on' : '', onclick: function () { filter = k; resultsGrid.page = 0; run(); } }, [k === 'all' ? t('f_all') : t('sec_' + k), el('span', { 'class': 'n', text: String(cnt[k]) })])); })(order[j]);
      shown = filter === 'all' ? all : all.filter(function (e) { return e.kind === filter; });
      if (modalRef) { var h = modalRef.box.querySelector('h3'); clear(h).appendChild(document.createTextNode((popts && popts.title ? popts.title : t('results')) + ' – ' + all.length + ' ' + t('results_n'))); }
      resultsGrid.render();
    }
    modalRef = modal('results', popts && popts.title ? popts.title : t('results'), body, null, function () { resultsGrid = null; });
    resultsGrid = PagedGrid(host, function () { return shown; }, { noStar: !!(popts && popts.onPick), onOpen: function (e) { if (popts && popts.onPick) { var cb = popts.onPick; modalRef.close(); cb(e); } else openEntity(e); }, onFav: function () { } });
    var tmr = 0; inp.oninput = inp.onkeyup = function (ev) { if (ev && ev.keyCode === 37 && !inp.value) return; clearTimeout(tmr); tmr = setTimeout(function () { resultsGrid.page = 0; run(); }, 140); };
    inp.onkeydown = function (ev) { if (ev.keyCode === 33) { resultsGrid.next(-1); ev.preventDefault(); } else if (ev.keyCode === 34) { resultsGrid.next(1); ev.preventDefault(); } };
    run(); setTimeout(function () { resultsGrid.render(); inp.focus(); inp.setSelectionRange && inp.setSelectionRange(inp.value.length, inp.value.length); }, 0);
  }

  /* ---------------------------------------------------------------- actions: forms + entity dialogs */
  function playerField(label) {
    var inp = el('input', { type: 'text', placeholder: t('me') }), sel = el('select', { style: 'margin-top:6px' }, [el('option', { value: '', text: t('pick_player') })]);
    function fill() { clear(sel).appendChild(el('option', { value: '', text: t('pick_player') })); for (var i = 0; i < S.players.length; i++) sel.appendChild(el('option', { value: S.players[i].id, text: S.players[i].name + ' (' + S.players[i].id + ')' })); }
    fill(); sel.onchange = function () { if (sel.value) inp.value = sel.value; };
    var f = el('div', { 'class': 'field' }, [el('label', { text: label || t('player') }), inp, sel, el('button', { type: 'button', 'class': 'btn', style: 'margin:6px 0 0 0;padding:3px 10px;font-size:12px', text: t('refresh'), onclick: function () { transport.send('kz_players', [], true); setTimeout(fill, 1200); } })]);
    return { el: f, input: inp, value: function () { return inp.value.replace(/^\s+|\s+$/g, ''); } };
  }
  function pickerField(label, kinds, spec) {
    var inp = el('input', { type: 'text', autocomplete: 'off' }), list = el('div', { 'class': 'list', style: 'display:none' }), chosen = '', sel = -1, hits = [];
    var f = el('div', { 'class': 'field' }, [el('label', { text: label }), el('div', { 'class': 'pick' }, [inp, list])]);
    function close() { list.style.display = 'none'; }
    function choose(e) { chosen = e.id; inp.value = e.name + ' (' + e.id + ')'; close(); }
    function upd() {
      chosen = ''; var q = inp.value; if (/^\d+$/.test(q)) { close(); return; }
      hits = []; if (q) { var r = search(q); for (var i = 0; i < r.length && hits.length < 8; i++) if (kinds.indexOf(r[i].kind) >= 0) hits.push(r[i]); }
      clear(list); sel = -1; if (!hits.length) { close(); return; }
      for (var j = 0; j < hits.length; j++) (function (e) { var it = el('div', { 'class': 'it' }, [iconNode(e, 'ico'), e.name, el('small', { text: '#' + e.id })]); it.onmousedown = function (ev) { ev.preventDefault(); choose(e); }; list.appendChild(it); })(hits[j]);
      list.style.display = '';
    }
    inp.oninput = upd;
    inp.onkeydown = function (ev) {
      if (ev.keyCode === 40 || ev.keyCode === 38) { if (!hits.length) return; sel = (sel + (ev.keyCode === 40 ? 1 : -1) + hits.length) % hits.length; for (var i = 0; i < list.children.length; i++) list.children[i].className = 'it' + (i === sel ? ' sel' : ''); ev.preventDefault(); }
      else if (ev.keyCode === 13 && list.style.display !== 'none') { choose(hits[sel < 0 ? 0 : sel]); ev.preventDefault(); ev.stopPropagation(); }
    };
    inp.onblur = function () { setTimeout(close, 120); };
    return { el: f, input: inp, set: function (e) { choose(e); }, value: function () { var v = inp.value.replace(/^\s+|\s+$/g, ''); if (chosen) return chosen; if (/^\d+$/.test(v)) return v; if (hits.length === 1 && v) return hits[0].id; return ''; } };
  }
  // builds the form for a list of arg specs; preset = {argName: value}
  function buildForm(args, preset) {
    var root = el('div'), fields = [], i, row = null;
    preset = preset || {};
    function labelOf(n) { var d = window.KZ_I18N[S.lang] || {}; return d[n] !== undefined ? d[n] : n; }
    for (i = 0; i < args.length; i++) (function (a) {
      var f = { a: a }, lab = labelOf(a.name) + (a.opt ? '' : ' *');
      if (a.type === 'player') { f.w = playerField(labelOf(a.name)); f.el = f.w.el; f.get = f.w.value; }
      else if (a.type === 'item' || a.type === 'building' || a.type === 'object' || a.type === 'thing') {
        var kinds = a.type === 'item' ? ['i'] : a.type === 'building' ? ['b'] : a.type === 'object' ? ['m'] : ['b', 'm'];
        f.w = pickerField(lab, kinds); f.el = f.w.el; f.get = f.w.value;
        if (preset[a.name]) { var pe = S.ent[(a.type === 'item' ? 'i' : 'b') + ':' + preset[a.name]] || S.ent['m:' + preset[a.name]]; if (pe) f.w.set(pe); else f.w.input.value = preset[a.name]; }
      } else if (a.type === 'animal' || a.type === 'ground' || a.type === 'choice') {
        var opts = [];
        if (a.type === 'choice') for (var c = 0; c < a.choices.length; c++) opts.push([a.choices[c], a.choices[c]]);
        else if (a.type === 'animal') for (c = 0; c < S.animals.length; c++) opts.push([S.animals[c][0], S.lang === 'de' ? (S.animals[c][2] || S.animals[c][1]) : S.animals[c][1]]);
        else for (c = 0; c < S.ground.length; c++) opts.push([S.ground[c][0], S.lang === 'de' ? (S.ground[c][3] || S.ground[c][2]) : S.ground[c][2]]);
        var sl = el('select'); for (c = 0; c < opts.length; c++) { var op = el('option', { value: opts[c][0], text: opts[c][1] }); if (opts[c][0] === (preset[a.name] || a.def)) op.setAttribute('selected', 'selected'); sl.appendChild(op); }
        f.el = el('div', { 'class': 'field' }, [el('label', { text: labelOf(a.name) }), sl]); f.get = function () { return sl.value; };
      } else {
        var inp = el('input', { type: 'text', value: preset[a.name] !== undefined ? preset[a.name] : a.def });
        f.el = el('div', { 'class': 'field' }, [el('label', { text: lab }), inp, el('div', { 'class': 'hint', style: 'display:none' })]); f.get = function () { return inp.value.replace(/^\s+|\s+$/g, ''); }; f.input = inp;
      }
      fields.push(f);
    })(args[i]);
    // two small number fields share a row
    for (i = 0; i < fields.length; i++) {
      var small = fields[i].a.type === 'int';
      if (small) { if (!row) { row = el('div', { 'class': 'row' }); root.appendChild(row); } row.appendChild(fields[i].el); } else { row = null; root.appendChild(fields[i].el); }
    }
    function values() {
      var out = [], ok = true;
      for (var j = 0; j < fields.length; j++) {
        var f = fields[j], v = f.get(), bad = '';
        if (!v && !f.a.opt) bad = t('req');
        else if (v && f.a.type === 'int' && !/^-?\d+(\.\d+)?$/.test(v)) bad = t('need_num');
        else if (v && f.a.type === 'word' && /\s/.test(v)) bad = t('need_word');
        if (f.input) { var h = f.el.querySelector('.hint'); f.el.className = 'field' + (bad ? ' bad' : ''); if (h) { h.style.display = bad ? '' : 'none'; clear(h).appendChild(document.createTextNode(bad)); } } else if (bad) { f.el.className = 'field bad'; } else f.el.className = 'field';
        if (bad) ok = false; out.push(v);
      }
      return ok ? out : null;
    }
    return { el: root, values: values, fields: fields };
  }
  function run(cmdId, args) {
    if (cmdId === 'dashboard') { setTab('eco'); return; }
    var c = S.cmdById[cmdId];
    if (DANGER[cmdId] && !window.confirm((c ? (S.lang === 'de' ? c.de : c.en) : cmdId) + '\n\n' + t('confirm'))) return;
    transport.send(cmdId, args);
  }
  function foot(buttons) { var f = el('div', { 'class': 'm-foot' }); for (var i = 0; i < buttons.length; i++) f.appendChild(buttons[i]); return f; }
  function btn(text, pri, fn) { return el('button', { type: 'button', 'class': 'btn' + (pri ? ' pri' : ''), text: text, onclick: fn }); }
  function entHead(e) { return el('div', { 'class': 'ent-head' }, [iconNode(e, 'ico'), el('div', null, [el('div', { 'class': 't', text: e.name }), el('div', { 'class': 's', text: (e.sub || '') + (e.kind === 'c' ? ' · ' + e.id : ' · #' + e.id) })])]); }

  function openEntity(e) {
    var m;
    if (e.kind === 'c') {
      var c = e.cmd;
      if (!c.args.length) { run(c.id, []); return; }
      var form = buildForm(c.args), body = el('div', { 'class': 'm-body' }, [entHead(e), form.el]);
      var go = function () { var v = form.values(); if (v) { run(c.id, v); m.close(); } };
      m = modal('small', e.name, body, foot([btn(t('cancel'), false, function () { m.close(); }), btn(t('run'), true, go)]));
      var first = body.querySelector('input'); if (first) first.focus();
      body.onkeydown = function (ev) { if (ev.keyCode === 13) go(); };
    } else if (e.kind === 'i') {
      // quality is chosen here; the durability is calculated by the server from it (learned from the game's own items) and only shown
      var form2 = buildForm([{ name: 'qty', type: 'int', def: '1', opt: false }, { name: 'quality', type: 'int', def: '100', opt: false }]);
      var qIn = form2.fields[1].input, slider = el('input', { type: 'range', min: '1', max: '100', value: '100', style: 'width:100%;margin:2px 0 6px' });
      var presets = el('div', { 'class': 'seg', style: 'margin:0 0 8px' }), durLine = el('div', { 'class': 'note durline', text: t('dur_wait') });
      function curQ() { var q = parseInt(qIn.value, 10); if (isNaN(q)) return 0; return q < 1 ? 1 : (q > 100 ? 100 : q); }
      var durTimer = 0;
      function askDur() { var q = curQ(); if (!q) return; clearTimeout(durTimer); durTimer = setTimeout(function () { S.durWant = { type: e.id, q: q, el: durLine }; clear(durLine).appendChild(document.createTextNode(t('dur_wait'))); transport.send('kz_dur', [e.id, String(q)], true); }, 450); }
      function setQ(q) { qIn.value = String(q); slider.value = String(q); askDur(); }
      qIn.oninput = function () { var q = curQ(); if (q) slider.value = String(q); askDur(); };
      slider.oninput = slider.onchange = function () { qIn.value = slider.value; askDur(); };
      var ps = [25, 50, 75, 100]; for (var pi = 0; pi < ps.length; pi++) (function (v) { presets.appendChild(el('button', { type: 'button', text: String(v), onclick: function () { setQ(v); } })); })(ps[pi]);
      form2.fields[1].el.appendChild(slider); form2.fields[1].el.appendChild(presets);
      var who = playerField(t('give_to')), body2 = el('div', { 'class': 'm-body' }, [entHead(e), form2.el, el('div', { 'class': 'field' }, [el('label', { text: t('dur_label') }), durLine]), who.el]);
      var send = function (toPlayer) { var v = form2.values(); if (!v) return; var q = String(curQ() || 100); if (toPlayer) { var w = who.value(); if (!w) { who.el.className = 'field bad'; return; } run('giveto', [w, e.id, v[0], q]); } else run('give', [e.id, v[0], q]); };
      m = modal('small', e.name, body2, foot([btn(t('cancel'), false, function () { m.close(); }), btn(t('give_to'), false, function () { send(true); }), btn(t('give_me'), true, function () { send(false); })]), function () { clearTimeout(durTimer); S.durWant = null; });
      form2.fields[0].input.focus(); askDur();
    } else if (e.kind === 'b' || e.kind === 'm') {
      m = modal('small', e.name, el('div', { 'class': 'm-body' }, [entHead(e), el('div', { 'class': 'note', text: t('create') })]), foot([btn(t('cancel'), false, function () { m.close(); }), btn(t('create'), true, function () { run('place', [e.id]); m.close(); })]));
    } else if (e.kind === 'a') {
      run('animal', [e.id]);
    } else if (e.kind === 'g') {
      m = modal('small', e.name, el('div', { 'class': 'm-body' }, [entHead(e)]), foot([btn(t('cancel'), false, function () { m.close(); }), btn(S.lang === 'de' ? 'Erhöhen' : 'Raise', false, function () { run('raise', [e.id]); m.close(); }), btn(S.lang === 'de' ? 'Boden ändern' : 'Change ground', true, function () { run('ground', [e.id]); m.close(); })]));
    }
  }

  /* ---------------------------------------------------------------- theme window */
  function themeSave() {
    var s = window.KZTheme.serialize();
    try { localStorage.setItem('kz_theme', s); } catch (e) { }
    transport.send('kz_themesave', [s], true);
  }
  function openTheme() {
    var KT = window.KZTheme, body = el('div', { 'class': 'm-body' }), tiles = el('div', { 'class': 'themes' }), custom = el('div'), tileEls = {};
    var names = ['hud', 'light', 'mono', 'custom'], m;
    function mark() { var cur = KT.get().name; for (var k in tileEls) tileEls[k].className = 'tile' + (k === cur ? ' on' : ''); }
    function preview(nm) {
      var b = KT.base(nm), pv = el('div', { 'class': 'pv' }, [el('i'), el('i'), el('b', { text: 'Aa' })]);
      pv.style.background = b.bg; pv.style.color = b.text; pv.children[0].style.background = b.a1; pv.children[0].style.width = '70%'; pv.children[1].style.background = b.a2; pv.children[1].style.width = '45%';
      return pv;
    }
    function buildTiles() {
      clear(tiles); tileEls = {};
      for (var i = 0; i < names.length; i++) (function (nm) {
        var tile = el('button', { type: 'button', 'class': 'tile' }, [preview(nm), el('div', { 'class': 'tn', text: t('theme_' + nm) })]);
        tile.onclick = function () { KT.set(nm); themeSave(); buildTiles(); };
        tiles.appendChild(tile); tileEls[nm] = tile;
      })(names[i]);
      mark();
    }
    var colorOk = (function () { try { var x = document.createElement('input'); x.setAttribute('type', 'color'); return x.type === 'color'; } catch (e) { return false; } })();
    function row(key) {
      var cur = KT.get().custom[key], txt = el('input', { type: 'text', maxlength: '7', value: cur }), sw = el('div', { 'class': 'sw' }), pick = null;
      sw.style.background = cur;
      function set(v) { if (!KT.validHex(v)) return; if (v.charAt(0) !== '#') v = '#' + v; var o = {}; o[key] = v; var c = KT.get().custom; for (var k in c) if (k !== key) o[k] = c[k]; KT.set('custom', o); sw.style.background = v; if (pick) pick.value = v.length === 7 ? v : pick.value; themeSave(); buildTiles(); }
      txt.oninput = function () { var v = txt.value; if (/^#?[0-9a-fA-F]{6}$/.test(v) || /^#?[0-9a-fA-F]{3}$/.test(v)) set(v); };
      var kids = [el('label', { text: t('c_' + key) }), txt];
      if (!colorOk) kids.push(sw);
      if (colorOk) { pick = el('input', { type: 'color', value: cur.length === 7 ? cur : '#000000' }); pick.oninput = pick.onchange = function () { txt.value = pick.value; set(pick.value); }; kids.push(pick); }
      return el('div', { 'class': 'crow' }, kids);
    }
    body.appendChild(tiles);
    custom.appendChild(el('div', { 'class': 'note', text: t('theme_hint'), style: 'margin:4px 0 10px' }));
    var keys = ['bg', 'text', 'a1', 'a2']; for (var i = 0; i < keys.length; i++) custom.appendChild(row(keys[i]));
    body.appendChild(custom);
    buildTiles();
    m = modal('small', t('theme_title'), body, foot([btn(t('theme_reset'), false, function () { KT.set('hud'); themeSave(); m.close(); openTheme(); }), btn(t('close'), true, function () { m.close(); })]));
  }

  /* ---------------------------------------------------------------- economy tab (replaces the old stand-alone dashboard page) */
  var ECO = { rows: [], range: 30, src: '', asked: false, infHigh: 10, infLow: -5, tracked: [], hist: {}, live: null, liveSeries: [], sel: 'total', cmp: '', at: 0, fullAt: 0, pending: 0, timer: 0, fromCache: false, everLive: false, refreshMs: 15000 };
  function E(k) { return t('eco_' + k); }
  function fmtN(n, dec) { n = Number(n) || 0; var s = dec ? n.toFixed(dec) : String(Math.round(n)); var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, S.lang === 'de' ? '.' : ','); return p.join(S.lang === 'de' ? ',' : '.'); }
  function fmtPct(v) { return (v >= 0 ? '+' : '') + fmtN(v, 1) + ' %'; }
  function inflCls(v) { return v > ECO.infHigh ? 's-bad' : (v < ECO.infLow ? 's-ok' : 's-warn'); }
  function parseEco(txt) {
    // date,copper,silver,gold,coinValue,players,perPlayer,inflationPct[,baseline]
    var L = lines(txt), out = [];
    for (var i = 0; i < L.length; i++) {
      var p = L[i].replace(/^\s+|\s+$/g, '').split(','); if (p.length < 8 || /^date/i.test(p[0])) continue;
      out.push({ date: p[0], cu: parseInt(p[1], 10) || 0, si: parseInt(p[2], 10) || 0, au: parseInt(p[3], 10) || 0, val: parseFloat(p[4]) || 0, pl: parseInt(p[5], 10) || 1, pp: parseFloat(p[6]) || 0, infl: parseFloat(p[7]) || 0, base: p.length > 8 ? (parseFloat(p[8]) || 0) : 0 });
    }
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }
  function ecoVisible() { var r = ECO.rows; return ECO.range > 0 && r.length > ECO.range ? r.slice(r.length - ECO.range) : r; }
  function dayNum(d) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(d); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : 0; }
  function trendOf(rows) { // least squares of inflation over days
    if (rows.length < 3) return null; var n = rows.length, sx = 0, sy = 0, sxx = 0, sxy = 0, x0 = dayNum(rows[0].date), i;
    for (i = 0; i < n; i++) { var x = dayNum(rows[i].date) - x0, y = rows[i].infl; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    var den = n * sxx - sx * sx; if (!den) return null; var slope = (n * sxy - sx * sy) / den;
    return { slope: slope, in7: rows[n - 1].infl + slope * 7 };
  }
  function svg(tag, attrs, parent) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag), k; for (k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function niceTicks(lo, hi, n) {
    if (hi - lo < 1e-9) { hi = lo + 1; } var span = hi - lo, step = Math.pow(10, Math.floor(Math.log(span / n) / Math.LN10)), err = span / n / step;
    step *= err >= 7 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1; var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, o = []; for (var v = a; v <= b + step * 0.5; v += step) o.push(Math.round(v / step) * step); return o;
  }
  // o: { rows, series:[{name,color,vals,dashed,area,dots}], zones:[{from,to,color}], stack:bool, h, fmt }
  function chart(host, o) {
    clear(host); var P = window.KZTheme.palette(), w = Math.max(320, host.clientWidth || 640), h = o.h || 220, pad = { l: 58, r: 14, t: 12, b: 26 }, n = o.rows.length, i, j;
    var lo = Infinity, hi = -Infinity;
    function take(v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (o.stack) { for (i = 0; i < n; i++) { var s = 0; for (j = 0; j < o.series.length; j++) s += o.series[j].vals[i]; take(0); take(s); } }
    else { for (j = 0; j < o.series.length; j++) for (i = 0; i < n; i++) take(o.series[j].vals[i]); if (o.zero) take(0); }
    if (o.zones) for (i = 0; i < o.zones.length; i++) { if (o.zones[i].from > -1e8) take(o.zones[i].from); if (o.zones[i].to < 1e8) take(o.zones[i].to); }
    var ticks = niceTicks(lo, hi, 4); lo = ticks[0]; hi = ticks[ticks.length - 1];
    function X(k) { return pad.l + (n < 2 ? (w - pad.l - pad.r) / 2 : k * (w - pad.l - pad.r) / (n - 1)); }
    function Y(v) { return pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b); }
    var root = svg('svg', { width: w, height: h }, host);
    if (o.zones) for (i = 0; i < o.zones.length; i++) { var z = o.zones[i], y1 = Y(Math.min(hi, z.to)), y2 = Y(Math.max(lo, z.from)); if (y2 > y1) svg('rect', { x: pad.l, y: y1, width: w - pad.l - pad.r, height: y2 - y1, fill: z.color, opacity: 0.1 }, root); }
    for (i = 0; i < ticks.length; i++) { var ty = Y(ticks[i]); svg('line', { x1: pad.l, x2: w - pad.r, y1: ty, y2: ty, stroke: P.line, 'stroke-width': 1, opacity: 0.6 }, root); var lt = svg('text', { x: pad.l - 7, y: ty + 3, 'text-anchor': 'end', 'class': 'axis' }, root); lt.appendChild(document.createTextNode((o.fmt || fmtN)(ticks[i]))); }
    var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - pad.l - pad.r) / 70))));
    for (i = 0; i < n; i += every) { var xt = svg('text', { x: X(i), y: h - 8, 'text-anchor': 'middle', 'class': 'axis' }, root); xt.appendChild(document.createTextNode(o.rows[i].date.slice(5))); }
    if (o.stack) {
      var bw = Math.max(3, Math.min(34, (w - pad.l - pad.r) / n * 0.62));
      for (i = 0; i < n; i++) { var acc = 0; for (j = 0; j < o.series.length; j++) { var v = o.series[j].vals[i]; if (v <= 0) continue; svg('rect', { x: X(i) - bw / 2, y: Y(acc + v), width: bw, height: Math.max(0.5, Y(acc) - Y(acc + v)), fill: o.series[j].color }, root); acc += v; } }
    } else {
      for (j = 0; j < o.series.length; j++) {
        var sr = o.series[j], pts = []; for (i = 0; i < n; i++) pts.push(X(i) + ',' + Y(sr.vals[i]));
        if (sr.area && n > 1) svg('polygon', { points: X(0) + ',' + Y(Math.max(lo, 0)) + ' ' + pts.join(' ') + ' ' + X(n - 1) + ',' + Y(Math.max(lo, 0)), fill: sr.color, opacity: 0.12 }, root);
        svg('polyline', { points: pts.join(' '), fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-dasharray': sr.dashed ? '6 4' : '' }, root);
        if (sr.dots) for (i = 0; i < n; i++) svg('circle', { cx: X(i), cy: Y(sr.vals[i]), r: 3, fill: sr.dotColor ? sr.dotColor(sr.vals[i]) : sr.color }, root);
      }
    }
    if (o.zero && lo < 0 && hi > 0) svg('line', { x1: pad.l, x2: w - pad.r, y1: Y(0), y2: Y(0), stroke: P.text, 'stroke-width': 1, opacity: 0.55 }, root);
    var cur = svg('line', { y1: pad.t, y2: h - pad.b, stroke: P.a2, 'stroke-width': 1, opacity: 0, 'pointer-events': 'none' }, root), tip = el('div', { 'class': 'tip', style: 'display:none' }); host.appendChild(tip);
    var hit = svg('rect', { x: pad.l, y: pad.t, width: w - pad.l - pad.r, height: h - pad.t - pad.b, fill: 'transparent' }, root);
    hit.onmousemove = function (ev) {
      var r = host.getBoundingClientRect(), mx = ev.clientX - r.left, k = n < 2 ? 0 : Math.round((mx - pad.l) / ((w - pad.l - pad.r) / (n - 1))); if (k < 0) k = 0; if (k > n - 1) k = n - 1;
      cur.setAttribute('x1', X(k)); cur.setAttribute('x2', X(k)); cur.setAttribute('opacity', 0.8);
      var tx = o.rows[k].date; for (var q = 0; q < o.series.length; q++) tx += '\n' + o.series[q].name + ': ' + (o.tipFmt || o.fmt || fmtN)(o.series[q].vals[k]);
      clear(tip); var parts = tx.split('\n'); for (var z2 = 0; z2 < parts.length; z2++) { if (z2) tip.appendChild(document.createElement('br')); tip.appendChild(document.createTextNode(parts[z2])); }
      tip.style.display = ''; tip.style.left = Math.min(w - 170, X(k) + 12) + 'px'; tip.style.top = '8px';
    };
    hit.onmouseout = function () { cur.setAttribute('opacity', 0); tip.style.display = 'none'; };
    if (o.legend) { var lg = el('div', { 'class': 'legend' }); for (j = 0; j < o.series.length; j++) { var sp = el('span'); var sw = el('i'); sw.style.background = o.series[j].color; sp.appendChild(sw); sp.appendChild(document.createTextNode(o.series[j].name)); lg.appendChild(sp); } host.appendChild(lg); }
  }

  function coinView(main, side, rows, all, last, prev, P) {
    var i;
    // KPIs
    var kp = el('div', { 'class': 'kpis' });
    function kpi(cls, lab, val, sub) { kp.appendChild(el('div', { 'class': 'kpi ' + cls }, [el('div', { 'class': 'kl', text: lab }), el('div', { 'class': 'kv', text: val }), el('div', { 'class': 'ks', text: sub || '' })])); }
    kpi('big ' + (last.base > 0 ? inflCls(last.infl) : ''), E('infl'), last.base > 0 ? fmtPct(last.infl) : '—', last.base > 0 ? E('base') + ' ' + fmtN(last.base) + ' ' + E('copper_pp') : E('nocoins'));
    kpi('', E('pp'), fmtN(last.pp, 1), prev ? (last.pp >= prev.pp ? '▲ ' : '▼ ') + fmtN(Math.abs(last.pp - prev.pp), 1) + ' ' + E('vs_prev') : E('copper_pp'));
    kpi('', E('total'), fmtN(last.val), prev ? (last.val >= prev.val ? '▲ ' : '▼ ') + fmtN(Math.abs(last.val - prev.val)) + ' ' + E('vs_prev') : E('cp'));
    kpi('', E('players'), fmtN(last.pl), last.date);
    kpi('', E('copper'), fmtN(last.cu), '= ' + fmtN(last.cu) + ' ' + E('cp'));
    kpi('', E('silver'), fmtN(last.si), '= ' + fmtN(last.si * 100) + ' ' + E('cp'));
    kpi('', E('gold'), fmtN(last.au), '= ' + fmtN(last.au * 10000) + ' ' + E('cp'));
    main.appendChild(kp);
    var tr = trendOf(rows); if (tr) main.appendChild(el('div', { 'class': 'note', style: 'margin:0 0 10px' }, [E('trend') + ': ', el('b', { 'class': tr.slope > 0.05 ? 'up' : (tr.slope < -0.05 ? 'down' : 'flat'), text: fmtPct(tr.slope) }), ' ' + E('trend_txt') + ' ', el('b', { 'class': inflCls(tr.in7).replace('s-bad', 'up').replace('s-ok', 'down').replace('s-warn', 'flat'), text: fmtPct(tr.in7) })]));
    // charts
    function box(title, hint) { var p = el('div', { 'class': 'panel' }, [el('h4', null, [el('span', { text: title }), hint ? el('em', { text: hint }) : null])]), host = el('div', { 'class': 'chartbox' }); p.appendChild(host); main.appendChild(p); return host; }
    var h1 = box(E('c_infl'), '+' + ECO.infHigh + ' % / ' + ECO.infLow + ' %');
    var dotC = function (val) { return val > ECO.infHigh ? P.bad : (val < ECO.infLow ? P.ok : P.warn); };
    var h2 = box(E('c_pp')), h3 = box(E('c_comp'));
    var tb = el('div', { 'class': 'panel' }, [el('h4', null, [el('span', { text: E('hist') })])]); main.appendChild(tb);
    function draw() {
      chart(h1, { rows: rows, series: [{ name: E('infl'), color: P.a2, vals: rows.map(function (r) { return r.infl; }), area: true, dots: true, dotColor: dotC }], zones: [{ from: ECO.infHigh, to: 1e9, color: P.bad }, { from: -1e9, to: ECO.infLow, color: P.ok }], zero: true, h: 230, fmt: function (x) { return fmtN(x, 0) + '%'; }, tipFmt: fmtPct });
      chart(h2, { rows: rows, series: [{ name: E('h_pp'), color: P.a1, vals: rows.map(function (r) { return r.pp; }), area: true, dots: true }, { name: E('base'), color: P.muted, dashed: true, vals: rows.map(function (r) { return r.base; }) }], h: 200, legend: true, tipFmt: function (x) { return fmtN(x, 1); } });
      chart(h3, { rows: rows, stack: true, series: [{ name: E('copper'), color: P.a1, vals: rows.map(function (r) { return r.cu; }) }, { name: E('silver'), color: P.soft, vals: rows.map(function (r) { return r.si * 100; }) }, { name: E('gold'), color: P.warn, vals: rows.map(function (r) { return r.au * 10000; }) }], h: 200, legend: true });
    }
    draw(); ECO.redraw = draw;
    // table
    var wrapT = el('div', { 'class': 'tblwrap' }), tbl = el('table', { 'class': 'tbl' }), hr = el('tr'), hs = ['date', 'total', 'pp', 'pl', 'infl', 'd'];
    for (i = 0; i < hs.length; i++) hr.appendChild(el('th', { text: E('h_' + hs[i]) })); tbl.appendChild(hr);
    for (i = rows.length - 1; i >= 0; i--) { var r = rows[i], pr = i > 0 ? rows[i - 1] : (all.indexOf(r) > 0 ? all[all.indexOf(r) - 1] : null), d = pr ? r.pp - pr.pp : 0;
      var tr2 = el('tr'); tr2.appendChild(el('td', { text: r.date })); tr2.appendChild(el('td', { text: fmtN(r.val) })); tr2.appendChild(el('td', { text: fmtN(r.pp, 1) })); tr2.appendChild(el('td', { text: fmtN(r.pl) }));
      tr2.appendChild(el('td', { 'class': r.base > 0 ? (r.infl > ECO.infHigh ? 'up' : (r.infl < ECO.infLow ? 'down' : '')) : '', text: r.base > 0 ? fmtPct(r.infl) : '—' }));
      tr2.appendChild(el('td', { 'class': d > 0 ? 'up' : (d < 0 ? 'down' : ''), text: pr ? (d >= 0 ? '+' : '') + fmtN(d, 1) : '' })); tbl.appendChild(tr2); }
    wrapT.appendChild(tbl); tb.appendChild(wrapT);

    fillSide(side, last);
  }
  function fillSide(side, last) {
    var infl = last ? last.infl : 0, i;
    // price calculator
    var c = el('div', { 'class': 'panel' }, [el('h4', null, [el('span', { text: E('calc') })])]);
    var base = el('input', { type: 'text', value: '100' }), cur = el('select'), ovr = el('input', { type: 'text', placeholder: fmtN(infl, 1) }), res = el('div', { 'class': 'res', style: 'display:none' });
    var curs = [['cp', E('cp')], ['sp', E('sp')], ['gp', E('gp')]]; for (i = 0; i < curs.length; i++) cur.appendChild(el('option', { value: curs[i][0], text: curs[i][1] }));
    function pct() { var o = ovr.value.replace(',', '.'); return o !== '' && !isNaN(parseFloat(o)) ? parseFloat(o) : infl; }
    c.appendChild(el('label', { text: E('calc_base') })); c.appendChild(base); c.appendChild(el('label', { text: E('calc_cur') })); c.appendChild(cur); c.appendChild(el('label', { text: E('calc_ovr') })); c.appendChild(ovr);
    c.appendChild(btn(E('calc_go'), true, function () { var b = parseFloat(base.value.replace(',', '.')) || 0, p = pct(), a = Math.round(b * (1 + p / 100)), d = a - b; clear(res); res.style.display = ''; res.appendChild(document.createTextNode(fmtN(b) + ' ' + cur.options[cur.selectedIndex].text + '  ·  ' + fmtPct(p))); res.appendChild(document.createElement('br')); res.appendChild(el('b', { text: fmtN(a) + ' ' + cur.options[cur.selectedIndex].text })); res.appendChild(document.createTextNode('   ' + (d >= 0 ? '+' : '') + fmtN(d))); }));
    c.lastChild.style.margin = '0'; c.appendChild(res); side.appendChild(c);
    // bulk
    var b2 = el('div', { 'class': 'panel' }, [el('h4', null, [el('span', { text: E('bulk') })])]), ta = el('textarea', { placeholder: E('bulk_h') }), out = el('div', { style: 'margin-top:8px' });
    b2.appendChild(ta); b2.appendChild(el('div', { style: 'margin-top:8px' }, [btn(E('bulk_go'), true, function () {
      clear(out); var L = ta.value.split('\n'), tbl = el('table', { 'class': 'tbl' }), h = el('tr', null, [el('th', { text: '' }), el('th', { text: '' }), el('th', { text: E('adj') })]); tbl.appendChild(h);
      for (var k = 0; k < L.length; k++) { var p = L[k].split(','); if (p.length < 2) continue; var bb = parseFloat(p[1].replace(',', '.')) || 0, aa = Math.round(bb * (1 + infl / 100)); tbl.appendChild(el('tr', null, [el('td', { text: p[0].replace(/^\s+|\s+$/g, '') }), el('td', { text: fmtN(bb) }), el('td', { 'class': aa > bb ? 'up' : (aa < bb ? 'down' : ''), text: fmtN(aa) })])); }
      out.appendChild(tbl); })])); b2.lastChild.firstChild.style.margin = '0'; b2.appendChild(out); side.appendChild(b2);
    // baseline
    var b3 = el('div', { 'class': 'panel' }, [el('h4', null, [el('span', { text: E('baseline') }), el('em', { text: last ? fmtN(last.base) : '' })])]), bi = el('input', { type: 'text', placeholder: E('baseline_h') });
    b3.appendChild(bi); b3.appendChild(btn(E('baseline_go'), false, function () { var x = bi.value.replace(/\s/g, ''); if (/^\d+(\.\d+)?$/.test(x) && parseFloat(x) > 0) { run('inflation_baseline', [x]); setTimeout(ecoAsk, 1800); } else bi.parentNode.className = 'panel'; }));
    b3.lastChild.style.margin = '0'; side.appendChild(b3);
  }
  function ecoCsv() {
    var csv = 'date,copper,silver,gold,value,players,perPlayer,inflation,baseline\n';
    for (var i = 0; i < ECO.rows.length; i++) { var r = ECO.rows[i]; csv += [r.date, r.cu, r.si, r.au, r.val, r.pl, r.pp, r.infl, r.base].join(',') + '\n'; }
    var ta = el('textarea', { style: 'width:100%;height:320px;padding:8px;background:#000;color:#4fd6e6;border:1px solid #444;font:12px Consolas,monospace' }); ta.value = csv;
    var m = modal('small', E('csv'), el('div', { 'class': 'm-body' }, [ta]), foot([btn(E('close'), true, function () { m.close(); })])); ta.focus(); ta.select();
  }
  function ecoImport() {
    var ta = el('textarea', { style: 'width:100%;height:260px;padding:8px;background:#000;color:#4fd6e6;border:1px solid #444;font:12px Consolas,monospace' }), m;
    m = modal('small', E('import'), el('div', { 'class': 'm-body' }, [el('div', { 'class': 'note', text: E('imp_h'), style: 'margin:0 0 8px' }), ta]), foot([btn(t('cancel'), false, function () { m.close(); }), btn(E('imp_go'), true, function () { var r = parseEco(ta.value); if (r.length) { ECO.rows = r; ECO.src = 'imp'; m.close(); renderEco(); } })]));
    ta.focus();
  }
  function renderEcoIfOpen() { if (S.tab === 'eco') renderEco(); }

  /* ---------------------------------------------------------------- tracked items: data, cache, live refresh */
  function todayStr() { var d = new Date(), z = function (n) { return n < 10 ? '0' + n : '' + n; }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
  function hhmmss(d) { var z = function (n) { return n < 10 ? '0' + n : '' + n; }; return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()); }
  function entOf(id) { return S.ent['i:' + id] || { kind: 'i', id: id, name: '#' + id, sub: '', icon: '', nameN: '' }; }
  var saveT = 0;
  function ecoSave() {
    clearTimeout(saveT); saveT = setTimeout(function () {
      try { localStorage.setItem('kz_eco_cache', JSON.stringify({ rows: ECO.rows, tracked: ECO.tracked, hist: ECO.hist, live: ECO.live, series: ECO.liveSeries.slice(-60), sel: ECO.sel, cmp: ECO.cmp, range: ECO.range, at: ECO.at })); } catch (e) { }
    }, 800);
  }
  function ecoLoadCache() {
    try {
      var c = JSON.parse(localStorage.getItem('kz_eco_cache') || 'null'); if (!c) return;
      ECO.rows = c.rows || []; ECO.tracked = c.tracked || []; ECO.hist = c.hist || {}; ECO.live = c.live || null; ECO.liveSeries = c.series || []; ECO.sel = c.sel || 'total'; ECO.cmp = c.cmp || ''; ECO.range = c.range === undefined ? 30 : c.range; ECO.at = c.at || 0;
      if (ECO.rows.length || ECO.tracked.length) { ECO.fromCache = true; ECO.src = 'cache'; }
    } catch (e) { }
  }
  function parseEcoItems(txt) {
    // type|date|stock|stacks   (an empty date = tracked, no snapshot yet)
    var L = lines(txt), tracked = [], hist = {};
    for (var i = 0; i < L.length; i++) {
      var f = L[i].replace(/\s+$/, '').split('|'); if (f.length < 2 || !/^\d+$/.test(f[0])) continue;
      if (!hist[f[0]]) { hist[f[0]] = []; tracked.push(f[0]); }
      if (f[1]) hist[f[0]].push({ date: f[1], q: parseFloat(f[2]) || 0, s: parseInt(f[3], 10) || 0 });
    }
    ECO.tracked = tracked; ECO.hist = hist;
    if (ECO.sel !== 'total' && indexOf(tracked, ECO.sel) < 0) ECO.sel = 'total';
    if (ECO.cmp && indexOf(tracked, ECO.cmp) < 0) ECO.cmp = '';
  }
  // one live sample: "H|time|cu|si|au|players|baseline;I|type|stock|stacks;..."
  function ecoLiveEvent(d) {
    var parts = String(d || '').split(';'), smp = { t: Date.now(), cu: 0, si: 0, au: 0, pl: 1, base: 0, items: {} }, ok = false, i;
    for (i = 0; i < parts.length; i++) {
      var f = parts[i].split('|');
      if (f[0] === 'H') { smp.cu = parseInt(f[2], 10) || 0; smp.si = parseInt(f[3], 10) || 0; smp.au = parseInt(f[4], 10) || 0; smp.pl = Math.max(1, parseInt(f[5], 10) || 1); smp.base = parseFloat(f[6]) || 0; ok = true; }
      else if (f[0] === 'I') smp.items[f[1]] = { q: parseFloat(f[2]) || 0, s: parseInt(f[3], 10) || 0 };
    }
    if (!ok) return;
    ECO.pending = 0; ECO.at = Date.now(); ECO.live = smp; ECO.everLive = true; ECO.fromCache = false; if (ECO.src === 'cache') ECO.src = 'live';
    var val = smp.cu + smp.si * 100 + smp.au * 10000, pp = val / smp.pl, infl = smp.base > 0 ? (pp / smp.base - 1) * 100 : 0, today = todayStr(), last = ECO.rows.length ? ECO.rows[ECO.rows.length - 1] : null;
    var row = { date: today, cu: smp.cu, si: smp.si, au: smp.au, val: val, pl: smp.pl, pp: Math.round(pp * 100) / 100, infl: Math.round(infl * 10) / 10, base: smp.base };
    if (last && last.date === today) ECO.rows[ECO.rows.length - 1] = row; else ECO.rows.push(row);
    for (var id in smp.items) if (smp.items.hasOwnProperty(id)) {
      if (indexOf(ECO.tracked, id) < 0) { ECO.tracked.push(id); }
      var h = ECO.hist[id] || (ECO.hist[id] = []), lh = h.length ? h[h.length - 1] : null, pt = { date: today, q: smp.items[id].q, s: smp.items[id].s };
      if (lh && lh.date === today) h[h.length - 1] = pt; else h.push(pt);
    }
    for (i = ECO.tracked.length - 1; i >= 0; i--) if (!smp.items[ECO.tracked[i]] && smp.items.hasOwnProperty) { var any = false; for (var k in smp.items) { any = true; break; } if (any) { /* a type that the server no longer tracks */ delete ECO.hist[ECO.tracked[i]]; ECO.tracked.splice(i, 1); } }
    ECO.liveSeries.push({ t: smp.t, pp: pp, items: smp.items }); if (ECO.liveSeries.length > 240) ECO.liveSeries.shift();
    ecoSave(); ecoRerender();
  }
  function ecoRerender() { if (S.tab !== 'eco') return; var v = $('view'), st = v.scrollTop; renderEco(); v.scrollTop = st; }
  function ecoAsk(mode) {
    mode = mode === 'live' ? 'live' : 'full';
    if (mode === 'live' && ECO.pending && Date.now() - ECO.pending < 20000) return;   // the last live answer has not arrived yet
    ECO.asked = true; if (mode === 'full') ECO.fullAt = Date.now(); else ECO.pending = Date.now();
    transport.send('kz_eco', [mode], true);
  }
  // refreshes happen only while the dashboard is open: when it opens, on the button, and every 15 s
  function ecoTick() { if (S.tab !== 'eco') return; var hidden = false; try { hidden = !!document.hidden; } catch (e) { } if (!hidden) ecoAsk('live'); }
  function ecoOpened() { ecoStop(); renderEco(); ecoAsk('full'); ecoAsk('live'); ECO.timer = setInterval(ecoTick, ECO.refreshMs); }
  function ecoStop() { if (ECO.timer) { clearInterval(ECO.timer); ECO.timer = 0; } }
  function ecoStatus() {
    var parts = [ECO.timer ? t('eco_auto') + ' ' + Math.round(ECO.refreshMs / 1000) + ' s' : ''];
    if (ECO.at) parts.push((ECO.fromCache ? E('stored') : E('last')) + ' ' + hhmmss(new Date(ECO.at)));
    return parts.join(' · ');
  }

  /* ---------------------------------------------------------------- item statistics */
  function itemRows(id) { var h = ECO.hist[id] || [], n = ECO.range; return n > 0 && h.length > n ? h.slice(h.length - n) : h; }
  function itemStat(id) {
    var h = ECO.hist[id] || [], last = h.length ? h[h.length - 1] : null, rows = itemRows(id), mn = Infinity, mx = -Infinity, sum = 0, i;
    for (i = 0; i < rows.length; i++) { if (rows[i].q < mn) mn = rows[i].q; if (rows[i].q > mx) mx = rows[i].q; sum += rows[i].q; }
    function back(n) { return h.length > n ? h[h.length - 1 - n] : null; }
    var p1 = back(1), p7 = back(7) || (h.length > 1 ? h[0] : null);
    return { last: last, q: last ? last.q : 0, s: last ? last.s : 0, d1: last && p1 ? last.q - p1.q : null, d1p: last && p1 && p1.q ? (last.q - p1.q) / p1.q * 100 : null, d7: last && p7 && p7 !== last ? last.q - p7.q : null, d7p: last && p7 && p7 !== last && p7.q ? (last.q - p7.q) / p7.q * 100 : null, min: rows.length ? mn : 0, max: rows.length ? mx : 0, avg: rows.length ? sum / rows.length : 0, n: rows.length };
  }
  function arrow(d) { return d === null || d === undefined ? '' : (d > 0 ? '▲ ' : (d < 0 ? '▼ ' : '▬ ')); }
  function sgn(d, dec) { return d === null || d === undefined ? '—' : (d > 0 ? '+' : '') + fmtN(d, dec || 0); }
  function sparkline(vals, w, h, color) {
    var box = el('span', { 'class': 'spark' }), n = vals.length; if (n < 2) return box;
    var s = svg('svg', { width: w, height: h }, box), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pts = [], i; if (hi === lo) { hi += 1; lo -= 1; }
    for (i = 0; i < n; i++) pts.push((i * (w - 2) / (n - 1) + 1) + ',' + (h - 2 - (vals[i] - lo) / (hi - lo) * (h - 4)));
    svg('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 1.6 }, s); return box;
  }

  /* ---------------------------------------------------------------- tracked item strip, item views, compare */
  function trackCard(id, P) {
    var e = entOf(id), st = itemStat(id), selected = ECO.sel === id, cmp = ECO.cmp === id;
    var c = el('div', { 'class': 'tcard' + (selected ? ' sel' : '') + (cmp ? ' cmp' : ''), title: e.name + '  #' + id });
    c.appendChild(iconNode(e, 'ico'));
    var info = el('div', { 'class': 'ti' }, [el('div', { 'class': 'tn', text: e.name }), el('div', { 'class': 'tv', text: ECO.hist[id] && ECO.hist[id].length ? fmtN(st.q) : '…' }), el('div', { 'class': 'td', text: st.d1 === null ? E('wait_items') : arrow(st.d1) + sgn(st.d1) + ' ' + E('d1') })]);
    c.appendChild(info);
    c.appendChild(sparkline((ECO.hist[id] || []).slice(-14).map(function (r) { return r.q; }), 70, 24, cmp ? P.a2 : P.a1));
    var cb = el('button', { type: 'button', 'class': 'tb cb', title: E('cmp'), text: '⇄', onclick: function (ev) { ev.stopPropagation(); if (ECO.sel === 'total' || ECO.sel === id) { ECO.sel = id; } else { ECO.cmp = ECO.cmp === id ? '' : id; } ecoSave(); renderEco(); } });
    var xb = el('button', { type: 'button', 'class': 'tb xb', title: E('untrack'), text: '×', onclick: function (ev) { ev.stopPropagation(); ecoUntrack(id); } });
    c.appendChild(cb); c.appendChild(xb);
    c.onclick = function () { if (ECO.sel === id) return; if (ECO.cmp === id) ECO.cmp = ''; ECO.sel = id; ecoSave(); renderEco(); };
    return c;
  }
  function ecoTrack(e) {
    var id = String(e.id);
    if (indexOf(ECO.tracked, id) < 0) { ECO.tracked.push(id); ECO.hist[id] = ECO.hist[id] || []; run('eco_track_add', [id]); setTimeout(function () { ecoAsk('full'); ecoAsk('live'); }, 1600); }
    ecoSave(); return id;
  }
  function ecoUntrack(id) {
    var e = entOf(id); if (!window.confirm(e.name + '\n\n' + E('untrack') + '?')) return;
    var i = indexOf(ECO.tracked, id); if (i >= 0) ECO.tracked.splice(i, 1); delete ECO.hist[id];
    if (ECO.sel === id) ECO.sel = 'total'; if (ECO.cmp === id) ECO.cmp = '';
    transport.send('eco_track_remove', [id]); ecoSave(); renderEco();
  }
  // the item search window (icons, filters, paging) in "pick" mode: a click returns the item instead of opening its dialog
  function ecoPickItem(title, cb) { openResults('', { pick: true, kinds: ['i'], title: title, onPick: cb }); }

  function itemKpis(id, compact) {
    var st = itemStat(id), kp = el('div', { 'class': 'kpis' + (compact ? ' sm' : '') });
    function k(cls, lab, val, sub) { kp.appendChild(el('div', { 'class': 'kpi ' + cls }, [el('div', { 'class': 'kl', text: lab }), el('div', { 'class': 'kv', text: val }), el('div', { 'class': 'ks', text: sub || '' })])); }
    k('big', E('stock'), ECO.hist[id] && ECO.hist[id].length ? fmtN(st.q) : '—', st.s ? st.s + ' ' + E('stacks') : '');
    k('', E('d1'), sgn(st.d1), st.d1p === null ? '' : sgn(st.d1p, 1) + ' %');
    k('', E('d7'), sgn(st.d7), st.d7p === null ? '' : sgn(st.d7p, 1) + ' %');
    if (!compact) { k('', E('min') + ' / ' + E('max'), fmtN(st.min) + ' / ' + fmtN(st.max), E('avg') + ' ' + fmtN(st.avg)); k('', E('stacks'), fmtN(st.s), ''); }
    return kp;
  }
  function itemChartRows(id) { return itemRows(id).map(function (r) { return { date: r.date, v: r.q }; }); }
  function itemView(host, id, compact, P, color) {
    var e = entOf(id), head = el('div', { 'class': 'ihead' }, [iconNode(e, 'ico'), el('div', null, [el('div', { 'class': 'it', text: e.name }), el('div', { 'class': 'is', text: (e.sub ? e.sub + ' · ' : '') + '#' + id })])]);
    host.appendChild(head); host.appendChild(itemKpis(id, compact));
    var rows = itemChartRows(id);
    var p = el('div', { 'class': 'panel' }, [el('h4', null, [el('span', { text: E('hist_item') }), el('em', { text: fmtN(rows.length) + ' ' + E('days') })])]), box = el('div', { 'class': 'chartbox' }); p.appendChild(box); host.appendChild(p);
    if (rows.length) chart(box, { rows: rows, series: [{ name: E('stock'), color: color, vals: rows.map(function (r) { return r.v; }), area: true, dots: !compact }], h: compact ? 120 : 230, tipFmt: function (x) { return fmtN(x); } });
    else box.appendChild(el('div', { 'class': 'note', text: E('wait_items') }));
    if (!compact) {
      var ls = ECO.liveSeries.filter(function (x) { return x.items && x.items[id]; });
      if (ls.length > 2) { var lp = el('div', { 'class': 'panel' }, [el('h4', null, [el('span', { text: E('live') }), el('em', { text: ls.length + ' × ' + Math.round(ECO.refreshMs / 1000) + ' s' })])]), lb = el('div', { 'class': 'chartbox' }); lp.appendChild(lb); host.appendChild(lp);
        chart(lb, { rows: ls.map(function (x) { return { date: 'live-' + hhmmss(new Date(x.t)).slice(0, 5) }; }), series: [{ name: E('stock'), color: P.a2, vals: ls.map(function (x) { return x.items[id].q; }), area: true }], h: 130, tipFmt: function (x) { return fmtN(x); } }); }
      var tp = el('div', { 'class': 'panel' }, [el('h4', null, [el('span', { text: E('hist') })])]), wrapT = el('div', { 'class': 'tblwrap' }), tbl = el('table', { 'class': 'tbl' }); tbl.appendChild(el('tr', null, [el('th', { text: E('h_date') }), el('th', { text: E('stock') }), el('th', { text: E('stacks') }), el('th', { text: E('h_d') })]));
      var all = ECO.hist[id] || [];
      for (var i = rows.length - 1; i >= 0; i--) { var gi = all.indexOf(itemRows(id)[i]), pr = gi > 0 ? all[gi - 1] : null, d = pr ? itemRows(id)[i].q - pr.q : null; tbl.appendChild(el('tr', null, [el('td', { text: rows[i].date }), el('td', { text: fmtN(rows[i].v) }), el('td', { text: fmtN(itemRows(id)[i].s) }), el('td', { 'class': d > 0 ? 'up' : (d < 0 ? 'down' : ''), text: sgn(d) })])); }
      wrapT.appendChild(tbl); tp.appendChild(wrapT); host.appendChild(tp);
    }
  }
  function compareSummary(a, b, P) {
    var sa = itemStat(a), sb = itemStat(b), ea = entOf(a), eb = entOf(b), box = el('div', { 'class': 'panel cmpbar' });
    var ratio = sb.q > 0 && sa.q > 0 ? sa.q / sb.q : null;
    box.appendChild(el('div', { 'class': 'cmpline' }, [iconNode(ea, 'ico'), el('b', { text: fmtN(sa.q) }), el('span', { 'class': 'vs', text: '  :  ' }), iconNode(eb, 'ico'), el('b', { text: fmtN(sb.q) }),
      el('span', { 'class': 'note', style: 'margin-left:14px', text: ratio === null ? '' : E('ratio') + ' 1 : ' + fmtN(1 / ratio, 2) + '   (' + fmtN(ratio, 2) + '×)' })]));
    var ra = itemRows(a), rb = itemRows(b), n = Math.min(ra.length, rb.length);
    if (n > 2) {
      var A = ra.slice(ra.length - n), B = rb.slice(rb.length - n), a0 = A[0].q || 1, b0 = B[0].q || 1, h = el('div', { 'class': 'chartbox', style: 'margin-top:8px' }); box.appendChild(el('h4', { style: 'margin-top:10px' }, [el('span', { text: E('index') })])); box.appendChild(h);
      chart(h, { rows: A.map(function (r) { return { date: r.date }; }), series: [{ name: ea.name, color: P.a1, vals: A.map(function (r) { return r.q / a0 * 100; }) }, { name: eb.name, color: P.a2, vals: B.map(function (r) { return r.q / b0 * 100; }) }], h: 150, legend: true, tipFmt: function (x) { return fmtN(x, 1); } });
    }
    return box;
  }

  /* ---------------------------------------------------------------- the economy tab */
  function renderEco() {
    var v = clear($('view')), P = window.KZTheme.palette(), rows = ecoVisible(), all = ECO.rows, last = all.length ? all[all.length - 1] : null, prev = all.length > 1 ? all[all.length - 2] : null, i;
    var ctl = el('div', { 'class': 'ecoctl' }), seg = el('div', { 'class': 'seg' }), ranges = [[7, '7 ' + E('days')], [30, '30 ' + E('days')], [90, '90 ' + E('days')], [0, E('all')]];
    for (i = 0; i < ranges.length; i++) (function (r) { seg.appendChild(el('button', { type: 'button', 'class': ECO.range === r[0] ? 'on' : '', text: r[1], onclick: function () { ECO.range = r[0]; ecoSave(); renderEco(); } })); })(ranges[i]);
    ctl.appendChild(seg);
    ctl.appendChild(btn(E('refresh'), false, function () { ecoAsk('full'); ecoAsk('live'); }));
    ctl.appendChild(btn(E('snap'), false, function () { run('inflation', []); setTimeout(function () { ecoAsk('full'); }, 2200); }));
    ctl.appendChild(btn('+ ' + E('track'), true, function () { ecoPickItem(E('pick_t'), function (e) { var id = ecoTrack(e); ECO.sel = id; ECO.cmp = ''; renderEco(); }); }));
    if (ECO.sel !== 'total') ctl.appendChild(btn(ECO.cmp ? E('cmp_off') : E('cmp'), false, function () { if (ECO.cmp) { ECO.cmp = ''; ecoSave(); renderEco(); } else ecoPickCompare(); }));
    ctl.appendChild(btn('⌘ ' + E('calc_btn'), false, openCalc));
    ctl.appendChild(btn(E('csv'), false, ecoCsv)); ctl.appendChild(btn(E('import'), false, ecoImport));
    ctl.appendChild(el('span', { 'class': 'note', style: 'margin:0 0 0 6px', text: ecoStatus() }));
    v.appendChild(ctl);
    // strip: all coins + tracked items (with icon, stock, change, sparkline)
    var strip = el('div', { 'class': 'tstrip' }), tot = el('div', { 'class': 'tcard' + (ECO.sel === 'total' ? ' sel' : '') }, [el('div', { 'class': 'ico', text: '◎' }), el('div', { 'class': 'ti' }, [el('div', { 'class': 'tn', text: E('total_t') }), el('div', { 'class': 'tv', text: last && last.base > 0 ? fmtPct(last.infl) : '—' }), el('div', { 'class': 'td', text: last ? fmtN(last.pp, 1) + ' ' + E('copper_pp') : '' })])]);
    tot.onclick = function () { ECO.sel = 'total'; ECO.cmp = ''; ecoSave(); renderEco(); };
    strip.appendChild(tot);
    for (i = 0; i < ECO.tracked.length; i++) strip.appendChild(trackCard(ECO.tracked[i], P));
    if (!ECO.tracked.length) strip.appendChild(el('div', { 'class': 'note', style: 'align-self:center;margin-left:8px', text: E('none') }));
    v.appendChild(strip);
    if (ECO.sel === 'total') {
      var wrap = el('div', { 'class': 'eco' }), main = el('div', { 'class': 'eco-main' }), side = el('div', { 'class': 'eco-side' }); wrap.appendChild(main); wrap.appendChild(side); v.appendChild(wrap);
      if (!last) { main.appendChild(el('div', { 'class': 'empty', style: 'margin:30px 0' }, [el('h2', { text: E('infl') }), E('nodata')])); fillSide(side, last); return; }
      coinView(main, side, rows, all, last, prev, P);
    } else if (ECO.cmp && ECO.cmp !== ECO.sel) {
      var sp = el('div', { 'class': 'split' }), L = el('div', { 'class': 'L' }), R = el('div', { 'class': 'R' }); sp.appendChild(L); sp.appendChild(R); v.appendChild(sp);
      itemView(L, ECO.sel, false, P, P.a1);
      var rh = el('div', { 'class': 'rbar' }, [el('span', { text: E('cmp') }), el('button', { type: 'button', 'class': 'tb', title: E('swap'), text: '⇄', onclick: function () { var x = ECO.sel; ECO.sel = ECO.cmp; ECO.cmp = x; ecoSave(); renderEco(); } }), el('button', { type: 'button', 'class': 'tb', title: E('cmp_off'), text: '×', onclick: function () { ECO.cmp = ''; ecoSave(); renderEco(); } })]);
      R.appendChild(rh); itemView(R, ECO.cmp, true, P, P.a2); R.appendChild(compareSummary(ECO.sel, ECO.cmp, P));
    } else {
      var one = el('div'); v.appendChild(one); itemView(one, ECO.sel, false, P, P.a1);
    }
  }
  function ecoPickCompare() {
    var P = window.KZTheme.palette(), list = el('div', { 'class': 'cmplist' }), m, i;
    for (i = 0; i < ECO.tracked.length; i++) (function (id) { if (id === ECO.sel) return; var e = entOf(id); list.appendChild(el('div', { 'class': 'tcard', onclick: function () { ECO.cmp = id; ecoSave(); m.close(); renderEco(); } }, [iconNode(e, 'ico'), el('div', { 'class': 'ti' }, [el('div', { 'class': 'tn', text: e.name }), el('div', { 'class': 'td', text: '#' + id })])])); })(ECO.tracked[i]);
    var body = el('div', { 'class': 'm-body' }, [list]);
    m = modal('small', E('cmp_pick'), body, foot([btn(E('cmp_search'), false, function () { m.close(); ecoPickItem(E('pick_t'), function (e) { var id = ecoTrack(e); if (id !== ECO.sel) ECO.cmp = id; ecoSave(); renderEco(); }); }), btn(t('cancel'), true, function () { m.close(); })]));
  }

  /* ---------------------------------------------------------------- floating calculator (movable, stays open while you work) */
  function calcEval(src) {
    // + - * / % ( ) and decimals; % after a number = divide by 100.  No eval().
    var tk = [], i = 0, ch, num;
    src = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.');
    while (i < src.length) {
      ch = src.charAt(i);
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) { num = ''; while (i < src.length && /[0-9.]/.test(src.charAt(i))) num += src.charAt(i++); if ((num.match(/\./g) || []).length > 1) return NaN; tk.push({ n: parseFloat(num) }); continue; }
      if ('+-*/()%'.indexOf(ch) >= 0) { tk.push({ o: ch }); i++; continue; }
      return NaN;
    }
    var pos = 0;
    function peek() { return tk[pos]; }
    function prim() {
      var t0 = peek(); if (!t0) return NaN;
      if (t0.n !== undefined) { pos++; var val = t0.n; while (peek() && peek().o === '%') { pos++; val /= 100; } return val; }
      if (t0.o === '-') { pos++; return -prim(); } if (t0.o === '+') { pos++; return prim(); }
      if (t0.o === '(') { pos++; var x = expr(); if (!peek() || peek().o !== ')') return NaN; pos++; while (peek() && peek().o === '%') { pos++; x /= 100; } return x; }
      return NaN;
    }
    function term() { var a = prim(), t1; while ((t1 = peek()) && (t1.o === '*' || t1.o === '/')) { pos++; var b = prim(); a = t1.o === '*' ? a * b : a / b; } return a; }
    function expr() { var a = term(), t1; while ((t1 = peek()) && (t1.o === '+' || t1.o === '-')) { pos++; var b = term(); a = t1.o === '+' ? a + b : a - b; } return a; }
    var r = expr(); if (pos < tk.length) return NaN; return r;
  }
  var calcState = { ans: 0, hist: [], expr: '' };
  function openCalc() {
    var old = $('kzcalc'); if (old) { old.parentNode.removeChild(old); return; }
    var pos = { x: 40, y: 120 }; try { var sp = JSON.parse(localStorage.getItem('kz_calc_pos') || 'null'); if (sp) pos = sp; } catch (e) { }
    var box = el('div', { id: 'kzcalc', 'class': 'calc', tabindex: '0' }), head = el('div', { 'class': 'chead' }, [el('span', { text: '⌘ ' + t('calc_title') }), el('button', { type: 'button', 'class': 'x', text: '×', onclick: function () { box.parentNode.removeChild(box); } })]);
    var line = el('div', { 'class': 'cexpr' }), disp = el('input', { type: 'text', 'class': 'cdisp', value: calcState.expr, spellcheck: 'false', autocomplete: 'off' }), ans = el('div', { 'class': 'cans' }), hist = el('div', { 'class': 'chist' });
    box.appendChild(head); box.appendChild(line); box.appendChild(disp); box.appendChild(ans);
    function showAns() { var r = calcEval(disp.value); clear(ans); ans.appendChild(document.createTextNode(disp.value && !isNaN(r) && isFinite(r) ? '= ' + fmtN(r, Math.abs(r) < 1000 && r % 1 !== 0 ? 4 : 2).replace(/([.,]\d*?)0+$/, '$1').replace(/[.,]$/, '') : '')); }
    function commit() { var r = calcEval(disp.value); if (isNaN(r) || !isFinite(r)) { clear(ans); ans.appendChild(document.createTextNode(t('calc_err'))); return; } var txt = String(Math.round(r * 1e6) / 1e6); calcState.hist.unshift(disp.value + ' = ' + txt); if (calcState.hist.length > 6) calcState.hist.pop(); calcState.ans = r; calcState.expr = txt; disp.value = txt; showAns(); drawHist(); }
    function put(s) { var st = disp.selectionStart, en = disp.selectionEnd; if (typeof st === 'number') { disp.value = disp.value.slice(0, st) + s + disp.value.slice(en); disp.selectionStart = disp.selectionEnd = st + s.length; } else disp.value += s; calcState.expr = disp.value; showAns(); disp.focus(); }
    function drawHist() { clear(hist); for (var i = 0; i < calcState.hist.length; i++) (function (h) { hist.appendChild(el('div', { 'class': 'hl', text: h, onclick: function () { put(h.split(' = ')[1]); } })); })(calcState.hist[i]); }
    var keys = [['C', 'clr'], ['⌫', 'bs'], ['%', '%'], ['÷', '/'], ['7', '7'], ['8', '8'], ['9', '9'], ['×', '*'], ['4', '4'], ['5', '5'], ['6', '6'], ['−', '-'], ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+'], ['(', '('], ['0', '0'], ['.', '.'], [')', ')']], pad = el('div', { 'class': 'ckeys' });
    for (var i = 0; i < keys.length; i++) (function (k) { pad.appendChild(el('button', { type: 'button', text: k[0], 'class': /[0-9.]/.test(k[1]) ? '' : 'op', onclick: function () { if (k[1] === 'clr') { disp.value = ''; calcState.expr = ''; showAns(); disp.focus(); } else if (k[1] === 'bs') { disp.value = disp.value.slice(0, -1); calcState.expr = disp.value; showAns(); disp.focus(); } else put(k[1]); } })); })(keys[i]);
    box.appendChild(pad); box.appendChild(el('button', { type: 'button', 'class': 'ceq', text: '=', onclick: commit }));
    // quick values from the dashboard and coin conversion
    var last = ECO.rows.length ? ECO.rows[ECO.rows.length - 1] : null, quick = el('div', { 'class': 'cquick' });
    function qb(label, val) { quick.appendChild(el('button', { type: 'button', text: label, onclick: function () { if (val !== null && val !== undefined) put((/[0-9.)]$/.test(disp.value) ? ' ' : '') + String(Math.round(val * 100) / 100)); } })); }
    qb(t('calc_ans'), calcState.ans); qb(t('calc_pp'), last ? last.pp : null); qb(t('calc_tot'), last ? last.val : null); qb(t('calc_base'), last ? last.base : null);
    var sel = ECO.sel !== 'total' ? itemStat(ECO.sel) : null; if (sel && sel.last) qb(entOf(ECO.sel).name.slice(0, 12), sel.q);
    box.appendChild(quick);
    var conv = el('div', { 'class': 'cconv' }); box.appendChild(conv);
    function showConv() { clear(conv); var r = calcEval(disp.value); if (isNaN(r) || !isFinite(r) || r < 1) return; r = Math.floor(r); var g = Math.floor(r / 10000), s = Math.floor((r % 10000) / 100), c = r % 100; conv.appendChild(document.createTextNode(t('calc_coins') + ': ' + (g ? g + ' ' + E('gold') + ' ' : '') + (s ? s + ' ' + E('silver') + ' ' : '') + c + ' ' + E('copper'))); }
    box.appendChild(hist); drawHist();
    disp.oninput = disp.onkeyup = function (ev) { calcState.expr = disp.value; showAns(); showConv(); };
    disp.onkeydown = function (ev) { if (ev.keyCode === 13) { commit(); showConv(); ev.preventDefault(); } else if (ev.keyCode === 27) { box.parentNode.removeChild(box); } };
    // drag by the header
    head.onmousedown = function (ev) { if (ev.target.tagName === 'BUTTON') return; var sx = ev.clientX, sy = ev.clientY, ox = box.offsetLeft, oy = box.offsetTop; function mv(e2) { var x = Math.max(0, Math.min(window.innerWidth - 60, ox + e2.clientX - sx)), y = Math.max(0, Math.min(window.innerHeight - 40, oy + e2.clientY - sy)); box.style.left = x + 'px'; box.style.top = y + 'px'; pos = { x: x, y: y }; } function up() { document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true); try { localStorage.setItem('kz_calc_pos', JSON.stringify(pos)); } catch (e) { } } document.addEventListener('mousemove', mv, true); document.addEventListener('mouseup', up, true); ev.preventDefault(); };
    box.style.left = Math.min(pos.x, Math.max(0, window.innerWidth - 260)) + 'px'; box.style.top = Math.min(pos.y, Math.max(0, window.innerHeight - 120)) + 'px';
    document.body.appendChild(box); showAns(); showConv(); disp.focus();
  }
  window.KZ_onTheme = function () { if (S.tab === 'eco') renderEco(); };

  /* ---------------------------------------------------------------- demo transport (no game needed) */
  if (DEMO) {
    (function () {
      var mats = ['Iron', 'Steel', 'Bronze', 'Copper', 'Oak', 'Birch', 'Leather', 'Linen', 'Wool', 'Silver', 'Stone', 'Bone'];
      var types = [['Axe', 'Tools'], ['Pickaxe', 'Tools'], ['Hammer', 'Tools'], ['Sword', 'Weapons'], ['Spear', 'Weapons'], ['Shield', 'Armor'], ['Helmet', 'Armor'], ['Boots', 'Armor'], ['Gloves', 'Armor'], ['Ingot', 'Resources'], ['Bowl', 'Household'], ['Cloak', 'Clothing']];
      var txt = ['C|1|Weapons', 'C|2|Tools', 'C|3|Armor', 'C|4|Resources', 'C|5|Household', 'C|6|Clothing', 'C|7|Workshops', 'C|8|Furniture', 'C|9|Carts'];
      var cid = { Weapons: 1, Tools: 2, Armor: 3, Resources: 4, Household: 5, Clothing: 6 }, id = 1000, i, j;
      for (i = 0; i < mats.length; i++) for (j = 0; j < types.length; j++) txt.push('i|' + (id++) + '|' + cid[types[j][1]] + '|' + mats[i] + ' ' + types[j][0] + '|');
      var bl = ['Barn', 'Smithy', 'Watermill', 'Tannery', 'Stonemason', 'Tavern', 'Chapel', 'Granary', 'Windmill', 'Stable', 'Kiln', 'Warehouse'], ol = ['Wooden Cart', 'Chest', 'Table', 'Bench', 'Barrel', 'Anvil', 'Loom', 'Bookshelf', 'Wardrobe', 'Banner'];
      for (i = 0; i < bl.length; i++) txt.push('b|' + (100 + i) + '|7|' + bl[i] + '|');
      for (i = 0; i < ol.length; i++) txt.push('m|' + (300 + i) + '|' + (i < 1 ? 9 : 8) + '|' + ol[i] + '|');
      var cmds = ['# demo', 'give\tItems\tserver\t!give {type} {qty} {quality} {dur}\ttype:item,qty:int=1,quality:int=100,dur:int=100\tGive item to me\tGegenstand an mich geben\titem add', 'giveto\tItems\tserver\t!giveto {who} {type} {qty}\twho:player,type:item,qty:int=1\tGive item to a player\tGegenstand an Spieler geben\t', 'place\tObjects\tserver\t!place {type}\ttype:thing\tCreate object or building\tObjekt oder Gebäude erstellen\t', 'heal\tPlayer\tserver\t!heal {who}\twho:player?\tHeal (empty = me)\tHeilen (leer = ich)\t', 'godon\tPlayer\tlocal\t\t\tInvulnerable ON (GOD)\tUnverwundbar AN (GOD)\tgod', 'godoff\tPlayer\tlocal\t\t\tInvulnerable OFF\tUnverwundbar AUS\tgod', 'tp\tTeleport\tserver\t!tp {who}\twho:player\tGo to a player\tZu einem Spieler gehen\t', 'weather\tWorld\tslash\t/WEATHER {kind}\tkind:choice(Fair|Cloudy|Shower|Snowy)=Fair\tSet the weather\tWetter setzen\t', 'kick\tModeration\tserver\t!kick {who}\twho:player\tKick a player\tSpieler kicken\t', 'announce\tModeration\tserver\t!announce {text}\ttext:text\tAnnouncement to everyone\tAnkündigung an alle\t', 'inflation\tEconomy\tserver\t!inflation\t\tShow inflation now\tInflation jetzt anzeigen\t'];
      parseCommands(cmds.join('\n')); parseCatalog(txt.join('\n'));
      S.animals = [['BoarData', 'Boar', 'Wildschwein'], ['WolfData', 'Wolf', 'Wolf'], ['BearData', 'Bear', 'Bär'], ['MooseData', 'Moose', 'Elch']];
      S.ground = [['rock', '3', 'Rock', 'Fels'], ['riverrock', '27', 'River rock', 'Flussstein'], ['swamp', '26', 'Swamp', 'Sumpf']];
      S.players = [{ id: '101', name: 'Alrik Stonehand' }, { id: '102', name: 'Berta Millerin' }, { id: '103', name: 'Cedric Vale' }];
      S.favs = ['c:godon', 'c:heal', 'i:1000', 'i:1003', 'b:101', 'a:WolfData', 'c:weather', 'g:rock']; S.favLoaded = true;
    })();
    (function () {
      var rows = [], d = new Date(), base = 5000, pp = 4600, cu = 90000, i;
      for (i = 59; i >= 0; i--) { var dd = new Date(d.getTime() - i * 86400000), pl = 18 + Math.round(6 * Math.sin(i / 9) + (60 - i) / 8); pp += (Math.sin(i / 5) * 90) + 45 + (i < 12 ? 70 : 0); var val = Math.round(pp * pl); cu = Math.round(val * 0.38); var si = Math.round(val * 0.34 / 100), au = Math.round(val * 0.28 / 10000);
        rows.push(dd.toISOString().slice(0, 10) + ',' + cu + ',' + si + ',' + au + ',' + (cu + si * 100 + au * 10000) + ',' + pl + ',' + (Math.round((cu + si * 100 + au * 10000) / pl * 100) / 100) + ',' + (Math.round(((cu + si * 100 + au * 10000) / pl / base - 1) * 1000) / 10) + ',' + base); }
      ECO.rows = parseEco(rows.join('\n')); ECO.src = 'live';
    })();
    function demoHist(id) { var out = [], q = 800 + (parseInt(id, 10) % 7) * 420, i; for (i = 29; i >= 0; i--) { q += Math.round((Math.sin(i / 3 + parseInt(id, 10)) * 60) + 18); var dd = new Date(Date.now() - i * 86400000); out.push({ date: dd.toISOString().slice(0, 10), q: Math.max(0, q), s: Math.max(1, Math.round(q / 40)) }); } return out; }
    ECO.tracked = ['1000', '1003', '1024']; for (var di = 0; di < ECO.tracked.length; di++) ECO.hist[ECO.tracked[di]] = demoHist(ECO.tracked[di]);
    ECO.sel = 'total'; ECO.at = Date.now();
    transport.start = function () { logMsg('sent', t('demo_note')); };
    transport.send = function (cmd, args, quiet) {
      if (!quiet) logMsg('sent', cmd + ' ' + args.join(' '));
      if (cmd === 'eco_track_add') { var nid = String(args[0]); if (indexOf(ECO.tracked, nid) < 0) { ECO.tracked.push(nid); ECO.hist[nid] = demoHist(nid); } handleEvent({ type: 'reply', id: 'ok', data: 'Tracking item type ' + nid }); return; }
      if (cmd === 'eco_track_remove') { handleEvent({ type: 'reply', id: 'ok', data: 'Stopped tracking item type ' + args[0] }); return; }
      if (cmd === 'kz_eco') { setTimeout(function () {
        var l = ECO.rows[ECO.rows.length - 1], parts = ['H|0|' + Math.round(l.cu * (1 + (Math.random() - 0.45) * 0.004)) + '|' + l.si + '|' + l.au + '|' + l.pl + '|' + l.base];
        for (var q = 0; q < ECO.tracked.length; q++) { var hh = ECO.hist[ECO.tracked[q]], lq = hh.length ? hh[hh.length - 1].q : 900; parts.push('I|' + ECO.tracked[q] + '|' + Math.max(0, Math.round(lq + (Math.random() - 0.4) * 14)) + '|' + Math.max(1, Math.round(lq / 40))); }
        handleEvent({ type: 'eco', id: '', data: parts.join(';') }); }, 250); return; }
      if (cmd === 'kz_dur') { setTimeout(function () { handleEvent({ type: 'dur', id: '', data: args[0] + '|' + args[1] + '|' + (parseInt(args[1], 10) * 42) + '|demo: learned from 5 game item(s)' }); }, 300); return; }
      if (cmd.indexOf('kz_') === 0) return;
      setTimeout(function () {
        if (cmd === 'godon') handleEvent({ type: 'god', id: 'on' }); else if (cmd === 'godoff') handleEvent({ type: 'god', id: 'off' });
        handleEvent({ type: 'reply', id: cmd === 'kick' ? 'err' : 'ok', data: cmd === 'kick' ? 'Player is not online.' : cmd + ': done' });
      }, 350);
    };
    transport.blob = function () { };
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    if (!DEMO && (!S.s || !S.p)) { document.body.innerHTML = '<div style="padding:40px;font:16px sans-serif;color:#e3d9bd">Kanzlei GM &ndash; open this page from the game (F6). / Diese Seite im Spiel mit F6 öffnen.<br><br><a style="color:#c8a84b" href="?demo=1">Demo</a></div>'; return; }
    if (!S.favLoaded && !DEMO) { try { var f = localStorage.getItem('kz_favs'); if (f) S.favs = f.split(','); } catch (e) { } }
    $('demo-flag').style.display = DEMO ? '' : 'none';
    $('theme').onclick = openTheme;
    $('lang').onclick = function () { S.lang = S.lang === 'de' ? 'en' : 'de'; searchCache = {}; applyLang(); };
    var tabs = document.querySelectorAll('.tab'); for (var i = 0; i < tabs.length; i++) tabs[i].onclick = function () { setTab(this.getAttribute('data-tab')); };
    $('q').onkeydown = function (ev) { if (ev.keyCode === 13 && this.value.replace(/\s/g, '')) { openResults(this.value); this.value = ''; } };
    $('qgo').onclick = function () { openResults($('q').value); $('q').value = ''; };
    $('bar-toggle').onclick = function () { var lg = $('bar-log'), open = lg.style.display === 'none'; lg.style.display = open ? '' : 'none'; clear($('bar-toggle')).appendChild(document.createTextNode(open ? t('log_hide') : t('log'))); if (open) renderLog(); };
    document.addEventListener('keydown', function (ev) { var tg = ev.target && ev.target.tagName; if (ev.keyCode === 191 && tg !== 'INPUT' && tg !== 'SELECT') { ev.preventDefault(); $('q').focus(); } }, false);
    if (!DEMO) ecoLoadCache();
    applyLang(); transport.start();
  }
  boot();
})();
