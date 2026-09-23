import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql+asyncpg://phishhunt:phishhunt_password@localhost:5432/phishhunt")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "super_secret_jwt_key_for_phishhunt")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 7 days

    # Comma-separated list of hostnames allowed for server-side HTML import.
    # When empty, any *public* domain may be imported (private/internal
    # addresses are always blocked).
    ALLOWED_IMPORT_DOMAINS: str = os.getenv("ALLOWED_IMPORT_DOMAINS", "")
    
    class Config:
        env_file = ".env"

settings = Settings()
