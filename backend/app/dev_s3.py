"""Development only: create the photo bucket on the local S3 server and make it publicly readable.

    docker compose --profile s3 up -d s3
    docker compose exec api python -m app.dev_s3

On Cloudflare R2 you do the equivalent in the dashboard instead (see README).
"""

import json

from app.config import get_settings
from app.storage import S3PhotoStorage, get_photo_storage


def main() -> None:
    settings = get_settings()
    if not settings.is_development:
        raise SystemExit("dev_s3 only runs with ENVIRONMENT=development.")
    storage = get_photo_storage()
    if not isinstance(storage, S3PhotoStorage):
        raise SystemExit("Set PHOTO_STORAGE=s3 (and the S3_* settings) in backend/.env first.")

    client, bucket = storage.client, storage.bucket
    existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
    if bucket not in existing:
        client.create_bucket(Bucket=bucket)
    client.put_bucket_policy(
        Bucket=bucket,
        Policy=json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": "*",
                        "Action": "s3:GetObject",
                        "Resource": f"arn:aws:s3:::{bucket}/*",
                    }
                ],
            }
        ),
    )
    print(f"Bucket '{bucket}' is ready. Photos will be served from {settings.s3_public_base_url}")


if __name__ == "__main__":
    main()
