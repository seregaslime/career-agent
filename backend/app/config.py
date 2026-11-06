from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: SecretStr = SecretStr(
        "postgresql+psycopg://career:career_local@localhost:55433/career"
    )
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
