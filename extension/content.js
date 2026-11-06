// DocInsight content script, on Google Docs document pages only. It adds one button near Docs' toolbar; the button opens
// DocInsight's own page as a full-size overlay in an iframe (the extension's page, with its own CSP and DOM). That page
// asks this script, by postMessage, for two things only: the page's request parameters, and fetches of this document's
// own history and text export, which this script makes same-origin with the teacher's own Google session. Any other
// address is refused. Nothing is stored and nothing goes anywhere but docs.google.com.
(function () {
  'use strict';
  if (window.top !== window || window.__docinsightContent) return;
  window.__docinsightContent = true;

  var m = location.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{25,100})(?:\/|$)/);
  if (!m) return;
  var docId = m[1];
  var extOrigin = new URL(chrome.runtime.getURL('')).origin;
  var overlay = null, frame = null, button = null;

  // --- Allowed requests: this document's revisions/tiles, revisions/load and plain-text export, nothing else. ---
  function allowed(url) {
    var u;
    try { u = new URL(url); } catch (e) { return false; }
    if (u.origin !== 'https://docs.google.com') return false;
    var base = '/document/d/' + docId + '/';
    if (u.pathname === base + 'revisions/tiles' || u.pathname === base + 'revisions/load') return true;
    if (u.pathname === base + 'export' && u.searchParams.get('format') === 'txt') return true;
    return false;
  }

  function pageParams() {
    return new Promise(function (resolve) {
      var done = false;
      function on(ev) {
        if (done) return;
        done = true;
        document.removeEventListener('docinsight:params', on);
        var p = {};
        try { p = JSON.parse(ev.detail || '{}'); } catch (e) { p = {}; }
        resolve(p);
      }
      document.addEventListener('docinsight:params', on);
      document.dispatchEvent(new CustomEvent('docinsight:get-params'));
      setTimeout(function () { if (!done) { done = true; document.removeEventListener('docinsight:params', on); resolve({ timeout: true }); } }, 3000);
    });
  }

  function title() {
    var t = document.title || '';
    return t.replace(/\s+-\s+Google Docs\s*$/, '').trim();
  }

  function reply(msg) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, extOrigin);
  }

  window.addEventListener('message', function (ev) {
    if (!frame || ev.source !== frame.contentWindow || ev.origin !== extOrigin) return;
    var msg = ev.data;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    if (msg.type === 'docinsight:hello') {
      pageParams().then(function (p) {
        reply({
          type: 'docinsight:context', id: msg.id, docId: docId, title: title(), href: location.origin + location.pathname,
          office: /[?&]rtpof=true/.test(location.search), params: p,
        });
      });
    } else if (msg.type === 'docinsight:fetch') {
      if (!allowed(msg.url)) { reply({ type: 'docinsight:fetched', id: msg.id, error: 'refused' }); return; }
      fetch(msg.url, { credentials: 'include', headers: { 'x-same-domain': '1' }, cache: 'no-store' })
        .then(function (r) { return r.text().then(function (text) { reply({ type: 'docinsight:fetched', id: msg.id, status: r.status, text: text }); }); })
        .catch(function (e) { reply({ type: 'docinsight:fetched', id: msg.id, error: String(e && e.message || e) }); });
    } else if (msg.type === 'docinsight:close') {
      close();
    }
  });

  function open(page) {
    if (overlay) { overlay.hidden = false; frame.focus(); return; }
    overlay = document.createElement('div');
    overlay.setAttribute('data-docinsight', 'overlay');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(20,24,40,.45);display:flex;padding:12px;box-sizing:border-box;';
    frame = document.createElement('iframe');
    frame.src = chrome.runtime.getURL('extension/' + (page || 'overlay') + '.html') + '#doc=' + encodeURIComponent(docId);
    frame.title = 'DocInsight';
    frame.allow = 'clipboard-write';
    frame.style.cssText = 'flex:1;border:0;border-radius:10px;background:#fff;box-shadow:0 10px 40px rgba(0,0,0,.35);';
    overlay.appendChild(frame);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.documentElement.appendChild(overlay);
    frame.focus();
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    frame = null;
    if (button) button.focus();
  }

  document.addEventListener('keydown', function (e) {
    if (overlay && e.key === 'Escape') { e.preventDefault(); close(); }
  }, true);

  // --- The button: in Docs' title bar when we can find it, else floating in the corner. ---
  function makeButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'DocInsight';
    b.title = 'See how this document was written (DocInsight)';
    b.setAttribute('data-docinsight', 'button');
    b.style.cssText = 'font:500 14px/1 "Google Sans",Roboto,Arial,sans-serif;color:#fff;background:#3b4fa0;border:0;border-radius:18px;padding:10px 16px;margin:0 8px;cursor:pointer;';
    b.addEventListener('click', function () { open('overlay'); });
    return b;
  }

  function place() {
    if (button && document.contains(button)) return true;
    button = button || makeButton();
    var host = document.querySelector('.docs-titlebar-buttons') || document.querySelector('#docs-titlebar-share-client-button');
    if (host) {
      if (host.id === 'docs-titlebar-share-client-button') host.parentNode.insertBefore(button, host);
      else host.insertBefore(button, host.firstChild);
      button.style.position = '';
      return true;
    }
    return false;
  }

  if (!place()) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (place() || tries > 20) {
        clearInterval(timer);
        if (!document.contains(button)) {
          button.style.position = 'fixed';
          button.style.left = '16px';
          button.style.bottom = '16px';
          button.style.zIndex = '2147482000';
          document.documentElement.appendChild(button);
        }
      }
    }, 500);
  }
})();
