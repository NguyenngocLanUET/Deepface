# DeepFace: Hệ thống kiểm soát ra vào cửa và chấm công bằng khuôn mặt
## 1. Kiến trúc

<img width="7524" height="4932" alt="image" src="https://github.com/user-attachments/assets/88ac4d65-9597-44ec-8e7c-6aa2b1e6eaf9" />
<pre>
Trình duyệt / Camera --> GitHub Actions (CI/CD) --> Docker Containers
                                                          |
                 +----------------------------------------+------------------------------------------+
                 |                                                                                   |
          Frontend (Vite + React)                                                            Ngrok Tunnel (Public URL)
          (User / Admin Portal)                                                                      |
                 |                                                                                   |
                 v                                                                                   v
          FastAPI (Backend) <------------------------------------------------------------------------+
                 |
                 +--> AI Engine (DeepFace/OpenCV)   (Trích xuất đặc trưng khuôn mặt)
                 +--> PostgreSQL                    (Lưu thông tin NV, Cửa, Lịch sử, Cấu hình)
                 +--> Qdrant (Vector DB)            (Lưu trữ face embeddings, search similarity)
                 +--> Redis                         (Cache, Anti-spam Cooldown, Message Broker)
                 +--> Celery Worker                 (Đăng ký khuôn mặt, Bulk import, tính trung bình vector)
                 +--> MinIO (S3 Compatible)         (Lưu trữ ảnh gốc, ảnh chụp)
                 +--> Prometheus & Grafana          (Theo dõi tài nguyên hệ thống, Logs)
</pre>
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
- Phần cứng: CPU tối thiểu 4 Cores, ưu tiên CPU có hỗ trợ lệnh AVX2 để tăng tốc độ xử lý, RAM tối thiểu 12GB.
- Hệ điều hành: đã được thử nghiệm trên Windows.
- Network: cần có kết nối Internet trong lần đầu tiên chạy.

## 4. Tài khoản mặc định
Hệ thống sử dụng JWT Authentication. Các giá trị này nằm trong `.env` và có thể đổi trước khi chạy.
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

### 5.1. Model AI 
- Mô hình Nhận diện: ArcFace (tối ưu nhất về khả năng nhận diện góc nghiêng và ánh sáng phức tạp, vector 512 dims).
- Mô hình Phát hiện khuôn mặt: retinaface (mạnh nhất để detect và align khuôn mặt).
- Normalization: L2 trước khi lưu trữ vector vào Qdrant.
### 5.2. Dataset
   Dự án này sử dụng bộ dữ liệu ** [SCface (Surveillance Cameras Face Database)](https://scface.org/)** đã chỉnh sửa cho phù hợp dự án để thử nghiệm và đánh giá pipeline nhận diện khuôn mặt.
   Source: 
   Cấu trúc dữ liệu sử dụng trong dự án:
   - Dữ liệu thông tin của nhân viên `employees.json`: bao gồm mã nhân viên, họ và tên, phòng ban, chức vụ, liên hệ, trạng thái làm việc, trạng thái cập nhật ảnh xác minh
   - Dữ liệu ảnh upload để làm ảnh gốc `mugshot_frontal_cropped_all` : Chứa ảnh của 130 nhân viên theo ba góc: góc chính diện, góc lệch trái và góc lệch phải
   - `surveillance_cameras_distance_1`, `surveillance_cameras_distance_2`, `surveillance_cameras_distance_3`chứa ảnh chụp từ 3 khoảng cách khác nhau với 4 camera giám sát để thực hiện luồng xác minh tại cửa để mô phỏng ảnh chụp realtime từ camera ở cửa.

```
Cấu trúc database
database/
├── employees.json
└── Images/
    ├── Fail/
    ├── mugshot_frontal_cropped_all/
    ├── mugshot_rotation_all/
    ├── surveillance_cameras_distance_1/
    ├── surveillance_cameras_distance_2/
    ├── surveillance_cameras_distance_3/
    └── Readme.txt 
```
## 6. Cách chạy ✨
   1. Kiểm tra file `.env`. Có thể tạo lại từ `.env.example` nếu cần.
   2. Build và chạy toàn bộ stack:
      ```
      docker compose up -d --build
      ```
   3. Mở các URL:
      ```
      User/Admin Frontend:
      Backend API Docs: http://localhost:8000/docs
      Public API (Ngrok): https://graffiti-fit-error.ngrok-free.dev/docs
      MinIO Console: http://localhost:9001
      Grafana: http://localhost:3000
      Prometheus: http://localhost:9090
      Qdrant: http://localhost:6333/dashboard
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
-> Qdrant tìm kiếm vector tương tự 
-> Nhận diện được ID nhân viên
-> Kiểm tra logic Quyền truy cập (db_service.check_access_permission):
     1. Nhân viên có bị khóa không?
     2. Có quyền qua cửa này không?
     3. Khung giờ hiện tại hợp lệ không?
-> FastAPI lưu ảnh sự kiện lên MinIO, ghi Log (SUCCESS/DENIED) vào PostgreSQL
-> Redis set Cooldown (60s) chống spam
-> Trả về kết quả đóng/mở cửa.
```
API chính
```
POST /api/v1/attendance/identify?door_name=<string>
Content-Type: multipart/form-data
file=<image_binary>
```
### 7.2. Luồng đăng ký khuôn mặt nhân viên mới 

```
Admin gửi thông tin nhân viên và 1 đến 5 ảnh gốc
-> FastAPI tạo record trong PostgreSQL
-> Upload ảnh lên MinIO bucket
-> Gửi task process_face_registration vào hàng đợi Redis
-> Celery Worker lấy task từ Redis
-> Worker tải ảnh từ MinIO
-> Kiểm tra chất lượng (đủ sáng, không nhòe, duy nhất 1 mặt)
-> Trích xuất các Vector và tính Average Vector
-> Lưu Average Vector vào Qdrant
```
API chính
```
POST /api/v1/employees/register
Content-Type: multipart/form-data

full_name=<string>
employee_code=<string>
department_name=<string>
files=[<image1_binary>, <image2_binary>, ...]
```
### 7.3. Luồng Bulk Import (Dành cho khởi tạo hệ thống)

```
Admin upload 1 file ZIP (chứa file metadata.json và hàng loạt ảnh)
-> FastAPI giải nén vào thư mục tạm
-> Quét file JSON, lặp qua từng nhân viên
-> Tạo record DB và upload ảnh vào MinIO
-> Thêm hàng loạt task process_face_registration vào Celery Worker
-> Worker tuần tự xử lý vector trong nền.
```
API chính
```
POST /admin/bulk-import
Content-Type: multipart/form-data

zip_file=<zip_file_binary>
```
### 7.. Luồng thiết lập quyền truy cập nhanh
```
Admin chọn 1 phòng ban, chọn nhiều cửa và khung giờ
-> FastAPI tiếp nhận payload
-> Lặp qua danh sách các cửa (door_ids)
-> PostgreSQL lưu bản ghi phân quyền (DeptPermission)
-> Từ lúc này, mọi nhân viên thuộc phòng ban đó sẽ được ra vào các cửa đã chọn trong khung giờ quy định.
```
```
POST /api/v1/departments/{dept_id}/quick-setup
Content-Type: application/json

{
  "door_ids": [1, 2, 3, 4],
  "start_time": "08:00:00",
  "end_time": "18:00:00"
}
```

## 8. API chính
Authentication (Xác thực)
```
POST /api/v1/auth/login (Đăng nhập)
POST /api/v1/auth/register (Tạo tài khoản)
GET  /api/v1/auth/me
```
Attendance (Chấm công và Điểm danh)
POST /api/v1/attendance/identify (Nhận diện khuôn mặt)
GET  /api/v1/attendance/history (Xem lịch sử)
GET  /api/v1/attendance/stats/monthly (Thống kê tháng)
GET  /api/v1/attendance/export/excel (Xuất file Excel)

Employees (Quản lý Nhân viên)
```
POST   /api/v1/employees/register (Đăng kí thông tin cho nhân viên)
GET    /api/v1/employees/ (Lấy danh sách tất cả nhân viên)
PATCH  /api/v1/employees/{id}/status (Khóa hoặc mở tài khoản)
PUT    /api/v1/employees/{id}/permissions (Cấp quyền cửa)
DELETE /api/v1/employees/{id} (Xóa nhân viên)
```
Departments & Doors (Quản lý phòng ban và cửa ra vào)
```
GET  /api/v1/departments/
POST /api/v1/departments/permissions
POST /api/v1/departments/{dept_id}/quick-setup (Phân quyền hàng loạt)
GET  /api/v1/doors/ (Redis cached)
```
Admin Tools (Công cụ quản trị)
```
POST /admin/bulk-import (Tải ZIP và đăng kí cho nhiều nhân viên một lúc)
GET  /admin/system-stats (Dashboard tổng quan)
```
System (Hệ thống)
```
GET /health
GET /metrics
```
## 9. Quản lý Dữ liệu (Volumes)
Dữ liệu được bảo toàn qua các Docker Volume định nghĩa sẵn dù có khởi động lại hệ thống:
*   `postgres_data`: Lưu trữ User, Employee, Attendance Log.
*   `qdrant_storage`: Cơ sở dữ liệu Vector nhận diện khuôn mặt.
*   `minio_data`: Kho hình ảnh gốc và ảnh snapshoot điểm danh.
*   `deepface_models`: Lưu trữ trọng số của mô hình để tránh tải lại khi khởi động lại.
*   `grafana_data`: Lưu cấu hình các bảng dashboard phân tích hệ thống.

## 11. Monitoring và Backup
## 11.1 Theo dõi hệ thống thông qua Dashboards & Logs:
Dashboards:
*   `Grafana Dashboard:` Dùng để theo dõi tài nguyên (CPU, RAM), số lượng Request API, thời gian phản hồi và tỷ lệ lỗi,...
*   `MinIO Console:` Quản lý dung lượng lưu trữ ảnh tĩnh, kiểm tra file rác.
*   `Qdrant Dashboard:` Trực quan hóa các Collection, số lượng Vector khuôn mặt hiện có và theo dõi hiệu suất bộ nhớ.
Theo dõi hệ thống thông qua Logs:
*   **Logs:** Theo dõi hoạt động của hệ thống qua:
    ```bash
    docker compose logs -f backend 
    docker compose logs -f worker   
    ```
## 11.2 Hướng dẫn Backup & Restore dữ liệu
Thực hiện sao lưu thủ công thông qua các lệnh:

**1. Backup PostgreSQL (Dữ liệu quan hệ):**
Xuất toàn bộ dữ liệu ra file `.sql`:
```bash
docker exec -t <tên_container_db> pg_dump -U admin attendance > db_backup_$(date +%F).sql
```
*(Khôi phục: `cat db_backup.sql | docker exec -i <tên_container_db> psql -U admin -d attendance`)*

**2. Backup Vector Qdrant:**
```bash
curl -X POST 'http://localhost:6333/collections/face_embeddings/snapshots'
```
File snapshot sẽ được lưu tự động bên trong volume `qdrant_storage/snapshots/`.

**3. Backup Hình ảnh (MinIO):**
```bash
# Stop MinIO tạm thời để tránh mất mát data đang ghi
docker compose stop minio
tar -czvf minio_backup_$(date +%F).tar.gz /var/lib/docker/volumes/tên_project_minio_data/_data
docker compose start minio
```
## 12. GitHub private repo
## 13. Ghi chú triển khai CPU
- Nếu chạy trên hệ thống không có GPU (chỉ có CPU), hàm detection OpenCV được khuyên dùng để tránh quá tải RAM thay vì RetinaFace.
- Worker được cấu hình tách biệt với API chính, giúp hệ thống không bị nghẽn khi đăng ký quá nhiều nhân viên cùng lúc.
- Ngrok cung cấp kết nối HTTPS SSL tự động để WebRTC/Webcam phía Frontend có thể xin quyền truy cập Camera từ trình duyệt.
