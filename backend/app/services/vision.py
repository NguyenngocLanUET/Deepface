import cv2
import numpy as np
from deepface import DeepFace

from app.core.config import settings


class FaceDetectionError(ValueError):
    pass


class VisionService:
    def __init__(self):
        self.model_name = settings.FACE_MODEL
        self.default_detector = settings.DETECTOR_BACKEND
        self.detector_fallbacks = ("opencv", "ssd", "mtcnn", "retinaface")

    def _ordered_detectors(self, detector: str = None):
        detectors = []
        for candidate in (detector, self.default_detector, *self.detector_fallbacks):
            if candidate and candidate not in detectors:
                detectors.append(candidate)
        return detectors

    def check_image_quality(self, image_path: str):
        img = cv2.imread(image_path)
        if img is None:
            return False, "Không thể đọc file ảnh."

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        brightness = gray.mean()
        print(f"DEBUG: Brightness: {brightness}")
        if brightness < 40:
            return False, "Ảnh quá tối."
        if brightness > 220:
            return False, "Ảnh quá chói."

        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        print(f"DEBUG: Blur Score (Laplacian): {laplacian_var}")
        if laplacian_var < 10:
            return False, "Ảnh quá nhòe."

        detectors = self._ordered_detectors()
        errors = []
        for current_detector in detectors:
            try:
                faces = DeepFace.extract_faces(
                    img_path=image_path,
                    detector_backend=current_detector,
                    enforce_detection=True,
                )

                face_count = len(faces)
                print(f"DEBUG: Face count with {current_detector}: {face_count}")
                if face_count == 0:
                    errors.append(f"{current_detector}: không tìm thấy khuôn mặt")
                    continue
                if face_count > 1:
                    return False, f"Tìm thấy {face_count} người trong 1 ảnh."

                if current_detector != detectors[0]:
                    print(f"INFO: Face quality check passed with fallback detector '{current_detector}'")
                return True, "Chất lượng ảnh đạt yêu cầu."
            except Exception as e:
                print(f"DEBUG: AI Error with {current_detector}: {str(e)}")
                errors.append(f"{current_detector}: {str(e)}")

        return False, (
            "Không tìm thấy khuôn mặt rõ ràng. "
            "Hãy nhìn thẳng camera, giữ mặt trong khung và đảm bảo ảnh đủ sáng. "
            f"Chi tiết: {' | '.join(errors[-2:])}"
        )

    def get_embedding(self, image_path: str, detector: str = None):
        detectors = self._ordered_detectors(detector)

        errors = []
        for current_detector in detectors:
            try:
                objs = DeepFace.represent(
                    img_path=image_path,
                    model_name=self.model_name,
                    enforce_detection=True,
                    detector_backend=current_detector,
                    align=False,
                    normalization="base",
                )
                if not objs:
                    errors.append(f"{current_detector}: không trả về embedding")
                    continue

                embedding = np.array(objs[0]["embedding"])
                norm = np.linalg.norm(embedding)
                if norm == 0:
                    errors.append(f"{current_detector}: embedding rỗng")
                    continue

                if current_detector != detectors[0]:
                    print(f"INFO: Face detected with fallback detector '{current_detector}'")
                return (embedding / norm).tolist()
            except Exception as e:
                errors.append(f"{current_detector}: {str(e)}")

        raise FaceDetectionError(
            "Không phát hiện được khuôn mặt rõ ràng. "
            "Hãy nhìn thẳng camera, giữ mặt trong khung và đảm bảo ảnh đủ sáng. "
            f"Chi tiết: {' | '.join(errors[-2:])}"
        )
