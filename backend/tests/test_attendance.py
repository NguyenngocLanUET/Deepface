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

def test_attendance_grace_period(test_client):
    """Test attendance within grace period"""
    response = test_client.post("/api/v1/attendance/identify", json={"checkin_time": "08:35"})
    assert response.status_code == 200
    assert response.json()["message"] == "Chấm công thành công (trong thời gian ân hạn)"

def test_attendance_late(test_client):
    """Test attendance after grace period"""
    response = test_client.post("/api/v1/attendance/identify", json={"checkin_time": "08:50"})
    assert response.status_code == 200
    assert response.json()["message"] == "Chấm công thành công (muộn)"

def test_attendance_history_single_employee(test_client):
    """Test getting attendance history for single employee"""
    response = test_client.get("/api/v1/attendance/history?employee_id=1")
    assert response.status_code in [200, 401]

def test_attendance_history_multiple_employees(test_client):
    """Test getting attendance history for multiple employees"""
    response = test_client.get("/api/v1/attendance/history?employee_ids=1,2,3")
    assert response.status_code in [200, 401]

def test_departments_with_permissions(test_client):
    """Test getting departments with their access permissions"""
    response = test_client.get("/api/v1/attendance/departments-with-permissions")
    assert response.status_code in [200, 401]
    if response.status_code == 200:
        data = response.json()
        assert isinstance(data, list)
        for dept in data:
            assert "id" in dept
            assert "name" in dept
            assert "permissions" in dept
