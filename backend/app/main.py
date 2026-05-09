from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

# [NEW] Thêm các import mới
from fastapi_cache import FastAPICache
from fastapi_cache.backends.redis import RedisBackend
from redis import asyncio as aioredis
from prometheus_fastapi_instrumentator import Instrumentator

from app.api.endpoints import employees, attendance, doors, departments, admin
from app.services.vector_db import VectorDBService
from app.services.storage import StorageService
from app.core.config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Các dịch vụ cũ của bạn
    StorageService()._ensure_bucket_exists()
    VectorDBService().init_collection(collection_name=settings.COLLECTION_NAME, vector_size=512)
    
    # 2. [NEW] Khởi tạo Redis Cache
    # Chúng ta dùng database số 1 (db=1) để tránh xung đột với Celery (thường dùng db=0)
    # settings.REDIS_HOST nên là "redis" nếu chạy docker-compose
    redis_url = f"redis://{settings.REDIS_HOST}:6379/1"
    redis = aioredis.from_url(redis_url, encoding="utf8", decode_responses=True)
    FastAPICache.init(RedisBackend(redis), prefix="fastapi-cache")
    
    yield

app = FastAPI(title="FaceAccess AI System", lifespan=lifespan)

# 3. [NEW] Khởi tạo Monitoring (Tự động tạo endpoint /metrics)
Instrumentator().instrument(app).expose(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Đăng ký Router
app.include_router(employees.router, prefix="/api/v1/employees", tags=["Employees"])
app.include_router(attendance.router, prefix="/api/v1/attendance", tags=["Attendance"])
app.include_router(doors.router, prefix="/api/v1/doors", tags=["Doors"])
app.include_router(departments.router, prefix="/api/v1/departments", tags=["Departments"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["Admin"])

@app.get("/health")
def health():
    return {"status": "healthy"}