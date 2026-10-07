.PHONY: help backend-install frontend-install dev-backend dev-frontend build

help:
	@echo "Targets:"
	@echo "  backend-install   Install Python dependencies (uv sync)"
	@echo "  frontend-install  Install Node dependencies (pnpm install)"
	@echo "  dev-backend       Run FastAPI with autoreload on :8000"
	@echo "  dev-frontend      Run the Vite dev server on :5173"
	@echo "  build             Build the SPA for production"

backend-install:
	cd backend && uv sync

frontend-install:
	cd frontend && pnpm install

dev-backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && pnpm dev

build:
	cd frontend && pnpm build
