import boto3
import os
from botocore.client import Config
import time
from app.core.config import settings  # Import settings từ config.py

class StorageService:
    def __init__(self):
        # Sử dụng thông tin từ settings thay vì gọi os.getenv bị sai tên
        self.s3 = boto3.client(
            's3',
            endpoint_url=settings.MINIO_ENDPOINT,
            aws_access_key_id=settings.MINIO_ACCESS_KEY,
            aws_secret_access_key=settings.MINIO_SECRET_KEY,
            config=Config(signature_version='s3v4'),
            region_name='us-east-1'
        )
        self.bucket_name = settings.MINIO_BUCKET_NAME
        # Không gọi _ensure ở đây để tránh crash khi vừa start, 
        # sẽ gọi từ main lifespan sau.

    def _ensure_bucket_exists(self):
        try:
            self.s3.head_bucket(Bucket=self.bucket_name)
        except:
            print(f"Creating bucket: {self.bucket_name}")
            self.s3.create_bucket(Bucket=self.bucket_name)

    def upload_file(self, file_data, object_name):
        # Đảm bảo con trỏ file ở vị trí đầu tiên
        file_data.seek(0)
        self.s3.upload_fileobj(file_data, self.bucket_name, object_name)
        return object_name

    def download_file(self, object_name, local_path):
        self.s3.download_file(self.bucket_name, object_name, local_path)
        return local_path

    def get_file_object(self, object_name):
        return self.s3.get_object(Bucket=self.bucket_name, Key=object_name)

    def list_objects(self, prefix):
        """Liệt kê các object trong bucket với prefix cho trước"""
        try:
            response = self.s3.list_objects_v2(Bucket=self.bucket_name, Prefix=prefix)
            if 'Contents' in response:
                return [obj['Key'].replace(prefix, '') for obj in response['Contents'] if obj['Key'] != prefix]
            return []
        except Exception as e:
            print(f"Lỗi liệt kê objects: {str(e)}")
            return []

    def get_object(self, object_name):
        """Lấy nội dung của một object"""
        try:
            response = self.s3.get_object(Bucket=self.bucket_name, Key=object_name)
            return response['Body'].read()
        except Exception as e:
            print(f"Lỗi lấy object: {str(e)}")
            raise

    def delete_object(self, object_name):
        """Xóa một object"""
        try:
            self.s3.delete_object(Bucket=self.bucket_name, Key=object_name)
            return True
        except Exception as e:
            print(f"Lỗi xóa object: {str(e)}")
            return False
