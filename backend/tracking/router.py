from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from tracking.models import LinkVisit

router = APIRouter(prefix="/tracking", tags=["tracking"])


class PageVisitPayload(BaseModel):
    page_id: int
    ip: Optional[str] = None
    user_agent: Optional[str] = None


@router.post("/page-visit")
async def record_page_visit(
    request: Request,
    payload: PageVisitPayload,
    db: AsyncSession = Depends(get_db),
):
    client_ip = payload.ip or (request.client.host if request.client else "Unknown")
    user_agent = request.headers.get("user-agent", "")
    visit = LinkVisit(
        page_id=payload.page_id,
        ip=client_ip,
        user_agent=user_agent,
    )
    db.add(visit)
    await db.commit()
    return {"status": "tracked"}
