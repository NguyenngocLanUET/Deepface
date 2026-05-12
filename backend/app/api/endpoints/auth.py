"""
Authentication Endpoints - Login & Register
"""
from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.orm import Session
from app.schemas.schemas import UserLogin, UserRegister, Token, UserOut
from app.models.models import User, Base
from app.services.auth import hash_password, verify_password, create_access_token, get_current_user
from app.services.database import get_db
from datetime import timedelta

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(user: UserRegister, db: Session = Depends(get_db)):
    """
    Đăng ký tài khoản mới
    """
    # Kiểm tra username đã tồn tại
    existing_user = db.query(User).filter(User.username == user.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists"
        )
    
    # Kiểm tra email đã tồn tại
    existing_email = db.query(User).filter(User.email == user.email).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Tạo user mới
    new_user = User(
        username=user.username,
        email=user.email,
        hashed_password=hash_password(user.password),
        role="user"  # Mặc định role là user
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return new_user

@router.post("/login", response_model=Token)
def login(user: UserLogin, db: Session = Depends(get_db)):
    """
    Đăng nhập - trả về JWT token
    """
    # Tìm user theo username
    db_user = db.query(User).filter(User.username == user.username).first()
    
    # Kiểm tra user tồn tại và password đúng
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Kiểm tra user có active không
    if not db_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )
    
    # Tạo token
    access_token_expires = timedelta(hours=24)
    access_token = create_access_token(
        data={"sub": db_user.username},
        expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": db_user.id,
            "username": db_user.username,
            "email": db_user.email,
            "role": db_user.role,
            "is_active": db_user.is_active,
            "employee_id": db_user.employee_id,
            "created_at": db_user.created_at
        }
    }

@router.get("/me", response_model=UserOut)
def get_current_user_info(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Lấy thông tin user hiện tại
    Cần token trong header: Authorization: Bearer <token>
    """
    db_user = db.query(User).filter(User.username == current_user["sub"]).first()
    
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return db_user

@router.post("/logout")
def logout():
    """
    Đăng xuất
    Frontend sẽ xóa token từ localStorage
    """
    return {"message": "Logout successful. Please clear token from client."}
