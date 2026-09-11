import hashlib

import bcrypt
import pytest

from services.password_service import PASSWORD_HASH_PREFIX, hash_password, verify_password_hash


def test_new_passwords_use_bcrypt_sha256():
    encoded = hash_password("a-secure-password")

    assert encoded.startswith(PASSWORD_HASH_PREFIX)
    assert verify_password_hash("a-secure-password", encoded) == (True, False)
    assert verify_password_hash("wrong-password", encoded) == (False, False)


def test_legacy_sha256_password_requests_upgrade():
    legacy = hashlib.sha256("legacy-password".encode()).hexdigest()

    assert verify_password_hash("legacy-password", legacy) == (True, True)
    assert verify_password_hash("wrong-password", legacy) == (False, False)


def test_legacy_bcrypt_password_requests_upgrade():
    legacy_bcrypt = bcrypt.hashpw(b"a-secure-password", bcrypt.gensalt(rounds=4)).decode("ascii")

    assert verify_password_hash("a-secure-password", legacy_bcrypt) == (True, True)
    assert verify_password_hash("wrong-password", legacy_bcrypt) == (False, False)


def test_utf8_password_beyond_bcrypt_72_byte_boundary_is_not_truncated():
    password = "密" * 30
    encoded = hash_password(password)

    assert verify_password_hash(password, encoded) == (True, False)
    assert verify_password_hash("密" * 29 + "码", encoded) == (False, False)


def test_password_length_is_bounded():
    with pytest.raises(ValueError, match="at least"):
        hash_password("short")
    with pytest.raises(ValueError, match="at most"):
        hash_password("x" * 129)
    assert verify_password_hash("x" * 129, "not-a-hash") == (False, False)
