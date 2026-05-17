from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from fastapi_cache import FastAPICache
from fastapi_cache.backends.redis import RedisBackend
from redis import asyncio as aioredis
from prometheus_fastapi_instrumentator import Instrumentator

from app.api.endpoints import employees, attendance, doors, departments, admin, auth
from app.services.vector_db import VectorDBService
from app.services.storage import StorageService
from app.core.config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    StorageService()._ensure_bucket_exists()
    VectorDBService().init_collection(collection_name=settings.COLLECTION_NAME, vector_size=512)
    
    redis_url = f"redis://{settings.REDIS_HOST}:6379/1"
    redis = aioredis.from_url(redis_url)
    FastAPICache.init(RedisBackend(redis), prefix="fastapi-cache")
    
    yield

app = FastAPI(title="FaceAccess AI System", lifespan=lifespan)

Instrumentator().instrument(app).expose(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====================================================================
# ĐĂNG KÝ ROUTER SONG SONG ĐỂ CHỐNG LỖI 404 TỪ FRONTEND
# ====================================================================


# 1. API chuẩn RESTful mới
app.include_router(auth.router, prefix="/api/v1", tags=["Authentication"])
app.include_router(employees.router, prefix="/api/v1", tags=["Employees_V1"])
app.include_router(attendance.router, prefix="/api/v1", tags=["Attendance_V1"])
app.include_router(doors.router, prefix="/api/v1", tags=["Doors_V1"])
app.include_router(departments.router, prefix="/api/v1", tags=["Departments_V1"])
app.include_router(admin.router, prefix="/api/v1", tags=["Admin_V1"])

# 2. API gốc hỗ trợ Frontend hiện tại (KHÔNG CÓ /api/v1)
app.include_router(auth.router, tags=["Authentication_Legacy"])
app.include_router(employees.router, tags=["Employees_Legacy"])
app.include_router(attendance.router, tags=["Attendance_Legacy"])
app.include_router(doors.router, tags=["Doors_Legacy"])
app.include_router(departments.router, tags=["Departments_Legacy"])
app.include_router(admin.router, tags=["Admin_Legacy"])

@app.get("/health")
def health():
    return {"status": "healthy"}
