# DeepFace: Hệ thống kiểm soát ra vào cửa và chấm công bằng khuôn mặt
## 1. Kiến trúc

<img width="7524" height="4932" alt="image" src="https://github.com/user-attachments/assets/88ac4d65-9597-44ec-8e7c-6aa2b1e6eaf9" />

Developer
    |
    v
GitHub <----> GitHub Actions
    |
    v
Pull code / CI-CD
    |
    v
Docker containers
    |
    v
Ngrok tunnel
    |
    v
Nginx reverse proxy :8080
    |
    +--> frontend-user (Vite + React)
    |
    +--> frontend-admin (Vite + React)
    |
    +--> backend FastAPI
            |
            +--> DeepFace: nhận diện khuôn mặt
            |
            +--> PostgreSQL:
            |      - users
            |      - cameras
            |      - events
            |      - configs
            |      - face_records
            |
            +--> Qdrant:
            |      - face embeddings
            |      - vector search
            |
            +--> Redis:
            |      - cache
            |      - message queue
            |
            +--> Message Queue / Worker
            |      - xử lý bất đồng bộ
            |      - video processing
            |      - detection jobs
            |
            +--> MinIO:
            |      - raw images
            |      - processed images
            |      - videos
            |      - snapshots
            |
            +--> Prometheus:
            |      - metrics monitoring
            |
            +--> Grafana:
                   - dashboards
                   - visualization

User
    |
    +--> webcam / image / video

## 2. Chức năng chính
   - **Điểm danh cho nhân viên**: Tiếp nhận ảnh từ camera cửa, nhận diện khuôn mặt, kiểm tra quyền truy cập nhiều lớp (trạng thái tài khoản, quyền cá nhân, quyền phòng ban, khu vực, khung giờ) rồi mới quyết định mở cửa.

   - **Đăng ký khuôn mặt cho nhân viên mới**: Hỗ trợ upload 1-3 ảnh cho một nhân viên, liên kết ảnh với dữ liệu nhân viên đã có. Celery Worker xử lý nền để: kiểm tra chất lượng ảnh (độ sáng, độ nhòe, số mặt), tính ArcFace embedding cho từng ảnh, và tính Average Embedding cuối cùng.

   - **Quản lý quyền truy cập cho nhân viên**: Cấp quyền truy cập theo cửa và khung giờ. Hỗ trợ cấp quyền riêng cho cá nhân hoặc kế thừa cho nguyên một phòng ban.

   - **Quản trị nhân viên**: Tìm kiếm nhân viên nâng cao, khóa/ mở tài khoản, thêm/ xóa hoàn toàn nhân viên

   - **Xem lịch sử điểm danh**: Tra cứu nhật ký ra vào thời gian thực (get_attendance_history), sắp xếp theo thời gian mới nhất, hiển thị trạng thái (SUCCESS/DENIED) và lý do từ chối cụ thể.

   - **Lưu trữ dữ liệu**: Lưu lịch sử vào PostgreSQL, lưu ảnh khuôn mặt gốc vào MinIO, lưu vector khuôn mặt vào Qdrant.

## 3. Yêu cầu môi trường
- Docker Desktop
- Docker Compose
- Phần cứng ✨
- Hệ điều hành: đã được thử nghiệm trên Windows

## 4. Tài khoản mặc định✨
```
Admin:
username: admin
password: admin123

User:
username: user
password: user123
```
Các giá trị này nằm trong `.env` và có thể đổi trước khi chạy.
## 5. Model AI và Dataset

### 5.1. Model AI ✨
Hệ thống sử dụng thư viện DeepFace với cấu hình tối ưu để đảm bảo độ chính xác:
- Mô hình Nhận diện: ArcFace (trội hơn về khả năng nhận diện góc nghiêng và ánh sáng phức tạp, vector 512 dims).
- Mô hình Phát hiện khuôn mặt: retinaface (mạnh nhất để detect và align khuôn mặt).
- Normalization: "base".
- Chuẩn hóa Vector: Vector cuối cùng luôn được chuẩn hóa L2 100% trong VisionService.get_embedding
### 5.2. Dataset
   Dự án này sử dụng bộ dữ liệu ** [SCface (Surveillance Cameras Face Database)](https://scface.org/)** đã chỉnh sửa cho phù hợp dự án để thử nghiệm và đánh giá pipeline nhận diện khuôn mặt.
   
   Cấu trúc dữ liệu sử dụng trong dự án: ✨ % Chỉnh sửa thêm tên của file
   - Dữ liệu ảnh upload để làm ảnh gốc ✨ : Chứa ảnh của 130 nhân viên theo ba góc: góc chính diện, góc lệch trái và góc lệch phải
   - Sử dụng ảnh chụp từ 4 camera giám sát với 3 khoảng cách khác nhau để thực hiện luồng xác minh tại cửa để mô phỏng ảnh chụp realtime từ camera ở cửa.

```
Cấu trúc database
```
## 6. Cách chạy ✨
   1. Kiểm tra file `.env`. Có thể tạo lại từ `.env.example` nếu cần.
   2. Build và chạy toàn bộ stack:
      ```
      docker compose up -d --build
      ```
   3. Mở các URL:
      ```
      User frontend:  http://localhost:8080/user/
      Admin frontend: http://localhost:8080/admin/
      Backend docs:   http://localhost:8002/docs
      MinIO console:  http://localhost:9003
      Grafana:        http://localhost:3001
      Prometheus:     http://localhost:9090
      Qdrant:         http://localhost:6333/dashboard
      ```
   4. Xem log:
   ```
   docker compose logs -f backend
   docker compose logs -f inference-service
   docker compose logs -f worker
   ```
   5. Dừng hệ thống
   ```
   docker compose down
   ```
## 7. Các luồng dữ liệu chính

### 7.1. Luồng xác minh
```
Quản trị viên gửi ảnh + tên cửa
-> backend FastAPI tiếp nhận, lưu tạm ảnh
-> DeepFace trích xuất vector khuôn mặt
-> Qdrant tìm kiếm vector tương tự (ngưỡng 0.5)
-> Nhận diện được ID nhân viên
-> Kiểm tra logic Quyền truy cập (db_service.check_access_permission):
     1. Nhân viên/Cửa có tồn tại không?
     2. Giờ hiện tại nằm trong khung giờ [allowed_start_time, allowed_end_time]?
-> Trả về kết quả match: True/False, message open_door
-> backend ghi log điểm danh (status: SUCCESS/DENIED, reason)
```
API chính
```
POST /attendance/identify?door_name=<string>
Content-Type: multipart/form-data
file=<image_binary>
```
### 7.2. Luồng đăng ký khuôn mặt nhân viên mới 

```
Admin nhập thông tin + upload 3 ảnh
-> backend FastAPI kiểm tra số lượng ảnh 
-> backend tạo hồ sơ nhân viên trong PostgreSQL (department_id)
-> backend upload ảnh gốc lên MinIO (S3 compatible storage)
-> backend gửi task Celery background "process_face_registration"
-> backend trả về thông tin nhân viên mới
-> Celery Worker tải ảnh từ MinIO
-> worker gọi DeepFace KIỂM TRA CHẤT LƯỢNG ảnh (quá sáng, nhòe, đúng 1 mặt)
-> worker trích xuất ArcFace vector, TÍNH AVERAGE VECTOR 
-> worker chuẩn hóa L2 vector cuối cùng
-> worker upsert average vector vào Qdrant (dùng ID nhân viên SQL làm ID point)
```
API chính
```
POST /employees/register
Content-Type: multipart/form-data
files=[<image1_binary>, <image2_binary>, ...]
full_name=<string>
employee_code=<string>
department_id=<int>
```
### 7.3. Luồng upload ảnh ✨

```
User chọn ảnh
-> backend lưu ảnh gốc vào MinIO
-> inference-service detect biển số
-> crop từng biển số
-> OCR và chuẩn hóa định dạng biển số Việt Nam
-> vẽ bbox + số thứ tự + biển số lên ảnh output
-> backend lưu ảnh output vào MinIO
-> backend lưu event vào PostgreSQL
-> backend upsert embedding vào Qdrant
-> frontend hiển thị ảnh output và bảng kết quả
```
API chính
```
POST /api/recognize/image
Authorization: Bearer <token>
Content-Type: multipart/form-data
file=<image>
```
### 7.4. Luồng webcam realtime ✨

```
Trình duyệt lấy webcam
-> gửi frame JPEG qua WebSocket /ws/recognize/live
-> backend gọi inference-service
-> lưu snapshot/event nếu có kết quả
-> frontend hiển thị frame annotated gần nhất
```
Webcam yêu cầu chạy trên `localhost` hoặc HTTPS. URL `http://localhost:8080/user/` đáp ứng điều kiện này.

## 8. API chính
Attendance (Xác minh và điểm danh)
```
POST /attendance/identify
GET  /attendance/history
Tag: Employees (Quản lý Nhân viên)
code
Http
POST   /employees/register
GET    /employees/
GET    /employees/search
PATCH  /employees/{id}/status
PUT    /employees/{id}/permissions
DELETE /employees/{id}
```
Departments (Quản lý phòng ban và cửa ra vào)
```
GET  /departments/
POST /departments/
POST /departments/permissions
POST /departments/{dept_id}/quick-setup
```
Doors (Quản lý Cửa ra vào)
```
GET  /doors/
POST /doors/
```
System (Hệ thống)
```
GET /health
```
## 11. Monitoring và Backup
raw backend: https://graffiti-fit-error.ngrok-free.dev/docs
## 12. GitHub private repo
## 13. Ghi chú triển khai CPU
- Giảm kích thước frame webcam trước khi gửi backend.
- Sampling webcam mặc định khoảng 1 frame / 1.2 giây.
- Video batch sample mỗi khoảng 1.5 giây.
- Khi có model YOLO custom nhỏ như YOLO nano, CPU sẽ ổn định hơn baseline OpenCV/EasyOCR.
