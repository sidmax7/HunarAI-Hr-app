from fastapi import APIRouter

from app.services.hunar_client import hunar_client

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("/")
async def list_agents() -> dict:
    return await hunar_client.list_agents()
