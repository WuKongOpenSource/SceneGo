"""Public online parameter and scope guards; private preparation is separate."""
from generation_route_contract import GenerationOptionsContract, public_generation_router


class TestPublicGenerationOptions(GenerationOptionsContract):
    router = staticmethod(public_generation_router)
