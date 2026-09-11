"""Source-edition queue cancellation and submission use the shared contract."""
from core.online_provider_queue import OnlineProviderQueue, TASK_PREFIX
from core.online_provider_task_model import OnlineProviderTask
from task_cancellation_contract import CancellationContract, WorkerDispatchRaceContract


class TestOnlineCancellation(CancellationContract):
    queue_type = OnlineProviderQueue
    task_type = OnlineProviderTask
    task_prefix = TASK_PREFIX


class TestWorkerDispatchRace(WorkerDispatchRaceContract):
    pass
