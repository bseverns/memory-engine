import io
import os
import boto3
from botocore.client import Config
from django.conf import settings

def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.MINIO_ENDPOINT,
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )

def put_bytes(key: str, data: bytes, content_type: str) -> None:
    s3 = s3_client()
    s3.put_object(
        Bucket=settings.MINIO_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
    )

def get_bytes(key: str) -> bytes:
    s3 = s3_client()
    obj = s3.get_object(Bucket=settings.MINIO_BUCKET, Key=key)
    return obj["Body"].read()

def delete_key(key: str) -> None:
    s3 = s3_client()
    s3.delete_object(Bucket=settings.MINIO_BUCKET, Key=key)

def stream_key(key: str):
    s3 = s3_client()
    obj = s3.get_object(Bucket=settings.MINIO_BUCKET, Key=key)
    return obj["Body"], obj.get("ContentType", "application/octet-stream")
