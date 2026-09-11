"""SMS provider adapter. Production uses Alibaba Cloud's official SDK."""
from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass


class SmsProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class AliyunSmsSettings:
    access_key_id: str
    access_key_secret: str
    sign_name: str
    template_code: str


class DevelopmentSmsProvider:
    async def send_code(self, phone: str, code: str, purpose: str) -> str:
        return f"development:{purpose}:{phone[-4:]}"


class AliyunSmsProvider:
    def __init__(self, settings: AliyunSmsSettings):
        self.settings = settings

    def _send_sync(self, phone: str, code: str, purpose: str) -> str:
        from alibabacloud_dysmsapi20170525.client import Client
        from alibabacloud_dysmsapi20170525 import models as sms_models
        from alibabacloud_tea_openapi import models as open_api_models
        from alibabacloud_tea_util import models as util_models

        config = open_api_models.Config(
            access_key_id=self.settings.access_key_id,
            access_key_secret=self.settings.access_key_secret,
        )
        config.endpoint = "dysmsapi.aliyuncs.com"
        client = Client(config)
        request = sms_models.SendSmsRequest(
            phone_numbers=phone,
            sign_name=self.settings.sign_name,
            template_code=self.settings.template_code,
            template_param=json.dumps({"code": code}, ensure_ascii=False),
            out_id=f"ostory-{purpose}",
        )
        response = client.send_sms_with_options(
            request,
            util_models.RuntimeOptions(connect_timeout=5000, read_timeout=5000, autoretry=False),
        )
        body = response.body
        if getattr(body, "code", None) != "OK":
            raise SmsProviderError(
                f"Aliyun SMS rejected request: {getattr(body, 'code', 'UNKNOWN')}"
            )
        return str(getattr(body, "biz_id", None) or getattr(body, "request_id", ""))

    async def send_code(self, phone: str, code: str, purpose: str) -> str:
        return await asyncio.to_thread(self._send_sync, phone, code, purpose)


def build_sms_provider():
    runtime = (os.getenv("OSTORY_RUNTIME_ENV") or "development").strip().lower()
    provider = (os.getenv("OSTORY_SMS_PROVIDER") or "development").strip().lower()
    if runtime != "production" and provider == "development":
        return DevelopmentSmsProvider()
    if provider != "aliyun":
        raise SmsProviderError("production SMS provider must be aliyun")

    settings = AliyunSmsSettings(
        access_key_id=(os.getenv("ALIBABA_CLOUD_ACCESS_KEY_ID") or "").strip(),
        access_key_secret=(os.getenv("ALIBABA_CLOUD_ACCESS_KEY_SECRET") or "").strip(),
        sign_name=(os.getenv("OSTORY_SMS_SIGN_NAME") or "").strip(),
        template_code=(os.getenv("OSTORY_SMS_TEMPLATE_CODE") or "").strip(),
    )
    if not all((settings.access_key_id, settings.access_key_secret, settings.sign_name, settings.template_code)):
        raise SmsProviderError("Aliyun SMS configuration is incomplete")
    return AliyunSmsProvider(settings)
