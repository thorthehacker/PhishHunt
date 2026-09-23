from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base

class Capture(Base):
    __tablename__ = "captures"
    
    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"))
    page_id = Column(Integer, ForeignKey("landing_pages.id", ondelete="SET NULL"), nullable=True)
    
    ip = Column(String)
    user_agent = Column(String)
    email = Column(String, index=True)
    password_hash = Column(String)  # SHA-256 of captured password (kept for legacy verification)
    session_id = Column(String)
    raw_payload = Column(Text, nullable=True)  # JSON snapshot of exactly what the payload captured

    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
