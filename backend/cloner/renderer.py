import hashlib
import time

from .template import CLONE_USER_AGENT, MAX_HTML_SIZE, sanitize_html

try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

STABILITY_POLL_MS = 800
STABILITY_ROUNDS = 5
STABILITY_BUDGET_S = 35

# Sites like X.com bot-wall headless Chromium based on the Sec-CH-UA client
# hint leaking "HeadlessChrome". Pin real browser hints so we pass. The dark
# color-scheme bits make Instagram/other themed sites SSR their dark variant
# so the clone matches what a real dark-mode browser produces.
AUTH_HEADERS = {
    "Sec-CH-UA": '"Not/A)Brand";v="99", "Chromium";v="152", "Google Chrome";v="152"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-CH-Prefers-Color-Scheme": "dark",
    "sec-ch-prefers-color-scheme": "dark",
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

SNAPSHOT_JS = """
(() => {
    const d = document.documentElement;
    const html = d ? d.outerHTML : '';
    const body = document.body;
    const text = body && body.innerText ? body.innerText.trim().length : 0;
    const interactive = document.querySelectorAll(
        'input, textarea, select, button, form, [role="dialog"], [role="form"]'
    ).length;
    const imgs = document.querySelectorAll('img').length;
    return {
        len: html.length,
        text: text,
        interactive: interactive,
        imgs: imgs,
    };
})()
"""


def _signature(snap) -> str:
    return hashlib.sha1(
        f"{snap['len']}|{snap['text']}|{snap['interactive']}".encode()
    ).hexdigest()


def _looks_empty(snap) -> bool:
    return snap["len"] < 200 or (
        snap["text"] < 40 and snap["interactive"] < 2
    )


async def render_with_playwright(
    url: str,
    checkpoints: bool = False,
    preserve_scripts: bool = False,
):
    """
    Render in headless Chromium, WAITING until the DOM settles (React/Angular
    hydration, lazy modules) before snapshotting. Returns sanitized HTML of
    the FINAL state, or None if rendering is unavailable / produced nothing.

    preserve_scripts=True: keep the render even when its form is hidden by JS
    at snapshot time (the preserved bundle self-heals on the served clone), so
    the "invisible form" quality gate is bypassed.
    """

    if not PLAYWRIGHT_AVAILABLE:
        return None

    started = time.time()
    ck = []
    MAX_RETRIES = 1

    for attempt in range(MAX_RETRIES + 1):
        try:
            html = await _render_once(
                url,
                started,
                ck if attempt == 0 else [],
                checkpoints and attempt == 0,
                preserve_scripts,
            )
            if html:
                return html
            if attempt < MAX_RETRIES:
                started = time.time()
                continue
        except Exception:
            if attempt < MAX_RETRIES:
                started = time.time()
                continue
            return None

    return None


async def _render_once(url, started, ck, checkpoints, preserve_scripts=False):

    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage",
                    "--disable-background-timer-throttling",
                    "--disable-backgrounding-occluded-windows",
                    "--disable-renderer-backgrounding",
                ],
            )

            try:
                context = await browser.new_context(
                    user_agent=CLONE_USER_AGENT,
                    viewport={"width": 1440, "height": 900},
                    device_scale_factor=1,
                    locale="en-US",
                    color_scheme="dark",
                    extra_http_headers=AUTH_HEADERS,
                )

                # Mask common automation signals.
                await context.add_init_script(
                    """
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    window.chrome = window.chrome || { runtime: {} };
                    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                    const origQuery = window.navigator.permissions && navigator.permissions.query;
                    if (origQuery) {
                        navigator.permissions.query = (p) =>
                            p && p.name === 'notifications'
                                ? Promise.resolve({ state: Notification.permission })
                                : origQuery(p);
                    }
                    """
                )

                page = await context.new_page()
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)

                try:
                    await page.wait_for_load_state("networkidle", timeout=20000)
                except Exception:
                    pass

                def snapshot():
                    return page.evaluate(SNAPSHOT_JS)

                def content_ready():
                    return page.evaluate(
                        """
                        (() => {
                            const b = document.body;
                            if (!b) return false;
                            const text = (b.innerText || '').trim().length;
                            if (text >= 25) return true;
                            const hasVisibleInputs = Array.from(
                                document.querySelectorAll('input, textarea, select')
                            ).some(el => {
                                if (el.offsetParent === null || getComputedStyle(el).display === 'none') return false;
                                const r = el.getBoundingClientRect();
                                return r.width >= 50 && r.height >= 8;
                            });
                            if (hasVisibleInputs) return true;
                            const hasVisibleCtls = Array.from(
                                document.querySelectorAll('button, [role="button"], a, form')
                            ).some(el => {
                                if (el.offsetParent === null || getComputedStyle(el).display === 'none') return false;
                                const r = el.getBoundingClientRect();
                                return r.width >= 50 && r.height >= 8;
                            });
                            return text >= 8 && hasVisibleCtls;
                        })()
                        """
                    )

                # Full-screen boot overlays (Instagram's logo splash) cover the
                # page until JS removes them. Snapshot only once they're gone.
                def has_splash_overlay():
                    return page.evaluate(
                        """
                        (() => {
                            const vw = window.innerWidth;
                            const vh = window.innerHeight;
                            return Array.from(document.querySelectorAll('body > div, body > style'))
                                .some(el => {
                                    if (el.tagName === 'STYLE') {
                                        return /splash|loading|loader/i.test(el.textContent || '');
                                    }
                                    const cs = getComputedStyle(el);
                                    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
                                    const r = el.getBoundingClientRect();
                                    if (r.width < vw * 0.8 || r.height < vh * 0.6) return false;
                                    const z = parseInt(cs.zIndex, 10) || 0;
                                    if (z < 50) return false;
                                    const id = el.id || '';
                                    const cls = String(el.className || '');
                                    if (/splash|loading|loader|boot|preload/i.test(id + ' ' + cls)) return true;
                                    const img = el.querySelector('img');
                                    if (img && img.getBoundingClientRect().height >= 40) return true;
                                    return /splash|loading|loader|please wait/i.test((el.innerText || '').trim());
                                });
                        })()
                        """
                    )

                # Load lazy content by scrolling, then settle again.
                try:
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await page.wait_for_timeout(1200)
                    await page.evaluate("window.scrollTo(0, 0)")
                except Exception:
                    pass

                # ---- wait for CONTENT to become visible, then stability ----
                # (SPAs like Instagram hide their login UI behind a loading
                # splash; snapping during that lull yields an empty shell.)
                prev_sig = None
                stable_count = 0
                last_snap = None
                was_ready = False
                loop_deadline = started + STABILITY_BUDGET_S

                while time.time() < loop_deadline:
                    snap = await snapshot()
                    last_snap = snap
                    sig = _signature(snap)
                    try:
                        ready = await content_ready()
                    except Exception:
                        ready = was_ready
                    try:
                        covered = await has_splash_overlay()
                    except Exception:
                        covered = False
                    if ready and covered:
                        ready = False
                    was_ready = ready
                    if checkpoints:
                        ck.append(
                            (round(time.time() - started, 1), sig[:8], snap["len"], snap["text"], snap["interactive"], ready)
                        )
                    if not ready:
                        # Full-clone mode: JS-hidden forms never report "ready",
                        # but they DO settle. Count stability so we don't burn
                        # the whole budget on a page that will self-heal later.
                        if not preserve_scripts:
                            stable_count = 0
                            prev_sig = sig
                            await page.wait_for_timeout(STABILITY_POLL_MS)
                            continue
                    if sig == prev_sig:
                        stable_count += 1
                        if stable_count >= STABILITY_ROUNDS:
                            break
                    else:
                        stable_count = 1
                        prev_sig = sig
                    await page.wait_for_timeout(STABILITY_POLL_MS)

                # If we never reached "ready", give the static shell one more
                # chance after reload (some bot-walls serve an empty first doc).
                if last_snap and not was_ready and _looks_empty(last_snap):
                    try:
                        await page.reload(wait_until="domcontentloaded", timeout=30000)
                        await page.wait_for_load_state("networkidle", timeout=15000)
                        for _ in range(6):
                            await page.wait_for_timeout(1500)
                            last_snap = await snapshot()
                            if not _looks_empty(last_snap):
                                break
                    except Exception:
                        pass

                if last_snap is None:
                    last_snap = await snapshot()

                if checkpoints:
                    ck.append(("final", "", last_snap["len"], last_snap["text"], last_snap["interactive"]))

                if _looks_empty(last_snap):
                    if checkpoints:
                        print("RENDER_EMPTY", ck)
                    return None

                # Final stabilization pass after any scrolling/reload.
                try:
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await page.wait_for_timeout(1200)
                    await page.evaluate("window.scrollTo(0, 0)")
                    await page.wait_for_timeout(800)
                except Exception:
                    pass

                try:
                    await page.evaluate(
                        """async () => {
                            const imgs = Array.from(document.images).filter(i => !i.complete);
                            await Promise.all(imgs.map(i => i.decode().catch(() => {})));
                        }"""
                    )
                except Exception:
                    pass

                html = last_snap and await page.evaluate(
                    "document.documentElement.outerHTML"
                )

                if (
                    not html
                    or len(html) > MAX_HTML_SIZE
                    or (len(html) < 200)
                ):
                    if checkpoints:
                        print("RENDER_EMPTY2", len(html) if html else 0)
                    return None

                # Quality gate: if the page contains a form/inputs but NOTHING
                # is actually visible (some SPAs serve a JS-toggled shell where
                # the form stays display:none without their bundle), this render
                # is useless for a static clone -> fall back to static fetch.
                # Skipped in full-clone mode: the preserved JS reveals the form
                # when the clone is served.
                try:
                    has_form = await page.evaluate("!!document.querySelector('form')")
                    has_visible = await page.evaluate(
                        """
                        (() => {
                            const text = (document.body.innerText || '').trim().length;
                            if (text >= 25) return true;
                            return Array.from(document.querySelectorAll('input, textarea, select'))
                                .some(el => {
                                    if (el.offsetParent === null || getComputedStyle(el).display === 'none') return false;
                                    const r = el.getBoundingClientRect();
                                    return r.width >= 50 && r.height >= 8;
                                });
                        })()
                        """
                    )
                except Exception:
                    has_form, has_visible = False, True
                if has_form and not has_visible and not preserve_scripts:
                    if checkpoints:
                        print("RENDER_INVISIBLE_FORM (falling back to static)")
                    return None

                if checkpoints:
                    print("RENDER_OK", html[:120].replace("\\n", " ")[:120])
                return sanitize_html(html)

            finally:
                try:
                    await browser.close()
                except Exception:
                    pass

    except Exception:
        return None