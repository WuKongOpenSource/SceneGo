#!/usr/bin/env python3


import os
from pathlib import Path

def diagnose():
    print("=" * 70)
    print("存储路径诊断工具")
    print("=" * 70)

    storage_dir = Path("persistent_storage")

    if not storage_dir.exists():
        print(f"❌ {storage_dir} 目录不存在！")
        return

    print(f"✅ 存储目录存在: {storage_dir.absolute()}")
    print()


    print("📁 目录结构:")
    for item in sorted(storage_dir.iterdir()):
        if item.is_symlink():
            target = os.readlink(item)
            exists = "✅" if item.exists() else "❌"
            print(f"  {exists} {item.name} -> {target} (符号链接)")
        elif item.is_dir():
            print(f"  📂 {item.name}/ (目录)")
        else:
            print(f"  📄 {item.name}")
    print()


    video_dir = storage_dir / "video"
    videos_dir = storage_dir / "videos"

    print("🎬 视频目录检查:")
    if video_dir.exists():
        print(f"  ✅ video/ 存在 (单数)")

        video_files = list(video_dir.rglob("*.mp4"))
        print(f"     包含 {len(video_files)} 个 .mp4 文件")
    else:
        print(f"  ❌ video/ 不存在")

    if videos_dir.exists():
        print(f"  ✅ videos/ 存在 (复数)")
        if videos_dir.is_symlink():
            print(f"     → 符号链接指向: {os.readlink(videos_dir)}")
        video_files = list(videos_dir.rglob("*.mp4"))
        print(f"     包含 {len(video_files)} 个 .mp4 文件")
    else:
        print(f"  ❌ videos/ 不存在")
    print()


    image_dir = storage_dir / "image"
    images_dir = storage_dir / "images"

    print("🖼️ 图片目录检查:")
    if image_dir.exists():
        print(f"  ✅ image/ 存在 (单数)")
        image_files = list(image_dir.rglob("*.png")) + list(image_dir.rglob("*.jpg"))
        print(f"     包含 {len(image_files)} 个图片文件")
    else:
        print(f"  ❌ image/ 不存在")

    if images_dir.exists():
        print(f"  ✅ images/ 存在 (复数)")
        if images_dir.is_symlink():
            print(f"     → 符号链接指向: {os.readlink(images_dir)}")
        image_files = list(images_dir.rglob("*.png")) + list(images_dir.rglob("*.jpg"))
        print(f"     包含 {len(image_files)} 个图片文件")
    else:
        print(f"  ❌ images/ 不存在")
    print()


    print("🔍 路径访问测试:")
    test_paths = [
        "video/admin",
        "videos/admin",
        "image/admin",
        "images/admin"
    ]

    for path in test_paths:
        full_path = storage_dir / path
        if full_path.exists():
            print(f"  ✅ {path}/ 可访问")
        else:
            print(f"  ❌ {path}/ 不可访问")

    print()
    print("=" * 70)
    print("💡 建议:")
    print("=" * 70)

    if not videos_dir.exists() and video_dir.exists():
        print("需要创建符号链接:")
        print(f"  cd {storage_dir.absolute()}")
        print(f"  ln -s video videos")

    if not images_dir.exists() and image_dir.exists():
        print("需要创建符号链接:")
        print(f"  cd {storage_dir.absolute()}")
        print(f"  ln -s image images")

    if videos_dir.exists() and video_dir.exists():
        print("✅ 符号链接已正确配置，请重启FastAPI服务器")

if __name__ == "__main__":
    diagnose()
