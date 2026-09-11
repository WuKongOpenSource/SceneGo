

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


DEPLOY_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = DEPLOY_DIR / "static"
BRAND_DIR = STATIC_DIR / "branding"

BLUE = (83, 159, 243, 255)
INDIGO = (8, 121, 232, 255)
PURPLE = (0, 191, 239, 255)
DEEP_BLUE = (23, 79, 209, 255)
INK = (23, 23, 28, 255)
WHITE = (255, 255, 255, 255)


def _font(size: int, *, bold: bool = True) -> ImageFont.FreeTypeFont:
    fonts = Path("C:/Windows/Fonts")
    candidates = [
        fonts / "NotoSansSC-VF.ttf",
        fonts / ("msyhbd.ttc" if bold else "msyh.ttc"),
        fonts / ("simhei.ttf" if bold else "simsun.ttc"),
        fonts / ("segoeuib.ttf" if bold else "segoeui.ttf"),
        fonts / ("arialbd.ttf" if bold else "arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            font = ImageFont.truetype(str(candidate), size=size)
            if bold and candidate.name == "NotoSansSC-VF.ttf":
                font.set_variation_by_name("Black")
            return font
    return ImageFont.load_default(size=size)


def _gradient_layer(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = min(1.0, max(0.0, x / max(1, size - 1)))
            if t < 0.52:
                p = t / 0.52
                a, b = DEEP_BLUE, INDIGO
            else:
                p = (t - 0.52) / 0.48
                a, b = INDIGO, PURPLE
            pixels[x, y] = tuple(round(a[i] * (1 - p) + b[i] * p) for i in range(4))
    return image


def make_mark(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    scale = size / 368
    draw.rounded_rectangle((44 * scale, 152 * scale, 264 * scale, 322 * scale), radius=30 * scale, fill=DEEP_BLUE)
    draw.rounded_rectangle((74 * scale, 132 * scale, 294 * scale, 302 * scale), radius=30 * scale, fill=INDIGO)

    gradient = _gradient_layer(size)
    front_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(front_mask).rounded_rectangle(
        (104 * scale, 128 * scale, 324 * scale, 298 * scale),
        radius=30 * scale,
        fill=255,
    )
    image.paste(gradient, (0, 0), front_mask)

    clapper_mask = Image.new("L", (size, size), 0)
    clapper_draw = ImageDraw.Draw(clapper_mask)
    clapper_draw.polygon(
        [(96 * scale, 118 * scale), (278 * scale, 70 * scale), (323 * scale, 132 * scale), (108 * scale, 189 * scale)],
        fill=255,
    )
    clapper_draw.polygon([(142 * scale, 106 * scale), (171 * scale, 98 * scale), (202 * scale, 141 * scale), (173 * scale, 149 * scale)], fill=0)
    clapper_draw.polygon([(218 * scale, 86 * scale), (247 * scale, 78 * scale), (278 * scale, 121 * scale), (249 * scale, 129 * scale)], fill=0)
    image.paste(gradient, (0, 0), clapper_mask)

    alpha = image.getchannel("A")
    ImageDraw.Draw(alpha).polygon(
        [(162 * scale, 170 * scale), (262 * scale, 228 * scale), (162 * scale, 286 * scale)],
        fill=0,
    )
    image.putalpha(alpha)
    return image


def make_lockup(on_dark: bool) -> Image.Image:
    image = Image.new("RGBA", (820, 368), (0, 0, 0, 0))
    image.alpha_composite(make_mark(368), (0, 0))
    draw = ImageDraw.Draw(image)
    word_font = _font(176)
    draw.text((390, 68), "创剧", font=word_font, fill=WHITE if on_dark else INK)
    return image


def main() -> None:
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    mark = make_mark(368)
    mark.save(BRAND_DIR / "chuangju-mark.png")
    make_lockup(on_dark=False).save(BRAND_DIR / "chuangju-logo-on-light.png")
    make_lockup(on_dark=True).save(BRAND_DIR / "chuangju-logo-on-dark.png")

    favicon_16 = make_mark(16)
    favicon_32 = make_mark(32)
    favicon_180 = make_mark(180)
    favicon_16.save(STATIC_DIR / "favicon-16x16.png")
    favicon_32.save(STATIC_DIR / "favicon-32x32.png")
    favicon_180.save(STATIC_DIR / "apple-touch-icon.png")
    favicon_32.save(STATIC_DIR / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])


if __name__ == "__main__":
    main()
