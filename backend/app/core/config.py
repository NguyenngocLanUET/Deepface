import os
from pydantic_settings import BaseSettings
from zoneinfo import ZoneInfo
from datetime import datetime

class Settings(BaseSettings):
    PROJECT_NAME: str = "FaceAccess AI System"
    
    # --- Timezone Configuration ---
    TIMEZONE: str = "Asia/Ho_Chi_Minh"  # Vietnam timezone
    
    # --- Postgres Database ---
    # Thay đổi user/pass/db cho đúng với docker-compose của bạn
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "admin")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "123")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "attendance")
    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "db")
    POSTGRES_PORT: int = int(os.getenv("POSTGRES_PORT", 5432))

    SQLALCHEMY_DATABASE_URL: str = (
        f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
    )
    
    # --- Qdrant (Vector DB) ---
    QDRANT_HOST: str = os.getenv("QDRANT_HOST", "qdrant")
    QDRANT_PORT: int = 6333
    COLLECTION_NAME: str = "employees"
    
    # --- Redis (Sử dụng chung cho cả Celery và Cache) ---
    REDIS_HOST: str = os.getenv("REDIS_HOST", "redis")
    REDIS_PORT: int = 6379
    
    # Celery sử dụng DB số 0
    CELERY_BROKER_URL: str = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"
    CELERY_RESULT_BACKEND: str = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"

    # --- MinIO (S3 Storage) ---
    MINIO_ENDPOINT: str = os.getenv("MINIO_ENDPOINT", "http://localhost:9000")
    # MINIO_ENDPOINT: str = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
    MINIO_ENDPOINT: str = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
    MINIO_ACCESS_KEY: str = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    MINIO_SECRET_KEY: str = os.getenv("MINIO_SECRET_KEY", "minioadmin")
    MINIO_BUCKET_NAME: str = "face-access-storage"
    MINIO_SECURE: bool = False # Để False nếu chạy local/docker không có SSL

    # --- DeepFace & Vision ---
    FACE_MODEL: str = "ArcFace" 
    DETECTOR_BACKEND: str = "opencv" # hoặc 'opencv' để chính xác hơn

    class Config:
        case_sensitive = True

settings = Settings()

# Helper function to convert UTC datetime to Vietnam timezone
def utc_to_vn(dt: datetime) -> datetime:
    """Convert UTC datetime to Vietnam timezone"""
    if dt is None:
        return None
    # If naive, assume it's UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    # Convert to Vietnam timezone
    vn_tz = ZoneInfo(settings.TIMEZONE)
    return dt.astimezone(vn_tz)