from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.future import select

from database import engine, Base, AsyncSessionLocal
from auth.models import User
from auth.utils import get_password_hash
from auth.router import router as auth_router
from campaigns.router import router as campaigns_router
from captures.router import router as captures_router
from tracking.router import router as tracking_router
from tracking.models import LinkVisit
from landing_pages.router import router as landing_pages_router
from landing_pages.router import seed_phe_templates

app = FastAPI(title="PhishHunt API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(campaigns_router)
app.include_router(captures_router)
app.include_router(tracking_router)
app.include_router(landing_pages_router)

async def _run_migrations(conn):
    """Auto-apply any schema changes that create_all won't handle (adding columns to existing tables)."""
    migrations = [
        # landing_pages: new columns added after initial schema
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS capture_fields TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS source_url VARCHAR",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS import_type VARCHAR",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS import_status VARCHAR DEFAULT 'ready'",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS error_message TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS asset_count INTEGER",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()",
        "ALTER TABLE captures ADD COLUMN IF NOT EXISTS raw_payload TEXT",
        "ALTER TABLE captures DROP CONSTRAINT IF EXISTS captures_page_id_fkey",
        "ALTER TABLE captures ADD CONSTRAINT captures_page_id_fkey FOREIGN KEY (page_id) REFERENCES landing_pages(id) ON DELETE SET NULL",
        """CREATE TABLE IF NOT EXISTS flows (
            id SERIAL PRIMARY KEY,
            landing_page_id INTEGER UNIQUE REFERENCES landing_pages(id) ON DELETE CASCADE,
            nodes TEXT,
            connections TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )""",
    ]
    for sql in migrations:
        try:
            await conn.execute(text(sql))
        except Exception:
            pass  # Column may already exist or table doesn't exist yet — safe to ignore

@app.on_event("startup")
async def startup_event():
    async with engine.begin() as conn:
        # Create all tables that don't exist yet
        await conn.run_sync(Base.metadata.create_all)
        # Apply any column-level migrations for existing tables
        await _run_migrations(conn)

    # Create default admin if not exists
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.username == "admin"))
        admin_user = result.scalars().first()
        if not admin_user:
            default_admin = User(
                username="admin",
                hashed_password=get_password_hash("admin"),
                must_change_password=True
            )
            session.add(default_admin)
            await session.commit()

    # Ship the built-in starter flow as template #0 on a fresh database
    try:
        async with AsyncSessionLocal() as session:
            await seed_phe_templates(session)
    except Exception:
        pass  # seeding must never block startup

@app.get("/")
def read_root():
    return {"message": "Welcome to PhishHunt API"}
