"""Makes the key pair for browser notifications (Web Push). Run once:

    python scripts/make_vapid_keys.py

Put both values in Railway (RunStride service -> Variables) as VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.
Keep the private key secret: don't paste it anywhere else. Changing the keys later means everyone has
to allow notifications again.
"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


key = ec.generate_private_key(ec.SECP256R1())
private = key.private_numbers().private_value.to_bytes(32, "big")
public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)

print("VAPID_PUBLIC_KEY=" + b64url(public))
print("VAPID_PRIVATE_KEY=" + b64url(private))
