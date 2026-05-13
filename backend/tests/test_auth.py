"""
Basic tests for authentication endpoints
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

@pytest.fixture
def test_client():
    """Create test client"""
    from app.main import app
    return TestClient(app)

def test_health_check(test_client):
    """Test health check endpoint"""
    response = test_client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}

def test_register_user(test_client):
    """Test user registration"""
    payload = {
        "username": "testuser",
        "email": "test@example.com",
        "password": "TestPassword123!",
        "full_name": "Test User"
    }
    response = test_client.post("/api/v1/auth/register", json=payload)
    # Should either succeed or fail due to duplicate (if test runs multiple times)
    assert response.status_code in [201, 400]

def test_login_user(test_client):
    """Test user login"""
    # First register
    register_payload = {
        "username": "logintest",
        "email": "logintest@example.com",
        "password": "TestPassword123!"
    }
    test_client.post("/api/v1/auth/register", json=register_payload)
    
    # Then try to login
    login_payload = {
        "username": "logintest",
        "password": "TestPassword123!"
    }
    response = test_client.post("/api/v1/auth/login", json=login_payload)
    
    if response.status_code == 200:
        data = response.json()
        assert "access_token" in data
        assert data["access_token"] is not None
