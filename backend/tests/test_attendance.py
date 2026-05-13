"""
Tests for attendance endpoints
"""
import pytest
from fastapi.testclient import TestClient

@pytest.fixture
def test_client():
    """Create test client"""
    from app.main import app
    return TestClient(app)

def test_attendance_list(test_client):
    """Test getting attendance logs"""
    response = test_client.get("/api/v1/attendance/logs")
    assert response.status_code in [200, 401]  # 401 if auth required

def test_attendance_stats(test_client):
    """Test getting attendance statistics"""
    response = test_client.get("/api/v1/attendance/stats")
    assert response.status_code in [200, 401]
