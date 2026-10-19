/*
 * The Almanac's website: a book chosen from the rail on the right, its gallery, filters in the panel that pulls out
 * beside the rail, and each thing opened in the full-screen viewer - in 3D, as the game draws it.
 */
(function () {
  'use strict';
  var AOA = window.AOA = window.AOA || {};
  var $ = function (id) { return document.getElementById(id); };
  var D, book, shown = [], viewer, openAt = -1;
  var state = { q: '', mods: new Set(), sort: 'name', show: 'all', size: 'm', panel: false };

  // ------------------------------------------------------------------ pixel icons, drawn on a grid as the book's are
  var PX = {
    structures: ['#..#..#..#', '##########', '.########.', '.###..###.', '.###..###.', '.########.', '.########.', '.###..###.', '.##....##.', '.##....##.'],
    biomes: ['.....#......', '....###.....', '...#####....', '..###.###.#.', '..##...####.', '.####.######', '############'],
    mobs: ['..##..##..', '..##..##..', '##......##', '##..##..##', '...####...', '..######..', '..######..', '...#..#...'],
    items: ['..######..', '.#.#..#.#.', '##########', '.########.', '..######..', '...####...', '....##....'],
    mods: ['.####..####.', '#....##....#', '#.##.##.##.#', '#....##....#', '#.##.##.##.#', '#....##....#', '#.##.##.##.#', '#....##....#', '.####..####.'],
    search: ['..####...', '.#....#..', '#......#.', '#......#.', '#......#.', '.#....#..', '..####.#.', '.......##', '........#'],
    filter: ['##########', '.########.', '..######..', '...####...', '...####...', '...####...', '....##....'],
    discord: ['..##..##..', '.########.', '##########', '##..##..##', '##..##..##', '##########', '.##.##.##.', '.#......#.'],
    grid9: ['##.##.##', '##.##.##', '........', '##.##.##', '##.##.##', '........', '##.##.##', '##.##.##'],
    grid4: ['###.###', '###.###', '###.###', '.......', '###.###', '###.###', '###.###'],
    grid2: ['#######', '#######', '#######', '.......', '#######', '#######', '#######'],
    left: ['...#', '..##', '.###', '####', '.###', '..##', '...#'],
    right: ['#...', '##..', '###.', '####', '###.', '##..', '#...'],
    close: ['#.....#', '##...##', '.##.##.', '..###..', '.##.##.', '##...##', '#.....#'],
    pause: ['##.##', '##.##', '##.##', '##.##', '##.##', '##.##', '##.##'],
    play: ['#....', '###..', '#####', '###..', '#....'],
    spin: ['..####..', '.#....#.', '#......#', '#......#', '#....###', '.#....##', '..####.#'],
    cube: ['...##...', '.##..##.', '#......#', '##....##', '#.####.#', '#..##..#', '.#.##.#.', '...##...'],
    reset: ['..####..', '.#....#.', '#......#', '#......#', '###....#', '##....#.', '#.####..'],
    camera: ['..###...', '########', '#..##..#', '#.#..#.#', '#.#..#.#', '#..##..#', '########'],
    tick: ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....']
  };
  function px(name) {
    var rows = PX[name]; if (!rows) return '';
    var w = rows[0].length, hgt = rows.length, n = Math.max(w, hgt), ox = (n - w) / 2, oy = (n - hgt) / 2, d = '';
    rows.forEach(function (r, y) { for (var x = 0; x < r.length; x++) if (r[x] === '#') d += 'M' + (x + ox) + ' ' + (y + oy) + 'h1v1h-1z'; });
    return '<svg viewBox="0 0 ' + n + ' ' + n + '" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  function pxAll(root) { (root || document).querySelectorAll('.pxicon[data-icon]').forEach(function (el) { if (!el.firstChild) el.innerHTML = px(el.dataset.icon); }); }

  // the books' colours (the glow behind the page, the tape on their polaroids)
  var LOOK = { structures: '#e2a541', biomes: '#6cc46a', mobs: '#e86a9a', items: '#5ea8ec', mods: '#a77ce0' };
  // the mods' link tiles: one sheet, the same as the book's (see tiles.py)
  var TILES = ['Config', 'CurseForge', 'Modrinth', 'GitHub', 'Source', 'Wiki', 'Discord', 'YouTube', 'Website', 'Report'];

  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rgb(hex) { var v = parseInt(hex.slice(1), 16); return (v >> 16 & 255) + ',' + (v >> 8 & 255) + ',' + (v & 255); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem('aoa.' + k); localStorage.setItem('aoa.' + k, v); } catch (e) { return null; } }
  function toast(t) { var el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove('on'); }, 2200); }

  // ------------------------------------------------------------------ the data arrives last
  // the viewer's controls and cards are sized for a 1024x768 window, and scale with the window so it always looks the same
  function fitUi() {
    var k = Math.min(innerWidth / 1024, innerHeight / 768);
    document.documentElement.style.setProperty('--ui', Math.max(0.5, Math.min(1.6, k)).toFixed(3));
  }
  fitUi();
  window.addEventListener('resize', fitUi);

  // the author's own touches (custom.js, written by Dev Mode): title, logo, banner, description, links, books shown
  var C = {};
  AOA.custom = function (c) { C = c || {}; AOA.customised = C; };
  var LINKS = [['discord', 'Discord'], ['curseforge', 'CurseForge'], ['modrinth', 'Modrinth'], ['youtube', 'YouTube'], ['github', 'GitHub'], ['website', 'Website']];
  AOA.LINKS = LINKS;

  AOA.data = function (d) {
    D = d;
    AOA.D = D;
    D.allBooks = D.books.slice();
    D.seriesDiscord = D.discord;
    applyCustom();
    D.books.forEach(function (b) {
      b.look = { c: LOOK[b.id] || '#a77ce0' };
      b.modOf = {}; b.mods.forEach(function (m) { b.modOf[m.id] = m; });
      b.entries.forEach(function (e) {
        var m = b.modOf[e.m];
        e.hay = (e.n + ' ' + e.id + ' ' + (m ? m.name : '') + ' ' + (e.f || []).join(' ')).toLowerCase();
      });
    });
    state.size = store('size') || 'm';
    state.panel = store('panel') === '1' && innerWidth > 640;
    pxAll(); rail(); bind(); dressed(); AOA.loadProfile();
    route(true);
    if (/[?&]dev=/.test(location.search)) {
      // opened by the game for its author: Dev Mode, to customise and publish (never in a published copy)
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'assets/dev.css'; document.head.appendChild(css);
      var js = document.createElement('script'); js.src = 'assets/dev.js'; document.body.appendChild(js);
    }
  };

  /** What the author chose: which books show, the pack's name, their Discord. */
  function applyCustom() {
    var out = C.excluded || [];
    D.allBooks.forEach(function (b) {
      if (!b.allEntries) { b.allEntries = b.entries; b.allMods = b.mods; }
      b.entries = b.allEntries.filter(function (e) { return out.indexOf(e.m) < 0; });
      b.mods = b.allMods.filter(function (m) { return out.indexOf(m.id) < 0; });
      b.modOf = {}; b.mods.forEach(function (m) { b.modOf[m.id] = m; });
    });
    var hide = C.hidden || [];
    D.books = D.allBooks.filter(function (b) { return hide.indexOf(b.id) < 0; });
    if (!D.books.length) D.books = D.allBooks.slice(0, 1);
    if (D.packFromGame === undefined) { D.packFromGame = D.pack || ''; D.ownDiscordFromGame = !!D.ownDiscord; }
    D.pack = C.title || D.packFromGame;
    if (C.links && C.links.discord) { D.discord = C.links.discord; D.ownDiscord = true; }
    else { D.discord = D.seriesDiscord; D.ownDiscord = D.ownDiscordFromGame; }
  }

  /** The author's logo, banner and description where the page has room for them (nothing changes without them). */
  function dressed() {
    var seal = document.querySelector('.seal');
    seal.innerHTML = C.logo ? '<img src="' + h(C.logo) + '" alt="">' : '';
    seal.classList.toggle('has-logo', !!C.logo);
    $('pack').textContent = D.pack || ''; $('pack').hidden = !D.pack;
    document.title = D.pack ? D.pack + ' \u00b7 Almanac O\' Adventures' : 'Almanac O\' Adventures';
    var intro = $('intro');
    if (!intro) { intro = document.createElement('div'); intro.id = 'intro'; intro.className = 'intro'; $('hero').parentNode.insertBefore(intro, $('hero')); }
    var pr = AOA.profile;
    intro.innerHTML = (C.banner ? '<img class="banner" src="' + h(C.banner) + '" alt="">' : '') + (C.description ? '<p>' + h(C.description) + '</p>' : '') +
      (pr ? '<div class="profile-code"><div class="pc-text"><b>Pack profile</b><small>Copy it, then paste it into the Almanac\'s profile box in game (top left of the book) to get this pack\'s set-up.</small></div>' +
        '<code>' + h(pr.code.replace(/(\d{4})(?=\d)/g, '$1 ')) + '</code><button class="paper-btn" data-copy-profile="' + h(pr.code) + '">Copy</button></div>' : '');
    intro.hidden = !C.banner && !C.description && !pr;
  }

  /** The pack's profile, if it was published beside the page: a numbers-only code to copy into the game. */
  AOA.profile = null;
  AOA.loadProfile = function () {
    if (location.protocol === 'file:') return;
    fetch('profile.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) { AOA.profile = p && p.code ? p : null; dressed(); }, function () {});
  };

  /** Dev Mode changed something: the page shows it at once. */
  AOA.redress = function (c) {
    if (c) C = c;
    AOA.customised = C;
    applyCustom(); dressed(); rail();
    var still = D.books.indexOf(book) >= 0 ? book : D.books[0];
    book = null; choose(still);
  };

  function rail() {
    var r = $('rail'), out = '';
    D.books.forEach(function (b) {
      out += '<button class="tab" data-book="' + b.id + '" aria-label="' + h(b.label) + '"><span class="pxicon">' + px(b.id) + '</span>' +
        '<span class="label">' + h(b.label) + '<b>' + b.entries.length + '</b></span></button>';
    });
    out += '<div class="grow"></div>';
    out += '<button class="tab small" id="railPanel" aria-label="Filters"><span class="pxicon">' + px('filter') + '</span><span class="label">Filters</span></button>';
    out += '<a class="tab small" href="' + h(D.discord) + '" target="_blank" rel="noopener" aria-label="Discord"><span class="pxicon">' + px('discord') + '</span>' +
      '<span class="label">' + (D.ownDiscord ? 'Our Discord' : 'The O\' series Discord') + '</span></a>';
    // the pack's own links, as the book's link tiles
    LINKS.forEach(function (l) {
      var u = C.links && C.links[l[0]];
      if (!u || l[0] === 'discord') return;
      var k = TILES.indexOf(l[1]); if (k < 0) k = TILES.indexOf('Website');
      out += '<a class="tab small link" href="' + h(u) + '" target="_blank" rel="noopener" aria-label="' + l[1] + '"><i style="background-position:' + (-22 * k) + 'px 0"></i>' +
        '<span class="label">' + l[1] + '</span></a>';
    });
    r.innerHTML = out;
    document.querySelectorAll('.tab[data-book]').forEach(function (el) { if (book) el.setAttribute('aria-current', el.dataset.book === book.id); });
  }

  // ------------------------------------------------------------------ choosing a book, filtering, the gallery
  function route(first) {
    var hash = decodeURIComponent(location.hash.slice(1)), parts = hash.split('/'), id = parts[0] || D.first || D.books[0].id;
    var b = D.books.filter(function (x) { return x.id === id; })[0] || D.books[0];
    if (b !== book) choose(b);
    var want = parts.length > 1 ? hash.slice(parts[0].length + 1) : null;
    if (want) {
      var i = shown.findIndex(function (e) { return e.id === want; });
      if (i < 0) { state.q = ''; state.mods.clear(); state.show = 'all'; $('q').value = ''; filter(); i = shown.findIndex(function (e) { return e.id === want; }); }
      if (i >= 0 && i !== openAt) open(i, null, true);
    } else if (openAt >= 0) close(true);
  }

  function choose(b) {
    book = b;
    document.documentElement.style.setProperty('--accent', b.look.c);
    document.documentElement.style.setProperty('--accent-rgb', rgb(b.look.c));
    document.querySelectorAll('.tab[data-book]').forEach(function (el) { el.setAttribute('aria-current', el.dataset.book === b.id); });
    state.q = ''; state.mods.clear(); state.show = 'all'; $('q').value = '';
    $('q').placeholder = 'Search ' + b.entries.length + ' ' + (b.nouns || b.label).toLowerCase();
    var models = b.id === 'mods' ? 0 : b.entries.filter(function (e) { return e.k; }).length;
    var group = b.id === 'mods' ? ['category', 'categories'] : ['mod', 'mods'];
    $('hero').innerHTML = '<div><div class="eyebrow">' + h(b.t1 + ' ' + b.t2) + '</div><h1>' + h(b.label) + '</h1>' +
      '<p><b>' + b.entries.length + '</b> ' + h((b.nouns || '').toLowerCase()) + ' from <b>' + b.mods.length + '</b> ' + group[b.mods.length === 1 ? 0 : 1] +
      (models ? ', ' + (models === b.entries.length ? 'every one' : '<b>' + models + '</b>') + ' in 3D as the game draws ' + (models === 1 ? 'it' : 'them') : '') + '.</p></div>' +
      '<div class="stats"><div class="stat" style="--r:-2deg"><b>' + b.entries.length + '</b><span>' + h(b.nouns || 'entries') + '</span></div>' +
      '<div class="stat" style="--r:1.5deg"><b>' + b.mods.length + '</b><span>' + group[1] + '</span></div>' +
      (b.entries.some(function (e) { return e.off; }) ? '<div class="stat" style="--r:-1deg"><b>' + b.entries.filter(function (e) { return e.off; }).length + '</b><span>disabled</span></div>' : '') + '</div>';
    $('pEyebrow').textContent = b.t1 + ' ' + b.t2; $('pTitle').textContent = 'Filter ' + b.label.toLowerCase();
    document.querySelector('#panel .field.grow .label span').textContent = b.id === 'mods' ? 'Categories' : 'Mods';
    $('modQ').placeholder = b.id === 'mods' ? 'Find a category' : 'Find a mod';
    var foot = 'Spot an error? <a href="' + h(D.discord) + '" target="_blank" rel="noopener">Check out ' + (D.ownDiscord ? 'our' : 'the O\' series') + ' Discord</a>.';
    $('foot').innerHTML = '<span>' + foot + '</span><span>Made in the game ' + h(D.made || '') + ' · All rights reserved Milfheim Group © 2020</span>';
    chips(); modList(); syncSegs(); filter(); window.scrollTo({ top: 0 });
  }

  function chips() {
    var c = $('chips'), mods = book.mods.slice().sort(function (a, b) { return b.count - a.count; });
    c.innerHTML = '<button class="chip" data-mod="" style="--c:var(--accent)" aria-pressed="' + (state.mods.size === 0) + '">All<span class="ct">' + book.entries.length + '</span></button>' +
      mods.map(function (m) {
        return '<button class="chip" data-mod="' + h(m.id) + '" style="--c:' + m.c + '" aria-pressed="' + state.mods.has(m.id) + '"><span class="dot" style="background:' + m.c + '"></span>' +
          h(m.name) + '<span class="ct">' + m.count + '</span></button>';
      }).join('');
    edges();
  }
  function edges() {
    var c = $('chips'), max = c.scrollWidth - c.clientWidth;
    c.classList.toggle('fits', max <= 2); c.classList.toggle('scrolled', c.scrollLeft > 2 && c.scrollLeft < max - 2); c.classList.toggle('end', max > 2 && c.scrollLeft >= max - 2);
  }
  function modList() {
    var t = ($('modQ').value || '').toLowerCase();
    $('modList').innerHTML = book.mods.filter(function (m) { return !t || m.name.toLowerCase().indexOf(t) >= 0; }).map(function (m) {
      return '<button class="mod" role="checkbox" data-mod="' + h(m.id) + '" aria-checked="' + state.mods.has(m.id) + '"><span class="box">' + px('tick') +
        '</span><span class="dot" style="background:' + m.c + '"></span><span class="nm">' + h(m.name) + '</span><span class="ct">' + m.count + '</span></button>';
    }).join('');
  }
  function syncSegs() {
    document.querySelectorAll('[data-sort]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.sort === state.sort); });
    document.querySelectorAll('[data-show]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.show === state.show); });
    document.querySelectorAll('[data-size]').forEach(function (b) { if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', b.dataset.size === state.size); });
    $('grid').dataset.size = state.size;
    document.body.classList.toggle('panel-open', state.panel);
    var rpp = $('railPanel'); if (rpp) rpp.setAttribute('aria-pressed', state.panel);
    $('panel').setAttribute('aria-hidden', !state.panel);
    var rp = $('railPanel'); if (rp) rp.setAttribute('aria-pressed', state.panel);
  }

  function filter() {
    var q = state.q.trim().toLowerCase(), words = q ? q.split(/\s+/) : [];
    shown = book.entries.filter(function (e) {
      if (state.mods.size && !state.mods.has(e.m)) return false;
      if (state.show === 'on' && e.off) return false;
      if (state.show === 'off' && !e.off) return false;
      for (var i = 0; i < words.length; i++) if (e.hay.indexOf(words[i]) < 0) return false;
      return true;
    });
    if (state.sort === 'za') shown.reverse();
    else if (state.sort === 'mod') shown.sort(function (a, b) { var ma = book.modOf[a.m], mb = book.modOf[b.m]; return (ma ? ma.name : a.m).localeCompare(mb ? mb.name : b.m) || a.n.localeCompare(b.n); });
    grid();
  }

  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (list) {
    list.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target; io.unobserve(el);
      var img = el.querySelector('img[data-src]');
      if (img) {
        var src = img.dataset.src; img.removeAttribute('data-src');
        img.onload = function () { img.classList.add('ok'); };
        img.onerror = function () { img.replaceWith(mono(el.dataset.n)); };
        if (src.indexOf('model:') === 0) {
          // pictured here, from its own model, as the game draws it: a sticker
          AOA.thumb(src.slice(6)).then(function (url) { if (url) img.src = url; else img.onerror(); }, function () { img.onerror(); });
        } else img.src = src;
      }
      setTimeout(function () { el.classList.add('in'); }, (+el.dataset.i % 12) * 28);
    });
  }, { rootMargin: '200px 0px' }) : null;

  function hash(s) { var x = 7; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; }
  function mono(name) { var s = document.createElement('span'); s.className = 'mono'; s.textContent = (name || '?').trim().charAt(0).toUpperCase(); return s; }

  function grid() {
    var g = $('grid');
    $('empty').hidden = shown.length > 0;
    g.innerHTML = shown.map(function (e, i) {
      var m = book.modOf[e.m] || { name: e.m, c: '#888' }, photo = book.id === 'mods' && e.gallery && e.img === e.gallery[0];
      var r = ((hash(e.id) % 70) - 35) / 10;                       // each a little crooked, the same way every time
      var cls = photo ? ' class="photo"' : book.id === 'biomes' ? ' class="scene"' : '';
      var src = e.img || (e.k ? 'model:' + e.k : '');
      return '<button class="card" data-i="' + i + '" data-n="' + h(e.n) + '" style="--c:' + m.c + ';--r:' + r + 'deg" aria-label="' + h(e.n) + '">' +
        (e.off ? '<span class="stamp">DISABLED</span>' : '') +
        '<span class="pic">' + (src ? '<img data-src="' + h(src) + '" alt=""' + cls + ' draggable="false">' : '<span class="mono">' + h((e.n || '?').charAt(0).toUpperCase()) + '</span>') + '</span>' +
        '<span class="meta"><span class="nm">' + h(e.n) + '</span><span class="md"><span class="dot" style="background:' + m.c + '"></span><span>' + h(m.name) + '</span></span></span></button>';
    }).join('');
    g.querySelectorAll('.card').forEach(function (el) { if (io) io.observe(el); else { el.classList.add('in'); var img = el.querySelector('img[data-src]'); if (img) { img.src = img.dataset.src; img.classList.add('ok'); } } });
    document.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', c.dataset.mod ? state.mods.has(c.dataset.mod) : state.mods.size === 0); });
    document.querySelectorAll('.mod').forEach(function (c) { c.setAttribute('aria-checked', state.mods.has(c.dataset.mod)); });
  }

  // ------------------------------------------------------------------ the viewer
  function ensureViewer() {
    if (viewer !== undefined) return viewer;
    try { viewer = new AOA.Viewer($('gl')); viewer.onTouch = hideHint; } catch (e) { viewer = null; }
    return viewer;
  }
  function hideHint() { $('vHint').classList.add('gone'); }

  function open(i, from, noHistory) {
    var e = shown[i]; if (!e) return;
    var first = openAt < 0;
    openAt = i;
    var v = $('viewer'), m = book.modOf[e.m] || { name: e.m, c: '#888' };
    if (!noHistory) history[first ? 'pushState' : 'replaceState'](null, '', '#' + book.id + '/' + encodeURIComponent(e.id));
    v.hidden = false; requestAnimationFrame(function () { v.classList.add('on'); });
    document.body.style.overflow = 'hidden';
    $('vBook').textContent = book.t1 + ' ' + book.t2;
    $('vName').textContent = e.n;
    $('vMod').innerHTML = '<span class="dot" style="background:' + m.c + '"></span>' + h(m.name) + (e.off ? '<span class="off">· Disabled</span>' : '');
    // facts, links, notes
    var info = '';
    if (e.f && e.f.length) info += '<h3>About</h3><ul>' + e.f.slice(0, 14).map(function (f) { return '<li>' + h(f) + '</li>'; }).join('') + '</ul>';
    if (e.why) info += '<h3>Not drawn</h3><ul><li>' + h(e.why) + '</li></ul>';
    if (e.links && e.links.length) {
      info += '<div class="links">' + e.links.map(function (l) {
        var k = TILES.indexOf(l.t); if (k < 0) k = TILES.indexOf('Website');
        return '<a class="tile-link" href="' + h(l.u) + '" target="_blank" rel="noopener"><i style="background-position:' + (-28 * k) + 'px 0"></i>' + h(l.t) + '</a>';
      }).join('') + '</div>';
    }
    $('vInfo').innerHTML = info;
    $('vNotes').innerHTML = (e.notes || []).map(function (n, k) { return '<div class="note" style="--r:' + (k % 2 ? -3 : 3) + 'deg;animation-delay:' + (k * 80 + 150) + 'ms"><img src="' + h(n.img) + '" alt=""><span>' + h(n.t) + '</span></div>'; }).join('');
    $('vPrev').style.visibility = i > 0 ? '' : 'hidden'; $('vNext').style.visibility = i < shown.length - 1 ? '' : 'hidden';
    $('vHint').classList.remove('gone'); clearTimeout(open.hint); open.hint = setTimeout(hideHint, 4500);
    // what it is shown as: its model, a mod's pictures, or its picture
    var canvas = $('gl'), flat = $('flat'), slides = $('slides');
    canvas.classList.remove('ready'); $('viewer').classList.remove('scene'); flat.hidden = true; slides.hidden = true; clearInterval(open.slideT);
    var gl = ensureViewer(), useModel = e.k && gl && !(book.id === 'mods' && e.gallery);
    $('vAnim').hidden = true; $('vOrtho').hidden = !useModel; $('vSpin').hidden = !useModel; $('vReset').hidden = !useModel; $('vShot').hidden = !useModel;
    canvas.hidden = !useModel;
    if (from && e.img) fly(from, e);
    if (useModel) {
      $('vLoad').hidden = false; $('vLoadText').textContent = 'Loading ' + e.n;
      gl.show(e.k).then(function (model) {
        if (shown[openAt] !== e || !model) return;
        $('vLoad').hidden = true; canvas.classList.add('ready');
        $('vAnim').hidden = !(model.meta.frames > 1); setPressed('vAnim', false); setPressed('vSpin', gl.spinning); setPressed('vOrtho', gl.state.ortho);
        $('vOrtho').hidden = !!model.scene;
        $('viewer').classList.toggle('scene', !!model.scene);
        canvas.style.background = model.scene ? 'linear-gradient(180deg,' + model.scene.sky + ' 0%,' + model.scene.fog + ' 58%,' + model.scene.fog + ' 100%)' : '';
      }).catch(function (err) {
        $('vLoad').hidden = true; canvas.hidden = true;
        if (e.img || e.full) { flat.src = e.full || e.img; flat.hidden = false; }
        toast(String(err && err.message || err));
      });
    } else {
      $('vLoad').hidden = true;
      if (gl) gl.drop();
      if (e.gallery && e.gallery.length) {
        slides.hidden = false; var k = 0;
        slides.innerHTML = e.gallery.map(function (src, j) { return '<img src="' + h(src) + '" alt=""' + (j === 0 ? ' class="on"' : '') + '>'; }).join('') +
          (e.gallery.length > 1 ? '<div class="pager">' + e.gallery.map(function (_, j) { return '<button data-slide="' + j + '"' + (j === 0 ? ' class="on"' : '') + ' aria-label="Picture ' + (j + 1) + '"></button>'; }).join('') + '</div>' : '');
        var go = function (j) {
          k = (j + e.gallery.length) % e.gallery.length;
          slides.querySelectorAll('img').forEach(function (im, x) { im.classList.toggle('on', x === k); });
          slides.querySelectorAll('.pager button').forEach(function (d, x) { d.classList.toggle('on', x === k); });
        };
        open.slide = go;
        if (e.gallery.length > 1) open.slideT = setInterval(function () { go(k + 1); }, 5000);
      } else if (e.full || e.img) { flat.src = e.full || e.img; flat.hidden = false; }
    }
    $('vClose').focus({ preventScroll: true });
  }

  /** The card's picture grows from where it was to the middle of the screen while the model loads. */
  function fly(from, e) {
    var img = from.querySelector('img'); if (!img || !img.complete) return;
    var r = img.getBoundingClientRect(), g = document.createElement('img');
    g.className = 'ghostpic'; g.src = img.src;
    g.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;opacity:1';
    document.body.appendChild(g);
    var s = Math.min(innerWidth, innerHeight) * 0.5;
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      g.style.cssText = 'left:' + (innerWidth - s) / 2 + 'px;top:' + (innerHeight - s) / 2 + 'px;width:' + s + 'px;height:' + s + 'px;opacity:' + (e.k ? '.0' : '0');
    }); });
    setTimeout(function () { g.remove(); }, 600);
  }

  function close(noHistory) {
    if (openAt < 0) return;
    var cards = $('grid').querySelectorAll('.card'), back = cards[openAt];
    openAt = -1;
    var v = $('viewer'); v.classList.remove('on');
    setTimeout(function () { if (openAt < 0) { v.hidden = true; if (viewer) viewer.drop(); } }, 350);
    clearInterval(open.slideT);
    document.body.style.overflow = '';
    if (!noHistory) history.pushState(null, '', '#' + book.id);
    if (back) back.focus({ preventScroll: false });
  }
  function step(d) { if (openAt < 0) return; var n = openAt + d; if (n >= 0 && n < shown.length) open(n); }
  function setPressed(id, on) { $(id).setAttribute('aria-pressed', !!on); }

  // ------------------------------------------------------------------ wiring
  function bind() {
    $('rail').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-book]');
      if (b) {
        if (b.dataset.book === book.id) { state.panel = !state.panel; store('panel', state.panel ? '1' : '0'); syncSegs(); }
        else { history.pushState(null, '', '#' + b.dataset.book); route(); }
        return;
      }
      if (ev.target.closest('#railPanel')) { state.panel = !state.panel; store('panel', state.panel ? '1' : '0'); syncSegs(); }
    });
    $('pClose').onclick = function () { state.panel = false; store('panel', '0'); syncSegs(); };
    $('q').addEventListener('input', function () { state.q = this.value; filter(); });
    $('modQ').addEventListener('input', modList);
    $('chips').addEventListener('scroll', edges, { passive: true });
    window.addEventListener('resize', edges);
    // a vertical wheel over the chips slides them sideways
    $('chips').addEventListener('wheel', function (ev) { if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { this.scrollLeft += ev.deltaY; ev.preventDefault(); } }, { passive: false });
    $('chips').addEventListener('click', function (ev) {
      var c = ev.target.closest('.chip'); if (!c) return;
      if (!c.dataset.mod) state.mods.clear();
      else if (ev.shiftKey || ev.metaKey || ev.ctrlKey) { state.mods.has(c.dataset.mod) ? state.mods.delete(c.dataset.mod) : state.mods.add(c.dataset.mod); }
      else if (state.mods.size === 1 && state.mods.has(c.dataset.mod)) state.mods.clear();
      else { state.mods.clear(); state.mods.add(c.dataset.mod); }
      filter();
    });
    // the panel's mods: click to tick, or press and drag down over several to tick them all the same
    var sweep = null;
    $('modList').addEventListener('pointerdown', function (ev) {
      var m = ev.target.closest('.mod'); if (!m) return;
      ev.preventDefault();
      sweep = !state.mods.has(m.dataset.mod);
      sweep ? state.mods.add(m.dataset.mod) : state.mods.delete(m.dataset.mod);
      m.setAttribute('aria-checked', sweep); filter();
    });
    $('modList').addEventListener('pointerover', function (ev) {
      if (sweep === null) return; var m = ev.target.closest('.mod'); if (!m) return;
      if (state.mods.has(m.dataset.mod) !== sweep) { sweep ? state.mods.add(m.dataset.mod) : state.mods.delete(m.dataset.mod); filter(); }
    });
    window.addEventListener('pointerup', function () { sweep = null; });
    $('modsAll').onclick = function () {
      var all = state.mods.size === book.mods.length;
      state.mods.clear(); if (!all) book.mods.forEach(function (m) { state.mods.add(m.id); });
      this.textContent = all ? 'Select all' : 'Clear'; filter();
    };
    document.addEventListener('click', function (ev) {
      var s = ev.target.closest('[data-sort]'); if (s) { state.sort = s.dataset.sort; syncSegs(); filter(); return; }
      var w = ev.target.closest('[data-show]'); if (w) { state.show = w.dataset.show; syncSegs(); filter(); return; }
      var z = ev.target.closest('button[data-size]'); if (z) { state.size = z.dataset.size; store('size', state.size); syncSegs(); return; }
      var c = ev.target.closest('.card'); if (c) { open(+c.dataset.i, c); return; }
      var pc = ev.target.closest('[data-copy-profile]');
      if (pc) {
        var num = pc.dataset.copyProfile;
        (navigator.clipboard ? navigator.clipboard.writeText(num) : Promise.reject()).then(function () { pc.textContent = 'Copied!'; setTimeout(function () { pc.textContent = 'Copy'; }, 1800); },
          function () { prompt('Copy this number', num); });
        return;
      }
      var d = ev.target.closest('[data-slide]'); if (d && open.slide) { clearInterval(open.slideT); open.slide(+d.dataset.slide); return; }
      if (ev.target.closest('[data-home]')) { ev.preventDefault(); history.pushState(null, '', '#' + book.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
    $('clear').onclick = function () { state.q = ''; $('q').value = ''; state.mods.clear(); state.show = 'all'; syncSegs(); filter(); };
    $('vClose').onclick = function () { close(); };
    $('vPrev').onclick = function () { step(-1); };
    $('vNext').onclick = function () { step(1); };
    $('vReset').onclick = function () { if (viewer) viewer.reset(); };
    $('vAnim').onclick = function () {
      if (!viewer) return; viewer.playing = !viewer.playing; setPressed('vAnim', !viewer.playing); viewer.dirty = true;
      $('vAnim').querySelector('.pxicon').innerHTML = px(viewer.playing ? 'pause' : 'play');
    };
    $('vSpin').onclick = function () { if (!viewer) return; viewer.spinning = !viewer.spinning; setPressed('vSpin', viewer.spinning); };
    $('vOrtho').onclick = function () { if (!viewer) return; viewer.state.ortho = !viewer.state.ortho; setPressed('vOrtho', viewer.state.ortho); viewer.dirty = true; };
    $('vShot').onclick = function () {
      if (!viewer) return;
      var e = shown[openAt];
      viewer.snapshot().then(function (url) {
        var a = document.createElement('a'); a.href = url; a.download = (e ? e.n : 'almanac').replace(/[^\w -]+/g, '') + '.png'; a.click(); toast('Picture saved');
      });
    };
    $('viewer').addEventListener('click', function (ev) { if (ev.target === this) close(); });
    document.addEventListener('keydown', function (ev) {
      if (ev.target.tagName === 'INPUT') { if (ev.key === 'Escape') ev.target.blur(); return; }
      if (openAt >= 0) {
        if (ev.key === 'Escape') close();
        else if (ev.key === 'ArrowRight') step(1);
        else if (ev.key === 'ArrowLeft') step(-1);
        else if (ev.key === 'r' || ev.key === 'R') $('vReset').click();
        else if (ev.key === 't' || ev.key === 'T') $('vSpin').click();
        else if (ev.key === 'o' || ev.key === 'O') $('vOrtho').click();
        else if (ev.key === ' ') { ev.preventDefault(); $('vAnim').click(); }
        return;
      }
      if (ev.key === '/') { ev.preventDefault(); $('q').focus(); }
      else if (ev.key === 'Escape' && state.panel) { state.panel = false; syncSegs(); }
      else if (/^[1-9]$/.test(ev.key) && D.books[+ev.key - 1]) { history.pushState(null, '', '#' + D.books[+ev.key - 1].id); route(); }
    });
    window.addEventListener('popstate', function () { route(); });
    window.addEventListener('hashchange', function () { route(); });
    // swipe between things on a phone
    var sx = null;
    $('viewer').addEventListener('touchstart', function (ev) { if (ev.target.id !== 'gl') sx = ev.touches[0].clientX; }, { passive: true });
    $('viewer').addEventListener('touchend', function (ev) { if (sx === null) return; var dx = ev.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1); });
  }
})();
