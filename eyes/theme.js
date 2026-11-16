/* Kanzlei GM - theme engine. The whole stylesheet is a template (@token@) so the user can switch presets or pick his own colours at runtime;
   plain ES5, no CSS variables (old embedded browsers).  Presets: hud (orange/cyan on dark steel), light (white + black), mono (black + white). */
(function () {
  'use strict';
  var CSS = [
    "*{box-sizing:border-box;margin:0;padding:0}",
    "html,body{height:100%}",
    "body{background:@bg@ radial-gradient(circle at 1px 1px,@grid@ 1px,transparent 1.5px) 0 0/22px 22px;color:@text@;font:14px/1.35 \"Bahnschrift\",\"Segoe UI\",Tahoma,Arial,sans-serif;overflow:hidden}",
    "button,input,select{font:inherit;color:inherit}",
    "button{cursor:pointer}",
    ".mono,.sub,.code,#stats,.msg,.logline,.tab b,.label{font-family:\"Consolas\",\"Lucida Console\",\"Courier New\",monospace}",
    "#app{display:-webkit-flex;display:flex;-webkit-flex-direction:column;flex-direction:column;height:100%}",
    "#top{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;padding:10px 16px;background:@bar@;border-bottom:1px solid @line@;position:relative}",
    "#top:after{content:\"\";position:absolute;left:0;bottom:-1px;width:180px;height:2px;background:@a1@}",
    ".brand{font:700 17px \"Bahnschrift\",\"Segoe UI\",Arial,sans-serif;color:@strong@;letter-spacing:4px;text-transform:uppercase;white-space:nowrap;margin-right:20px}",
    ".brand b{color:@a1@;font-weight:700}.brand-mark{color:@a2@;margin-right:6px;letter-spacing:0}",
    ".search-wrap{-webkit-flex:1;flex:1;display:-webkit-flex;display:flex;max-width:640px}",
    "#q{-webkit-flex:1;flex:1;padding:9px 12px;background:@input@;border:1px solid @line@;border-right:0;outline:0;font-size:14px;font-family:\"Consolas\",\"Lucida Console\",monospace;color:@a2@}",
    "#q::placeholder{color:@muted2@}",
    "#q:focus{border-color:@a2@;box-shadow:0 0 0 1px @a2@ inset}",
    "#qgo{width:46px;background:@panel2@;border:1px solid @line@;color:@a2@}",
    "#qgo:hover{background:@a1@;border-color:@a1@;color:@onA@}",
    "#stats{margin-left:18px;font-size:11px;color:@muted@;white-space:nowrap}",
    "#stats b{color:@a2@;font-weight:400;margin-right:10px}",
    ".top-right{margin-left:auto;display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center}",
    ".top-right>*{margin-left:14px}",
    ".conn{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;font:11px \"Consolas\",monospace;color:@muted@;text-transform:uppercase;letter-spacing:1px}",
    ".conn i{width:9px;height:9px;background:@bad@;margin-right:7px;display:inline-block}",
    ".conn.on i{background:@ok@;box-shadow:0 0 8px @ok@}.conn.on{color:@okt@}",
    ".conn.wait i{background:@warn@}",
    ".lang{padding:5px 12px;background:transparent;border:1px solid @line@;font:11px \"Consolas\",monospace;text-transform:uppercase;letter-spacing:1px;color:@soft@}",
    ".lang:hover{border-color:@a2@;color:@a2@}",
    ".demo{padding:2px 8px;border:1px solid @warn@;color:@warn@;font:11px \"Consolas\",monospace;letter-spacing:2px}",
    ".god{padding:3px 14px;background:@a1@;color:@onA@;font:700 15px \"Bahnschrift\",\"Segoe UI\",Arial,sans-serif;letter-spacing:5px;animation:godglow 1.4s ease-in-out infinite alternate}",
    ".god:before{content:\"GM \\00b7 \";font:11px \"Consolas\",monospace;letter-spacing:2px}",
    "@keyframes godglow{from{box-shadow:0 0 3px @a1@}to{box-shadow:0 0 18px @a1glow@}}",
    "#tabs{display:-webkit-flex;display:flex;padding:0 16px;background:@bar@;border-bottom:1px solid @line@}",
    ".tab{display:-webkit-flex;display:flex;-webkit-align-items:stretch;align-items:stretch;margin-right:6px;padding:0;background:none;border:0;color:@muted@;font:600 13px \"Bahnschrift\",\"Segoe UI\",Arial,sans-serif;text-transform:uppercase;letter-spacing:2px}",
    ".tab b{display:block;padding:9px 8px;margin:6px 0;background:@panel2@;color:@muted@;font-size:12px;font-weight:400;letter-spacing:0}",
    ".tab .tl{display:block;padding:15px 16px 13px;border-bottom:2px solid transparent}",
    ".tab:hover{color:@text@}",
    ".tab.on{color:@strong@}.tab.on b{background:@a1@;color:@onA@;font-weight:700}.tab.on .tl{border-bottom-color:@a1@}",
    "#view{-webkit-flex:1;flex:1;overflow:auto;padding:16px;min-height:0}",
    ".view-flex{display:-webkit-flex;display:flex;-webkit-flex-direction:column;flex-direction:column;height:100%}",
    ".seg{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;margin-bottom:12px}",
    ".seg button{padding:6px 14px;margin:0 6px 6px 0;background:@panel@;border:1px solid @line@;font:12px \"Consolas\",monospace;text-transform:uppercase;letter-spacing:1px;color:@soft@}",
    ".seg button:hover{border-color:@a2@;color:@a2@}",
    ".seg button.on{background:@a1@;border-color:@a1@;color:@onA@;font-weight:700}",
    ".seg .n{margin-left:7px;font-size:11px;opacity:.7}",
    ".toolbar{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;margin-bottom:12px}",
    ".toolbar input,.toolbar select{padding:7px 10px;background:@input@;border:1px solid @line@;margin-right:8px;outline:0;font-family:\"Consolas\",monospace;font-size:13px}",
    ".toolbar input{min-width:260px;color:@a2@}.toolbar input:focus,.toolbar select:focus{border-color:@a2@}",
    ".grid-host{-webkit-flex:1;flex:1;min-height:0;overflow:hidden}",
    ".grid{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;-webkit-align-content:flex-start;align-content:flex-start}",
    ".card{position:relative;width:138px;height:146px;margin:0 8px 8px 0;background:@panel@;border:1px solid @line@;border-top:3px solid @muted@;overflow:hidden;cursor:pointer;user-select:none;-webkit-user-select:none}",
    ".card.k-c{border-top-color:@kc@}.card.k-i{border-top-color:@ki@}.card.k-b{border-top-color:@kb@}.card.k-m{border-top-color:@km@}.card.k-a{border-top-color:@ka@}.card.k-g{border-top-color:@kg@}",
    ".card:hover{background:@panel3@;border-color:@a1@}",
    ".card .ico{position:absolute;left:50%;margin-left:-37px;top:9px;width:74px;height:74px;box-sizing:border-box;background:@bg@;border:1px solid @line@;overflow:hidden;text-align:center;line-height:72px;font:700 30px \"Consolas\",monospace;color:@strong@}",
    ".card .ico img{width:100%;height:100%;display:block;object-fit:contain;padding:3px;box-sizing:border-box}",
    ".card .nm{position:absolute;left:6px;right:6px;top:88px;height:36px;display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;text-align:center;overflow:hidden;line-height:1.15;font-weight:600;color:@strong@;letter-spacing:.2px}",
    ".card .nm span{display:block;max-height:2.3em;overflow:hidden;word-wrap:break-word;overflow-wrap:break-word}",
    ".card .meta{position:absolute;left:8px;right:8px;bottom:4px;display:-webkit-flex;display:flex;-webkit-justify-content:space-between;justify-content:space-between;font:10px \"Consolas\",monospace}",
    ".card .code{letter-spacing:1px;color:@muted@}",
    ".card.k-c .code{color:@kc@}.card.k-i .code{color:@ki@}.card.k-b .code{color:@kb@}.card.k-m .code{color:@km@}.card.k-a .code{color:@ka@}",
    ".card .sub{color:@muted@;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-left:6px}",
    ".crumb{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;margin-bottom:14px;font:13px \"Consolas\",monospace;color:@muted@}",
    ".crumb button{padding:5px 12px;margin-right:8px;background:@panel@;border:1px solid @line@;font:12px \"Consolas\",monospace;text-transform:uppercase;letter-spacing:1px;color:@soft@}",
    ".crumb button:hover{border-color:@a2@;color:@a2@}.crumb button.on{background:@a1@;border-color:@a1@;color:@onA@;font-weight:700}",
    ".crumb span{margin-right:8px}.crumb .back{margin-left:auto;margin-right:0}",
    ".fgrid{padding-top:4px}",
    ".folder{width:230px;height:156px;margin:0 14px 14px 0;box-sizing:border-box;padding:16px 12px 10px 12px;background:@panel@;border:1px solid @line@;border-top:4px solid @a1@;text-align:center;cursor:pointer;user-select:none;-webkit-user-select:none}",
    ".folder.sub{border-top-color:@a2@}",
    ".folder:hover{background:@panel3@;border-color:@a1@}",
    ".folder .fg{font-size:50px;line-height:60px;color:@a1@}.folder.sub .fg{color:@a2@}",
    ".folder .fn{margin-top:8px;font-size:17px;font-weight:700;color:@strong@;letter-spacing:.3px}",
    ".folder .fc{margin-top:6px;font:11px \"Consolas\",monospace;color:@muted@;letter-spacing:1px;text-transform:uppercase}",
    ".card .star{position:absolute;right:3px;top:1px;width:24px;height:24px;background:none;border:0;font-size:17px;line-height:24px;color:@line2@}",
    ".card .star:hover{color:@a1@}.card .star.on{color:@a1@}",
    ".card .mv{position:absolute;right:4px;bottom:4px;display:none}",
    ".card.fav:hover .mv{display:block}",
    ".card .mv button{width:20px;height:16px;line-height:14px;font-size:9px;background:@bg@;border:1px solid @line@;margin-left:2px;color:@soft@}",
    ".card .mv button:hover{border-color:@a2@;color:@a2@}",
    ".card.drag{opacity:.3}",
    ".ghost{position:fixed;z-index:99;pointer-events:none;opacity:.92;box-shadow:0 10px 28px rgba(0,0,0,.7),0 0 0 1px @a1@}",
    ".drop-before{box-shadow:-5px 0 0 0 @a2@}",
    ".empty{max-width:540px;margin:70px auto;text-align:center;color:@muted@;padding:26px;border:1px dashed @line@}",
    ".empty h2{color:@a1@;font:400 16px \"Consolas\",monospace;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px}",
    ".pager{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;padding-top:8px;-webkit-flex-wrap:wrap;flex-wrap:wrap}",
    ".pager button{min-width:34px;padding:5px 9px;margin:0 3px;background:@panel@;border:1px solid @line@;font:12px \"Consolas\",monospace;color:@soft@}",
    ".pager button:hover:not(:disabled){border-color:@a2@;color:@a2@}",
    ".pager button.on{background:@a2@;color:@onA@;border-color:@a2@;font-weight:700}",
    ".pager button:disabled{opacity:.3;cursor:default}",
    ".pager .info{margin:0 12px;color:@muted@;font:11px \"Consolas\",monospace}",
    "#bar{background:@bar@;border-top:1px solid @line@;position:relative}",
    "#bar-last{padding:8px 16px;min-height:34px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:130px}",
    "#bar-toggle{position:absolute;right:12px;top:5px;padding:3px 12px;background:transparent;border:1px solid @line@;font:11px \"Consolas\",monospace;text-transform:uppercase;letter-spacing:1px;color:@soft@}",
    "#bar-toggle:hover{border-color:@a2@;color:@a2@}",
    "#bar-log{max-height:200px;overflow:auto;border-top:1px solid @line@;padding:6px 16px;font-size:12px}",
    ".msg{display:inline-block;padding:1px 10px;margin-right:10px;font-weight:700;font-size:11px;letter-spacing:1px;text-transform:uppercase;border:1px solid}",
    ".msg.ok{color:@ok@;border-color:@ok@;background:@okbg@}",
    ".msg.err{color:@bad@;border-color:@bad@;background:@badbg@}",
    ".msg.sent{color:@warn@;border-color:@warn@;background:@warnbg@}",
    ".logline{padding:2px 0;white-space:pre-wrap}.logline .tm{color:@muted2@;margin-right:8px}",
    "#modal-root .shade{position:fixed;left:0;top:0;right:0;bottom:0;background:@shade@;z-index:50;display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center}",
    ".modal{position:relative;background:@modal@;border:1px solid @line@;border-top:2px solid @a1@;box-shadow:0 14px 48px rgba(0,0,0,.8);display:-webkit-flex;display:flex;-webkit-flex-direction:column;flex-direction:column;max-width:96%;max-height:94%}",
    ".modal:before,.modal:after{content:\"\";position:absolute;width:12px;height:12px;border:2px solid @a2@;pointer-events:none}",
    ".modal:before{left:-1px;bottom:-1px;border-top:0;border-right:0}.modal:after{right:-1px;bottom:-1px;border-top:0;border-left:0}",
    ".modal.results{width:92%;height:88%}",
    ".modal.small{width:620px}",
    ".m-head{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;padding:12px 18px;border-bottom:1px solid @line@}",
    ".m-head h3{font:600 15px \"Bahnschrift\",\"Segoe UI\",Arial,sans-serif;letter-spacing:3px;text-transform:uppercase;color:@strong@;-webkit-flex:1;flex:1}",
    ".m-head .x{background:none;border:0;font-size:22px;color:@muted@;padding:0 4px}.m-head .x:hover{color:@a1@}",
    ".m-body{-webkit-flex:1;flex:1;min-height:0;padding:16px 18px;overflow:auto}",
    ".m-body.res{overflow:hidden;display:-webkit-flex;display:flex;-webkit-flex-direction:column;flex-direction:column}",
    ".m-foot{padding:12px 18px;border-top:1px solid @line@;text-align:right}",
    ".btn{white-space:nowrap;padding:8px 18px;background:transparent;border:1px solid @line2@;margin-left:8px;font:600 12px \"Bahnschrift\",\"Segoe UI\",Arial,sans-serif;text-transform:uppercase;letter-spacing:2px;color:@text@}",
    ".btn:hover{border-color:@a2@;color:@a2@}",
    ".btn.pri{background:@a1@;border-color:@a1@;color:@onA@;font-weight:700}.btn.pri:hover{background:@a1h@;color:@onA@}",
    ".field{margin-bottom:12px}.field label{display:block;font:11px \"Consolas\",monospace;text-transform:uppercase;letter-spacing:1px;color:@muted@;margin-bottom:4px}",
    ".field input[type=text],.field select{width:100%;padding:8px 10px;background:@input@;border:1px solid @line@;outline:0;font-family:\"Consolas\",monospace;font-size:13px;color:@a2@}",
    ".field input:focus,.field select:focus{border-color:@a2@}.field.bad input,.field.bad select{border-color:@bad@}",
    ".field .hint{font-size:11px;color:@bad@;margin-top:2px}",
    ".row{display:-webkit-flex;display:flex}.row .field{-webkit-flex:1;flex:1;margin-right:10px}.row .field:last-child{margin-right:0}",
    ".ent-head{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid @line@}",
    ".ent-head .ico{width:56px;height:56px;background:@bg@;border:1px solid @line@;border-left:3px solid @a1@;margin-right:14px;overflow:hidden;text-align:center;line-height:50px;font:700 22px \"Consolas\",monospace;color:@strong@}",
    ".ent-head .ico img{width:100%;height:100%}.ent-head .t{font-size:18px;color:@strong@;font-weight:600}.ent-head .s{font:12px \"Consolas\",monospace;color:@a2@}",
    ".pick{position:relative}.pick .list{position:absolute;left:0;right:0;top:100%;z-index:5;background:@input@;border:1px solid @a2@;max-height:260px;overflow:auto}",
    ".pick .it{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;padding:4px 8px;cursor:pointer}.pick .it:hover,.pick .it.sel{background:@panel3@}",
    ".pick .it .ico{width:26px;height:26px;margin-right:8px;background:@panel@;overflow:hidden;text-align:center;line-height:26px;font-size:12px;color:@strong@;font-weight:700}",
    ".pick .it .ico img{width:100%;height:100%}.pick .it small{color:@muted@;margin-left:auto;padding-left:8px;font-family:\"Consolas\",monospace}",
    ".note{color:@muted@;font-size:12px;margin-top:6px}",
    ".cats{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap}",
    "::-webkit-scrollbar{width:9px;height:9px}::-webkit-scrollbar-thumb{background:@line@}::-webkit-scrollbar-thumb:hover{background:@a1@}::-webkit-scrollbar-track{background:@bg@}",
    ".themes{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;margin-bottom:6px}",
    ".tile{width:168px;margin:0 10px 10px 0;padding:0;background:transparent;border:1px solid @line@;text-align:left;color:@text@}",
    ".tile:hover{border-color:@a1@}.tile.on{border-color:@a1@;box-shadow:0 0 0 1px @a1@}",
    ".tile .pv{height:62px;padding:9px 10px;position:relative}.tile .pv i{display:block;height:6px;margin-bottom:6px}.tile .pv b{font:700 15px Consolas,monospace}",
    ".tile .tn{padding:7px 10px;font:12px Consolas,monospace;text-transform:uppercase;letter-spacing:1px;color:@text@;background:@panel@;border-top:1px solid @line@}",
    ".crow{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;margin-bottom:8px}",
    ".crow label{width:150px;margin:0;font:11px Consolas,monospace;text-transform:uppercase;letter-spacing:1px;color:@muted@}",
    ".crow input[type=text]{width:110px;padding:6px 8px;background:@input@;border:1px solid @line@;outline:0;font:13px Consolas,monospace;color:@a2@}",
    ".crow input[type=color]{width:44px;height:30px;margin-left:8px;padding:0;border:1px solid @line@;background:transparent}",
    ".crow .sw{width:30px;height:30px;margin-left:8px;border:1px solid @line@}",
    "#theme{padding:5px 12px;background:transparent;border:1px solid @line@;font:11px Consolas,monospace;text-transform:uppercase;letter-spacing:1px;color:@soft@}",
    "#theme:hover{border-color:@a2@;color:@a2@}",
    ".god,.conn,.lang,#theme,.demo{white-space:nowrap}",
    "@media (max-width:1500px){#stats{display:none}}"
  ].join('\n');

  /* ---------------------------------------------------------------- colour helpers */
  function hex2rgb(h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); if (!/^[0-9a-fA-F]{6}$/.test(h)) return null; return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function rgb2hex(c) { function z(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16); } return '#' + z(c[0]) + z(c[1]) + z(c[2]); }
  function mix(a, b, t) { var x = hex2rgb(a), y = hex2rgb(b); return rgb2hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
  function lum(h) { var c = hex2rgb(h); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  function rgba(h, a) { var c = hex2rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  /* ---------------------------------------------------------------- palettes */
  var PRESETS = {
    hud: { bg: '#0b0d10', text: '#cfd8de', a1: '#ff6b3d', a2: '#4fd6e6', hudKinds: true },
    light: { bg: '#ffffff', text: '#000000', a1: '#000000', a2: '#000000' },
    mono: { bg: '#050505', text: '#ffffff', a1: '#ffffff', a2: '#ffffff' }
  };

  // from 4 base colours (background, text, accent 1, accent 2) to every token of the stylesheet
  function build(base) {
    var bg = base.bg, tx = base.text, a1 = base.a1, a2 = base.a2, dark = lum(bg) < 0.5, edge = dark ? '#000000' : '#ffffff';
    var p = {
      bg: bg, text: tx, strong: dark ? mix(tx, '#ffffff', 0.35) : mix(tx, '#000000', 0.35),
      panel: mix(bg, tx, dark ? 0.055 : 0.03), panel2: mix(bg, tx, 0.1), panel3: mix(bg, tx, 0.14), input: mix(bg, edge, dark ? 0.45 : 0.0), bar: mix(bg, tx, dark ? 0.025 : 0.02), modal: mix(bg, tx, dark ? 0.03 : 0.0),
      line: mix(bg, tx, base.hudKinds ? 0.18 : (dark ? 0.28 : 0.55)), line2: mix(bg, tx, base.hudKinds ? 0.3 : (dark ? 0.42 : 0.7)),
      muted: mix(bg, tx, 0.55), muted2: mix(bg, tx, 0.4), soft: mix(bg, tx, 0.75), grid: mix(bg, tx, dark ? 0.06 : 0.1),
      a1: a1, a1h: mix(a1, tx, 0.22), a1glow: mix(a1, bg, 0.0), a2: a2,
      onA: lum(a1) > 0.55 ? '#0b0d10' : '#ffffff',
      ok: dark ? '#4fd27f' : '#14803a', okt: dark ? '#8fe0ad' : '#14803a', warn: dark ? '#f0c24a' : '#9a6a00', bad: dark ? '#ff5a4a' : '#c0281a',
      shade: dark ? 'rgba(5,7,9,.78)' : 'rgba(0,0,0,.5)'
    };
    p.okbg = rgba(p.ok, 0.12); p.badbg = rgba(p.bad, 0.12); p.warnbg = rgba(p.warn, 0.1);
    if (base.hudKinds) { p.kc = a1; p.ki = a2; p.kb = p.warn; p.km = '#8aa4ff'; p.ka = p.ok; p.kg = '#c9a27a'; }
    else { // plain themes: the card type is told by its CMD / ITM / BLD ... tag, the edge goes through shades of the text colour
      p.kc = tx; p.ki = mix(bg, tx, 0.85); p.kb = mix(bg, tx, 0.7); p.km = mix(bg, tx, 0.58); p.ka = mix(bg, tx, 0.46); p.kg = mix(bg, tx, 0.36);
    }
    return p;
  }

  var el = null, state = { name: 'hud', custom: { bg: '#1b1f2a', text: '#e6e6e6', a1: '#7cc4ff', a2: '#ffb86b' } };
  function render(p) { return CSS.replace(/@([a-zA-Z0-9]+)@/g, function (m, k) { return p[k] !== undefined ? p[k] : m; }); }
  function apply() {
    var base = state.name === 'custom' ? state.custom : (PRESETS[state.name] || PRESETS.hud);
    var css = render(build(base));
    if (!el) { el = document.createElement('style'); el.id = 'kz-theme'; (document.head || document.getElementsByTagName('head')[0]).appendChild(el); }
    if (el.styleSheet) el.styleSheet.cssText = css; else { while (el.firstChild) el.removeChild(el.firstChild); el.appendChild(document.createTextNode(css)); }
  }
  function validHex(h) { return !!hex2rgb(h); }
  function serialize() { var c = state.custom; return state.name + ';' + c.bg + ';' + c.text + ';' + c.a1 + ';' + c.a2; }
  function load(str) {
    var f = String(str || '').split(';');
    if (f[0] && (PRESETS[f[0]] || f[0] === 'custom')) state.name = f[0];
    if (f.length >= 5 && validHex(f[1]) && validHex(f[2]) && validHex(f[3]) && validHex(f[4])) state.custom = { bg: f[1], text: f[2], a1: f[3], a2: f[4] };
    apply();
  }

  window.KZTheme = {
    presets: PRESETS, apply: apply, serialize: serialize, load: load, validHex: validHex,
    get: function () { return { name: state.name, custom: { bg: state.custom.bg, text: state.custom.text, a1: state.custom.a1, a2: state.custom.a2 } }; },
    set: function (name, custom) { state.name = name; if (custom) for (var k in custom) if (validHex(custom[k])) state.custom[k] = custom[k]; apply(); },
    base: function (name) { return name === 'custom' ? state.custom : PRESETS[name]; }
  };
  try { load(localStorage.getItem('kz_theme')); } catch (e) { apply(); }
})();
