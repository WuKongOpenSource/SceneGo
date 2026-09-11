"""Public submissions must authorize every original media reference."""
from generation_route_contract import MediaReferenceSubmissionContract, public_generation_router


class TestPublicMediaReferenceSubmission(MediaReferenceSubmissionContract):
    router = staticmethod(public_generation_router)
