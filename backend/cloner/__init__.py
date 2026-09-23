from dataclasses import dataclass, field

from .fetcher import FetchError, fetch_html, looks_like_spa_shell
from .renderer import render_with_playwright
from .localizer import localize_assets
from .security import ImportValidationError, validate_import_url
from .template import (
    MAX_HTML_SIZE,
    DEFAULT_CAPTURE_FIELDS,
    CLONE_ASSETS_DIR,
    build_capture_script,
    finalize_html,
    is_absolute,
    is_data_or_blob,
    looks_like_html,
    normalize_url,
    sanitize_html,
)
from bs4 import BeautifulSoup


class CloneError(Exception):
    pass


@dataclass
class CloneResult:
    html: str
    asset_count: int = 0
    failed_assets: list = field(default_factory=list)


def _html_has_content(html: str) -> bool:
    """A rendered page is only worth using if it actually contains content."""
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        return False
    if soup.find("form") or soup.find("input"):
        return True
    body = soup.find("body")
    text = body.get_text(" ", strip=True) if body else ""
    return len(text) >= 40


async def clone_site(
    url: str,
    capture_fields,
    page_id: int,
    force_render: bool = False,
    allowed_domains: str = "",
    prefers_dark: bool = True,
) -> CloneResult:
    """
    Full cloning pipeline:
      0. Validate URL (SSRF protection + authorized-domain check)
      1. Static fetch (modern browser UA, timeouts, charset, size limits)
      2. If the page looks like a JS-rendered shell (or force_render),
         render it in headless Chromium to capture the real content.
         An empty/low-content render is discarded in favor of the static HTML.
      3. Download + localize assets (CSS, images, fonts, icons)
      4. Inject passive PhishHunt capture script that sniffs fetch/XHR
         request bodies for credentials.
    """

    try:
        validated_url = validate_import_url(url, allowed_domains)
    except ImportValidationError as exc:
        raise CloneError(str(exc))

    try:
        html = await fetch_html(validated_url)
    except FetchError as exc:
        raise CloneError(str(exc))

    if force_render or looks_like_spa_shell(html):
        try:
            rendered = await render_with_playwright(validated_url, preserve_scripts=True)
            if (
                rendered
                and _html_has_content(rendered)
                and len(rendered) <= MAX_HTML_SIZE
            ):
                html = rendered
        except Exception:
            pass

    asset_count = 0
    failed_assets = []
    try:
        result = await localize_assets(html, validated_url, page_id)
        html = result.html
        asset_count = result.asset_count
        failed_assets = result.failures
    except Exception:
        pass

    return CloneResult(
        html=finalize_html(
            html,
            capture_fields,
            page_id,
            strip_scripts=False,
            passive_capture=True,
            prefers_dark=prefers_dark,
        ),
        asset_count=asset_count,
        failed_assets=failed_assets,
    )


__all__ = [
    "CloneError",
    "CloneResult",
    "FetchError",
    "ImportValidationError",
    "validate_import_url",
    "fetch_html",
    "looks_like_spa_shell",
    "render_with_playwright",
    "localize_assets",
    "clone_site",
    "MAX_HTML_SIZE",
    "DEFAULT_CAPTURE_FIELDS",
    "CLONE_ASSETS_DIR",
    "build_capture_script",
    "finalize_html",
    "is_absolute",
    "is_data_or_blob",
    "looks_like_html",
    "normalize_url",
    "sanitize_html",
]
