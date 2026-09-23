from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from typing import List
from pydantic import BaseModel

from database import get_db
from campaigns.models import Campaign
from auth.utils import get_current_user
from auth.models import User
from captures.models import Capture
from tracking.models import LinkVisit

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

class CampaignCreate(BaseModel):
    name: str

class CampaignResponse(BaseModel):
    id: int
    name: str
    status: str
    emails_sent: int
    emails_delivered: int
    emails_opened: int
    links_clicked: int
    data_submitted: int

    class Config:
        from_attributes = True

@router.get("/", response_model=List[CampaignResponse])
async def get_campaigns(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Campaign))
    return result.scalars().all()

@router.post("/", response_model=CampaignResponse)
async def create_campaign(campaign: CampaignCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    new_campaign = Campaign(name=campaign.name)
    db.add(new_campaign)
    await db.commit()
    await db.refresh(new_campaign)
    return new_campaign

@router.get("/metrics")
async def get_dashboard_metrics(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    # links_clicked = every real open of a landing page link (/build/:id)
    clicked_result = await db.execute(select(func.count(LinkVisit.id)))
    clicked = clicked_result.scalar() or 0

    # data_submitted = real form submissions, i.e. the captures listed below
    submitted_result = await db.execute(select(func.count(Capture.id)))
    submitted = submitted_result.scalar() or 0

    ips_result = await db.execute(select(func.count(func.distinct(Capture.ip))))
    ips_observed = ips_result.scalar() or 0

    click_rate = 0.0
    submission_rate = 0.0
    if clicked > 0:
        submission_rate = (submitted / clicked * 100)
        click_rate = 100.0

    risk_level = "Low"
    if click_rate > 30 or submission_rate > 10:
        risk_level = "Critical"
    elif click_rate > 15 or submission_rate > 5:
        risk_level = "High"
    elif click_rate > 5:
        risk_level = "Medium"

    return {
        "emails_sent": 0,
        "emails_delivered": 0,
        "emails_opened": 0,
        "links_clicked": clicked,
        "data_submitted": submitted,
        "ips_observed": ips_observed,
        "engagement_rate": 0.0,
        "click_rate": round(click_rate, 1),
        "submission_rate": round(submission_rate, 1),
        "risk_level": risk_level
    }

@router.get("/timeline")
async def get_engagement_timeline(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    days: int = 7,
):
    """Real-time daily engagement data: page opens (link clicks) and
    credential submissions per day for the last `days` days."""
    days = max(1, min(days, 30))

    try:
        visit_result = await db.execute(
            select(
                func.date(LinkVisit.visited_at).label("day"),
                func.count(LinkVisit.id).label("total"),
            )
            .group_by(func.date(LinkVisit.visited_at))
        )
        visits = {str(r.day): int(r.total) for r in visit_result.all()}
    except Exception:
        visits = {}

    try:
        cap_result = await db.execute(
            select(
                func.date(Capture.submitted_at).label("day"),
                func.count(Capture.id).label("total"),
            )
            .group_by(func.date(Capture.submitted_at))
        )
        submissions = {str(r.day): int(r.total) for r in cap_result.all()}
    except Exception:
        submissions = {}

    from datetime import date, timedelta
    today = date.today()
    timeline = []
    for i in range(days - 1, -1, -1):
        day = today - timedelta(days=i)
        key = day.isoformat()
        timeline.append({
            "day": key,
            "clicked": visits.get(key, 0),
            "submitted": submissions.get(key, 0),
        })

    return timeline
