from fastapi import APIRouter, File, UploadFile, HTTPException, Form, Query
from typing import List, Optional
import shutil, uuid, os
from app.services.database import DBService
from app.services.storage import StorageService
from app.services.vision import VisionService
from app.worker import celery_app
from app.schemas.schemas import EmployeeOut, PermissionUpdate

router = APIRouter(prefix="/employees", tags=["Employees"])
db_service = DBService()
storage_service = StorageService()
vision_service = VisionService()

@router.post("/register", response_model=EmployeeOut)
async def register(
    full_name: str = Form(...), 
    employee_code: str = Form(...), 
    department_name: str = Form(...), 
    files: List[UploadFile] = File(...)
):
    if not (1 <= len(files) <= 5):
        raise HTTPException(status_code=400, detail="Vui lòng gửi từ 1 đến 5 ảnh.")

    try:
        new_user = db_service.create_employee(full_name, employee_code, department_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo nhân viên: {str(e)}")
    
    user_id = new_user.id
    
    object_names = []
    temp_paths = []
    
    try:
        for file in files:
            temp_path = f"/tmp/{uuid.uuid4()}.jpg"
            temp_paths.append(temp_path)
            
            try:
                with open(temp_path, "wb") as buffer:
                    shutil.copyfileobj(file.file, buffer)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Lỗi lưu file: {str(e)}")
            
            try:
                is_ok, msg = vision_service.check_image_quality(temp_path)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Lỗi kiểm tra ảnh: {str(e)}")
            
            if not is_ok:
                raise HTTPException(status_code=400, detail=f"Ảnh lỗi: {msg}")
            
            obj_name = f"avatars/{user_id}/{uuid.uuid4()}.jpg"
            try:
                with open(temp_path, "rb") as f:
                    storage_service.upload_file(f, obj_name)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Lỗi tải ảnh lên storage: {str(e)}")
            
            object_names.append(obj_name)
        
        try:
            celery_app.send_task("process_face_registration", args=[user_id, object_names])
        except Exception as e:
            print(f"Cảnh báo: Lỗi gửi task Celery - {str(e)}")
        
        return new_user
    
    except HTTPException:
        # Dọn dẹp khi có lỗi
        try:
            db_service.delete_employee(user_id)
        except Exception as e:
            print(f"Cảnh báo: Lỗi xóa nhân viên khi rollback - {str(e)}")
        raise
    
    finally:
        # Xóa các file tạm
        for path in temp_paths:
            if os.path.exists(path):
                try:
                    os.remove(path)
                except Exception as e:
                    print(f"Cảnh báo: Lỗi xóa file tạm - {str(e)}")

@router.get("/", response_model=List[EmployeeOut])
async def list_employees():
    return db_service.get_all_employees()

@router.patch("/{id}/status")
async def update_status(id: int, is_active: bool):
    return db_service.update_employee_status(id, is_active)

@router.put("/{id}/permissions")
async def update_permissions(id: int, perm: PermissionUpdate):
    return db_service.set_permission(id, perm.door_id, perm.allowed_start_time, perm.allowed_end_time)

@router.delete("/{id}")
async def delete_employee(id: int):
    success = db_service.delete_employee(id)
    if not success:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên để xóa")
    
    from app.services.vector_db import VectorDBService
    from app.core.config import settings
    VectorDBService().delete_vector(settings.COLLECTION_NAME, id)
    
    return {"status": "success", "message": f"Đã xóa nhân viên ID {id} khỏi hệ thống"}

@router.get("/search", response_model=List[EmployeeOut])
async def search_employees(
    query: Optional[str] = Query(None),
    department_id: Optional[int] = Query(None),
    is_active: Optional[bool] = Query(None),
    # Nhận trực tiếp danh sách int từ URL dạng: ?ids=1&ids=2
    ids: Optional[List[int]] = Query(None),  
    codes: Optional[List[str]] = Query(None), 
):
    # Lúc này ids và codes đã tự động là List[int] hoặc List[str] sạch sẽ,
    # không cần try-except ValueError hay split(",") nữa.
    
    return db_service.search_employees_advanced(
        query=query,
        department_id=department_id,
        is_active=is_active,
        employee_ids=ids,
        employee_codes=codes
    )