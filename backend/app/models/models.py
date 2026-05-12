from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Time
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime

Base = declarative_base()

class User(Base):
    """Model để quản lý tài khoản đăng nhập - tách biệt với Employee"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    
    # Liên kết với Employee (1 User có thể quản lý 1 hoặc nhiều Employee)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    employee = relationship("Employee", foreign_keys=[employee_id])
    
    # Quản lý quyền
    is_active = Column(Boolean, default=True)
    role = Column(String(20), default="user")  # "admin", "manager", "user"
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(100), nullable=False)
    employee_code = Column(String(20), unique=True, index=True)
    
    # Bổ sung cho UC 3: Quản lý trạng thái và phân quyền hệ thống
    is_active = Column(Boolean, default=True) 
    role = Column(String(20), default="user") # admin hoặc user
    
    created_at = Column(DateTime, default=datetime.utcnow)

    # Quan hệ
    logs = relationship("AttendanceLog", back_populates="employee")
    permissions = relationship("AccessPermission", back_populates="employee")
    department_id = Column(Integer, ForeignKey("departments.id"))
    department = relationship("Department", back_populates="employees")

class Door(Base):
    """Bổ sung để quản lý các khu vực/cửa khác nhau (UC 2, 3)"""
    __tablename__ = "doors"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True) # Ví dụ: Cửa chính, Phòng Server
    description = Column(String(200))
    
    permissions = relationship("AccessPermission", back_populates="door")
    logs = relationship("AttendanceLog", back_populates="door")

class AccessPermission(Base):
    """Bảng trung gian quản lý quyền truy cập theo khung giờ (UC 3)"""
    __tablename__ = "access_permissions"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"))
    door_id = Column(Integer, ForeignKey("doors.id"))
    
    # Khung giờ được phép ra vào
    allowed_start_time = Column(Time, default=None) # Ví dụ: 08:00:00
    allowed_end_time = Column(Time, default=None)   # Ví dụ: 17:30:00
    
    employee = relationship("Employee", back_populates="permissions")
    door = relationship("Door", back_populates="permissions")

class AttendanceLog(Base):
    __tablename__ = "attendance_logs"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True) # Null nếu không nhận diện được
    door_id = Column(Integer, ForeignKey("doors.id"))
    
    checkin_at = Column(DateTime, default=datetime.utcnow)
    
    # Bổ sung cho UC 2 & 4: Ghi lại trạng thái thành công hay thất bại
    status = Column(String(20)) # "SUCCESS", "DENIED", "UNKNOWN"
    reason = Column(String(255)) # Lý do: "Sai khuôn mặt", "Ngoài giờ", "Không có quyền"
    image_snapshot = Column(String(255)) # Lưu path ảnh lúc chụp tại cửa để đối soát

    employee = relationship("Employee", back_populates="logs")
    door = relationship("Door", back_populates="logs")
# models.py (Bổ sung)

class Department(Base):
    __tablename__ = "departments"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True)
    employees = relationship("Employee", back_populates="department")
    default_permissions = relationship("DepartmentPermission", back_populates="department")

class DepartmentPermission(Base):
    __tablename__ = "department_permissions"
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id"))
    door_id = Column(Integer, ForeignKey("doors.id"))
    allowed_start_time = Column(Time)
    allowed_end_time = Column(Time)
    department = relationship("Department", back_populates="default_permissions")

# Trong class Employee, cần thêm:
# department_id = Column(Integer, ForeignKey("departments.id"))
# department = relationship("Department", back_populates="employees")