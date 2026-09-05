from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    HUNAR_API_KEY: str
    HUNAR_BASE_URL: str = "https://api.voice.hunar.ai/external/v1"

    PDL_API_KEY: str
    GEMINI_API_KEY: str

    DATABASE_URL: str = "sqlite+aiosqlite:///./hunar_hr.db"
    WEBHOOK_BASE_URL: str = "http://localhost:8000"

    # CAMARA / GSMA Open Gateway Device Location Verification — optional, unset until a
    # sandbox or operator agreement provides real values. The client no-ops without these.
    # Auth is private_key_jwt (RFC 7523), not a plain client secret: we sign a short-lived
    # JWT with CAMARA_PRIVATE_KEY_PEM and send it as a client_assertion.
    CAMARA_TOKEN_URL: str | None = None
    CAMARA_BASE_URL: str | None = None
    CAMARA_CLIENT_ID: str | None = None
    CAMARA_PRIVATE_KEY_PEM: str | None = None
    CAMARA_KEY_ID: str | None = None
    CAMARA_KEY_ALG: str = "PS256"
    CAMARA_SCOPE: str = "location-verification:verify"

    # Fires when a CAMARA check comes back non-TRUE, so the verification-failure path is
    # testable end-to-end without a real telecom deal or real employee phones.
    ATTENDANCE_ESCALATION_AGENT_ID: str | None = "2cdb938c-3352-4be1-a2cd-b94c0a464241"
    # Fires for employees with no check-in recorded a configurable window after shift_start.
    ATTENDANCE_REMINDER_AGENT_ID: str | None = "784ab685-410d-48de-af2a-abcda944ccd5"
    ATTENDANCE_COMPANY_NAME: str = "HunarAI HR"

    CORS_ORIGINS: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
