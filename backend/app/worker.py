import os
import uuid
import numpy as np
from typing import List
from celery import Celery
from celery.schedules import crontab
from app.services.vision import VisionService
from app.services.vector_db import VectorDBService
from app.services.storage import StorageService
from app.core.config import settings
from app.services.database import DBService

# Cấu hình Celery
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
celery_app = Celery("worker", broker=CELERY_BROKER_URL)
db_service = DBService()

celery_app.conf.beat_schedule = {
    # Tự động dọn dẹp snapshot cũ vào 2 giờ sáng mỗi ngày
    'auto-cleanup-snapshots': {
        'task': 'app.worker.system_maintenance',
        'schedule': crontab(hour=2, minute=0),
    },
}

# Khởi tạo services
vision_service = VisionService()
vector_db = VectorDBService()
storage_service = StorageService()

@celery_app.task(name="process_face_registration")
def process_face_registration(user_id: int, object_names: List[str]):
    """
    Xử lý đăng ký với danh sách nhiều ảnh (UC 1).
    Tính toán Average Embedding để tăng độ chính xác.
    """
    all_embeddings = []
    processed_temp_files = []
    
    try:
        print(f"--- Đang xử lý đăng ký cho User ID: {user_id} với {len(object_names)} ảnh ---")
        
        for obj_name in object_names:
            temp_path = f"/tmp/{uuid.uuid4()}.jpg"
            # 1. Tải từng ảnh từ Storage
            storage_service.download_file(obj_name, temp_path)
            processed_temp_files.append(temp_path)
            
            # 2. Trích xuất embedding
            embedding = vision_service.get_embedding(temp_path)
            
            if embedding is not None:
                all_embeddings.append(embedding)
            else:
                print(f"Cảnh báo: Không tìm thấy mặt trong ảnh {obj_name}")

        if not all_embeddings:
            raise Exception("AI không thể tìm thấy khuôn mặt trong bất kỳ ảnh nào được gửi lên.")

        # 3. Tính toán Average Embedding (Tính trung bình cộng các vector)
        # Chuyển list sang numpy array để tính toán theo cột
        embeddings_array = np.array(all_embeddings)
        # Tính trung bình theo cột
        avg_embedding = np.mean(embeddings_array, axis=0)
        # Chuẩn hóa lại một lần nữa cho chắc chắn
        norm = np.linalg.norm(avg_embedding)
        final_vector = (avg_embedding / norm).tolist()

        # 4. Lưu vào Vector DB (Qdrant)
        payload = {
            "user_id": user_id,
            "total_images_processed": len(all_embeddings),
            "registered_at": str(np.datetime64('now'))
        }
        
        # Ghi đè hoặc tạo mới vector đại diện cho nhân viên
        vector_db.upsert(settings.COLLECTION_NAME, final_vector, user_id, payload)        
        
        print(f"Thành công: Đã tạo Average Vector cho nhân viên ID: {user_id}")
        return {"status": "success", "user_id": user_id, "images_used": len(all_embeddings)}
        
    except Exception as e:
        print(f"Lỗi xử lý cho User {user_id}: {str(e)}")
        return {"status": "error", "message": str(e)}
        
    finally:
        # Dọn dẹp tất cả file tạm
        for f in processed_temp_files:
            if os.path.exists(f):
                os.remove(f)

@celery_app.task(name="system_maintenance")
def system_maintenance():
    """
    Tác vụ bảo trì hệ thống định kỳ:
    1. Xóa log cũ (quá 60 ngày)
    2. (Option) Xóa các snapshot ảnh người lạ để tiết kiệm dung lượng
    """
    print("--- Đang chạy tác vụ bảo trì hệ thống ---")
    deleted_count = db_service.delete_old_logs(days=60)
    return {"status": "cleaned", "deleted_logs": deleted_count}