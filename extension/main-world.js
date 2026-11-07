// DocInsight: the only script that runs in the Docs page's own world. Docs keeps the request token its history endpoints
// need in `_docs_flag_initialData.info_params`; this script hands that (and nothing else from the page) to DocInsight's
// content script when it asks, through a DOM event. It reads; it changes nothing on the page.
(function () {
  'use strict';
  if (window.__docinsightMain) return;
  window.__docinsightMain = true;
  document.addEventListener('docinsight:get-params', function () {
    var out = { token: '', ouid: '', infoKeys: [], idCandidates: [], hasInitialData: false };
    try {
      var d = window._docs_flag_initialData;
      if (d && typeof d === 'object') {
        out.hasInitialData = true;
        var ip = d.info_params || {};
        out.token = typeof ip.token === 'string' ? ip.token : '';
        out.ouid = typeof ip.ouid === 'string' ? ip.ouid : '';
        // Names only, for the diagnostics page: which fields Docs exposes, never their values.
        out.infoKeys = Object.keys(ip).slice(0, 40);
        // Values that look like a Google account id (15 to 25 digits), with their keys: the content script keeps only
        // the one that matches an author of the document, to recognise the teacher's own edits.
        out.idCandidates = [];
        var scan = function (obj, prefix) {
          for (var k in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
            var v = obj[k];
            if ((typeof v === 'string' || typeof v === 'number') && /^\d{15,25}$/.test(String(v))) out.idCandidates.push({ key: prefix + k, value: String(v) });
            if (out.idCandidates.length > 30) return;
          }
        };
        scan(d, '');
        scan(ip, 'info_params.');
      }
    } catch (e) { /* the page changed; the content script reports it */ }
    document.dispatchEvent(new CustomEvent('docinsight:params', { detail: JSON.stringify(out) }));
  });
})();
