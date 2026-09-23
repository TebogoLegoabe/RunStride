from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

# Refuse absurdly large images (decompression bombs) before decoding them
Image.MAX_IMAGE_PIXELS = 40_000_000

ALLOWED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP"}  # MPO is a JPEG variant some phone cameras produce
MAX_SIDE_PX = 1600


class InvalidImage(ValueError):
    pass


def process_photo(raw: bytes) -> bytes:
    """Validate an uploaded photo and re-encode it as a JPEG.

    Re-encoding drops all EXIF metadata, which on phone photos usually includes
    the GPS location where the picture was taken. That must never reach other users.
    """
    try:
        img = Image.open(BytesIO(raw))
        if img.format not in ALLOWED_FORMATS:
            raise InvalidImage(f"unsupported format {img.format}")
        # Apply the camera's rotation flag before the metadata is thrown away
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        img.thumbnail((MAX_SIDE_PX, MAX_SIDE_PX))
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise InvalidImage(str(exc)) from exc

    out = BytesIO()
    img.save(out, "JPEG", quality=85, optimize=True)
    return out.getvalue()
