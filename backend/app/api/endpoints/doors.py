from fastapi import APIRouter, HTTPException
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

@router.delete("/{door_id}")
async def delete_door(door_id: int):
    deleted = db_service.delete_door(door_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Cửa/Khu vực không tồn tại.")
    return {"status": "success", "message": "Đã xóa cửa/khu vực."}