## 1. Đăng ký khuôn mặt cho nhân viên (`employees.py`, `worker.py`)

### **Mô tả**
Quản trị viên tạo hồ sơ nhân viên mới và đăng ký khuôn mặt cho nhân viên đó để phục vụ xác minh khi ra vào công ty.  
Hệ thống AI sẽ kiểm tra chất lượng ảnh, trích xuất đặc trưng khuôn mặt (ArcFace Embedding) và tính toán average embedding để lưu vào vector database.

### **Actor**
- **Chính:** Quản trị viên (Admin)
- **Phụ:** Celery Worker (xử lý AI nền)

### **Mục tiêu**
Tạo hồ sơ nhân viên hợp lệ và vector khuôn mặt chính xác để sử dụng ở những lần xác minh sau.

### **Pre-condition**
- Quản trị viên đã đăng nhập vào hệ thống quản lý.
- Phòng ban `department_id` hợp lệ đã tồn tại trong cơ sở dữ liệu.
- Quản trị viên đã chuẩn bị từ **1 đến 3 ảnh khuôn mặt** của nhân viên.

### **Luồng xử lý chính**
1. Quản trị viên nhập thông tin: Tên, Mã nhân viên, ID phòng ban.
2. Upload từ 1–3 ảnh khuôn mặt.
3. Hệ thống kiểm tra số lượng ảnh. Nếu hợp lệ thì tạo nhân viên mới trong SQL DB.
4. Ảnh được lưu tạm và upload lên MinIO.
5. Hệ thống gửi task `process_face_registration` đến Celery Worker.
7. Worker trích xuất embedding khuôn mặt bằng ArcFace.
7. AI kiểm tra chất lượng ảnh và số khuôn mặt (phải đúng 1 mặt).
9. Hệ thống tiến hành tính toán Average Embedding cho nhân viên.
10. Lưu vector vào Qdrant Vector Database.

### **Luồng thay thế**
- Upload ít hơn 1 hoặc nhiều hơn 3 ảnh:
  - Hệ thống báo lỗi.
  - Không tạo nhân viên.

### **Post-condition**
- Hồ sơ nhân viên được lưu trong SQL DB.
- Ảnh gốc được lưu trong MinIO.
- Vector khuôn mặt được lưu trong Qdrant.

### **Exceptions**
- Lỗi chất lượng ảnh/ AI: Ảnh không đạt chuẩn (như quá tối, quá nhòe, không tìm thấy mặt, tìm thấy nhiều khuôn mặt) -> Báo lỗi, vector không được lưu.
- Lỗi kết nối các service: Lỗi kết nối PostgreSQL, MinIO, hoặc Qdrant → Dữ liệu không được lưu.

## 2. Xác minh khuôn mặt và điểm danh ('attendance.py')

### **Mô tả** Hệ thống AI tự động nhận diện và xác minh khuôn mặt từ ảnh được chụp tại cửa, sau đó ghi log điểm danh cho nhân viên.

### **Actor**
- **Chính:** Ảnh của nhân viên được chụp tại cửa
- **Phụ:** Hệ thống AI, hệ thống cửa

### **Mục tiêu** Cho phép nhân viên hợp lệ đi qua cửa, chấm công, ngăn chặn người không có quyền.

### **Pre-condition**
- Hệ thống AI đã khởi động và hoạt động.
- Hệ thống cửa được kết nối và sẵn sàng gửi dữ liệu.
### **Main Flow**
1. Nhân viên bước vào khu vực chấm công. Cửa chụp ảnh và gửi đến API xác minh.
2. Hệ thống AI trích xuất embedding khuôn mặt từ ảnh chụp.
3. Hệ thống AI tìm kiếm vector tương tự gần nhất trong Vector DB (Qdrant).
4. Hệ thống AI so sánh điểm số tương tự với ngưỡng (0.5).
5. Nếu điểm số đạt yêu cầu (>= 0.5), nhận diện được nhân viên.
6. Hệ thống ghi log điểm danh trạng thái "Success".
### **Alternative Flow**:
- Tại bước 5 (Điểm số thấp): Điểm số tương tự thấp hơn ngưỡng (score < 0.5) → Không nhận diện được nhân viên.
- Tại bước 6: Hệ thống ghi log điểm danh trạng thái "Denied" với lý do "Không nhận diện được".
### **Post-condition**:
- Thông tin điểm danh được ghi log vào cơ sở dữ liệu.
### **Exceptions**:
- Lỗi kết nối cơ sở dữ liệu: Lỗi kết nối PostgreSQL.
- Lỗi AI: Lỗi trích xuất embedding từ ảnh chụp.

...

