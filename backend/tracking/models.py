from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from database import Base

class LinkVisit(Base):
    __tablename__ = "link_visits"

    id = Column(Integer, primary_key=True, index=True)
    page_id = Column(Integer, index=True)
    ip = Column(String)
    user_agent = Column(String)
    visited_at = Column(DateTime(timezone=True), server_default=func.now())
