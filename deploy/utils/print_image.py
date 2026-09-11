"""Write large print PNGs with bounded working memory."""
from __future__ import annotations

import os
from pathlib import Path
import struct
import uuid
import zlib

from PIL import Image, ImageChops, ImageFilter


def verify_print_png(path):
    metadata = {}
    with Path(path).open("rb") as stream:
        if stream.read(8) != b"\x89PNG\r\n\x1a\n":
            raise ValueError("Invalid print PNG signature")
        saw_data = False
        while True:
            header = stream.read(8)
            if len(header) != 8:
                raise ValueError("Incomplete print PNG")
            length, kind = struct.unpack(">I4s", header)
            if length > 4 * 1024 * 1024:
                raise ValueError("Print PNG chunk exceeds validation limit")
            data, crc = stream.read(length), stream.read(4)
            if len(data) != length or len(crc) != 4 or struct.unpack(">I", crc)[0] != zlib.crc32(data, zlib.crc32(kind)):
                raise ValueError("Print PNG chunk checksum mismatch")
            if kind == b"IHDR":
                width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", data)
                if depth != 8 or color not in (2, 6) or (compression, filtering, interlace) != (0, 0, 0):
                    raise ValueError("Unsupported print PNG encoding")
                metadata.update(width=width, height=height)
            elif kind == b"pHYs":
                x, y, unit = struct.unpack(">IIB", data)
                if unit != 1 or x != y:
                    raise ValueError("Invalid print PNG DPI")
                metadata["dpi"] = x * 0.0254
            elif kind == b"IDAT":
                saw_data = True
            elif kind == b"IEND":
                if length or stream.read(1) or not saw_data or set(metadata) != {"width", "height", "dpi"}:
                    raise ValueError("Incomplete print PNG metadata")
                return metadata


def write_print_png(source_path, target_path, *, long_edge, dpi=300,
                    text_clarity=False, aspect_size=None, strip_rows=256,
                    progress=None):
    source_path, target_path = Path(source_path), Path(target_path)
    if source_path.resolve() == target_path.resolve() or target_path.exists():
        raise ValueError("Print output must not overwrite an existing file")
    if not 1 <= int(long_edge) <= 50000 or not 72 <= int(dpi) <= 300:
        raise ValueError("Unsupported print dimensions or DPI")
    if not 16 <= int(strip_rows) <= 512:
        raise ValueError("Unsupported print strip height")
    temporary = target_path.with_name(target_path.name + "." + uuid.uuid4().hex + ".partial")
    try:
        with Image.open(source_path) as opened:
            if opened.width * opened.height > 64_000_000:
                raise ValueError("AI master exceeds the bounded source-image limit")
            master = opened.convert("RGBA" if "A" in opened.getbands() else "RGB")
        try:
            ratio_width, ratio_height = aspect_size or master.size
            if ratio_width <= 0 or ratio_height <= 0:
                raise ValueError("Invalid source aspect ratio")
            scale = int(long_edge) / max(ratio_width, ratio_height)
            width = max(1, round(ratio_width * scale))
            height = max(1, round(ratio_height * scale))
            if width * height > 2_500_000_000:
                raise ValueError("Print output exceeds the pixel limit")
            channels = len(master.getbands())
            with temporary.open("xb") as output:
                def chunk(kind, data):
                    output.write(struct.pack(">I", len(data)))
                    output.write(kind)
                    output.write(data)
                    output.write(struct.pack(">I", zlib.crc32(data, zlib.crc32(kind))))

                output.write(b"\x89PNG\r\n\x1a\n")
                chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6 if channels == 4 else 2, 0, 0, 0))
                pixels_per_meter = round(int(dpi) / 0.0254)
                chunk(b"pHYs", struct.pack(">IIB", pixels_per_meter, pixels_per_meter, 1))
                compressor = zlib.compressobj(3)
                row_bytes = width * channels
                for top in range(0, height, int(strip_rows)):
                    bottom = min(height, top + int(strip_rows))
                    # Padding keeps the sharpening kernel continuous across strips.
                    padded_top = max(0, top - 12)
                    padded_bottom = min(height, bottom + 12)
                    band = master.resize(
                        (width, padded_bottom - padded_top), Image.Resampling.LANCZOS,
                        box=(0, padded_top * master.height / height,
                             master.width, padded_bottom * master.height / height),
                    )
                    if text_clarity:
                        enhanced = band.filter(ImageFilter.UnsharpMask(radius=1.1, percent=115, threshold=3))
                        band.close()
                        band = enhanced
                    core = band.crop((0, top - padded_top, width, bottom - padded_top))
                    band.close()
                    shifted = ImageChops.offset(core, 1, 0)
                    filtered = ImageChops.subtract_modulo(core, shifted)
                    shifted.close()
                    first_column = core.crop((0, 0, 1, core.height))
                    filtered.paste(first_column, (0, 0))
                    first_column.close()
                    core.close()
                    raw = filtered.tobytes()
                    filtered.close()
                    for start in range(0, len(raw), row_bytes):
                        encoded = compressor.compress(b"\x01" + raw[start:start + row_bytes])
                        if encoded:
                            chunk(b"IDAT", encoded)
                    if progress:
                        progress(bottom, height)
                chunk(b"IDAT", compressor.flush())
                chunk(b"IEND", b"")
                output.flush()
                os.fsync(output.fileno())
            # Header and CRC validation does not allocate the full print bitmap.
            check = verify_print_png(temporary)
            if (check["width"], check["height"]) != (width, height) or abs(check["dpi"] - dpi) > 0.1:
                raise RuntimeError("Print output metadata verification failed")
            os.link(temporary, target_path)
            return {"width": width, "height": height, "dpi": int(dpi),
                    "text_clarity": bool(text_clarity), "bytes": target_path.stat().st_size}
        finally:
            master.close()
    finally:
        temporary.unlink(missing_ok=True)
