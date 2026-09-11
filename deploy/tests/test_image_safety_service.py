import io

import pytest
from PIL import Image

from services.image_safety_service import (
    UnsafeImageError,
    assert_safe_image_dimensions,
    configured_image_pixel_limit,
    load_image_bytes_safely,
)


def _png_bytes(size=(2, 2)) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", size, "white").save(output, format="PNG")
    return output.getvalue()


def test_small_image_is_decoded_and_detached() -> None:
    image = load_image_bytes_safely(_png_bytes())

    assert image.size == (2, 2)
    assert image.getpixel((0, 0)) == (255, 255, 255)


def test_pixel_ceiling_is_enforced_before_full_processing() -> None:
    image = Image.new("RGB", (3, 2), "white")

    with pytest.raises(UnsafeImageError):
        assert_safe_image_dimensions(image, max_pixels=5)


def test_invalid_pixel_limit_configuration_fails_closed(monkeypatch) -> None:
    monkeypatch.setenv("MAX_IMAGE_SOURCE_PIXELS", "not-a-number")

    with pytest.raises(ValueError):
        configured_image_pixel_limit()
