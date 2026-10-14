"""FastAPI application entrypoint.

Serves the JSON API under ``/api`` and, when the frontend has been built,
hosts the React SPA from ``frontend/dist`` (including client-side routing
fallbacks).
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .auth import require_admin, require_user
from .config import settings
from .database import init_db
from .models import User
from .routers import auth as auth_router
from .routers import config as config_router
from .routers import costs as costs_router
from .routers import cycles as cycles_router
from .routers import groups as groups_router
from .routers import projects as projects_router
from .routers import settings as settings_router
from .routers import stats as stats_router
from .routers import teams as teams_router
from .routers import users as users_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Engineering Efficiency API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_protected = [Depends(require_user)]
_admin = [Depends(require_admin)]

app.include_router(auth_router.router, prefix="/api")
app.include_router(users_router.router, prefix="/api")
app.include_router(config_router.router, prefix="/api", dependencies=_admin)
app.include_router(settings_router.router, prefix="/api", dependencies=_protected)
app.include_router(teams_router.router, prefix="/api", dependencies=_protected)
app.include_router(cycles_router.router, prefix="/api", dependencies=_protected)
app.include_router(groups_router.router, prefix="/api", dependencies=_protected)
app.include_router(costs_router.router, prefix="/api", dependencies=_protected)
app.include_router(stats_router.router, prefix="/api", dependencies=_protected)
app.include_router(projects_router.router, prefix="/api", dependencies=_protected)


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/openapi.json", include_in_schema=False)
def openapi_spec(_user: User = Depends(require_user)) -> dict:
    return app.openapi()


@app.get("/docs", include_in_schema=False)
def swagger_ui(_user: User = Depends(require_user)) -> HTMLResponse:
    return get_swagger_ui_html(openapi_url="/openapi.json", title=f"{app.title} docs")


@app.get("/redoc", include_in_schema=False)
def redoc_ui(_user: User = Depends(require_user)) -> HTMLResponse:
    return get_redoc_html(openapi_url="/openapi.json", title=f"{app.title} ReDoc")


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
