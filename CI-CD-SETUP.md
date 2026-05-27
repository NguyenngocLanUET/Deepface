# CI/CD Setup Guide

Dự án sử dụng GitHub Actions để tự động kiểm tra chất lượng mã nguồn (CI).

## GitHub Actions

### 1. CI Pipeline (`.github/workflows/ci.yml`)

Pipeline này dùng để:

- Kiểm tra format và coding style (Linting)
- Chạy unit tests
- Kiểm tra lỗi logic trước khi merge code

Pipeline chỉ phục vụ mục đích **Quality Control**, không thực hiện deploy hệ thống.

---

### 2. Code Quality (`.github/workflows/code-quality.yml`)

Pipeline phân tích chất lượng mã nguồn:

- Radon Complexity Analysis
- Bandit Security Check
- SonarCloud Analysis

## Deployment Strategy

Dự án triển khai theo mô hình **Hybrid Cloud**:

### Backend (Local Server)

- Chạy bằng `docker-compose` trên máy cá nhân hoặc máy chủ nội bộ
- Public API thông qua Ngrok

### Frontend (Cloud)

- Deploy tự động lên Vercel
- Vercel kết nối trực tiếp với GitHub repository
- Không cần cấu hình GitHub Actions cho frontend

### Security

Chỉ cần cấu hình biến môi trường trên Vercel:

```env
VITE_API_BASE_URL=https://your-ngrok-url.ngrok-free.app/api
