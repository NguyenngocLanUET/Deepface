import cv2
import numpy as np
from deepface import DeepFace

class VisionService:
    def __init__(self):
        self.model_name = "ArcFace"  
        self.default_detector = "retinaface"  

    def check_image_quality(self, image_path: str):
        img = cv2.imread(image_path)
        if img is None:
            return False, "Không thể đọc file ảnh."

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        brightness = gray.mean()
        # Log để xem thực tế
        print(f"DEBUG: Brightness: {brightness}")
        if brightness < 40: return False, "Ảnh quá tối."
        if brightness > 220: return False, "Ảnh quá chói."

        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        print(f"DEBUG: Blur Score (Laplacian): {laplacian_var}")
        
        # Gợi ý: Giảm xuống 30 để ảnh nghiêng dễ qua hơn
        if laplacian_var < 10: return False, "Ảnh quá nhòe."

        try:
            faces = DeepFace.extract_faces(
                img_path=image_path,
                detector_backend=self.default_detector,
                enforce_detection=False
            )
            
            face_count = len(faces)
            print(f"DEBUG: Face count: {face_count}")

            # Nếu enforce_detection=False, DeepFace thường trả về 1 "face" là toàn bộ ảnh 
            # ngay cả khi không thấy mặt. Bạn cần kiểm tra vùng diện tích mặt.
            if face_count == 0: 
                return False, "Không tìm thấy khuôn mặt."
                
            # Nếu nộp ảnh nghiêng mà hay bị báo > 1 người, hãy xem lại background
            if face_count > 1: 
                return False, f"Tìm thấy {face_count} người trong 1 ảnh."
            
            return True, "Chất lượng ảnh đạt yêu cầu."
        except Exception as e:
            print(f"DEBUG: AI Error: {str(e)}")
            return False, f"Lỗi AI: {str(e)}"

    def get_embedding(self, image_path: str, detector: str = None):
        try:
            # Nếu người gọi truyền detector vào thì dùng, không thì dùng mặc định
            current_detector = detector if detector else self.default_detector

            objs = DeepFace.represent(
                img_path=image_path, 
                model_name=self.model_name,
                enforce_detection=True, 
                detector_backend=current_detector,
                align=False,
                normalization="base" 
            )
            if not objs: return None
            
            embedding = np.array(objs[0]["embedding"])
            norm = np.linalg.norm(embedding)
            return (embedding / norm).tolist()
        except Exception as e:
            raise ValueError(f"Lỗi: {str(e)}")