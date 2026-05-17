import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "FaceAccess AI System"
2
    # --- Postgres Database ---
    DATABASE_URL: str = os.getenv("DATABASE_URL")

    # --- Qdrant (Vector DB) ---
    QDRANT_HOST: str = os.getenv("QDRANT_HOST")
    QDRANT_PORT: int = 6333
    COLLECTION_NAME: str = "employees"

    # --- Redis ---
    REDIS_HOST: str = os.getenv("REDIS_HOST")
    REDIS_PORT: int = 6379

    CELERY_BROKER_URL: str = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"
    CELERY_RESULT_BACKEND: str = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"

    # --- MinIO (S3 Storage) ---
    MINIO_ENDPOINT: str = os.getenv("MINIO_ENDPOINT")
    MINIO_ACCESS_KEY: str = os.getenv("MINIO_ACCESS_KEY")
    MINIO_SECRET_KEY: str = os.getenv("MINIO_SECRET_KEY")
    MINIO_BUCKET_NAME: str = "face-access-storage"
    MINIO_SECURE: bool = False

    # --- DeepFace & Vision ---
    FACE_MODEL: str = "ArcFace"
    DETECTOR_BACKEND: str = "opencv"

    class Config:
        case_sensitive = True

settings = Settings()