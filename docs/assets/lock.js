/* docs-lock: client side of the encrypted /docs area.
   Pages are shells holding an encrypted payload; one password unlocks the site key (docs/lock.json)
   and everything is decrypted in the browser. See docs_lock.py for the scheme.
   html[data-lock] = landing | library | page (shells) | decrypted (a page after unlocking). */
(function () {
  'use strict';
  var me = document.currentScript;
  var ROOT = new URL('../', me.src).href;                 // .../docs/
  var KIND = document.documentElement.getAttribute('data-lock') || '';
  var te = new TextEncoder(), td = new TextDecoder();
  var INFO = te.encode('docs-lock v1');
  var EC = { name: 'ECDH', namedCurve: 'P-256' };
  var lockCfg = null, priv = null, cache = {};

  function ub64(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64(u) { var s = ''; u = new Uint8Array(u); for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function store(remember) { try { return remember ? localStorage : sessionStorage; } catch (e) { return null; } }
  function slot() { return 'docslock:' + lockCfg.pub.slice(0, 24); }

  function getLock() {
    if (lockCfg) return Promise.resolve(lockCfg);
    return fetch(ROOT + 'lock.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('lock.json missing');
      return r.json();
    }).then(function (j) { lockCfg = j; return j; });
  }

  function importPriv(pk8) { return crypto.subtle.importKey('pkcs8', pk8, EC, false, ['deriveBits']); }

  function keyFromStorage() {
    var s = null;
    [sessionStorage, localStorage].some(function (st) { try { s = st.getItem(slot()); } catch (e) {} return !!s; });
    if (!s) return Promise.resolve(null);
    return importPriv(ub64(s)).catch(function () { return null; });
  }

  function unlockWith(pw, remember) {
    var k = lockCfg.kdf;
    return crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: ub64(k.salt), iterations: k.iter }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    }).then(function (wk) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(lockCfg.priv.iv) }, wk, ub64(lockCfg.priv.ct));
    }).then(function (pk8) {
      var st = store(remember); if (st) try { st.setItem(slot(), b64(pk8)); } catch (e) {}
      return importPriv(pk8);
    });
  }

  function decBytes(buf) {
    var u = new Uint8Array(buf);
    if (u[0] !== 1) return Promise.reject(new Error('unknown format'));
    var eph = u.slice(1, 66), iv = u.slice(66, 78), ct = u.slice(78);
    return crypto.subtle.importKey('raw', eph, EC, false, []).then(function (ek) {
      return crypto.subtle.deriveBits({ name: 'ECDH', public: ek }, priv, 256);
    }).then(function (bits) {
      return crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    }).then(function (hk) {
      return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: eph, info: INFO }, hk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    }).then(function (aes) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, aes, ct); });
  }
  function decText(s) { return decBytes(ub64(s.trim())).then(function (b) { return td.decode(b); }); }
  function decJSON(s) { return decText(s).then(JSON.parse); }

  // Fetch a page and return its decrypted HTML (shell pages carry the payload inline).
  function fetchHtml(url) {
    if (cache[url]) return cache[url];
    cache[url] = fetch(url).then(function (r) { return r.text(); }).then(function (t) {
      var m = t.match(/<script type="application\/octet-stream" id="enc">([^<]+)<\/script>/);
      return m ? decText(m[1]) : t;
    });
    return cache[url];
  }

  function getJSON(url) { return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); }); }

  // Library and document lists
  var libsP = null;
  function libraries() {
    if (!libsP) libsP = getJSON(ROOT + 'catalog.json').then(function (cat) {
      return Promise.all(cat.libraries.map(function (l) {
        return Promise.all([decJSON(l.card), getJSON(ROOT + l.dir + '/catalog.json')]).then(function (r) {
          return Promise.all(r[1].docs.map(function (d) {
            return decJSON(d.card).then(function (c) { c.href = ROOT + l.dir + '/' + d.href; c.lib = r[0].name; return c; });
          })).then(function (docs) {
            docs.sort(function (a, b) { return (parseInt(a.n, 10) || 0) - (parseInt(b.n, 10) || 0); });
            return { dir: l.dir, card: r[0], docs: docs, href: ROOT + l.dir + '/' };
          });
        });
      }));
    });
    return libsP;
  }
  function currentLibDir() { var rel = location.href.slice(ROOT.length); return rel.split('/')[0]; }
  function listDocs() {
    return libraries().then(function (libs) {
      if (KIND === 'library') libs = libs.filter(function (l) { return l.dir === currentLibDir(); });
      return [].concat.apply([], libs.map(function (l) { return l.docs; }));
    });
  }

  // ---------- UI ----------
  function lockButton() {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'lock-btn'; b.title = 'Lock: forget the password on this device';
    b.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg><span>Lock</span>';
    b.addEventListener('click', function () { DocsLock.lock(); });
    return b;
  }

  function showForm(root) {
    return new Promise(function (resolve) {
      root.innerHTML =
        '<div class="lock-card">' +
        '<p class="lock-kicker">michaelrossi.org</p><h1>Documents</h1>' +
        '<p class="lock-lead">This area is private. Enter the password to continue.</p>' +
        '<form class="lock-form" autocomplete="on">' +
        '<input type="text" name="username" value="documents" autocomplete="username" hidden>' +
        '<label class="lock-label" for="lock-pw">Password</label>' +
        '<input id="lock-pw" type="password" name="password" autocomplete="current-password" required autofocus>' +
        '<label class="lock-remember"><input type="checkbox" id="lock-rem"> Remember on this device</label>' +
        '<button type="submit" class="lock-go">Unlock</button>' +
        '<p class="lock-err" role="alert" aria-live="polite"></p>' +
        '</form></div>';
      var f = root.querySelector('form'), pw = root.querySelector('#lock-pw'), err = root.querySelector('.lock-err'), btn = root.querySelector('.lock-go');
      pw.focus();
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        btn.disabled = true; btn.textContent = 'Unlocking…'; err.textContent = '';
        unlockWith(pw.value, root.querySelector('#lock-rem').checked).then(function (k) {
          resolve(k);
        }).catch(function () {
          btn.disabled = false; btn.textContent = 'Unlock';
          err.textContent = 'That password didn’t work.'; pw.select();
        });
      });
    });
  }

  function assetVersions(html) {
    // keep decrypted pages on the shell's current asset versions
    ['docs.css', 'search.js', 'lock.js'].forEach(function (f) {
      var el = document.querySelector('[href*="assets/' + f + '"],[src*="assets/' + f + '"]');
      var v = el && (el.getAttribute('href') || el.getAttribute('src')).match(/\?v=([\w.]+)/);
      if (v) html = html.replace(new RegExp('assets/' + f.replace('.', '\\.') + '\\?v=[\\w.]+', 'g'), 'assets/' + f + '?v=' + v[1]);
    });
    return html;
  }

  function renderPage() {
    var p = document.getElementById('enc');
    return decText(p.textContent).then(function (html) {
      html = assetVersions(html);
      document.open(); document.write(html); document.close();
    });
  }

  function renderLibrary(root) {
    return libraries().then(function (libs) {
      var lib = libs.filter(function (l) { return l.dir === currentLibDir(); })[0];
      if (!lib) { root.innerHTML = '<p class="lock-lead">Library not found. <a href="../">All libraries</a></p>'; return; }
      document.title = lib.card.title;
      var n = lib.docs.length;
      root.innerHTML = '<header class="ho-head"><div class="lock-bar"><a class="crumb" href="../">&larr; All libraries</a></div>' +
        '<h1>' + esc(lib.card.title) + '</h1><p>' + n + ' document' + (n === 1 ? '' : 's') + ' · each also available as the original PDF</p></header>' +
        '<ul class="doc-list">' + lib.docs.map(function (d) {
          return '<li><a class="item" href="' + esc(d.href) + '"><span class="n">' + esc(d.n) + '</span><span class="t">' + esc(d.title) +
            '</span><span class="p">' + esc(d.pp) + '</span><span class="s">' + esc(d.sub) + '</span></a></li>';
        }).join('') + '</ul>';
      root.querySelector('.lock-bar').appendChild(lockButton());
    });
  }

  function renderLanding(root) {
    return libraries().then(function (libs) {
      var total = libs.reduce(function (a, l) { return a + l.docs.length; }, 0);
      root.innerHTML = '<header class="ho-head"><div class="lock-bar"><a class="crumb" href="../">&larr; michaelrossi.org</a></div>' +
        '<h1>Documents</h1><p>' + libs.length + ' librar' + (libs.length === 1 ? 'y' : 'ies') + ' · ' + total + ' documents · search covers them all</p></header>' +
        '<ul class="lib-list">' + libs.map(function (l) {
          var n = l.docs.length;
          return '<li><a class="lib" href="' + esc(l.href) + '"><span class="lib-name">' + esc(l.card.name) + '</span>' +
            '<span class="lib-title">' + esc(l.card.title) + '</span>' +
            (l.card.blurb ? '<span class="lib-blurb">' + esc(l.card.blurb) + '</span>' : '') +
            '<span class="lib-count">' + n + ' document' + (n === 1 ? '' : 's') + ' &rarr;</span></a></li>';
        }).join('') + '</ul>';
      root.querySelector('.lock-bar').appendChild(lockButton());
    });
  }

  // decrypted page: encrypted figures, PDF downloads, hash scrolling, lock button
  function enhanceDecrypted() {
    Array.prototype.forEach.call(document.querySelectorAll('img[data-enc-src]'), function (img) {
      fetch(img.getAttribute('data-enc-src')).then(function (r) { return r.arrayBuffer(); }).then(decBytes).then(function (b) {
        img.src = URL.createObjectURL(new Blob([b], { type: 'image/png' }));
      }).catch(function () { img.alt = '[figure could not be decrypted] ' + img.alt; });
    });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href$=".pdf"]');
      if (!a || /^https?:/.test(a.getAttribute('href'))) return;
      e.preventDefault();
      var name = a.getAttribute('href').split('/').pop();
      var w = window.open('', '_blank');
      if (w) w.document.write('<p style="font:15px system-ui;padding:24px">Decrypting ' + esc(name) + '…</p>');
      fetch(a.getAttribute('href') + '.enc').then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(decBytes).then(function (b) {
        var url = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }));
        if (w) w.location.href = url;
        else { var d = document.createElement('a'); d.href = url; d.download = name; document.body.appendChild(d); d.click(); d.remove(); }
      }).catch(function () { if (w) w.document.body.innerHTML = '<p style="font:15px system-ui;padding:24px">Sorry, the PDF could not be decrypted.</p>'; });
    });
    var top = document.querySelector('.doc-top');
    if (top) top.appendChild(lockButton());
    if (location.hash && !/[?&]q=/.test(location.search)) {
      var go = function () { var t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView(); };
      if (document.readyState === 'complete') setTimeout(go, 0); else window.addEventListener('load', go);
    }
  }

  var readyResolve;
  var DocsLock = window.DocsLock = {
    kind: KIND,
    ready: new Promise(function (r) { readyResolve = r; }),
    listDocs: listDocs,
    fetchHtml: fetchHtml,
    lock: function () {
      try { sessionStorage.removeItem(slot()); localStorage.removeItem(slot()); } catch (e) {}
      location.reload();
    }
  };

  function boot() {
    var root = document.getElementById('lock-root');
    if (!window.crypto || !crypto.subtle) {
      if (root) root.innerHTML = '<p class="lock-lead">This browser can’t decrypt these pages (it needs a secure https connection and a modern browser).</p>';
      return;
    }
    getLock().then(keyFromStorage).then(function (k) {
      if (k) return k;
      if (KIND === 'decrypted') { location.reload(); return new Promise(function () {}); }
      document.documentElement.classList.add('is-locked');
      return showForm(root);
    }).then(function (k) {
      priv = k;
      document.documentElement.classList.remove('is-locked');
      if (KIND === 'page') return renderPage();                  // replaces this document
      if (KIND === 'decrypted') { enhanceDecrypted(); readyResolve(); return; }
      var r = KIND === 'library' ? renderLibrary(root) : renderLanding(root);
      return r.then(function () { readyResolve(); });
    }).catch(function (e) {
      if (root) root.innerHTML = '<p class="lock-lead">Sorry, something went wrong opening this page (' + esc(e && e.message || e) + ').</p>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
