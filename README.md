# DeepFace: Hệ thống kiểm soát ra vào cửa và chấm công bằng khuôn mặt

## 1. Use case
**Nhiệm vụ**: Hệ thống kiểm soát ra vào cửa và thực hiện chấm công cho nhân viên bằng khuôn mặt trong thời gian thực
```
Camera tại cửa chụp ảnh mặt nhân viên realtime 
-> API Backend FastAPI tiếp nhận
-> Trích xuất Embedding khuôn mặt (DeepFace - ArcFace Model)
-> Tìm kiếm khuôn mặt tương tự trong Vector DB (Qdrant) với ngưỡng score > 0.5
-> Nhận diện ID nhân viên 
-> Kiểm tra logic quyền truy cập (PostgreSQL):
     1. Tài khoản có Active không?
     2. Nhân viên có quyền ra vào tại cửa này không?
     3. Nếu không, có quyền kế thừa từ Phòng ban tại cửa này không?
     4. Giờ hiện tại có phải trong khung giờ cho phép không?
-> Trả về kết quả: Mở cửa (SUCCESS) hoặc Từ chối (DENIED + Lý do)
-> Lưu lịch sử nhận diện và kết quả kiểm tra vào PostgreSQL
```
Hệ thống nhận diện khuôn mặt nhân viên thông qua webcam realtime. ✨ Chỉnh sửa lại câu này: Dự án được thiết kế theo yêu cầu đồ án: có frontend nhân viên, frontend quản trị viên, backend, database, object storage, vector database, queue, Nginx reverse proxy, Docker Compose, monitoring và tài liệu tái hiện.

## 2. Chức năng chính
   **Điểm danh cho nhân viên**: Tiếp nhận ảnh từ camera cửa, nhận diện khuôn mặt, kiểm tra quyền truy cập nhiều lớp (trạng thái tài khoản, quyền cá nhân, quyền phòng ban, khu vực, khung giờ) rồi mới quyết định mở cửa.

   **Đăng ký khuôn mặt cho nhân viên mới**: Hỗ trợ upload 1-3 ảnh cho một nhân viên, liên kết ảnh với dữ liệu nhân viên đã có. Celery Worker xử lý nền để: kiểm tra chất lượng ảnh (độ sáng, độ nhòe, số mặt), tính ArcFace embedding cho từng ảnh, và tính Average Embedding cuối cùng.

   **Quản lý quyền truy cập cho nhân viên**: Cấp quyền truy cập theo cửa và khung giờ. Hỗ trợ cấp quyền riêng cho cá nhân hoặc kế thừa cho nguyên một phòng ban.

   **Quản trị nhân viên**: Tìm kiếm nhân viên nâng cao, khóa/ mở tài khoản, thêm/ xóa hoàn toàn nhân viên.

   **Xem lịch sử điểm danh**: Tra cứu nhật ký ra vào thời gian thực, sắp xếp theo thời gian mới nhất, hiển thị trạng thái (SUCCESS/DENIED) và lý do từ chối cụ thể.

   **Lưu trữ dữ liệu**: Lưu lịch sử vào PostgreSQL, lưu ảnh khuôn mặt gốc vào MinIO, lưu vector khuôn mặt vào Qdrant.

## 3. Kiến trúc

## 4. Yêu cầu môi trường

## 5. Model AI và Dataset
### 5.1. Dataset
   Dự án này sử dụng bộ dữ liệu ** [SCface (Surveillance Cameras Face Database)](https://scface.org/)** đã chỉnh sửa cho phù hợp dự án để thử nghiệm và đánh giá pipeline nhận diện khuôn mặt.
   
   Cấu trúc dữ liệu sử dụng trong dự án: ✨ % Chỉnh sửa thêm tên của file
   - Dữ liệu ảnh upload để làm ảnh gốc ✨ : Chứa ảnh của 130 nhân viên theo ba góc: góc chính diện, góc lệch trái và góc lệch phải
   - Sử dụng ảnh chụp từ 4 camera giám sát với 3 khoảng cách khác nhau để thực hiện luồng xác minh tại cửa để mô phỏng ảnh chụp realtime từ camera ở cửa.

```
Cấu trúc database
```

## 6. Cách chạy

## 7. Các luồng dữ liệu chính

## 8. API chính

## 9. Monitoring và Backup



raw backend: https://graffiti-fit-error.ngrok-free.dev/docs
