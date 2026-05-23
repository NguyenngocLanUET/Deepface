# CI/CD Setup Guide

This project uses GitHub Actions for CI/CD.

## GitHub Actions Workflows

### 1. **CI Pipeline** (`.github/workflows/ci.yml`)

Runs on every push and pull request:

- **Lint Backend**: Checks code style with Black and isort
- **Test Backend**: Runs pytest with coverage
- **Build Backend**: Creates Docker image
- **Security Scan**: Trivy vulnerability scanning

### 2. **Deploy** (`.github/workflows/deploy.yml`)

Deploys to staging/production:

- **Staging**: On develop branch
- **Production**: On main branch with tags

### 3. **Code Quality** (`.github/workflows/code-quality.yml`)

Analyzes code quality:

- Radon complexity analysis
- Bandit security checks
- SonarCloud integration

## Secrets Configuration

Add these secrets in GitHub repository settings (**Settings > Secrets and variables > Actions**):

```
DEPLOY_KEY              # SSH private key for deployment
DEPLOY_HOST_STAGING     # Staging server hostname
DEPLOY_HOST_PROD        # Production server hostname
DEPLOY_USER            # Deployment user
SONAR_TOKEN            # SonarCloud token
SLACK_WEBHOOK          # Slack notification webhook
NGROK_AUTHTOKEN         # Ngrok Auth Token từ dashboard.ngrok.com
NGROK_DOMAIN            # Domain cố định (ví dụ: your-app.ngrok-free.dev)
DATABASE_URL            # postgresql://admin:123@db:5432/attendance
POSTGRES_USER           # admin
POSTGRES_PASSWORD       # 123
MINIO_ROOT_USER         # admin
MINIO_ROOT_PASSWORD     # password123
```

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
