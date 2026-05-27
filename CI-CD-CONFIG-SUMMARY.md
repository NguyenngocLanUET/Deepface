# Tổng quan cấu hình GitHub Actions

## Cấu trúc thư mục

```text
.
├── .github/
│   └── workflows/
│       ├── ci.yml                  # Pipeline CI
│       ├── deploy.yml              # Pipeline triển khai
│       └── code-quality.yml        # Kiểm tra chất lượng mã nguồn
├── backend/
│   ├── tests/....
│   ├── ...
├── frontend/
.                
├── docker-compose.staging.yml
├── docker-compose.prod.yml
└── CI-CD-SETUP.md                  # Tài liệu cấu hình CI/CD
```

## Tổng quan Workflows

### CI Workflow (`ci.yml`)

- **Lint**: Black, isort, flake8
- **Test**: pytest + coverage
- **Build**: Build Docker image
- **Security**: Quét lỗ hổng bằng Trivy

**Kích hoạt khi:**
- Push lên nhánh `main` / `develop`
- Tạo Pull Request

### Deploy Workflow (`deploy.yml`)

- Deploy môi trường staging (`develop`)
- Deploy production (`main` + tags)
- Kiểm tra health check
- Gửi thông báo Slack

**Kích hoạt khi:**
- Push lên `main` / `develop`
- Push tag release

### Code Quality Workflow (`code-quality.yml`)

- Phân tích độ phức tạp bằng Radon
- Kiểm tra bảo mật bằng Bandit
- Phân tích mã nguồn với SonarCloud

**Kích hoạt khi:**
- Push lên `main` / `develop`
- Tạo Pull Request

### 1. Thêm GitHub Secrets

Vào:

`Repository Settings → Secrets and variables → Actions`

Thêm các secrets sau:

```text

```
