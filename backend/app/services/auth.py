"""
Authentication Service - JWT & Password Management
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
from passlib.context import CryptContext
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os

# ====== PASSWORD HASHING ======
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    """Hash password using bcrypt"""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash"""
    return pwd_context.verify(plain_password, hashed_password)

# ====== JWT CONFIGURATION ======
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production-12345678")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

security = HTTPBearer()

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Tạo JWT token
    
    Args:
        data: Dữ liệu để encode vào token (thường là username)
        expires_delta: Thời gian hết hạn
    
    Returns:
        JWT token
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def verify_token(token: str) -> dict:
    """
    Xác minh JWT token
    
    Args:
        token: JWT token cần xác minh
    
    Returns:
        Dữ liệu được encode trong token
    
    Raises:
        HTTPException: Nếu token không hợp lệ
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    Dependency để lấy user hiện tại từ token
    Sử dụng trong các endpoint cần authentication
    
    Args:
        credentials: HTTP Bearer token
    
    Returns:
        Thông tin user từ token
    """
    token = credentials.credentials
    payload = verify_token(token)
    return payload
