from pydantic import BaseModel, field_validator
from datetime import datetime, time
from typing import List, Optional

# --- Departments (Phòng ban) ---
class DepartmentBase(BaseModel):
    name: str

class DepartmentOut(DepartmentBase):
    id: int
    class Config:
        from_attributes = True

# --- Department Permissions (Quyền theo phòng ban) ---
class DeptPermissionCreate(BaseModel):
    department_id: int
    door_id: int
    allowed_start_time: Optional[time] = None
    allowed_end_time: Optional[time] = None

class DeptPermissionOut(DeptPermissionCreate):
    id: int
    class Config:
        from_attributes = True

# --- Employees (Nhân viên) ---
class EmployeeBase(BaseModel):
    full_name: str
    employee_code: str
    role: str = "user"

class EmployeeCreate(EmployeeBase):
    department_name: str  # Dùng tên thay vì ID

class PermissionData(BaseModel):
    id: int
    door_name: Optional[str] = None
    allowed_start_time: Optional[str] = None
    allowed_end_time: Optional[str] = None

class EmployeeOut(EmployeeBase):
    id: int
    is_active: bool
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    photos: list = []
    permissions: list[PermissionData] = []
    class Config: 
        from_attributes = True

# --- Permissions (Quyền cá nhân/ngoại lệ) ---
class PermissionBase(BaseModel):
    employee_id: int
    door_id: int
    allowed_start_time: Optional[time] = None
    allowed_end_time: Optional[time] = None

class PermissionUpdate(BaseModel):
    door_id: int
    allowed_start_time: Optional[time] = None
    allowed_end_time: Optional[time] = None

class PermissionOut(PermissionBase):
    id: int
    class Config: 
        from_attributes = True

# --- Doors (Cửa/Khu vực) ---
class DoorBase(BaseModel):
    name: str
    description: Optional[str] = None

class DoorOut(DoorBase):
    id: int
    class Config: 
        from_attributes = True

# --- Attendance (Điểm danh & Log) ---
class AttendanceLogOut(BaseModel):
    id: int
    employee_id: Optional[int]
    door_id: Optional[int]
    checkin_at: datetime
    status: str
    reason: Optional[str]
    image_snapshot: Optional[str] = None
    
    @field_validator('checkin_at', mode='after')
    @classmethod
    def convert_to_vn_timezone(cls, v):
        """Convert UTC datetime to Vietnam timezone"""
        if v is None:
            return None
        from app.core.config import utc_to_vn
        return utc_to_vn(v)
    
    class Config: 
        from_attributes = True

class IdentifyRequest(BaseModel):
    door_name: str

# --- Authentication (Xác thực) ---
class UserRegister(BaseModel):
    username: str
    email: str
    password: str
    full_name: Optional[str] = None

class UserLogin(BaseModel):
    username: str
    password: str

class UserOut(BaseModel):
    id: int
    username: str
    email: str
    role: str
    is_active: bool
    employee_id: Optional[int] = None
    created_at: datetime
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserOut

class TokenData(BaseModel):
    username: Optional[str] = None