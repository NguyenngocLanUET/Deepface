"""
Tests configuration
"""
import os
from dotenv import load_dotenv

# Load test environment variables
load_dotenv(".env.test")

# Override settings for testing
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL", "sqlite:///./test.db")
os.environ["REDIS_URL"] = os.getenv("TEST_REDIS_URL", "redis://localhost:6379/1")
