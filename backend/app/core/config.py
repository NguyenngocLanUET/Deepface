import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "FaceAccess AI System"
    
    # --- Postgres Database ---
    # Thay đổi user/pass/db cho đúng với docker-compose của bạn
    
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
    MINIO_ENDPOINT: str = os.getenv("MINIO_ENDPOINT", "minio:9000")
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