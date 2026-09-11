"""Public billing regressions must not import the private task service."""
from services.online_provider_task_service import OnlineProviderTaskService
from task_billing_contract import RecordingQueue, TaskBillingContract


class TestOnlineTaskBilling(TaskBillingContract):
    service_type = OnlineProviderTaskService
    queue_type = RecordingQueue
    task_type = "sora2_i2v"

    def assert_enqueued_data(self, enqueued, original):
        super().assert_enqueued_data(enqueued, original)
        assert enqueued is not original
