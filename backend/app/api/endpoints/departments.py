# app/api/departments.py

from fastapi import APIRouter, HTTPException
from app.services.database import DBService
from app.schemas.schemas import DepartmentOut, DepartmentBase, DeptPermissionCreate, DeptPermissionOut
from typing import List
from datetime import time

router = APIRouter(prefix="/departments", tags=["Departments & Policies"])
db_service = DBService()

@router.post("/", response_model=DepartmentOut)
async def create_department(dept: DepartmentBase):
    """Tạo mới một phòng ban (Ví dụ: Ban Nhân Sự, Phòng Kỹ Thuật)"""
    return db_service.create_department(dept.name)

@router.get("/", response_model=List[DepartmentOut])
async def list_departments():
    """Lấy danh sách tất cả các phòng ban trong hệ thống"""
    return db_service.get_all_departments()

@router.post("/permissions", response_model=DeptPermissionOut)
async def set_dept_permission(perm: DeptPermissionCreate):
    """
    Thiết lập quyền cho Phòng ban:
    Phòng ban A được phép vào Cửa B trong khung giờ quy định.
    """
    return db_service.set_department_permission(
        perm.department_id, 
        perm.door_id, 
        perm.allowed_start_time, 
        perm.allowed_end_time
    )

@router.post("/{dept_id}/quick-setup")
async def quick_setup(dept_id: int, door_ids: List[int], start_time: time, end_time: time):
    """
    Thiết lập nhanh (Bulk Setup): 
    Cho phép một phòng ban truy cập vào danh sách nhiều cửa cùng một lúc 
    với chung một khung giờ.
    """
    try:
        for d_id in door_ids:
            db_service.set_department_permission(dept_id, d_id, start_time, end_time)
        return {
            "status": "success", 
            "message": f"Đã cấp quyền cho phòng ban ID {dept_id} tại {len(door_ids)} cửa thành công."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi thiết lập quyền nhanh: {str(e)}")

@router.delete("/{dept_id}")
async def delete_department(dept_id: int):
    try:
        deleted = db_service.delete_department(dept_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Phòng ban không tồn tại.")
        return {"status": "success", "message": "Đã xóa phòng ban."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể xóa phòng ban: {str(e)}")