# Black-Litterman Credit Optimiser

An interactive portfolio optimisation tool for investment-grade corporate bonds using the Black-Litterman framework with credit-specific risk analytics.

## Architecture

**Frontend** (React + Vite) — single-page app with a built-in JavaScript fallback engine and interactive charts (Recharts).

**Backend** (FastAPI + Python) — full optimisation engine using cvxpy, scipy, and Monte Carlo credit VaR simulation.

| Service | URL | Platform |
|---------|-----|----------|
| Frontend | https://black-litterman-credit.onrender.com | Render Static Site |
| Backend API | https://bl-credit-api.onrender.com | Render Web Service |

## Features

- Black-Litterman posterior return blending with absolute and relative views
- Constrained portfolio optimisation (issuer limits, position sizing, tracking error)
- Credit risk metrics: expected loss, spread duration, DTS, Credit VaR/CVaR (Monte Carlo)
- Sector and rating allocation analysis with interactive charts
- File upload (CSV, TXT, Excel) with automatic YTM calculation and OAS estimation
- Dual engine mode: Python backend with JS browser fallback

## Project Structure

```
src/
  App.jsx          Main React component (UI, state, API integration)
  constants.js     Sample bond universe and display constants
  engine.js        Browser-side BL engine (fallback when backend unavailable)
  main.jsx         Entry point
  index.css        Tailwind styles

backend/
  main.py          FastAPI endpoints (optimise, equilibrium, upload-bonds)
  bl_engine.py     Black-Litterman computation (equilibrium, posterior, optimisation)
  risk_engine.py   Risk analytics (covariance, expected loss, Monte Carlo VaR)
  models.py        Pydantic request/response schemas
  utils.py         Shared utilities (YTM solver, column resolution, rating maps)
  requirements.txt Python dependencies
  startup.sh       Gunicorn launch script
```

## Local Development

```bash
# Frontend
npm install
npm run dev

# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Set `VITE_API_URL=http://localhost:8000` in a `.env` file to connect the frontend to a local backend.

## Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `VITE_API_URL` | Frontend | Backend API URL (build-time) |
| `ALLOWED_ORIGINS` | Backend | Comma-separated CORS origins |
