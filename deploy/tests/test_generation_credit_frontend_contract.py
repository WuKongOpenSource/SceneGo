from pathlib import Path


FRONTEND_DIR = Path(__file__).resolve().parents[1] / "new_html"


def test_four_generation_surfaces_show_credit_estimates():
    storyboard = (FRONTEND_DIR / "components" / "GenerationPage.tsx").read_text(encoding="utf-8")
    audio = (FRONTEND_DIR / "components" / "audio" / "DubbingCard.tsx").read_text(encoding="utf-8")
    video = (FRONTEND_DIR / "components" / "VideoPage.tsx").read_text(encoding="utf-8")
    enhance = (FRONTEND_DIR / "pages" / "EnhancePage.tsx").read_text(encoding="utf-8")

    assert "STORYBOARD_IMAGE_CREDIT_FEATURE = 'image_generation'" in storyboard
    assert 'featureKey="audio_generation_tts"' in audio
    assert 'featureKey="video_generation"' in video
    assert 'featureKey="video_enhancement"' in enhance


def test_storyboard_sync_generation_checks_and_settles_credits():
    storyboard = (FRONTEND_DIR / "components" / "GenerationPage.tsx").read_text(encoding="utf-8")

    assert "await assertEnoughCredits(STORYBOARD_IMAGE_CREDIT_FEATURE" in storyboard
    assert "await consumeCredits({" in storyboard
    assert "!COMFYUI_MODELS.has(modelToUse)" in storyboard
