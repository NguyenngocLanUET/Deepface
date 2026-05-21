from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from fastapi_cache import FastAPICache
import shutil, uuid, os, io, tempfile
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
import pandas as pd

from app.services.vision import FaceDetectionError, VisionService
from app.services.vector_db import VectorDBService
from app.services.database import DBService, VN_TZ
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
WORK_START = time(8, 30)  # Updated work start time
GRACE_PERIOD = 15  # Grace period in minutes

def get_vn_now() -> datetime:
    return datetime.now(VN_TZ).replace(tzinfo=None)


# Updated attendance message logic to include grace period
def build_attendance_message(checkin_time: time, is_allowed: bool, default_msg: str) -> str:
    if not is_allowed:
        return default_msg
    if checkin_time < WORK_START:
        return "Chấm công thành công"
    grace_end = (datetime.combine(datetime.today(), WORK_START) + timedelta(minutes=GRACE_PERIOD)).time()
    if WORK_START <= checkin_time <= grace_end:
        return "Chấm công thành công (trong thời gian ân hạn)"
    if checkin_time > grace_end:
        return "Chấm công thành công (muộn)"
    return "Chấm công thành công"

@router.post("/identify")
async def identify(door_name: str, file: UploadFile = File(...)):
    temp_id = str(uuid.uuid4())
    temp_path = None
    
    try:
        # 1. Ghi file ảnh tạm thời
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as buffer:
                temp_path = buffer.name
                shutil.copyfileobj(file.file, buffer)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Lỗi tải file: {str(e)}")
        
        # 2. Trích xuất khuôn mặt lấy Embedding
        try:
            embedding = vision_service.get_embedding(temp_path)
        except FaceDetectionError as e:
            try:
                db_service.log_attendance(None, door_name, "UNKNOWN", str(e))
            except Exception as log_error:
                print(f"Lỗi log attendance khi không detect được mặt: {str(log_error)}")
            return {"match": False, "message": str(e), "open_door": False}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi trích xuất khuôn mặt: {str(e)}")
        
        if not embedding:
            return {"match": False, "message": "Không hợp lệ", "open_door": False}

        # 3. Tìm kiếm Vector DB
        try:
            results = vector_db.search(embedding, collection_name=settings.COLLECTION_NAME)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi tìm kiếm Vector DB: {str(e)}")
        
        # 4. XỬ LÝ TRƯỜNG HỢP: NGƯỜI LẠ (Không khớp hoặc score quá thấp)
        if not results or results[0].score < 0.45:
            # Kiểm tra xem có ai vừa check-in thành công trước đó 5 giây trên cùng cửa không (Fallback)
            try:
                recent_success = db_service.get_recent_success_on_door(door_name, seconds=5)
                if recent_success and recent_success.get("employee_id"):
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

            # Tải ảnh người lạ lên Storage làm bằng chứng (Snapshot)
            snapshot_name = None
            try:
                snapshot_name = f"snapshots/{date.today()}/{temp_id}.jpg"
                with open(temp_path, "rb") as f:
                    storage_service.upload_file(f, snapshot_name)
            except Exception as e:
                print(f"Cảnh báo: Không tải ảnh lên Storage cho người lạ - {str(e)}")
                snapshot_name = None
            
            # GHI LOG "DENIED" - Áp dụng chống spam log Người lạ liên tục trong 5 giây
            try:
                if not db_service.has_recent_denied_stranger(door_name, seconds=5):
                    db_service.log_attendance(None, door_name, "DENIED", "Người lạ", snapshot_name)
                else:
                    print("Bỏ qua ghi trùng log Người lạ (cooldown)")
            except Exception as e:
                print(f"Lỗi log attendance: {str(e)}")

            return {
                "match": False, 
                "message": "Người lạ", 
                "open_door": False, 
                "score": results[0].score if results else 0
            }

        # 5. XỬ LÝ TRƯỜNG HỢP: KHỚP VỚI NHÂN VIÊN
        emp_id = int(results[0].id)
        
        # Lấy thông tin nhân viên từ Database
        try:
            user_info = db_service.get_employee_by_id(emp_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi truy vấn DB: {str(e)}")
        
        # Nhân viên có trong VectorDB nhưng không tồn tại trong Database SQL
        if not user_info:
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
        
        # 6. KIỂM TRA COOLDOWN TRÁNH ĐIỂM DANH TRÙNG LẶP (REDIS)
        cache_key = f"cooldown_{emp_id}_{door_name}"
        is_cooldown = False
        
        try:
            redis_cache = FastAPICache.get_backend()
            if redis_cache:
                is_cooldown = await redis_cache.get(cache_key)
        except Exception as e:
            print(f"Cảnh báo: Redis không khả dụng - {str(e)}")
        
        if is_cooldown:
            # Nếu đang trong cooldown, kiểm tra xem vừa ghi nhận thành công chưa để duy trì mở cửa
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
            
            return {
                "match": False,
                "message": "Vui lòng chờ trước khi thử lại",
                "open_door": False
            }

        # 7. KIỂM TRA TÀI KHOẢN CÒN HOẠT ĐỘNG KHÔNG
        if not user_info.get("is_active", False):
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

        # 8. KIỂM TRA QUYỀN TRUY CẬP CỦA NHÂN VIÊN (Thời gian & Khu vực)
        try:
            is_allowed, msg = db_service.check_access_permission(emp_id, door_name)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi kiểm tra quyền: {str(e)}")
        
        # 9. TẢI ẢNH SNAPSHOT LÊN STORAGE
        snapshot_name = f"snapshots/{date.today()}/{temp_id}.jpg"
        try:
            with open(temp_path, "rb") as f:
                storage_service.upload_file(f, snapshot_name)
        except Exception as e:
            print(f"Cảnh báo: Không tải ảnh lên Storage - {str(e)}")
            snapshot_name = None

        # Thiết lập thông điệp và trạng thái dựa theo kết quả check quyền
        checkin_time = get_vn_now().time()
        attendance_message = build_attendance_message(checkin_time, is_allowed, msg)
        status = "SUCCESS" if is_allowed else "DENIED"

        # 10. GHI NHẬN LỊCH SỬ VÀO DATABASE
        try:
            log_result = db_service.log_attendance(
                emp_id, 
                door_name, 
                status,  # Ghi đúng thực tế (SUCCESS/DENIED) thay vì luôn ghi SUCCESS
                attendance_message,
                snapshot_name
            )
            if log_result:
                print(f"✅ Đã ghi nhận lịch sử chấm công: ID {log_result.id} ({status})")
            else:
                print(f"⚠️ Cảnh báo: Không thể lưu log chấm công.")
        except Exception as e:
            print(f"❌ Lỗi ghi log attendance: {str(e)}")

        # 11. DỌN DẸP LOG RÁC & CẬP NHẬT COOLDOWN
        if is_allowed:
            # Chỉ khi nhân viên được xác nhận thành công và được phép mở cửa,
            # hệ thống mới dọn dẹp các log "Người lạ" tạm thời tạo sai trước đó 5 giây.
            try:
                db_service.delete_recent_denied_strangers(door_name, seconds=5)
            except Exception as e:
                print(f"Cảnh báo: Không thể dọn dẹp các log rác trước đó: {str(e)}")

        # Lưu thông tin Cooldown tránh spam request vào Redis
        try:
            redis_cache = FastAPICache.get_backend()
            if redis_cache:
                await redis_cache.set(cache_key, "1", expire=COOLDOWN_SECONDS)
        except Exception as e:
            print(f"Cảnh báo: Không lưu cooldown vào Redis - {str(e)}")

        if not is_allowed:
            print(f"⚠️ Từ chối truy cập: {attendance_message} tại cửa {door_name}")

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
        raise HTTPException(status_code=500, detail=f"Lỗi hệ thống không xác định: {str(e)}")
    finally:
        # Đảm bảo file ảnh tạm thời luôn được giải phóng và xóa khỏi hệ thống
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                print(f"Cảnh báo: Không xóa file tạm - {str(e)}")

@router.post("/identify-multi")
async def identify_multi(door_name: str, files: List[UploadFile] = File(...)):
    """
    Xác định nhân viên từ 10 ảnh trong 5 giây.
    Lấy điểm số cao nhất từ tất cả các ảnh được cung cấp.
    """
    if not files or len(files) == 0:
        raise HTTPException(status_code=400, detail="Vui lòng gửi ít nhất một ảnh")
    
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="Tối đa 10 ảnh mỗi lần")

    temp_id = str(uuid.uuid4())
    temp_paths = []
    best_result = None
    best_score = -1
    best_emp_id = None
    best_temp_path = None
    
    try:
        # Xử lý từng ảnh và lấy embedding
        for file in files:
            temp_path = None
            try:
                # Ghi file ảnh tạm thời
                with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as buffer:
                    temp_path = buffer.name
                    shutil.copyfileobj(file.file, buffer)
                temp_paths.append(temp_path)
                
                # Trích xuất embedding
                try:
                    embedding = vision_service.get_embedding(temp_path)
                except Exception as e:
                    print(f"Cảnh báo: Không thể trích xuất embedding từ ảnh - {str(e)}")
                    continue
                
                if not embedding:
                    print(f"Cảnh báo: Embedding rỗng từ ảnh")
                    continue
                
                # Tìm kiếm trong Vector DB
                try:
                    results = vector_db.search(embedding, collection_name=settings.COLLECTION_NAME)
                    if results and results[0].score > best_score:
                        best_score = results[0].score
                        best_result = results[0]
                        best_emp_id = int(results[0].id)
                        best_temp_path = temp_path
                except Exception as e:
                    print(f"Cảnh báo: Lỗi tìm kiếm Vector DB - {str(e)}")
                    continue
                    
            except Exception as e:
                print(f"Cảnh báo: Lỗi xử lý ảnh - {str(e)}")
                continue

        # Kiểm tra kết quả tốt nhất
        if not best_result or best_score < 0.45:
            # Người lạ - không match
            snapshot_name = None
            if best_temp_path:
                try:
                    snapshot_name = f"snapshots/{date.today()}/{temp_id}.jpg"
                    with open(best_temp_path, "rb") as f:
                        storage_service.upload_file(f, snapshot_name)
                except Exception as e:
                    print(f"Cảnh báo: Không tải ảnh lên Storage cho người lạ - {str(e)}")
                    snapshot_name = None
            
            # GHI LOG "DENIED" với chống spam
            try:
                if not db_service.has_recent_denied_stranger(door_name, seconds=5):
                    db_service.log_attendance(None, door_name, "DENIED", "Người lạ", snapshot_name)
            except Exception as e:
                print(f"Lỗi log attendance: {str(e)}")

            return {
                "match": False, 
                "message": "Người lạ", 
                "open_door": False, 
                "score": best_score,
                "images_processed": len(temp_paths)
            }

        # Nhân viên match - tiếp tục xử lý như endpoint /identify
        emp_id = best_emp_id
        
        # Lấy thông tin nhân viên
        try:
            user_info = db_service.get_employee_by_id(emp_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi truy vấn DB: {str(e)}")
        
        if not user_info:
            snapshot_name = None
            if best_temp_path:
                try:
                    snapshot_name = f"snapshots/{date.today()}/{temp_id}.jpg"
                    with open(best_temp_path, "rb") as f:
                        storage_service.upload_file(f, snapshot_name)
                except Exception as e:
                    print(f"Cảnh báo: Không tải ảnh lên Storage - {str(e)}")
                    snapshot_name = None
            
            try:
                db_service.log_attendance(emp_id, door_name, "DENIED", "Nhân viên không tồn tại", snapshot_name)
            except Exception as e:
                print(f"Lỗi log attendance: {str(e)}")
            return {"match": False, "message": "Nhân viên không tồn tại", "open_door": False}
        
        # Kiểm tra cooldown
        cache_key = f"cooldown_{emp_id}_{door_name}"
        try:
            redis_cache = FastAPICache.get_backend()
            if redis_cache:
                cached = await redis_cache.get(cache_key)
                if cached:
                    return {
                        "match": True,
                        "employee_name": user_info["full_name"],
                        "employee_code": user_info["employee_code"],
                        "open_door": False,
                        "message": "Vừa chấm công cách đây ít phút",
                        "score": best_score
                    }
        except Exception as e:
            print(f"Cảnh báo: Lỗi kiểm tra cooldown - {str(e)}")

        # Kiểm tra quyền truy cập
        try:
            is_allowed, msg = db_service.check_access_permission(emp_id, door_name)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi kiểm tra quyền: {str(e)}")
        
        # Tải ảnh snapshot lên storage
        snapshot_name = None
        if best_temp_path:
            snapshot_name = f"snapshots/{date.today()}/{temp_id}.jpg"
            try:
                with open(best_temp_path, "rb") as f:
                    storage_service.upload_file(f, snapshot_name)
            except Exception as e:
                print(f"Cảnh báo: Không tải ảnh lên Storage - {str(e)}")
                snapshot_name = None

        # Thiết lập thông điệp
        checkin_time = get_vn_now().time()
        attendance_message = build_attendance_message(checkin_time, is_allowed, msg)
        status = "SUCCESS" if is_allowed else "DENIED"

        # Ghi nhận lịch sử
        try:
            log_result = db_service.log_attendance(
                emp_id, 
                door_name, 
                status,
                attendance_message,
                snapshot_name
            )
            if log_result:
                print(f"✅ Đã ghi nhận lịch sử chấm công: ID {log_result.id} ({status})")
            else:
                print(f"⚠️ Cảnh báo: Không thể lưu log chấm công.")
        except Exception as e:
            print(f"❌ Lỗi ghi log attendance: {str(e)}")

        # Dọn dẹp log rác
        if is_allowed:
            try:
                db_service.delete_recent_denied_strangers(door_name, seconds=5)
            except Exception as e:
                print(f"Cảnh báo: Không thể dọn dẹp các log rác - {str(e)}")

        # Lưu cooldown
        try:
            redis_cache = FastAPICache.get_backend()
            if redis_cache:
                await redis_cache.set(cache_key, "1", expire=COOLDOWN_SECONDS)
        except Exception as e:
            print(f"Cảnh báo: Không lưu cooldown vào Redis - {str(e)}")

        if not is_allowed:
            print(f"⚠️ Từ chối truy cập: {attendance_message} tại cửa {door_name}")

        return {
            "match": True,
            "employee_name": user_info["full_name"],
            "employee_code": user_info["employee_code"],
            "open_door": is_allowed,
            "message": attendance_message,
            "score": best_score,
            "images_processed": len(temp_paths)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi hệ thống không xác định: {str(e)}")
    finally:
        # Xóa tất cả file tạm
        for temp_path in temp_paths:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception as e:
                    print(f"Cảnh báo: Không xóa file tạm - {str(e)}")


@router.get("/history")
async def get_history(limit: int = 100, employee_id: Optional[int] = None, employee_ids: Optional[str] = None):
    """
    Lấy lịch sử chấm công
    - employee_id: Tìm kiếm 1 nhân viên (backward compatibility)
    - employee_ids: Tìm kiếm nhiều nhân viên, format: "1,2,3"
    """
    try:
        emp_list = None
        if employee_ids:
            # Parse chuỗi "1,2,3" thành list [1, 2, 3]
            emp_list = [int(id.strip()) for id in employee_ids.split(",") if id.strip()]
        elif employee_id:
            emp_list = [employee_id]
        
        return db_service.get_attendance_history(limit, emp_list)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi lấy lịch sử: {str(e)}")

@router.get("/departments-with-permissions")
async def get_departments_with_permissions():
    """
    Lấy danh sách phòng ban và quyền truy cập của từng phòng
    """
    try:
        departments = db_service.get_all_departments()
        result = []
        
        for dept in departments:
            dept_info = {
                "id": dept.get("id"),
                "name": dept.get("name"),
                "permissions": db_service.get_department_permissions(dept.get("id"))
            }
            result.append(dept_info)
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi lấy thông tin phòng ban: {str(e)}")

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
