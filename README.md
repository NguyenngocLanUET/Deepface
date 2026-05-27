# <span style="color: #1E3A8A;">DeepFace: Hệ thống kiểm soát ra vào cửa và chấm công bằng khuôn mặt</span>

## <span style="color: #059669;">1. Kiến trúc</span>

<img width="7524" height="4932" alt="image" src="https://github.com/user-attachments/assets/88ac4d65-9597-44ec-8e7c-6aa2b1e6eaf9" />
<pre>
             Trình duyệt / Camera ---> GitHub Actions (CI/CD) ---> Docker Containers
                                                                           |
                     +-----------------------------------------------------+-----------------------------+
                     |                                                                                   |
          Frontend (Vite + React)                                                            Ngrok Tunnel (Public URL)
           (User / Admin Portal)                                                                         |
                     |                                                                                   |
                     v                                                                                   v
             FastAPI (Backend) <-------------------------------------------------------------------------+
                     |
                     +--> (DeepFace/OpenCV)             (Trích xuất đặc trưng khuôn mặt)
                     +--> PostgreSQL                    (Lưu thông tin NV, Cửa, Lịch sử, Cấu hình)
                     +--> Qdrant                        (Lưu trữ face embeddings, search similarity)
                     +--> Redis                         (Cache, Anti-spam Cooldown, Message Broker)
                     +--> Celery Worker                 (Đăng ký khuôn mặt, Bulk import, tính trung bình)
                     +--> MinIO                         (Lưu trữ ảnh gốc, ảnh chụp sự kiện)
                     +--> Prometheus & Grafana          (Theo dõi tài nguyên hệ thống, Logs)
</pre>

## <span style="color: #059669;">2. Chức năng chính</span>

- **Điểm danh nhân viên**: Nhận ảnh từ camera, nhận diện khuôn mặt và kiểm tra quyền truy cập nhiều lớp (trạng thái tài khoản, quyền cá nhân/phòng ban, khu vực, khung giờ) trước khi mở cửa.

- **Đăng ký khuôn mặt**: Hỗ trợ upload 1–5 ảnh cho mỗi nhân viên, liên kết hoặc cập nhật dữ liệu khuôn mặt. Celery Worker xử lý nền gồm kiểm tra chất lượng ảnh, trích xuất ArcFace embedding và tính Average Embedding.

- **Quản lý quyền truy cập**: Phân quyền theo cửa và khung giờ cho cá nhân hoặc toàn bộ phòng ban.

- **Quản trị nhân viên**: Hỗ trợ tìm kiếm nâng cao, khóa/mở tài khoản, thêm/xóa nhân viên.

- **Lịch sử điểm danh**: Theo dõi log thời gian thực, sắp xếp theo thời gian mới nhất, hiển thị trạng thái SUCCESS/DENIED và lý do từ chối.

- **Lưu trữ dữ liệu**: PostgreSQL lưu log, MinIO lưu ảnh gốc, Qdrant lưu vector khuôn mặt.

### <span style="color: #D97706;">2.1. Logic đăng ký ảnh</span>

- Sử dụng nhiều ảnh ở các góc khác nhau để tính **Average Vector** và chuẩn hóa L2.
- Hỗ trợ xử lý burst mode 10 ảnh liên tục, chọn ảnh có Score tốt nhất.
- Tự động loại bỏ ảnh mờ, thiếu sáng hoặc không có khuôn mặt.

### <span style="color: #D97706;">2.2. Logic điểm danh</span>

- **Anti-spam Cooldown**: Áp dụng cooldown mặc định 60s sau mỗi lần điểm danh thành công.
- Người lạ chỉ bị ghi nhận DENIED khi xuất hiện liên tục > 3.5 giây nhằm giảm log rác.
- Tự động phân loại trạng thái: *Thành công*, *Trong giờ được phép* hoặc *Muộn*.

### <span style="color: #D97706;">2.3. Logic quản lý</span>

- **Bulk Import**: Import hàng nghìn nhân viên qua file ZIP, hỗ trợ metadata.json hoặc cấu trúc thư mục.
- **Phân quyền cửa**:
  - Theo cá nhân.
  - **Quick Setup** theo phòng ban và khung giờ.
- Dashboard cập nhật realtime qua WebSocket với Score và lý do từ chối.
- Tự động dọn log và snapshot người lạ lúc 2h sáng hằng ngày.

---

## <span style="color: #059669;">3. Yêu cầu môi trường</span>

- Docker Desktop, Docker Compose.
- CPU tối thiểu 4 cores (khuyến nghị hỗ trợ AVX2), RAM tối thiểu 12GB.
- Đã thử nghiệm trên Windows.
- Cần Internet khi chạy lần đầu để tải model.

---

## <span style="color: #059669;">4. Tài khoản</span>

### <span style="color: #D97706;">4.1. Tài khoản mặc định</span>

```yaml
Admin:
  username: admin
  password: admin123

User:
  username: user
  password: user123
```

*Cấu hình trong `.env` và có thể thay đổi trước khi chạy (xem mẫu `.env_example`).*

### <span style="color: #D97706;">4.2. Tài khoản nhân viên</span>

```yaml
Nhân viên:
  username: <mã nhân viên>
  password: user123
```

*Kích hoạt sau khi đăng ký khuôn mặt thành công.*

---

## <span style="color: #059669;">5. Model AI và Dataset</span>

### <span style="color: #D97706;">5.1. Model AI</span>

- Phát hiện khuôn mặt: `RetinaFace` / `OpenCV`.
- Nhận diện khuôn mặt: `ArcFace` (512-dim).
- Chuẩn hóa vector bằng L2 Normalization.
- Model pretrained tự động tải khi khởi động bằng Docker nếu chưa tồn tại.

### <span style="color: #D97706;">5.2. Dataset</span>

Sử dụng bộ dữ liệu **SCface** đã chỉnh sửa để đánh giá pipeline nhận diện khuôn mặt.

Bao gồm:
- `employees.json`: Thông tin nhân viên.
- `mugshot_frontal_cropped_all`: Ảnh gốc nhiều góc.
- `surveillance_cameras_distance_*`: Ảnh mô phỏng camera giám sát ở nhiều khoảng cách.

```text
database/
├── employees.json
└── Images/
    ├── mugshot_frontal_cropped_all/
    ├── surveillance_cameras_distance_1/
    ├── surveillance_cameras_distance_2/
    └── surveillance_cameras_distance_3/
```

---

## <span style="color: #059669;">6. Cách chạy</span>

  1. Cấu hình `.env` từ `.env.example`
  
  2. Khởi chạy hệ thống:
  ```bash
  docker compose up -d --build
  ```
  
  3. Các dịch vụ chính:
  ```yaml
  Frontend: https://deepface-azure.vercel.app
  Backend Docs: http://localhost:8000/docs
  MinIO: http://localhost:9001
  Grafana: http://localhost:3000
  Prometheus: http://localhost:9090
  Qdrant: http://localhost:6333/dashboard
  ```
  
  4. Xem log:
  ```bash
  docker compose logs -f backend
  docker compose logs -f worker
  ```
  
  5. Dừng hệ thống:
  ```bash
  docker compose down
  ```

## <span style="color: #059669;">7. Các luồng dữ liệu chính</span>

### <span style="color: #D97706;">7.1. Luồng xác minh</span>

```text
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
**API chính:**
```http
POST /api/v1/attendance/identify?door_name=<string>
Content-Type: multipart/form-data

file=<image_binary>
```

### <span style="color: #D97706;">7.2. Luồng đăng ký khuôn mặt nhân viên mới</span> 
```text
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
**API chính:**
```http
POST /api/v1/employees/register
Content-Type: multipart/form-data

full_name=<string>
employee_code=<string>
department_name=<string>
files=[<image1_binary>, <image2_binary>, ...]
```

### <span style="color: #D97706;">7.3. Luồng Bulk Import (Dành cho khởi tạo hệ thống)</span>
```text
Admin upload 1 file ZIP (chứa file metadata.json và hàng loạt ảnh)
-> FastAPI giải nén vào thư mục tạm
-> Quét file JSON, lặp qua từng nhân viên
-> Tạo record DB và upload ảnh vào MinIO
-> Thêm hàng loạt task process_face_registration vào Celery Worker
-> Worker tuần tự xử lý vector trong nền.
```
Hệ thống hỗ trợ file `metadata.json` trong ZIP:
```json
[
  {
    "full_name": "Nguyen Van A",
    "employee_code": "EMP001",
    "department_name": "IT Dept",
    "images": ["folder1/img1.jpg", "folder1/img2.jpg"]
  }
]
```
**API chính:**
```http
POST /admin/bulk-import
Content-Type: multipart/form-data

zip_file=<zip_file_binary>
```

### <span style="color: #D97706;">7.4. Luồng thiết lập quyền truy cập nhanh</span>
```text
Admin chọn 1 phòng ban, chọn nhiều cửa và khung giờ
-> FastAPI tiếp nhận payload
-> Lặp qua danh sách các cửa (door_ids)
-> PostgreSQL lưu bản ghi phân quyền (DeptPermission)
-> Từ lúc này, mọi nhân viên thuộc phòng ban đó sẽ được ra vào các cửa đã chọn trong khung giờ quy định.
```
**API chính:**
```http
POST /api/v1/departments/{dept_id}/quick-setup
Content-Type: application/json

{
  "door_ids": [1, 2, 3, 4],
  "start_time": "08:00:00",
  "end_time": "18:00:00"
}
```
## <span style="color: #059669;">8. API chính</span>
| Nhóm API | Endpoint | Chức năng |
|---|---|---|
| **Authentication** | `POST /api/v1/auth/login` | Đăng nhập |
|  | `POST /api/v1/auth/register` | Tạo tài khoản |
|  | `GET /api/v1/auth/me` | Lấy thông tin tài khoản hiện tại |
| **Attendance** | `POST /api/v1/attendance/identify` | Nhận diện khuôn mặt và điểm danh |
|  | `GET /api/v1/attendance/history` | Xem lịch sử điểm danh |
|  | `GET /api/v1/attendance/stats/monthly` | Thống kê điểm danh theo tháng |
|  | `GET /api/v1/attendance/export/excel` | Xuất báo cáo Excel |
| **Employees** | `POST /api/v1/employees/register` | Đăng ký nhân viên và khuôn mặt |
|  | `GET /api/v1/employees/` | Lấy danh sách nhân viên |
|  | `PATCH /api/v1/employees/{id}/status` | Khóa/Mở tài khoản |
|  | `PUT /api/v1/employees/{id}/permissions` | Cấp quyền truy cập cửa |
|  | `DELETE /api/v1/employees/{id}` | Xóa nhân viên |
| **Departments & Doors** | `GET /api/v1/departments/` | Lấy danh sách phòng ban |
|  | `POST /api/v1/departments/permissions` | Cấp quyền theo phòng ban |
|  | `POST /api/v1/departments/{dept_id}/quick-setup` | Phân quyền nhanh hàng loạt |
|  | `GET /api/v1/doors/` | Lấy danh sách cửa |
| **Admin Tools** | `POST /admin/bulk-import` | Import hàng loạt bằng ZIP |
|  | `GET /admin/system-stats` | Thống kê tổng quan hệ thống |
| **System** | `GET /health` | Health Check |
|  | `GET /metrics` | Metrics cho Prometheus |
---

## <span style="color: #059669;">9. Quản lý dữ liệu (Volumes)</span>

- `postgres_data`: User, Employee, Attendance Log.
- `qdrant_storage`: Vector khuôn mặt.
- `minio_data`: Ảnh gốc và snapshot.
- `deepface_models`: Trọng số model.
- `grafana_data`: Dashboard Grafana.

---

## <span style="color: #059669;">10. Monitoring và Backup</span>

### <span style="color: #D97706;">10.1. Monitoring</span>

- **Grafana**: Theo dõi CPU, RAM, API, latency, error rate.
- **MinIO Console**: Quản lý ảnh lưu trữ.
- **Qdrant Dashboard**: Theo dõi collection và vector.

```bash
docker compose logs -f backend
docker compose logs -f worker
```

- `/health`: Health check.
- `/metrics`: Metrics cho Prometheus.
- Log chi tiết SUCCESS/DENIED, Score, Door, Reason.

### <span style="color: #D97706;">10.2. Backup & Restore</span>

**PostgreSQL**
```bash
pg_dump -> .sql
```

**Qdrant**
```bash
POST /collections/face_embeddings/snapshots
```

**MinIO**
```bash
tar backup volume minio_data
```

---

## <span style="color: #059669;">11. Ghi chú triển khai CPU</span>

- Với hệ thống không có GPU, ưu tiên OpenCV detection để giảm tải RAM.
- Worker tách biệt với API giúp tránh nghẽn khi đăng ký số lượng lớn.
- Ngrok hỗ trợ HTTPS để frontend truy cập webcam qua trình duyệt.
