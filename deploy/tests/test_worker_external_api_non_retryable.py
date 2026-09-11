"""Run the shared provider contract with the source-edition worker."""
from core.online_provider_task_model import OnlineProviderTask
from core.online_provider_worker import OnlineProviderWorker
from provider_execution_contract import ProviderFailureContract


class TestOnlineFailureContract(ProviderFailureContract):
    worker_type = OnlineProviderWorker
    task_type = OnlineProviderTask
