from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from fastapi_cache import FastAPICache
import shutil, uuid, os, io, tempfile
from datetime import date, datetime, time
from zoneinfo import ZoneInfo
import pandas as pd

from app.services.vision import FaceDetectionError, VisionService
from app.services.vector_db import VectorDBService
from app.services.database import DBService
from app.services.storage import StorageService
from app.core.config import settings
from app.schemas.schemas import AttendanceLogOut
from typing import List, Optional

router = APIRouter(prefix="/attendance", tags=["Attendance"])
vision_service = VisionService()
vector_db = VectorDBService()
db_service = DBService()
storage_service = StorageService()

COOLDOWN_SECONDS = 60
WORK_START = time(9, 0)
AFTERNOON_START = time(13, 30)
VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

def get_vn_now() -> datetime:
    return datetime.now(VN_TZ).replace(tzinfo=None)


def build_attendance_message(checkin_time: time, is_allowed: bool, default_msg: str) -> str:
    if not is_allowed:
        return default_msg
    if checkin_time < WORK_START:
        return "Chấm công thành công"
    if WORK_START <= checkin_time < AFTERNOON_START:
        return "Chấm công thành công" if checkin_time == WORK_START else "Chấm công thành công (muộn)"
    if checkin_time == AFTERNOON_START:
        return "Chấm công thành công"
    return "Chấm công thành công (muộn)"

@router.post("/identify")
async def identify(door_name: str, file: UploadFile = File(...)):
    temp_id = str(uuid.uuid4())
    temp_path = None
    
    try:
        # Ghi file tạm
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as buffer:
                temp_path = buffer.name
                shutil.copyfileobj(file.file, buffer)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Lỗi tải file: {str(e)}")
        
        try:
            embedding = vision_service.get_embedding(temp_path)
        except FaceDetectionError as e:
            try:
                db_service.log_attendance(None, door_name, "UNKNOWN", str(e))
            except Exception as log_error:
                print(f"Loi log attendance khi khong detect duoc mat: {str(log_error)}")
            return {"match": False, "message": str(e), "open_door": False}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi trích xuất khuôn mặt: {str(e)}")
        
        if not embedding:
            return {"match": False, "message": "Không hợp lệ", "open_door": False}

        try:
            results = vector_db.search(embedding, collection_name=settings.COLLECTION_NAME)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi tìm kiếm Vector DB: {str(e)}")
        
        if not results or results[0].score < 0.45:
            # Nếu không tìm thấy kết quả rõ ràng, kiểm tra log SUCCESS gần đây trên cùng cửa
            try:
                recent_success = db_service.get_recent_success_on_door(door_name, seconds=5)
                if recent_success and recent_success.get("employee_id"):
                    # Trả về thông tin nhân viên đã được ghi nhận gần đây
                    recent_emp = db_service.get_employee_by_id(recent_success.get("employee_id"))
                    if recent_emp:
                        return {
                            "match": True,
                            "employee_name": recent_emp["full_name"],
                            "employee_code": recent_emp["employee_code"],
                            "open_door": True,
                            "message": "Đã xác nhận từ ghi nhận gần đây"
                        }
            except Exception as e:
                print(f"Cảnh báo: Lỗi khi kiểm tra log SUCCESS gần đây - {str(e)}")

            # Chụp snapshot cho người lạ
            snapshot_name = None
            try:
                snapshot_name = f"snapshots/{date.today()}/{temp_id}.jpg"
                with open(temp_path, "rb") as f:
                    storage_service.upload_file(f, snapshot_name)
            except Exception as e:
                print(f"Cảnh báo: Không tải ảnh lên Storage cho người lạ - {str(e)}")
                snapshot_name = None
            
            try:
                db_service.log_attendance(None, door_name, "DENIED", "Người lạ", snapshot_name)
            except Exception as e:
                print(f"Lỗi log attendance: {str(e)}")
            return {"match": False, "message": "Người lạ", "open_door": False, "score": results[0].score if results else 0}

        emp_id = int(results[0].id)
        
        # Lấy thông tin nhân viên
        try:
            user_info = db_service.get_employee_by_id(emp_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi truy vấn DB: {str(e)}")
        
        if not user_info:
            # Chụp snapshot cho nhân viên không tồn tại
            snapshot_name = None
            try:
                snapshot_name = f"snapshots/{date.today()}/{temp_id}.jpg"
                with open(temp_path, "rb") as f:
                    storage_service.upload_file(f, snapshot_name)
            except Exception as e:
                print(f"Cảnh báo: Không tải ảnh lên Storage - {str(e)}")
                snapshot_name = None
            
            try:
                db_service.log_attendance(emp_id, door_name, "DENIED", "Nhân viên không tồn tại", snapshot_name)
            except Exception as e:
                print(f"Lỗi log attendance: {str(e)}")
            return {"match": False, "message": "Nhân viên không tồn tại", "open_door": False}
        
        # COOLDOWN REDIS - Bảo vệ bằng try-catch
        cache_key = f"cooldown_{emp_id}_{door_name}"
        is_cooldown = False
        
        try:
            redis_cache = FastAPICache.get_backend()
            if redis_cache:
                is_cooldown = await redis_cache.get(cache_key)
        except Exception as e:
            print(f"Cảnh báo: Redis không khả dụng - {str(e)}")
        
        if is_cooldown:
            # Nếu đang trong cooldown, kiểm tra log gần đây để xác nhận
            try:
                recent_logs = db_service.get_recent_attendance_logs(emp_id, door_name, seconds=5)
                for log in recent_logs:
                    if log.get("status") == "SUCCESS":
                        return {
                            "match": True, 
                            "employee_name": user_info["full_name"], 
                            "employee_code": user_info["employee_code"],
                            "open_door": True, 
                            "message": "Đã ghi nhận (Cooldown)"
                        }
            except Exception as e:
                print(f"Cảnh báo: Không thể kiểm tra log gần đây - {str(e)}")
            
            # Nếu không có log hợp lệ gần đây, bỏ qua cooldown
            return {
                "match": False,
                "message": "Vui lòng chờ trước khi thử lại",
                "open_door": False
            }

        # Kiểm tra tài khoản hoạt động
        if not user_info.get("is_active", False):
            # Chụp snapshot cho tài khoản bị khóa
            snapshot_name = None
            try:
                snapshot_name = f"snapshots/{date.today()}/{temp_id}.jpg"
                with open(temp_path, "rb") as f:
                    storage_service.upload_file(f, snapshot_name)
            except Exception as e:
                print(f"Cảnh báo: Không tải ảnh lên Storage - {str(e)}")
                snapshot_name = None
            
            try:
                db_service.log_attendance(emp_id, door_name, "DENIED", "Tài khoản bị khóa", snapshot_name)
            except Exception as e:
                print(f"Lỗi log attendance: {str(e)}")
            return {"match": False, "message": "Tài khoản bị khóa", "open_door": False}

        # Kiểm tra quyền truy cập
        try:
            is_allowed, msg = db_service.check_access_permission(emp_id, door_name)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi kiểm tra quyền: {str(e)}")
        
        # Upload ảnh snapshot
        snapshot_name = f"snapshots/{date.today()}/{temp_id}.jpg"
        try:
            with open(temp_path, "rb") as f:
                storage_service.upload_file(f, snapshot_name)
        except Exception as e:
            print(f"Cảnh báo: Không tải ảnh lên Storage - {str(e)}")
            snapshot_name = None

        checkin_time = get_vn_now().time()
        attendance_message = build_attendance_message(checkin_time, is_allowed, msg)

        # Log attendance - GHI "SUCCESS" LUÔN nếu nhân viên được nhận diện thành công
        try:
            # Status = SUCCESS luôn (vì đã nhận diện được mặt)
            # Nếu không có quyền thì message sẽ chứa lý do
            log_result = db_service.log_attendance(
                emp_id, 
                door_name, 
                "SUCCESS",  # Luôn SUCCESS nếu match=true
                attendance_message,  # Message chứa lý do (muộn, ngoài giờ, v.v.)
                snapshot_name
            )
            if log_result:
                print(f"✅ Chấm công được ghi vào lịch sử: {log_result.id}")
            else:
                print(f"⚠️ CẢNH BÁO: Ghi log attendance thất bại!")
        except Exception as e:
            print(f"❌ Lỗi ghi log attendance: {str(e)}")
            import traceback
            traceback.print_exc()
        
        # Lưu cooldown vào Redis
        try:
            redis_cache = FastAPICache.get_backend()
            if redis_cache:
                await redis_cache.set(cache_key, "1", expire=COOLDOWN_SECONDS)
        except Exception as e:
            print(f"Cảnh báo: Không lưu cooldown vào Redis - {str(e)}")

        # Chỉ in thông báo khi phán quyết cuối cùng là người lạ
        if not is_allowed:
            print(f"⚠️ Người lạ: Không được phép truy cập tại cửa {door_name}")

        return {
            "match": True,
            "employee_name": user_info["full_name"],
            "employee_code": user_info["employee_code"],
            "open_door": is_allowed,
            "message": attendance_message
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi không xác định: {str(e)}")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                print(f"Cảnh báo: Không xóa file tạm - {str(e)}")

@router.get("/history", response_model=List[AttendanceLogOut])
async def get_history(limit: int = 100, employee_id: Optional[int] = None):
    try:
        return db_service.get_attendance_history(limit, employee_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi lấy lịch sử: {str(e)}")

@router.get("/snapshot")
async def get_snapshot(path: str):
    snapshot_path = path.strip().lstrip("/")
    if not snapshot_path.startswith("snapshots/") or ".." in snapshot_path.split("/"):
        raise HTTPException(status_code=400, detail="Duong dan anh snapshot khong hop le")

    try:
        snapshot = storage_service.get_file_object(snapshot_path)
    except Exception:
        raise HTTPException(status_code=404, detail="Khong tim thay anh snapshot")

    return StreamingResponse(
        snapshot["Body"],
        media_type=snapshot.get("ContentType") or "image/jpeg",
        headers={"Cache-Control": "private, max-age=300"},
    )

@router.get("/stats/monthly")
async def get_monthly_stats(month: int, year: int):
    try:
        data = db_service.get_monthly_report_data(month, year)
        return {
            "month": month,
            "year": year,
            "total_records": len(data),
            "data": data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi lấy thống kê: {str(e)}")

@router.get("/export/excel")
async def export_attendance_excel(month: int, year: int):
    try:
        raw_data = db_service.get_monthly_report_data(month, year)
        if not raw_data:
            raise HTTPException(status_code=404, detail="Không có dữ liệu trong tháng này")

        try:
            df = pd.DataFrame(raw_data)
            # Giữ nguyên việc định dạng nếu trong hàm DB bạn không trả về trực tiếp dict đã đổi tên
            df.columns = ['ID Nhân viên', 'Họ Tên', 'Mã NV', 'Ngày', 'Giờ Vào', 'Giờ Ra cuối']
            
            output = io.BytesIO()
            with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
                df.to_excel(writer, index=False, sheet_name='Attendance')
            
            output.seek(0)

            headers = {
                'Content-Disposition': f'attachment; filename="Attendance_Report_{month}_{year}.xlsx"'
            }
            return StreamingResponse(output, headers=headers, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi tạo file Excel: {str(e)}")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi xuất file: {str(e)}")
