from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base


class LandingPage(Base):
    __tablename__ = "landing_pages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    html_content = Column(Text, nullable=False)
    capture_fields = Column(Text, nullable=True)   # JSON-serialized list
    source_url = Column(String, nullable=True)
    import_type = Column(String, nullable=True)     # "url" | "html" | "upload"
    import_status = Column(String, nullable=True, default="ready")
    error_message = Column(Text, nullable=True)
    asset_count = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


class Flow(Base):
    """Visual flow editor state attached to one landing page.

    `nodes` and `connections` are JSON strings — the visual flow graph
    (starting page preview, action nodes, and the links between them).
    """

    __tablename__ = "flows"

    id = Column(Integer, primary_key=True, index=True)
    landing_page_id = Column(
        Integer,
        ForeignKey("landing_pages.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    nodes = Column(Text, nullable=True)          # JSON array of FlowNode
    connections = Column(Text, nullable=True)    # JSON array of FlowConnection
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
