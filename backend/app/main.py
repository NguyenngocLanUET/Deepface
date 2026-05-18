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

API_V1_PREFIX = "/api/v1"

# Canonical API paths, e.g. /api/v1/doors/{id}.
app.include_router(auth.router, prefix=API_V1_PREFIX, tags=["Authentication"])
app.include_router(employees.router, prefix=API_V1_PREFIX, tags=["Employees_V1"])
app.include_router(attendance.router, prefix=API_V1_PREFIX, tags=["Attendance_V1"])
app.include_router(doors.router, prefix=API_V1_PREFIX, tags=["Doors_V1"])
app.include_router(departments.router, prefix=API_V1_PREFIX, tags=["Departments_V1"])
app.include_router(admin.router, prefix=API_V1_PREFIX, tags=["Admin_V1"])

# Legacy double-prefix paths kept for older frontend builds.
app.include_router(employees.router, prefix=f"{API_V1_PREFIX}/employees", tags=["Employees_Legacy"], include_in_schema=False)
app.include_router(attendance.router, prefix=f"{API_V1_PREFIX}/attendance", tags=["Attendance_Legacy"], include_in_schema=False)
app.include_router(doors.router, prefix=f"{API_V1_PREFIX}/doors", tags=["Doors_Legacy"], include_in_schema=False)
app.include_router(departments.router, prefix=f"{API_V1_PREFIX}/departments", tags=["Departments_Legacy"], include_in_schema=False)
app.include_router(admin.router, prefix=f"{API_V1_PREFIX}/admin", tags=["Admin_Legacy"], include_in_schema=False)

# Direct shortcuts kept for local/static pages that call /doors, /departments, ...
app.include_router(employees.router, tags=["Employees_Direct"], include_in_schema=False)
app.include_router(attendance.router, tags=["Attendance_Direct"], include_in_schema=False)
app.include_router(doors.router, tags=["Doors_Direct"], include_in_schema=False)
app.include_router(departments.router, tags=["Departments_Direct"], include_in_schema=False)
app.include_router(admin.router, tags=["Admin_Direct"], include_in_schema=False)

@app.get("/health")
def health():
    return {"status": "healthy"}
