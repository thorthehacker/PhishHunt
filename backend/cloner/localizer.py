import asyncio
import hashlib
import re

from urllib.parse import urljoin, urlparse, unquote

from bs4 import BeautifulSoup
import httpx

from .template import CLONE_ASSETS_DIR, CLONE_USER_AGENT, is_absolute, is_data_or_blob, sanitize_html

URL_RE = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE | re.DOTALL)
IMPORT_RE = re.compile(r"@import\s+(['\"])([^'\"]+)\1", re.IGNORECASE)

from dataclasses import dataclass, field

MAX_ASSET_BYTES = 15 * 1024 * 1024
MAX_ASSET_COUNT = 250
MAX_CSS_DEPTH = 4
MAX_CSS_ASSETS = 200


@dataclass
class LocalizeResult:
    html: str
    asset_count: int = 0
    failures: list = field(default_factory=list)

RENDER_TAG_ATTRS = {
    "img":    ["src", "srcset"],
    "video":  ["src", "poster"],
    "audio":  ["src"],
    "source": ["src", "srcset"],
    "input":  ["src"],
}

MIME_EXT = {
    "text/css": ".css",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
    "font/woff": ".woff",
    "font/woff2": ".woff2",
    "application/font-woff": ".woff",
    "application/x-font-woff": ".woff",
    "application/font-woff2": ".woff2",
    "font/ttf": ".ttf",
    "application/x-font-ttf": ".ttf",
    "font/otf": ".otf",
    "application/vnd.ms-fontobject": ".eot",
}


def _resolve_url(base_url: str, val: str):
    if not val:
        return None
    if is_data_or_blob(val):
        return None
    if not is_absolute(val):
        val = urljoin(base_url, val)
    parsed = urlparse(val)
    if parsed.scheme not in ("http", "https"):
        return None
    if len(val) > 2000:
        return None
    return val


def _iter_srcset(val):
    for item in val.split(","):
        parts = item.strip().split()
        if parts:
            yield parts[0]


def _collect_asset_urls(soup, base_url):
    urls = set()

    def add(u):
        resolved = _resolve_url(base_url, u)
        if resolved:
            urls.add(resolved)

    for tag_name, attrs in RENDER_TAG_ATTRS.items():
        for tag in soup.find_all(tag_name):
            for attr in attrs:
                val = tag.get(attr)
                if not val:
                    continue
                if attr == "srcset":
                    for src in _iter_srcset(val):
                        add(src)
                else:
                    add(val)

    for tag in soup.find_all("link", href=True):
        rel = tag.get("rel") or []
        if isinstance(rel, str):
            rel = [rel]
        rel = [str(r).lower() for r in rel]
        as_val = str(tag.get("as") or "").lower()
        if (
            "stylesheet" in rel
            or "icon" in rel
            or as_val in ("image", "font", "style")
        ):
            add(tag["href"])
            for src in _iter_srcset(tag.get("imagesrcset") or ""):
                add(src)

    for style in soup.find_all("style"):
        text = style.string or ""
        for m in URL_RE.finditer(text):
            add(unquote(m.group(2).strip()))
        for m in IMPORT_RE.finditer(text):
            add(m.group(2).strip())

    for tag in soup.find_all(style=True):
        for m in URL_RE.finditer(tag["style"]):
            add(unquote(m.group(2).strip()))

    return urls


def _ext_for(url: str, content_type: str) -> str:
    ctype = content_type.split(";")[0].strip().lower()
    if ctype in MIME_EXT:
        return MIME_EXT[ctype]
    path = urlparse(url).path
    match = re.search(r"\.([A-Za-z0-9]{1,6})$", path)
    return match.group(0) if match else ".bin"


async def _download_asset(asset_dir, url, sem, client):
    async with sem:
        try:
            response = await client.get(
                url,
                headers={
                    "User-Agent": CLONE_USER_AGENT,
                    "Referer": url,
                },
            )
        except Exception:
            return None

        if response.status_code >= 400:
            return None

        content_length = response.headers.get("content-length")
        if content_length and int(content_length) > MAX_ASSET_BYTES:
            return None

        data = response.content
        if not data or len(data) > MAX_ASSET_BYTES:
            return None

        content_type = response.headers.get("content-type", "")
        ext = _ext_for(url, content_type)
        name = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16] + ext

        try:
            (asset_dir / name).write_bytes(data)
            return name
        except Exception:
            return None


def _clean_css(text):
    try:
        text = re.sub(r"/\*.*?\*/", " ", text, flags=re.DOTALL)
    except Exception:
        pass
    return text


async def _download_css_assets(
    asset_dir,
    page_id,
    css_sources,
    mapping,
    sem,
    client,
):
    """
    CSS files reference further assets (fonts, images, nested stylesheets) via
    url()/@import. Walk them breadth-first with a bounded depth, downloading
    each dependency and rewriting the CSS so references resolve locally.

    Returns a fresh {orig_url: local_abs_path} dict for newly fetched files
    plus the list of URLs that failed to download.
    """

    new_mapping = {}
    failures = []

    # (css_url, local_file, depth) — sources are already local at depth 1
    queue = [(css_url, css_file, 1) for css_url, css_file in css_sources]
    processed = {css_file for _, css_file, _ in queue}
    rewritten_dirs = set()
    downloaded_count = 0

    while queue and downloaded_count < MAX_CSS_ASSETS:
        css_url, css_file, depth = queue.pop(0)
        path = asset_dir / css_file
        if not path.is_file():
            continue

        try:
            text = _clean_css(path.read_text("utf-8", errors="replace"))
        except Exception:
            continue

        refs = set()
        for m in URL_RE.finditer(text):
            refs.add(unquote(m.group(2).strip()))
        for m in IMPORT_RE.finditer(text):
            refs.add(m.group(2).strip())

        for ref in refs:
            if is_data_or_blob(ref):
                continue
            resolved = urljoin(css_url, ref)
            parsed = urlparse(resolved)
            if parsed.scheme not in ("http", "https"):
                continue
            if len(resolved) > 2000:
                continue
            if resolved in mapping or resolved in new_mapping:
                continue
            if downloaded_count >= MAX_CSS_ASSETS:
                break

            filename = await _download_asset(asset_dir, resolved, sem, client)
            if not filename:
                failures.append(resolved)
                continue
            downloaded_count += 1
            new_mapping[resolved] = (
                f"/landing-pages/clone-assets/{page_id}/{filename}"
            )

            # Recurse into nested stylesheets, bounded by MAX_CSS_DEPTH.
            if (
                _type_is_css(resolved)
                and depth < MAX_CSS_DEPTH
                and filename not in processed
            ):
                processed.add(filename)
                queue.append((resolved, filename, depth + 1))

        if new_mapping:
            def localize_ref(val):
                return urljoin(css_url, unquote(val))

            def repl(match):
                quote = match.group(1) or ""
                inner = match.group(2).strip()
                return f"url({quote}{localize_ref(inner)}{quote})"

            text2 = URL_RE.sub(repl, text)
            text2 = IMPORT_RE.sub(
                lambda m: f"@import '{localize_ref(m.group(2).strip())}'",
                text2,
            )
            try:
                path.write_text(text2, "utf-8")
            except Exception:
                pass

    return new_mapping, failures


def _type_is_css(url: str) -> bool:
    return urlparse(url).path.lower().endswith(".css")


async def localize_assets(html: str, source_url: str, page_id: int) -> LocalizeResult:
    """
    Download every render-relevant asset (CSS, images, fonts, icons) and
    rewrite the HTML to point at locally-served files. CSS files are scanned
    recursively for url()/@import dependencies (fonts, images) which are also
    downloaded and rewritten.

    Returns a LocalizeResult (html, asset_count, failures). Individual asset
    download failures are recorded in .failures and never abort the import.
    """

    soup = BeautifulSoup(html, "lxml")
    asset_dir = CLONE_ASSETS_DIR / str(page_id)
    asset_dir.mkdir(parents=True, exist_ok=True)

    urls = _collect_asset_urls(soup, source_url)
    if not urls:
        return LocalizeResult(html=sanitize_html(str(soup)))

    urls = sorted(urls)[:MAX_ASSET_COUNT]

    sem = asyncio.Semaphore(8)
    mapping = {}

    async with httpx.AsyncClient(
        timeout=20.0,
        follow_redirects=True,
        max_redirects=10,
        verify=True,
    ) as client:
        results = await asyncio.gather(
            *[_download_asset(asset_dir, u, sem, client) for u in urls]
        )

    css_sources = []
    failures = []
    for url, filename in zip(urls, results):
        if filename:
            mapping[url] = (
                f"/landing-pages/clone-assets/{page_id}/{filename}"
            )
            if _type_is_css(url):
                css_sources.append((url, filename))
        else:
            failures.append(url)

    if not mapping:
        return LocalizeResult(html=sanitize_html(str(soup)))

    if css_sources:
        async with httpx.AsyncClient(
            timeout=20.0,
            follow_redirects=True,
            max_redirects=10,
            verify=True,
        ) as client:
            css_mapping, css_failures = await _download_css_assets(
                asset_dir, page_id, css_sources, mapping, sem, client
            )
        mapping.update(css_mapping)
        failures.extend(css_failures)

    def localize(val):
        resolved = _resolve_url(source_url, val)
        if resolved is None:
            return val
        return mapping.get(resolved, resolved)

    # ---- rewrite tag attributes ----
    for tag_name, attrs in RENDER_TAG_ATTRS.items():
        for tag in soup.find_all(tag_name):
            for attr in attrs:
                val = tag.get(attr)
                if not val:
                    continue
                if attr == "srcset":
                    rebuilt = []
                    for item in val.split(","):
                        item = item.strip()
                        if not item:
                            continue
                        parts = item.split()
                        target = localize(parts[0])
                        rebuilt.append(
                            f"{target} {' '.join(parts[1:])}".strip()
                            if len(parts) > 1
                            else target
                        )
                    tag[attr] = ", ".join(rebuilt)
                else:
                    tag[attr] = localize(val)

    for tag in soup.find_all("link", href=True):
        rel = tag.get("rel") or []
        if isinstance(rel, str):
            rel = [rel]
        rel = [str(r).lower() for r in rel]
        as_val = str(tag.get("as") or "").lower()
        if (
            "stylesheet" in rel
            or "icon" in rel
            or as_val in ("image", "font", "style")
        ):
            tag["href"] = localize(tag["href"])

    # ---- rewrite url() inside <style> blocks ----
    def replace_css_url(match):
        inner = unquote(match.group(2).strip())
        quote = match.group(1) or ""
        return f"url({quote}{localize(inner)}{quote})"

    def replace_import(match):
        return f"@import '{localize(match.group(2).strip())}'"

    for style in soup.find_all("style"):
        if style.string:
            text = URL_RE.sub(replace_css_url, style.string)
            text = IMPORT_RE.sub(replace_import, text)
            style.string = text

    for tag in soup.find_all(style=True):
        tag["style"] = URL_RE.sub(replace_css_url, tag["style"])

    return LocalizeResult(
        html=sanitize_html(str(soup)),
        asset_count=len(mapping),
        failures=failures,
    )