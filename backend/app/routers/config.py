"""Linear connection configuration endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..linear_client import LinearClient, LinearError
from ..models import LinearConfig
from ..schemas import ConnectionTestOut, LinearConfigIn, LinearConfigOut

router = APIRouter(prefix="/config", tags=["config"])


@router.get("", response_model=LinearConfigOut)
def read_config(db: Session = Depends(get_db)) -> LinearConfigOut:
    config = db.get(LinearConfig, 1)
    if config is None:
        return LinearConfigOut(configured=False)
    return LinearConfigOut(
        configured=bool(config.api_key),
        viewer_name=config.viewer_name,
        viewer_email=config.viewer_email,
        organization_name=config.organization_name,
        updated_at=config.updated_at,
    )


@router.put("", response_model=LinearConfigOut)
def save_config(payload: LinearConfigIn, db: Session = Depends(get_db)) -> LinearConfigOut:
    """Store the API key and validate it against Linear immediately."""
    try:
        with LinearClient(payload.api_key) as client:
            viewer = client.viewer()
    except LinearError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    config = db.get(LinearConfig, 1)
    if config is None:
        config = LinearConfig(id=1, api_key=payload.api_key)
        db.add(config)

    config.api_key = payload.api_key
    config.viewer_name = viewer.get("name")
    config.viewer_email = viewer.get("email")
    config.organization_name = (viewer.get("organization") or {}).get("name")
    db.commit()
    db.refresh(config)

    return LinearConfigOut(
        configured=True,
        viewer_name=config.viewer_name,
        viewer_email=config.viewer_email,
        organization_name=config.organization_name,
        updated_at=config.updated_at,
    )


@router.post("/test", response_model=ConnectionTestOut)
def test_connection(db: Session = Depends(get_db)) -> ConnectionTestOut:
    config = db.get(LinearConfig, 1)
    if config is None or not config.api_key:
        raise HTTPException(status_code=400, detail="No Linear API key saved yet.")

    try:
        with LinearClient(config.api_key) as client:
            viewer = client.viewer()
    except LinearError as exc:
        return ConnectionTestOut(ok=False, message=str(exc))

    org = (viewer.get("organization") or {}).get("name")
    return ConnectionTestOut(
        ok=True,
        message=f"Connected as {viewer.get('name') or 'unknown user'}.",
        viewer_name=viewer.get("name"),
        organization_name=org,
    )
