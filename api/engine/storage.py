import io
import mimetypes
import os
from pathlib import Path

import boto3
from botocore.client import Config
from django.conf import settings


def local_blob_storage_root():
    root = str(getattr(settings, "LOCAL_BLOB_STORAGE_ROOT", "") or "").strip()
    if not root:
        return None
    return Path(root)


def local_blob_path(key: str) -> Path:
    return local_blob_storage_root() / Path(key)


def local_blob_content_type_path(key: str) -> Path:
    return local_blob_path(key).with_suffix(local_blob_path(key).suffix + ".content-type")


def local_blob_storage_enabled() -> bool:
    return local_blob_storage_root() is not None


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
    if local_blob_storage_enabled():
        path = local_blob_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        local_blob_content_type_path(key).write_text(content_type or "application/octet-stream")
        return
    s3 = s3_client()
    s3.put_object(
        Bucket=settings.MINIO_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
    )

def get_bytes(key: str) -> bytes:
    if local_blob_storage_enabled():
        return local_blob_path(key).read_bytes()
    s3 = s3_client()
    obj = s3.get_object(Bucket=settings.MINIO_BUCKET, Key=key)
    return obj["Body"].read()


def delete_key(key: str) -> None:
    if local_blob_storage_enabled():
        path = local_blob_path(key)
        content_type_path = local_blob_content_type_path(key)
        if path.exists():
            path.unlink()
        if content_type_path.exists():
            content_type_path.unlink()
        return
    s3 = s3_client()
    s3.delete_object(Bucket=settings.MINIO_BUCKET, Key=key)


def stream_key(key: str):
    if local_blob_storage_enabled():
        path = local_blob_path(key)
        content_type_path = local_blob_content_type_path(key)
        if content_type_path.exists():
            content_type = content_type_path.read_text().strip() or "application/octet-stream"
        else:
            content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        return io.BytesIO(path.read_bytes()), content_type
    s3 = s3_client()
    obj = s3.get_object(Bucket=settings.MINIO_BUCKET, Key=key)
    return obj["Body"], obj.get("ContentType", "application/octet-stream")
