



import os
from urllib.parse import quote

from core.db_config_loader import get_db_config_value
from core.infrastructure_security import validate_database_security

class DatabaseConfig:



    @classmethod
    def get_connection_string(cls):
        params = cls.get_connection_params()
        user = quote(str(params['user']), safe='')
        password = quote(str(params['password']), safe='')
        database = quote(str(params['database']), safe='')
        ssl_query = f"?sslmode={quote(str(params['ssl']), safe='')}" if params.get('ssl') else ""
        return (
            f"postgresql://{user}:{password}"
            f"@{params['host']}:{params['port']}/{database}{ssl_query}"
        )


    @classmethod
    def get_connection_params(cls):
        host = get_db_config_value('DB_HOST', 'localhost')
        password = get_db_config_value('DB_PASSWORD', '')
        return {
            'host': host,
            'port': int(get_db_config_value('DB_PORT', '5432')),
            'database': get_db_config_value('DB_NAME', 'ostory_db'),
            'user': get_db_config_value('DB_USER', 'ostory_user'),
            'password': password,
            'ssl': validate_database_security(
                host=host,
                password=password,
                ssl_mode=get_db_config_value('DB_SSLMODE', ''),
            ),
            'min_size': int(get_db_config_value('DB_POOL_MIN_SIZE', '10')),
            'max_size': int(get_db_config_value('DB_POOL_MAX_SIZE', '50')),
        }

class JWTConfig:

    # Signing is implemented by core.jwt_auth. Keep this legacy configuration
    # surface explicit instead of creating a second, unrelated random secret.
    SECRET_KEY = os.getenv('JWT_SECRET_KEY', '')
    ALGORITHM = os.getenv('JWT_ALGORITHM', 'HS256')
    EXPIRE_HOURS = int(os.getenv('JWT_EXPIRE_HOURS', '720'))

class StorageConfig:

    TYPE = os.getenv('STORAGE_TYPE', 'local')  # local, s3, oss
    BASE_PATH = os.getenv('STORAGE_BASE_PATH', './persistent_storage')
    MAX_UPLOAD_SIZE = int(os.getenv('MAX_UPLOAD_SIZE', str(1024 * 1024 * 1024)))  # 1GB


    CDN_ENABLED = os.getenv('CDN_ENABLED', 'false').lower() == 'true'
    CDN_BASE_URL = os.getenv('CDN_BASE_URL', '')
    CDN_ACCESS_KEY = os.getenv('CDN_ACCESS_KEY', '')
    CDN_SECRET_KEY = os.getenv('CDN_SECRET_KEY', '')
