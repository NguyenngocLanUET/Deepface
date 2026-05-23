# CI/CD Setup Guide

This project uses GitHub Actions for CI/CD.

## GitHub Actions (Quality Control Only)

### 1. **CI Pipeline** (`.github/workflows/ci.yml`)
Giữ vai trò kiểm tra lỗi code (Linting) và chạy các unit test khi bạn đẩy code lên GitHub để đảm bảo code không bị lỗi logic. Không tham gia vào quá trình cài đặt (Deployment).

### 3. **Code Quality** (`.github/workflows/code-quality.yml`)

Analyzes code quality:

- Radon complexity analysis
- Bandit security checks
- SonarCloud integration

## Deployment Strategy

Dự án này sử dụng mô hình **Hybrid Cloud**:

1. **Backend (Local)**: Chạy trên máy tính cá nhân của bạn thông qua `docker-compose`. Kết nối ra ngoài bằng Ngrok.
2. **Frontend (Cloud)**: Deploy tự động lên Vercel. Vercel kết nối trực tiếp với GitHub nên không cần cấu hình Secrets phức tạp trên GitHub Actions.
3. **Bảo mật**: Chỉ cần cấu hình biến môi trường (`VITE_API_BASE_URL`) trên Dashboard của Vercel.

## Local Development

### Setup environment:

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt
pip install pytest pytest-asyncio pytest-cov
```

### Run tests locally:

```bash
# Run all tests
pytest backend/tests/

# Run with coverage
pytest backend/tests/ --cov=backend/app --cov-report=html

# Run specific test file
pytest backend/tests/test_auth.py -v
```

## Production Deployment

### 1. Create release tag:

```bash
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

### 2. GitHub Actions will:

- Run all tests
- Build Docker images
- Deploy to production
- Send Slack notification

### 3. Verify deployment:

```bash
curl https://your-domain.com/health
```

## Troubleshooting

### Workflow Failures:

1. Check GitHub Actions logs
2. Verify secrets are configured
3. Check Docker image builds
4. Review test failures
5. Check deployment server access and SSH key

## Best Practices

1. **Tag releases**: Use semantic versioning for tags
2. **Test before push**: Run tests locally before pushing
3. **Backup important data**: Keep backups for production storage
4. **Review logs**: Check logs in GitHub Actions for issues

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [FastAPI Testing](https://fastapi.tiangolo.com/advanced/testing-dependencies/)
