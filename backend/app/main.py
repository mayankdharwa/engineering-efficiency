"""FastAPI application entrypoint.

Serves the JSON API under ``/api`` and, when the frontend has been built,
hosts the React SPA from ``frontend/dist`` (including client-side routing
fallbacks).
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import init_db
from .routers import config as config_router
from .routers import settings as settings_router
from .routers import stats as stats_router
from .routers import teams as teams_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Engineering Efficiency API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(config_router.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(teams_router.router, prefix="/api")
app.include_router(stats_router.router, prefix="/api")


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Static SPA hosting (only when the frontend has been built).
# ---------------------------------------------------------------------------
dist = settings.frontend_dist

if dist.is_dir():
    assets_dir = dist / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")

        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)

        return FileResponse(dist / "index.html")

else:

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        return {
            "message": (
                "Frontend not built yet. Run `pnpm install && pnpm build` in "
                "`frontend/`, or use the Vite dev server on :5173."
            )
        }
