from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import create_engine, func, cast, Date
from app.models.models import Base, Employee, AttendanceLog, AccessPermission, Door, DepartmentPermission, Department
import os
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from app.core.config import settings

VN_TZ = timezone(timedelta(hours=7))

# Use DATABASE_URL env if provided, otherwise use settings from config
DATABASE_URL = os.getenv("DATABASE_URL", settings.SQLALCHEMY_DATABASE_URL)
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# FastAPI dependency injection for database session
def get_db():
    """Get database session for FastAPI dependency injection"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class DBService:
    def __init__(self):
        Base.metadata.create_all(bind=engine)

    # --- NHÓM QUẢN LÝ NHÂN VIÊN ---

    def create_employee(self, full_name: str, employee_code: str, department_name: str):
        db = SessionLocal()
        try:
            # Tự động Tìm hoặc Tạo phòng ban theo Tên
            dept_name_clean = department_name.strip().title()
            dept = db.query(Department).filter(Department.name == dept_name_clean).first()
            
            if not dept:
                dept = Department(name=dept_name_clean)
                db.add(dept)
                db.commit()
                db.refresh(dept)

            new_emp = Employee(
                full_name=full_name, 
                employee_code=employee_code, 
                department_id=dept.id
            )
            db.add(new_emp)
            db.commit()
            db.refresh(new_emp)
            return new_emp
        finally:
            db.close()

    def get_employee_by_id(self, employee_id: int):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.id == employee_id).first()
            if emp:
                return {
                    "id": emp.id, 
                    "full_name": emp.full_name, 
                    "is_active": emp.is_active,
                    "employee_code": emp.employee_code,
                    "department_id": emp.department_id
                }
            return None
        finally:
            db.close()

    def get_all_employees(self):
        db = SessionLocal()
        try:
            return db.query(Employee).all()
        finally:
            db.close()

    def update_employee_status(self, employee_id: int, is_active: bool):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.id == employee_id).first()
            if emp:
                emp.is_active = is_active
                db.commit()
                db.refresh(emp)
                return emp
            return None
        finally:
            db.close()

    def delete_employee(self, employee_id: int):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.id == employee_id).first()
            if emp:
                db.query(AttendanceLog).filter_by(employee_id=employee_id).delete()
                db.query(AccessPermission).filter_by(employee_id=employee_id).delete()
                db.delete(emp)
                db.commit()
                return True
            return False
        finally:
            db.close()

    def delete_department(self, department_id: int):
        db = SessionLocal()
        try:
            department = db.query(Department).filter(Department.id == department_id).first()
            if not department:
                return False
            db.query(DepartmentPermission).filter_by(department_id=department_id).delete()
            db.query(Employee).filter(Employee.department_id == department_id).update(
                {Employee.department_id: None},
                synchronize_session=False,
            )
            db.delete(department)
            db.commit()
            return True
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def search_employees(self, query: str):
        db = SessionLocal()
        try:
            return db.query(Employee).filter(
                (Employee.full_name.ilike(f"%{query}%")) | 
                (Employee.employee_code.ilike(f"%{query}%"))
            ).all()
        finally:
            db.close()

    def search_employees_advanced(
        self, 
        query: str = None, 
        department_id: int = None, 
        is_active: bool = None,
        employee_ids: list = None,
        employee_codes: list = None
    ):
        """Tìm kiếm nhân viên với nhiều tiêu chí
        
        Args:
            query: Tìm kiếm theo tên hoặc mã nhân viên
            department_id: Lọc theo ID phòng ban
            is_active: Lọc theo trạng thái (True/False)
            employee_ids: Danh sách ID nhân viên cần tìm
            employee_codes: Danh sách mã nhân viên cần tìm
        """
        db = SessionLocal()
        try:
            filters = []
            
            # Nếu có danh sách IDs, chỉ tìm trong đó
            if employee_ids:
                filters.append(Employee.id.in_(employee_ids))
            
            # Nếu có danh sách codes, chỉ tìm trong đó
            if employee_codes:
                filters.append(Employee.employee_code.in_(employee_codes))
            
            # Tìm kiếm theo text (name hoặc code)
            if query:
                filters.append(
                    (Employee.full_name.ilike(f"%{query}%")) | 
                    (Employee.employee_code.ilike(f"%{query}%"))
                )
            
            # Lọc theo phòng ban
            if department_id is not None:
                filters.append(Employee.department_id == department_id)
            
            # Lọc theo trạng thái
            if is_active is not None:
                filters.append(Employee.is_active == is_active)
            
            query_obj = db.query(Employee)
            
            # Áp dụng tất cả filters với AND logic
            for f in filters:
                query_obj = query_obj.filter(f)
            
            return query_obj.all()
        finally:
            db.close()

    # --- NHÓM PHÒNG BAN & THIẾT LẬP ---

    def create_department(self, name: str):
        db = SessionLocal()
        try:
            dept = Department(name=name)
            db.add(dept)
            db.commit()
            db.refresh(dept)
            return dept
        finally:
            db.close()

    def get_all_departments(self):
        db = SessionLocal()
        try:
            return db.query(Department).all()
        finally:
            db.close()

    def set_department_permission(self, dept_id: int, door_id: int, start_t: time, end_t: time):
        db = SessionLocal()
        try:
            perm = db.query(DepartmentPermission).filter_by(
                department_id=dept_id, door_id=door_id
            ).first()
            
            if not perm:
                perm = DepartmentPermission(department_id=dept_id, door_id=door_id)
                db.add(perm)
            
            perm.allowed_start_time = start_t
            perm.allowed_end_time = end_t
            db.commit()
            db.refresh(perm)
            return perm
        finally:
            db.close()

    # --- NHÓM CỬA & QUYỀN TRUY CẬP ---

    def create_door(self, name: str, description: str = None):
        db = SessionLocal()
        try:
            door = Door(name=name, description=description)
            db.add(door)
            db.commit()
            db.refresh(door)
            return door
        finally:
            db.close()

    def delete_door(self, door_id: int):
        db = SessionLocal()
        try:
            door = db.query(Door).filter(Door.id == door_id).first()
            if not door:
                return False
            db.query(AccessPermission).filter_by(door_id=door_id).delete()
            db.query(DepartmentPermission).filter_by(door_id=door_id).delete()
            db.query(AttendanceLog).filter_by(door_id=door_id).delete()
            db.delete(door)
            db.commit()
            return True
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def get_all_doors(self):
        db = SessionLocal()
        try:
            return db.query(Door).all()
        finally:
            db.close()

    def set_permission(self, employee_id: int, door_id: int, start: time, end: time):
        db = SessionLocal()
        try:
            perm = db.query(AccessPermission).filter_by(employee_id=employee_id, door_id=door_id).first()
            if not perm:
                perm = AccessPermission(employee_id=employee_id, door_id=door_id)
                db.add(perm)
            perm.allowed_start_time = start
            perm.allowed_end_time = end
            db.commit()
            return {"status": "success"}
        finally:
            db.close()

    def check_access_permission(self, employee_id: int, door_name: str):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.id == employee_id).first()
            door = db.query(Door).filter(Door.name == door_name).first()
            
            if not emp: 
                return False, "Nhân viên không tồn tại"
            if not door: 
                return False, "Cửa không tồn tại"

            perm = db.query(AccessPermission).filter_by(
                employee_id=employee_id, door_id=door.id
            ).first()
            
            if not perm:
                perm = db.query(DepartmentPermission).filter_by(
                    department_id=emp.department_id, door_id=door.id
                ).first()

            if not perm:
                return False, "Không có quyền truy cập cửa này"

            if perm.allowed_start_time and perm.allowed_end_time:
                current_time = datetime.now(VN_TZ).replace(tzinfo=None).time()
                if not (perm.allowed_start_time <= current_time <= perm.allowed_end_time):
                    return False, f"Ngoài giờ (Cho phép: {perm.allowed_start_time}-{perm.allowed_end_time})"

            return True, "Hợp lệ"
        except Exception as e:
            print(f"Lỗi check_access_permission: {str(e)}")
            return False, f"Lỗi: {str(e)}"
        finally:
            db.close()

    # --- NHÓM ĐIỂM DANH & LOG & THỐNG KÊ ---
            
    def log_attendance(self, employee_id: int, door_name: str, status: str, reason: str = None, image_path: str = None):
        db = SessionLocal()
        try:
            door = db.query(Door).filter(Door.name == door_name).first()
            door_id = door.id if door else None
            print(f"\n[LOG_ATTENDANCE] Ghi log chấm công:")
            print(f"  - Employee ID: {employee_id}")
            print(f"  - Door: {door_name} (ID: {door_id})")
            print(f"  - Status: {status}")
            print(f"  - Reason: {reason}")
            print(f"  - Image: {image_path}")

            # Lấy thời gian VN hiện tại dưới dạng naive datetime để lưu vào DB
            current_vn_time = datetime.now(VN_TZ).replace(tzinfo=None)

            new_log = AttendanceLog(
                employee_id=employee_id,
                door_id=door_id,
                status=status,
                reason=reason,
                image_snapshot=image_path,
                checkin_at=current_vn_time  # Gán thủ công giờ Việt Nam
            )
            db.add(new_log)
            db.commit()
            db.refresh(new_log)
            return new_log
        except Exception as e:
            print(f"\n❌ [LOG_ATTENDANCE] LỖI: {type(e).__name__}: {str(e)}")
            import traceback
            traceback.print_exc()
            db.rollback()
            return None
        finally:
            db.close()

    def get_attendance_history(self, limit: int = 100, employee_id: int = None):
        db = SessionLocal()
        try:
            query = db.query(AttendanceLog)
            if employee_id is not None:
                query = query.filter(AttendanceLog.employee_id == employee_id)
            return query.order_by(AttendanceLog.checkin_at.desc()).limit(limit).all()
        finally:
            db.close()

    def get_recent_attendance_logs(self, employee_id: int, door_name: str, seconds: int = 5):
        """Lấy log chấm công gần đây trong N giây để kiểm tra xác nhận"""
        from datetime import datetime, timedelta
        from app.models.models import AttendanceLog, Door
        
        db = SessionLocal()
        try:
            # Tìm door_id từ door_name
            door = db.query(Door).filter(Door.name == door_name).first()
            if not door:
                return []
            
            # Tính thời gian bắt đầu (N giây trước) - dùng Vietnam timezone
            start_time = (datetime.now(VN_TZ) - timedelta(seconds=seconds)).replace(tzinfo=None)
            
            # Truy vấn log gần đây
            logs = db.query(AttendanceLog)\
                .filter(AttendanceLog.employee_id == employee_id)\
                .filter(AttendanceLog.door_id == door.id)\
                .filter(AttendanceLog.checkin_at >= start_time)\
                .order_by(AttendanceLog.checkin_at.desc())\
                .all()
            
            # Chuyển đổi sang dict
            return [dict(
                status=log.status,
                message=log.reason,
                checkin_at=log.checkin_at,
                is_allowed=log.status == "SUCCESS"
            ) for log in logs]
        finally:
            db.close()

    def get_recent_success_on_door(self, door_name: str, seconds: int = 5):
        """Return the most recent SUCCESS attendance log on a door within `seconds`.
        Returns dict with employee_id and checkin_at or None.
        """
        db = SessionLocal()
        try:
            door = db.query(Door).filter(Door.name == door_name).first()
            if not door:
                return None

            from datetime import datetime, timedelta
            # Dùng Vietnam timezone
            start_time = (datetime.now(VN_TZ) - timedelta(seconds=seconds)).replace(tzinfo=None)

            log = db.query(AttendanceLog)\
                .filter(AttendanceLog.door_id == door.id)\
                .filter(AttendanceLog.status == 'SUCCESS')\
                .filter(AttendanceLog.checkin_at >= start_time)\
                .order_by(AttendanceLog.checkin_at.desc())\
                .first()

            if not log:
                return None
            return {"employee_id": log.employee_id, "checkin_at": log.checkin_at}
        finally:
            db.close()

    def get_monthly_report_data(self, month: int, year: int):
        db = SessionLocal()
        try:
            stats = db.query(
                AttendanceLog.employee_id,
                Employee.full_name,
                Employee.employee_code,
                cast(AttendanceLog.checkin_at, Date).label("date"),
                func.min(AttendanceLog.checkin_at).label("first_in"),
                func.max(AttendanceLog.checkin_at).label("last_out")
            ).join(Employee, Employee.id == AttendanceLog.employee_id)\
             .filter(func.extract('month', AttendanceLog.checkin_at) == month)\
             .filter(func.extract('year', AttendanceLog.checkin_at) == year)\
             .group_by(AttendanceLog.employee_id, Employee.full_name, Employee.employee_code, "date")\
             .all()
            
            result = []
            for s in stats:
                row = dict(s._mapping)
                if row.get('date'):
                    row['date'] = str(row['date'])
                
                # Do DB đã lưu đúng giờ Việt Nam, chỉ cần định dạng trực tiếp ra chuỗi ISO
                if row.get('first_in'):
                    row['first_in'] = row['first_in'].isoformat()
                if row.get('last_out'):
                    row['last_out'] = row['last_out'].isoformat()
                result.append(row)
            
            return result
        finally:
            db.close()

    def delete_old_logs(self, days: int = 30):
        """Xóa các bản ghi chấm công cũ hơn N ngày"""
        db = SessionLocal()
        try:
            cutoff_date = (datetime.now(VN_TZ) - timedelta(days=days)).replace(tzinfo=None)
            
            # Xóa các bản ghi AttendanceLog cũ hơn cutoff_date
            deleted_count = db.query(AttendanceLog)\
                .filter(AttendanceLog.checkin_at < cutoff_date)\
                .delete(synchronize_session=False)
            
            db.commit()
            
            print(f"✅ [DELETE_OLD_LOGS] Đã xóa {deleted_count} bản ghi cũ hơn {days} ngày")
            return deleted_count
        except Exception as e:
            print(f"❌ [DELETE_OLD_LOGS] LỖI: {type(e).__name__}: {str(e)}")
            import traceback
            traceback.print_exc()
            db.rollback()
            return 0
        finally:
            db.close()
