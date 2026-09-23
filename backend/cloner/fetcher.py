import re

from bs4 import BeautifulSoup
import httpx

from .template import (
    CLONE_USER_AGENT,
    MAX_HTML_SIZE,
    sanitize_html,
    looks_like_html,
)

try:
    import brotli  # noqa: F401  (optional; fixes Content-Encoding: br)
    BROTLI_AVAILABLE = True
except ImportError:
    BROTLI_AVAILABLE = False


class FetchError(Exception):
    def __init__(self, message: str, status_hint: int = 400):
        super().__init__(message)
        self.status_hint = status_hint


async def fetch_html(url: str) -> str:
    """
    Fetch raw HTML with a modern browser User-Agent and sane limits.
    httpx auto-decompresses gzip/deflate (and brotli when the optional
    'brotli' package is installed) — do NOT set Accept-Encoding manually.
    """

    headers = {
        "User-Agent": CLONE_USER_AGENT,
        "Sec-CH-UA": '"Not/A)Brand";v="99", "Chromium";v="152", "Google Chrome";v="152"',
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": '"Windows"',
        "Sec-CH-Prefers-Color-Scheme": "dark",
        "sec-ch-prefers-color-scheme": "dark",
        "Accept": (
            "text/html,application/xhtml+xml,"
            "application/xml;q=0.9,image/avif,image/webp,"
            "image/apng,*/*;q=0.8"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }

    try:
        has_h2 = True
        try:
            import h2  # optional
        except ImportError:
            has_h2 = False

        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            max_redirects=15,
            verify=True,
            http2=has_h2,
        ) as client:
            response = await client.get(url, headers=headers)

    except httpx.TimeoutException:
        raise FetchError("The website took too long to respond.", 408)
    except httpx.RequestError as exc:
        raise FetchError(f"Could not fetch the URL: {exc}")

    if response.status_code >= 400:
        raise FetchError(f"The website returned HTTP {response.status_code}.")

    content_type = response.headers.get("content-type", "").lower()

    if not (
        "text/html" in content_type
        or "application/xhtml+xml" in content_type
    ):
        raise FetchError(
            f"The URL did not return an HTML document. Content-Type: {content_type or 'unknown'}",
        )

    if len(response.content) > MAX_HTML_SIZE:
        raise FetchError(
            "The HTML document is too large. Maximum allowed size is 10 MB.",
            413,
        )

    html = _decode_html(response.content, response.charset_encoding)

    html = sanitize_html(html)

    if not looks_like_html(html):
        raise FetchError(
            "The server responded successfully, but the response does not appear to contain normal HTML.",
        )

    return html


# Detect <meta charset=...> to handle pages whose HTTP header omits the charset
_META_CHARSET_RE = re.compile(
    rb"<meta[^>]+charset\s*=\s*['\"]?\s*([A-Za-z0-9_\-]+)", re.IGNORECASE
)


def _decode_html(content: bytes, header_charset: str | None) -> str:
    """
    Decode fetched bytes to text, trying (in order):
      1. HTTP header charset
      2. BOM
      3. <meta charset> declaration
      4. UTF-8
      5. Windows-1252 / Latin-1 (superset — never raises)
    Prefer strict UTF-8 over lossy replacements when the bytes are valid UTF-8.
    """

    candidates = []

    if header_charset:
        candidates.append(header_charset)

    if content.startswith(b"\xef\xbb\xbf"):
        candidates.append("utf-8-sig")

    bom = content[:4]
    if bom.startswith(b"\x00\x00\xfe\xff") or bom.startswith(b"\xff\xfe\x00\x00"):
        candidates.append("utf-32")
    elif bom[:2] == b"\xff\xfe":
        candidates.append("utf-16")
    elif bom[:2] == b"\xfe\xff":
        candidates.append("utf-16-be")

    meta = _META_CHARSET_RE.search(content)
    if meta:
        candidates.append(meta.group(1).decode("ascii", errors="ignore"))

    candidates.append("utf-8")

    seen = set()
    for enc in candidates:
        enc = (enc or "").strip()
        if not enc or enc.lower() in seen:
            continue
        seen.add(enc.lower())
        try:
            return content.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue

    # cp1252 (Windows-1252) never raises — final fallback.
    return content.decode("cp1252", errors="replace")


def looks_like_spa_shell(html: str) -> bool:
    """
    Heuristic: does this HTML look like a JS-rendered app shell
    (little real content, heavy on scripts, root mount div) —
    i.e. a page we should render with a real browser?
    """

    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        return False

    body = soup.find("body")
    text = body.get_text(" ", strip=True) if body else ""

    scripts = soup.find_all("script", src=True)
    inline_scripts = soup.find_all("script")
    mount_nodes = soup.select(
        "#root, #__next, #app, #app-root, #appMountPoint, #__nuxt, [data-reactroot]"
    )

    if len(inline_scripts) == 0 and not mount_nodes:
        return False

    if mount_nodes and len(text) < 300 and scripts:
        return True

    if len(scripts) >= 3 and len(text) < 400:
        return True

    if not text and scripts:
        return True

    return False