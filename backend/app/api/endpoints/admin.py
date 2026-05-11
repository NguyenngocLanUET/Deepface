from fastapi import APIRouter, File, UploadFile, HTTPException, BackgroundTasks, Request
import shutil, uuid, os, json, zipfile
from fastapi_cache.decorator import cache

# [FIX]: Import thêm SessionLocal trực tiếp từ database.py
from app.services.database import DBService, SessionLocal 
from app.services.storage import StorageService
from app.worker import celery_app

router = APIRouter(prefix="/admin", tags=["Admin Tools"])
db_service = DBService()
storage_service = StorageService()

@router.post("/bulk-import")
async def bulk_import(zip_file: UploadFile = File(...)):
    temp_dir = f"/tmp/bulk_{uuid.uuid4()}"
    os.makedirs(temp_dir, exist_ok=True)
    zip_path = os.path.join(temp_dir, "upload.zip")

    try:
        try:
            with open(zip_path, "wb") as f:
                shutil.copyfileobj(zip_file.file, f)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Lỗi lưu file ZIP: {str(e)}")

        try:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(temp_dir)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Lỗi giải nén ZIP: {str(e)}")

        json_path = os.path.join(temp_dir, "metadata.json")
        if not os.path.exists(json_path):
            raise HTTPException(status_code=400, detail="Không tìm thấy file metadata.json trong gói ZIP")

        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                employees_data = json.load(f)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Lỗi đọc metadata.json: {str(e)}")

        results = []
        for emp in employees_data:
            try:
                full_name = emp.get("full_name")
                emp_code = emp.get("employee_code")
                dept_name = emp.get("department_name")
                image_filenames = emp.get("images", [])

                new_emp = db_service.create_employee(full_name, emp_code, dept_name)
                
                object_names = []
                for img_name in image_filenames:
                    img_path = os.path.join(temp_dir, img_name)
                    if os.path.exists(img_path):
                        obj_name = f"avatars/{new_emp.id}/{uuid.uuid4()}.jpg"
                        try:
                            with open(img_path, "rb") as f_img:
                                storage_service.upload_file(f_img, obj_name)
                            object_names.append(obj_name)
                        except Exception as e:
                            print(f"Cảnh báo: Lỗi tải ảnh {img_name} - {str(e)}")
                
                if object_names:
                    try:
                        celery_app.send_task("process_face_registration", args=[new_emp.id, object_names])
                    except Exception as e:
                        print(f"Cảnh báo: Lỗi gửi task Celery - {str(e)}")
                    results.append({"code": emp_code, "status": "processing", "images": len(object_names)})
                else:
                    results.append({"code": emp_code, "status": "no_images_found"})
            except Exception as e:
                print(f"Lỗi xử lý nhân viên {emp_code}: {str(e)}")
                results.append({"code": emp.get("employee_code", "unknown"), "status": "error", "message": str(e)})

        return {
            "message": f"Đã nhận lệnh import {len(employees_data)} nhân viên",
            "details": results
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                print(f"Cảnh báo: Lỗi xóa thư mục tạm - {str(e)}")

@router.get("/system-stats")
@cache(expire=60)
async def get_system_stats(request: Request):
    # [FIX]: Dùng SessionLocal() trực tiếp thay vì db_service.SessionLocal()
    db = SessionLocal()
    try:
        from app.models.models import Employee, Department, AttendanceLog, Door
        from datetime import date

        total_employees = db.query(Employee).count()
        total_depts = db.query(Department).count()
        total_doors = db.query(Door).count()
        today_attendance = db.query(AttendanceLog).filter(
            AttendanceLog.checkin_at >= str(date.today())
        ).count()

        return {
            "employees": total_employees,
            "departments": total_depts,
            "doors": total_doors,
            "today_logs": today_attendance
        }
    except Exception as e:
        print(f"Lỗi lấy thống kê hệ thống: {str(e)}")
        return {
            "employees": 0,
            "departments": 0,
            "doors": 0,
            "today_logs": 0,
            "error": str(e)
        }
    finally:
        db.close()

@router.post("/re-sync-all-vectors")
async def resync_vectors(background_tasks: BackgroundTasks):
    all_employees = db_service.get_all_employees()
    return {"message": f"Đang yêu cầu tính toán lại cho {len(all_employees)} nhân viên (Tính năng đang cập nhật)"}

@router.delete("/clear-logs")
async def clear_logs(days: int = 30):
    return {"message": f"Đã xóa các bản ghi cũ hơn {days} ngày (Tính năng đang cập nhật)"}