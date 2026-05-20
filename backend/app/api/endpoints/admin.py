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
    """
    Import nhân viên hàng loạt từ file ZIP.
    
    Định dạng folder ZIP yêu cầu:
    ```
    my_employees.zip
    ├── metadata.json
    ├── employee_001/
    │   ├── photo1.jpg
    │   └── photo2.jpg
    └── employee_002/
        ├── photo1.jpg
        └── photo2.jpg
    ```
    
    Hoặc các ảnh có thể đặt trực tiếp ở gốc ZIP:
    ```
    my_employees.zip
    ├── metadata.json
    ├── photo_emp001_1.jpg
    ├── photo_emp001_2.jpg
    ├── photo_emp002_1.jpg
    └── photo_emp002_2.jpg
    ```
    
    File metadata.json phải có cấu trúc:
    ```json
    [
        {
            "full_name": "Nguyễn Văn A",
            "employee_code": "EMP001",
            "department_name": "Phòng IT",
            "images": ["employee_001/photo1.jpg", "employee_001/photo2.jpg"]
        },
        {
            "full_name": "Trần Thị B",
            "employee_code": "EMP002",
            "department_name": "Phòng HR",
            "images": ["employee_002/photo1.jpg", "employee_002/photo2.jpg"]
        }
    ]
    ```
    """
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

        # Tổng hợp kết quả
        success_count = sum(1 for r in results if r['status'] == 'processing')
        error_count = sum(1 for r in results if r['status'] == 'error')
        no_images_count = sum(1 for r in results if r['status'] == 'no_images_found')

        print(f"✅ Import hoàn tất: {success_count} thành công, {error_count} lỗi, {no_images_count} không có ảnh.")

        return {
            "message": f"Đã nhận lệnh import {len(employees_data)} nhân viên",
            "details": results,
            "summary": {
                "success": success_count,
                "errors": error_count,
                "no_images": no_images_count
            }
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

@router.get("/bulk-import-format")
async def get_bulk_import_format():
    """
    Lấy hướng dẫn định dạng file ZIP cho import hàng loạt.
    """
    return {
        "title": "Định dạng ZIP cho Import Hàng Loạt",
        "description": "Hệ thống hỗ trợ hai cấu trúc folder ZIP",
        "formats": [
            {
                "name": "Cấu trúc 1: Ảnh tổ chức theo folder nhân viên",
                "structure": """
my_employees.zip
├── metadata.json
├── employee_001/
│   ├── photo1.jpg
│   ├── photo2.jpg
│   └── photo3.jpg
└── employee_002/
    ├── photo1.jpg
    └── photo2.jpg
                """,
                "pros": "Dễ quản lý, tổ chức rõ ràng"
            },
            {
                "name": "Cấu trúc 2: Ảnh đặt trực tiếp tại gốc",
                "structure": """
my_employees.zip
├── metadata.json
├── photo_emp001_1.jpg
├── photo_emp001_2.jpg
├── photo_emp002_1.jpg
└── photo_emp002_2.jpg
                """,
                "pros": "Đơn giản hơn, phù hợp cho số lượng ít"
            }
        ],
        "metadata_json_format": {
            "example": [
                {
                    "full_name": "Nguyễn Văn A",
                    "employee_code": "EMP001",
                    "department_name": "Phòng IT",
                    "images": ["employee_001/photo1.jpg", "employee_001/photo2.jpg", "employee_001/photo3.jpg"]
                },
                {
                    "full_name": "Trần Thị B",
                    "employee_code": "EMP002",
                    "department_name": "Phòng HR",
                    "images": ["photo_emp002_1.jpg", "photo_emp002_2.jpg"]
                },
                {
                    "full_name": "Lê Văn C",
                    "employee_code": "EMP003",
                    "department_name": "Phòng Marketing",
                    "images": ["employee_003/avatar.jpg"]
                }
            ],
            "fields": {
                "full_name": "Họ và tên nhân viên (bắt buộc)",
                "employee_code": "Mã nhân viên (bắt buộc)",
                "department_name": "Tên phòng ban (sẽ tạo nếu chưa tồn tại)",
                "images": "Danh sách đường dẫn ảnh trong ZIP (tối thiểu 1 ảnh)"
            }
        },
        "requirements": {
            "file_formats": ["JPG", "JPEG", "PNG"],
            "min_images_per_employee": 1,
            "recommended_images_per_employee": 3,
            "image_size_recommendation": "Tối thiểu 200x200px",
            "max_employees_per_import": "Không giới hạn"
        },
        "tips": [
            "Đặt tên ảnh rõ ràng để dễ quản lý",
            "Sử dụng 3-5 ảnh mỗi nhân viên để cải thiện độ chính xác nhận diện",
            "Đảm bảo khuôn mặt chiếm ít nhất 50% diện tích ảnh",
            "Sử dụng ảnh từ các góc độ và điều kiện ánh sáng khác nhau",
            "Kiểm tra metadata.json trước khi tạo ZIP",
            "File ZIP không nên vượt quá 500MB"
        ]
    }

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
    deleted_count = db_service.delete_old_logs(days)
    return {
        "message": f"Đã xóa {deleted_count} bản ghi chấm công cũ hơn {days} ngày",
        "deleted_count": deleted_count
    }