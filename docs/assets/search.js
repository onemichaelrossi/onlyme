/* /docs/ho search
   - On a document page: searches that page's sections (h2 and h3) and shows a live pop-up of matches.
   - On the index page: fetches every document listed in .doc-list on first use and searches all of them.
   Keys: "/" or Ctrl/Cmd+K focuses the box; arrows move; Enter opens; Esc closes.
   Arriving with ?q=terms#section highlights the terms in that section. */
(function () {
  'use strict';

  var BLOCK = /^(P|LI|TD|TH|TR|H1|H2|H3|H4|H5|H6|DIV|PRE|FIGCAPTION|BLOCKQUOTE|DT|DD|SECTION|ARTICLE|UL|OL|TABLE|BR)$/;
  var MAX_PER_DOC = 4, MAX_RESULTS = 60;

  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Text of a node with spaces at block boundaries (works on parsed, unrendered documents too).
  function textOf(node) {
    var out = [];
    (function walk(n) {
      if (n.nodeType === 3) { out.push(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'THEAD') return;
      if (n.classList && n.classList.contains('chip')) return;
      var b = BLOCK.test(n.tagName) || (n.tagName === 'SPAN' && /\b(sat|pchip|pattern-title|lvl)\b/.test(n.className));
      if (b) out.push(' ');
      if (n.tagName === 'IMG' && n.alt) out.push(n.alt);
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (b) out.push(' ');
    })(node);
    return out.join('').replace(/\s+/g, ' ').trim();
  }

  // Give h3s stable ids (same result whether run on the live page or on a fetched copy).
  function ensureIds(article) {
    var used = {}, h2 = '';
    Array.prototype.forEach.call(article.querySelectorAll('[id]'), function (e) { used[e.id] = 1; });
    Array.prototype.forEach.call(article.querySelectorAll('h2, h3'), function (h) {
      if (h.tagName === 'H2') { h2 = h.id || ''; return; }
      if (h.id) return;
      var base = (h2 || 's') + '--' + slug(h.textContent).slice(0, 60), id = base, k = 2;
      while (used[id]) id = base + '-' + (k++);
      used[id] = 1; h.id = id;
    });
  }

  // Split an article into sections at each h2/h3.
  function sectionsOf(article) {
    ensureIds(article);
    var secs = [], cur = null, h2title = '';
    for (var n = article.firstElementChild; n; n = n.nextElementSibling) {
      if (n.tagName === 'H2' || n.tagName === 'H3') {
        var t = textOf(n);
        if (n.tagName === 'H2') h2title = t;
        cur = { id: n.id, title: t, parent: n.tagName === 'H3' ? h2title : '', level: n.tagName, text: '', nodes: [n] };
        secs.push(cur);
      } else if (n.classList && n.classList.contains('part')) {
        cur = null; // part dividers are not searchable sections
      } else if (cur) {
        cur.nodes.push(n);
        cur.text += ' ' + textOf(n);
      } else if (!secs.length) {
        cur = { id: '', title: 'Introduction', parent: '', level: 'H2', text: textOf(n), nodes: [n] };
        secs.push(cur);
      }
    }
    secs.forEach(function (s) { s.text = s.text.replace(/\s+/g, ' ').trim(); s.lc = s.text.toLowerCase(); s.tlc = (s.parent + ' ' + s.title).toLowerCase(); });
    return secs;
  }

  // Query: words, or "quoted phrases"; all must match (AND).
  function parse(q) {
    var terms = [], m, re = /"([^"]+)"|(\S+)/g;
    while ((m = re.exec(q))) { var t = (m[1] || m[2]).toLowerCase().trim(); if (t.length > 0) terms.push(t); }
    return terms;
  }

  function count(hay, t) { var n = 0, i = hay.indexOf(t); while (i !== -1) { n++; i = hay.indexOf(t, i + t.length); } return n; }

  function score(sec, terms) {
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var inBody = count(sec.lc, terms[i]), inTitle = count(sec.tlc, terms[i]);
      if (!inBody && !inTitle) return 0;
      total += inBody + inTitle * 8;
    }
    return total;
  }

  function snippet(sec, terms) {
    var lc = sec.lc, first = -1;
    terms.forEach(function (t) { var i = lc.indexOf(t); if (i !== -1 && (first === -1 || i < first)) first = i; });
    var text = sec.text, start = 0, end = Math.min(text.length, 200);
    if (first > 70) { start = text.lastIndexOf(' ', first - 60); if (start < 0) start = first - 60; end = Math.min(text.length, start + 200); }
    var s = text.slice(start, end).trim();
    if (end < text.length) s = s.replace(/\s+\S*$/, '');
    return (start > 0 ? '… ' : '') + mark(s, terms) + (end < text.length ? ' …' : '');
  }

  function mark(s, terms) {
    if (!terms.length) return esc(s);
    var re = new RegExp('(' + terms.slice().sort(function (a, b) { return b.length - a.length; }).map(reEsc).join('|') + ')', 'gi');
    var out = '', last = 0, m;
    while ((m = re.exec(s))) { out += esc(s.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; if (!m[0].length) re.lastIndex++; }
    return out + esc(s.slice(last));
  }

  // ---------- highlighting on the page ----------
  function clearHits() {
    Array.prototype.forEach.call(document.querySelectorAll('mark.hs-hit'), function (m) {
      var p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize();
    });
  }
  function highlight(nodes, terms) {
    clearHits();
    if (!terms.length) return null;
    var re = new RegExp(terms.slice().sort(function (a, b) { return b.length - a.length; }).map(reEsc).join('|'), 'gi');
    var first = null;
    nodes.forEach(function (root) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), list = [], t;
      while ((t = walker.nextNode())) if (t.nodeValue.trim()) list.push(t);
      list.forEach(function (tn) {
        var v = tn.nodeValue, m, last = 0, frag = null;
        re.lastIndex = 0;
        while ((m = re.exec(v))) {
          if (!m[0].length) { re.lastIndex++; continue; }
          frag = frag || document.createDocumentFragment();
          frag.appendChild(document.createTextNode(v.slice(last, m.index)));
          var mk = document.createElement('mark'); mk.className = 'hs-hit'; mk.textContent = m[0];
          frag.appendChild(mk); if (!first) first = mk;
          last = m.index + m[0].length;
        }
        if (frag) { frag.appendChild(document.createTextNode(v.slice(last))); tn.parentNode.replaceChild(frag, tn); }
      });
    });
    return first;
  }

  // ---------- UI ----------
  function buildUI(host, placeholder) {
    var wrap = document.createElement('div');
    wrap.className = 'hs';
    wrap.innerHTML =
      '<label class="hs-box"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/></svg>' +
      '<input type="search" autocomplete="off" spellcheck="false" placeholder="' + esc(placeholder) + '" aria-label="' + esc(placeholder) + '" role="combobox" aria-expanded="false" aria-controls="hs-pop" aria-autocomplete="list">' +
      '<kbd>/</kbd></label>' +
      '<div class="hs-pop" id="hs-pop" role="listbox" hidden></div>';
    host.appendChild(wrap);
    return { wrap: wrap, input: wrap.querySelector('input'), pop: wrap.querySelector('.hs-pop') };
  }

  function wire(ui, run) {
    var sel = -1, timer = null;
    function items() { return ui.pop.querySelectorAll('a.hs-item'); }
    function setSel(i) {
      var it = items(); if (!it.length) { sel = -1; return; }
      sel = (i + it.length) % it.length;
      Array.prototype.forEach.call(it, function (a, k) { a.classList.toggle('on', k === sel); a.setAttribute('aria-selected', k === sel); });
      it[sel].scrollIntoView({ block: 'nearest' });
    }
    function open(html) { ui.pop.innerHTML = html; ui.pop.hidden = false; ui.input.setAttribute('aria-expanded', 'true'); sel = -1; }
    function close() { ui.pop.hidden = true; ui.input.setAttribute('aria-expanded', 'false'); sel = -1; }
    ui.open = open; ui.close = close;
    ui.input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { run(ui.input.value); }, 90); });
    ui.input.addEventListener('focus', function () { if (ui.input.value.trim()) run(ui.input.value); });
    ui.input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (ui.pop.hidden) run(ui.input.value); setSel(sel + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(sel - 1); }
      else if (e.key === 'Enter') { var it = items(); if (it.length) { e.preventDefault(); (it[sel >= 0 ? sel : 0]).click(); } }
      else if (e.key === 'Escape') { if (!ui.pop.hidden) close(); else { ui.input.value = ''; ui.input.blur(); clearHits(); } }
    });
    document.addEventListener('mousedown', function (e) { if (!ui.wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if ((e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag)) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault(); ui.input.focus(); ui.input.select();
      }
    });
  }

  function resultItem(href, title, crumb, snip, extra) {
    return '<a class="hs-item" role="option" href="' + esc(href) + '">' +
      (crumb ? '<span class="hs-crumb">' + crumb + '</span>' : '') +
      '<span class="hs-title">' + title + (extra ? ' <span class="hs-n">' + extra + '</span>' : '') + '</span>' +
      '<span class="hs-snip">' + snip + '</span></a>';
  }

  function empty(q) { return '<p class="hs-empty">No sections match <strong>' + esc(q) + '</strong></p>'; }

  // ---------- document page ----------
  function initDoc(article) {
    var host = document.querySelector('.doc-top');
    if (!host) return;
    var ui = buildUI(host, 'Search this document');
    var secs = sectionsOf(article);

    function run(q) {
      var terms = parse(q);
      if (!terms.length) { ui.close(); return; }
      var hits = secs.map(function (s) { return { s: s, sc: score(s, terms) }; }).filter(function (h) { return h.sc > 0; });
      hits.sort(function (a, b) { return b.sc - a.sc; });
      if (!hits.length) { ui.open(empty(q)); return; }
      var total = hits.length; hits = hits.slice(0, MAX_RESULTS);
      var html = '<p class="hs-head">' + total + ' section' + (total === 1 ? '' : 's') + ' match</p>';
      hits.forEach(function (h) {
        var n = terms.reduce(function (a, t) { return a + count(h.s.lc, t); }, 0);
        html += resultItem('#' + h.s.id, mark(h.s.title, terms), h.s.parent ? esc(h.s.parent) : '', snippet(h.s, terms), n ? n + '×' : '');
      });
      ui.open(html);
      Array.prototype.forEach.call(ui.pop.querySelectorAll('a.hs-item'), function (a, k) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var s = hits[k].s;
          ui.close();
          go(s, terms);
          history.replaceState(null, '', '?q=' + encodeURIComponent(q) + (s.id ? '#' + s.id : ''));
        });
      });
    }

    function go(s, terms) {
      var first = highlight(s.nodes, terms);
      var target = first || s.nodes[0];
      var heading = s.nodes[0];
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (first && first.getBoundingClientRect().top > window.innerHeight * 0.6) {
        setTimeout(function () { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 450);
      }
      heading.classList.remove('hs-flash'); void heading.offsetWidth; heading.classList.add('hs-flash');
    }

    wire(ui, run);

    // Arrived from a search link (index page or a shared URL)
    var q = new URLSearchParams(location.search).get('q');
    if (q) {
      ui.input.value = q;
      var terms = parse(q);
      var id = decodeURIComponent(location.hash.slice(1));
      var s = secs.filter(function (x) { return x.id === id; })[0];
      var nodes = s ? s.nodes : [article];
      var first = highlight(nodes, terms);
      window.addEventListener('load', function () {
        if (s) s.nodes[0].scrollIntoView({ block: 'start' });
        else run(q); // no section given: show this document's matches
      });
    }
  }

  // ---------- index page ----------
  function initIndex(list, allLibs) {
    var host = document.querySelector('.ho-head');
    var ui = buildUI(host, allLibs ? 'Search all libraries' : 'Search all documents');
    var docs = null, loading = null;
    var L = window.DocsLock;

    function load() {
      if (loading) return loading;
      var listP = L ? L.listDocs() : Promise.resolve(Array.prototype.map.call(list.querySelectorAll('a.item'), function (a) {
        return { href: a.getAttribute('href'), title: (a.querySelector('.t') || a).textContent.trim(), n: (a.querySelector('.n') || {}).textContent || '' };
      }));
      var get = L ? L.fetchHtml : function (u) { return fetch(u).then(function (r) { return r.ok ? r.text() : ''; }); };
      loading = listP.then(function (links) { return Promise.all(links.map(function (d) {
        return get(d.href).then(function (txt) {
          var doc = new DOMParser().parseFromString(txt, 'text/html');
          var art = doc.querySelector('article');
          d.secs = art ? sectionsOf(art) : [];
          return d;
        }).catch(function () { d.secs = []; return d; });
      })); }).then(function (all) { docs = all; return all; });
      return loading;
    }

    function run(q) {
      var terms = parse(q);
      if (!terms.length) { ui.close(); return; }
      if (!docs) { ui.open('<p class="hs-empty">Loading documents…</p>'); load().then(function () { if (ui.input.value === q) run(q); }); return; }
      var groups = [], nsec = 0;
      docs.forEach(function (d) {
        var hits = d.secs.map(function (s) { return { s: s, sc: score(s, terms) }; }).filter(function (h) { return h.sc > 0; });
        if (!hits.length) return;
        hits.sort(function (a, b) { return b.sc - a.sc; });
        nsec += hits.length;
        groups.push({ d: d, hits: hits, sc: hits.reduce(function (a, h) { return a + h.sc; }, 0) });
      });
      if (!groups.length) { ui.open(empty(q)); return; }
      groups.sort(function (a, b) { return b.sc - a.sc; });
      var html = '<p class="hs-head">' + nsec + ' section' + (nsec === 1 ? '' : 's') + ' in ' + groups.length + ' document' + (groups.length === 1 ? '' : 's') + '</p>';
      var qs = '?q=' + encodeURIComponent(q);
      groups.forEach(function (g) {
        html += '<div class="hs-doc"><a class="hs-doc-t" href="' + esc(g.d.href + qs) + '">' + (allLibs && g.d.lib ? '<span class="hs-lib">' + esc(g.d.lib) + '</span>' : '') + '<span class="hs-doc-n">' + esc(g.d.n) + '</span> ' + esc(g.d.title) +
          ' <span class="hs-n">' + g.hits.length + ' section' + (g.hits.length === 1 ? '' : 's') + '</span></a>';
        g.hits.slice(0, MAX_PER_DOC).forEach(function (h) {
          html += resultItem(g.d.href + qs + (h.s.id ? '#' + h.s.id : ''), mark(h.s.title, terms), h.s.parent ? esc(h.s.parent) : '', snippet(h.s, terms), '');
        });
        if (g.hits.length > MAX_PER_DOC) {
          html += '<a class="hs-more" href="' + esc(g.d.href + qs) + '">' + (g.hits.length - MAX_PER_DOC) + ' more in this document — search there →</a>';
        }
        html += '</div>';
      });
      ui.open(html);
    }

    ui.input.addEventListener('focus', load, { once: true });
    wire(ui, run);
  }

  function init() {
    var article = document.querySelector('article');
    var list = document.querySelector('.doc-list'), libs = document.querySelector('.lib-list');
    if (article) initDoc(article);
    else if (libs) initIndex(libs, true);
    else if (list) initIndex(list, false);
  }
  function start() {
    var L = window.DocsLock;
    if (L) { if (L.kind === 'page') return; L.ready.then(init); }   // shells: wait until unlocked and rendered
    else init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
