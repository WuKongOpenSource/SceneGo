"""Public crop guards without a private node transport dependency."""
from video_crop_contract import PublicVideoCropAdapter, VideoCropContract


class TestPublicVideoCrop(VideoCropContract, PublicVideoCropAdapter):
    pass
