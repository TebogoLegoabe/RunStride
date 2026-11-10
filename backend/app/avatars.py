"""Avatars: a picture to stand in for you when you'd rather not add a photo.

The app draws them, so the server only stores which one was picked. Wherever a person's photo is
sent, someone with no photos gets "avatar:<name>" in its place; a real photo always wins.
"""

# Must match AVATARS in lib/avatars.ts
AVATARS = (
    "cheetah", "springbok", "lion", "zebra", "elephant", "giraffe", "rhino", "penguin",
    "flamingo", "protea", "shoe", "medal", "mountain", "sunrise", "lightning", "flame",
)
PREFIX = "avatar:"


def all_photos(profile) -> list[str]:
    """Their photos, or their avatar when they have none, or nothing."""
    if profile is None:
        return []
    if profile.photos:
        return [p.url for p in profile.photos]
    return [PREFIX + profile.avatar] if profile.avatar else []


def main_photo(profile) -> str | None:
    """What to show as their picture: first photo, else avatar, else nothing."""
    photos = all_photos(profile)
    return photos[0] if photos else None
