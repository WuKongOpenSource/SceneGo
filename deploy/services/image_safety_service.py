"""Bounded Pillow decoding helpers for untrusted or provider-supplied images."""
from __future__ import annotations

import io
import os
import warnings
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from PIL import Image


DEFAULT_MAX_IMAGE_SOURCE_PIXELS = 80_000_000


class UnsafeImageError(ValueError):
    """Raised before a suspicious image can consume excessive decode memory."""


def configured_image_pixel_limit() -> int:
    raw = os.getenv("MAX_IMAGE_SOURCE_PIXELS", str(DEFAULT_MAX_IMAGE_SOURCE_PIXELS))
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("MAX_IMAGE_SOURCE_PIXELS must be an integer") from exc
    if value <= 0:
        raise ValueError("MAX_IMAGE_SOURCE_PIXELS must be positive")
    return value


def assert_safe_image_dimensions(image: Image.Image, *, max_pixels: int | None = None) -> None:
    width, height = image.size
    limit = max_pixels or configured_image_pixel_limit()
    if width <= 0 or height <= 0 or width * height > limit:
        raise UnsafeImageError(
            f"image dimensions {width}x{height} exceed the {limit}-pixel safety limit"
        )


@contextmanager
def open_image_path_safely(
    path: str | Path,
    *,
    max_pixels: int | None = None,
) -> Iterator[Image.Image]:
    """Open a path while converting Pillow decompression warnings to failures."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                assert_safe_image_dimensions(image, max_pixels=max_pixels)
                yield image
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise UnsafeImageError("image exceeds Pillow's decompression safety limit") from exc


@contextmanager
def open_image_bytes_safely(
    content: bytes,
    *,
    max_pixels: int | None = None,
) -> Iterator[Image.Image]:
    """Open in-memory image bytes with the same bounded dimension policy."""
    with open_image_path_safely(io.BytesIO(content), max_pixels=max_pixels) as image:
        yield image


def load_image_bytes_safely(content: bytes, *, max_pixels: int | None = None) -> Image.Image:
    """Fully decode and detach an image while the bounded source is open."""
    with open_image_bytes_safely(content, max_pixels=max_pixels) as image:
        image.load()
        return image.copy()


def load_image_path_safely(
    path: str | Path,
    *,
    max_pixels: int | None = None,
) -> Image.Image:
    """Fully decode and detach a path-backed image under the same limit."""
    with open_image_path_safely(path, max_pixels=max_pixels) as image:
        image.load()
        return image.copy()
