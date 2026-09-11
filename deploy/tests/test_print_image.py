import pytest
import random
from PIL import Image, ImageChops, ImageFilter

from utils.print_image import verify_print_png, write_print_png


@pytest.mark.parametrize("mode", ["RGB", "RGBA"])
@pytest.mark.parametrize("text", [False, True])
def test_striped_print_matches_full_resize_without_seams(tmp_path, mode, text):
    source = tmp_path / "master.png"
    image = Image.frombytes("L", (131, 83), random.Random(4).randbytes(131 * 83)).convert(mode)
    image.save(source)
    output = tmp_path / "print.png"
    result = write_print_png(source, output, long_edge=400, text_clarity=text, strip_rows=32)
    expected = image.resize((400, result["height"]), Image.Resampling.LANCZOS)
    if text:
        expected = expected.filter(ImageFilter.UnsharpMask(radius=1.1, percent=115, threshold=3))
    with Image.open(output) as actual:
        assert actual.size == expected.size
        assert actual.info["dpi"] == pytest.approx((300, 300), abs=0.1)
        # One-level resize rounding can cross the sharpening threshold.
        assert max(peak for _, peak in ImageChops.difference(actual, expected).getextrema()) <= (6 if text else 1)
    assert verify_print_png(output)["dpi"] == pytest.approx(300, abs=0.1)
    assert source.exists()


def test_print_validator_rejects_truncated_output(tmp_path):
    source, output = tmp_path / "master.png", tmp_path / "print.png"
    Image.new("RGB", (20, 20)).save(source)
    write_print_png(source, output, long_edge=200)
    output.write_bytes(output.read_bytes()[:-8])
    with pytest.raises(ValueError, match="Incomplete|checksum"):
        verify_print_png(output)
    assert not list(tmp_path.glob("*.partial"))


def test_print_preserves_source_aspect_and_rejects_overwrite(tmp_path):
    source, output = tmp_path / "master.png", tmp_path / "print.png"
    Image.new("RGB", (100, 60), "blue").save(source)
    result = write_print_png(source, output, long_edge=500, aspect_size=(1619, 971))
    assert (result["width"], result["height"]) == (500, 300)
    with pytest.raises(ValueError, match="overwrite"):
        write_print_png(source, output, long_edge=500)


def test_failed_print_does_not_publish_a_partial_output(tmp_path):
    source, output = tmp_path / "master.png", tmp_path / "print.png"
    Image.new("RGB", (100, 60), "blue").save(source)
    def fail(*args):
        raise RuntimeError("Interrupted")
    with pytest.raises(RuntimeError, match="Interrupted"):
        write_print_png(source, output, long_edge=500, progress=fail)
    assert not output.exists()
    assert not list(tmp_path.glob("*.partial"))
    assert source.exists()
