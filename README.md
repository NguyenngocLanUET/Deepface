# DeepFace: Hệ thống kiểm soát ra vào cửa và chấm công bằng khuôn mặt

## 1. Use case
### Nhiệm vụ: Hệ thống kiểm soát ra vào cửa và thực hiện chấm công cho nhân viên bằng khuôn mặt trong thời gian thực
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

## 3. Kiến trúc

## 4. Yêu cầu môi trường

## 5. Model AI và Dataset

## 6. Cách chạy

## 7. Các luồng dữ liệu chính

## 8. API chính

## 9. Monitoring và Backup
