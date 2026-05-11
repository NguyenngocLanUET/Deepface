from fastapi import APIRouter
from fastapi_cache.decorator import cache
from app.services.database import DBService
from app.schemas.schemas import DoorOut, DoorBase
from typing import List

router = APIRouter(prefix="/doors", tags=["Doors"])
db_service = DBService()

@router.get("/", response_model=List[DoorOut])
@cache(expire=300) # Cache lại danh sách cửa trong 5 phút để giảm query DB
async def get_doors():
    return db_service.get_all_doors()

@router.post("/", response_model=DoorOut)
async def create_door(door: DoorBase):
    return db_service.create_door(door.name, door.description)