/* Kanzlei GM - "Eyes": the web UI of KanzleiMOD.  Plain ES5 on purpose (the game's embedded browser may be old).
 * Talks to the relay (/p/*), which talks to the game (Core).  ?demo=1 runs it with fake data and no game.
 * Data comes from the game: commands (shared/commands.kz via the server), the item/object catalog (Brain: client data\objects_types.xml + data\loc),
 * animals and ground materials (shared/animals.kz, ground.kz). Nothing about game content is hardcoded here. */
(function () {
  'use strict';
  var CFG = window.KZ_CONFIG || {};
  var Q = parseQuery(location.search);
  var DEMO = !!Q.demo;
  var S = {
    lang: (Q.lang === 'en' || Q.lang === 'de') ? Q.lang : (/^de/i.test(navigator.language || '') ? 'de' : 'en'),
    s: Q.s || '', p: Q.p || '',
    cmds: [], cmdById: {}, catalog: [], cats: {}, animals: [], ground: [], players: [],
    favs: [], favLoaded: false, god: false, gameAge: -1, evAfter: 0,
    ent: {}, list: [], bySection: { c: [], i: [], b: [], m: [], a: [], g: [] },
    tab: 'fav', section: 'c', claimTries: 0, allCat: '', allFilter: '', catalogN: 0, dead: false, log: []
  };
  var DANGER = { ban: 1, kick: 1, delobj: 1, 'delete': 1, adminland_delete: 1, kzreload: 1 };
  var KIND_COLOR = { c: '#6a5a2c', i: '#4a6a3c', b: '#6a3c3c', m: '#3c4f6a', a: '#5a3c6a', g: '#6a5a3c' };
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
    box.style.background = KIND_COLOR[e.kind] || '#444';
    box.appendChild(document.createTextNode(glyphOf(e)));
    if (e.icon && CFG.iconBase) {
      var img = new Image();
      img.onload = function () { clear(box); box.style.background = '#15110a'; box.appendChild(img); };
      img.src = CFG.iconBase + e.icon;
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
    else if (ev.type === 'god') { S.god = ev.id === 'on'; $('god').style.display = S.god ? '' : 'none'; }
    else if (ev.type === 'players') { S.players = []; var a = d.split(';'); for (var i = 0; i < a.length; i++) { var f = a[i].split('|'); if (f[0]) S.players.push({ id: f[0], name: f[1] || f[0] }); } }
    else if (ev.type === 'fav') {
      if (!S.favLoaded) { S.favLoaded = true; S.favs = d ? d.split(',') : []; try { localStorage.setItem('kz_favs', S.favs.join(',')); } catch (e) { } refreshView(); }
    }
    else if (ev.type === 'blob') loadBlob(ev.id, d);
  }
  function loadBlob(name, hash) {
    transport.blob(name, hash, function (txt) {
      if (name === 'fav') { if (!S.favLoaded) { S.favLoaded = true; var f = txt.replace(/\s+$/, ''); S.favs = f ? f.split(',') : []; try { localStorage.setItem('kz_favs', S.favs.join(',')); } catch (e) { } refreshView(); } return; }
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
    var tabs = document.querySelectorAll('.tab'); for (var i = 0; i < tabs.length; i++) tabs[i].firstChild ? tabs[i].firstChild.nodeValue = t('tab_' + tabs[i].getAttribute('data-tab')) : tabs[i].appendChild(document.createTextNode(t('tab_' + tabs[i].getAttribute('data-tab'))));
    clear($('lang')).appendChild(document.createTextNode(t('lang_btn')));
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
    var c = el('div', { 'class': 'card' + (opts.fav ? ' fav' : ''), 'data-key': e.key, title: e.name + (e.sub ? '  ·  ' + e.sub : '') + '  ·  ' + (e.kind === 'c' ? e.id : '#' + e.id) });
    c.appendChild(iconNode(e));
    c.appendChild(el('div', { 'class': 'nm', text: e.name }));
    c.appendChild(el('div', { 'class': 'sub', text: e.kind === 'c' ? e.sub : ((e.sub ? e.sub + ' · ' : '') + '#' + e.id) }));
    var st = el('button', { type: 'button', 'class': 'star' + (fav ? ' on' : ''), title: fav ? t('fav_del') : t('fav_add'), text: fav ? '★' : '☆' });
    st.onclick = function (ev) { ev.stopPropagation(); toggleFav(e); if (opts.onFav) opts.onFav(); };
    st.onmousedown = function (ev) { ev.stopPropagation(); };
    c.appendChild(st);
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
  function refreshView() { if (S.tab === 'fav') renderFav(); else renderAll(); }
  function setTab(tab) { S.tab = tab; var b = document.querySelectorAll('.tab'); for (var i = 0; i < b.length; i++) b[i].className = 'tab' + (b[i].getAttribute('data-tab') === tab ? ' on' : ''); refreshView(); }

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

  var SECTIONS = ['c', 'i', 'b', 'm', 'a', 'g'];
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
  function openResults(q0) {
    var kinds = { all: 1 }, filter = 'all', modalRef = null, body = el('div', { 'class': 'm-body res' });
    var inp = el('input', { type: 'text', value: q0 || '', autocomplete: 'off', style: 'width:100%;padding:9px 12px;background:#0e0c08;border:1px solid #4a3e26;border-radius:5px;margin-bottom:10px;outline:0;color:#e3d9bd;font-size:15px' });
    var chips = el('div', { 'class': 'seg' }), host = el('div', { 'class': 'grid-host' });
    body.appendChild(inp); body.appendChild(chips); body.appendChild(host);
    var all = [], shown = [];
    function run() {
      all = search(inp.value); var cnt = { all: all.length, c: 0, i: 0, b: 0, m: 0, a: 0, g: 0 }, j; for (j = 0; j < all.length; j++) cnt[all[j].kind]++;
      clear(chips); var order = ['all'].concat(SECTIONS);
      for (j = 0; j < order.length; j++) (function (k) { if (k !== 'all' && !cnt[k]) return; chips.appendChild(el('button', { type: 'button', 'class': k === filter ? 'on' : '', onclick: function () { filter = k; resultsGrid.page = 0; run(); } }, [k === 'all' ? t('f_all') : t('sec_' + k), el('span', { 'class': 'n', text: String(cnt[k]) })])); })(order[j]);
      shown = filter === 'all' ? all : all.filter(function (e) { return e.kind === filter; });
      if (modalRef) { var h = modalRef.box.querySelector('h3'); clear(h).appendChild(document.createTextNode(t('results') + ' – ' + all.length + ' ' + t('results_n'))); }
      resultsGrid.render();
    }
    modalRef = modal('results', t('results'), body, null, function () { resultsGrid = null; });
    resultsGrid = PagedGrid(host, function () { return shown; }, { onOpen: function (e) { openEntity(e); }, onFav: function () { } });
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
      var form2 = buildForm([{ name: 'qty', type: 'int', def: '1', opt: false }, { name: 'quality', type: 'int', def: '100', opt: false }, { name: 'dur', type: 'int', def: '100', opt: false }]);
      var who = playerField(t('give_to')), body2 = el('div', { 'class': 'm-body' }, [entHead(e), form2.el, who.el]);
      var send = function (toPlayer) { var v = form2.values(); if (!v) return; if (toPlayer) { var w = who.value(); if (!w) { who.el.className = 'field bad'; return; } run('giveto', [w, e.id, v[0], v[1], v[2]]); } else run('give', [e.id, v[0], v[1], v[2]]); };
      m = modal('small', e.name, body2, foot([btn(t('cancel'), false, function () { m.close(); }), btn(t('give_to'), false, function () { send(true); }), btn(t('give_me'), true, function () { send(false); })]));
      form2.fields[0].input.focus();
    } else if (e.kind === 'b' || e.kind === 'm') {
      m = modal('small', e.name, el('div', { 'class': 'm-body' }, [entHead(e), el('div', { 'class': 'note', text: t('create') })]), foot([btn(t('cancel'), false, function () { m.close(); }), btn(t('create'), true, function () { run('place', [e.id]); m.close(); })]));
    } else if (e.kind === 'a') {
      run('animal', [e.id]);
    } else if (e.kind === 'g') {
      m = modal('small', e.name, el('div', { 'class': 'm-body' }, [entHead(e)]), foot([btn(t('cancel'), false, function () { m.close(); }), btn(S.lang === 'de' ? 'Erhöhen' : 'Raise', false, function () { run('raise', [e.id]); m.close(); }), btn(S.lang === 'de' ? 'Boden ändern' : 'Change ground', true, function () { run('ground', [e.id]); m.close(); })]));
    }
  }

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
    transport.start = function () { logMsg('sent', t('demo_note')); };
    transport.send = function (cmd, args, quiet) {
      if (!quiet) logMsg('sent', cmd + ' ' + args.join(' '));
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
    $('lang').onclick = function () { S.lang = S.lang === 'de' ? 'en' : 'de'; searchCache = {}; applyLang(); };
    var tabs = document.querySelectorAll('.tab'); for (var i = 0; i < tabs.length; i++) tabs[i].onclick = function () { setTab(this.getAttribute('data-tab')); };
    $('q').onkeydown = function (ev) { if (ev.keyCode === 13 && this.value.replace(/\s/g, '')) { openResults(this.value); this.value = ''; } };
    $('qgo').onclick = function () { openResults($('q').value); $('q').value = ''; };
    $('bar-toggle').onclick = function () { var lg = $('bar-log'), open = lg.style.display === 'none'; lg.style.display = open ? '' : 'none'; clear($('bar-toggle')).appendChild(document.createTextNode(open ? t('log_hide') : t('log'))); if (open) renderLog(); };
    document.addEventListener('keydown', function (ev) { var tg = ev.target && ev.target.tagName; if (ev.keyCode === 191 && tg !== 'INPUT' && tg !== 'SELECT') { ev.preventDefault(); $('q').focus(); } }, false);
    applyLang(); transport.start();
  }
  boot();
})();
