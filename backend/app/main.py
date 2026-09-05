from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.routers import agents, attendance, hiring, search, webhooks
from app.scheduler import start_scheduler, stop_scheduler

import app.models  # noqa: F401  (registers models with Base.metadata)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="HunarAI HR App", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents.router)
app.include_router(hiring.router)
app.include_router(search.router)
app.include_router(attendance.router)
app.include_router(webhooks.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}
