import boto3
import os
from botocore.client import Config
import time

class StorageService:
    def __init__(self):
        # Thêm một chút retry logic để đợi MinIO khởi động
        self.s3 = boto3.client(
            's3',
            endpoint_url=os.getenv("MINIO_URL", "http://minio:9000"),
            aws_access_key_id=os.getenv("MINIO_ROOT_USER"),
            aws_secret_access_key=os.getenv("MINIO_ROOT_PASSWORD"),
            config=Config(signature_version='s3v4'),
            region_name='us-east-1'
        )
        self.bucket_name = "attendance-bucket"
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