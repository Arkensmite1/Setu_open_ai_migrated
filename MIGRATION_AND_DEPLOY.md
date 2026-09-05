# SETU: Emergent → OpenAI migration + Render/Vercel deploy

Same migration pattern used for CodeGuard: strip out Emergent-platform-only
pieces so the app runs anywhere, then deploy backend on Render and frontend
on Vercel.

## What changed

1. **`backend/ai_service.py`** — rewritten to call the OpenAI API
   directly using the official `openai` Python SDK, instead of going
   through Emergent's `emergentintegrations` proxy (which needs
   `EMERGENT_LLM_KEY` and only works inside Emergent's platform, or the
   Mistral API this project used in an earlier migration). Same function
   signatures (`generate_text`, `analyze_image`, `stream_chat`), so
   `server.py` didn't need any changes. Text and image calls both use
   `gpt-4o-mini` by default (configurable via env vars).
2. **`backend/requirements.txt`** — removed `emergentintegrations` and
   pruned ~10 unused packages left over from the Emergent scaffold
   (`boto3`, `requests-oauthlib`, `cryptography`, `pandas`, `numpy`, `jq`,
   `typer`, `python-jose`, `passlib`, `email-validator`,
   `python-multipart`, plus the dev-lint tools) that weren't imported
   anywhere in the codebase — faster Render builds. Added `openai`.
3. **Citizen login OTP removed** — `/api/auth/otp/request` and
   `/api/auth/otp/verify` were replaced with a single
   `/api/auth/citizen/login` endpoint that signs a citizen in immediately
   from just their mobile number (and optional profile fields), no code
   step. See `backend/setu/auth.py` and `backend/setu/routers/auth_routes.py`.
3. **`frontend/package.json`** — removed `@emergentbase/visual-edits`
   (a dev-only Emergent tool pulled from their CDN). It was already
   wrapped in a try/catch in `craco.config.js` for a missing module, and
   only runs in `craco start` (dev server) — never in `craco build` (the
   production build Vercel runs) — so removing it is safe either way.
4. **`.gitignore`** — added `!.env.example` exceptions so the example env
   files below actually get committed (the existing `.env.*` rule was
   blocking them).
5. Added `backend/.env.example`, `frontend/.env.example`, `render.yaml`,
   `frontend/vercel.json`.

No auth changes were needed here — SETU's login is already self-contained
JWT (bcrypt + PyJWT), with no Emergent-hosted OAuth to replace.

## Environment variables you need to set

**Render (backend):**
- `MONGO_URL` — your MongoDB connection string (MongoDB Atlas free tier works)
- `DB_NAME` — e.g. `setu`
- `OPENAI_API_KEY` — your OpenAI API key
- `OPENAI_MODEL` — optional, defaults to `gpt-4o-mini`
- `OPENAI_VISION_MODEL` — optional, defaults to `gpt-4o-mini`
- `CORS_ORIGINS` — your Vercel URL once you have it (comma-separated if more than one)
- `JWT_SECRET` — `render.yaml` auto-generates this for you

**Vercel (frontend):**
- `REACT_APP_BACKEND_URL` — your Render backend URL, no trailing slash

## Deploy steps

1. Push this project to a GitHub repo.
2. **Render**: New → Blueprint → point at your repo. It reads `render.yaml`
   and creates the backend service. Fill in `MONGO_URL` and
   `OPENAI_API_KEY` when prompted (marked `sync: false` so Render asks
   for them rather than storing them in the blueprint).
3. **Vercel**: New Project → import the same repo → set root directory to
   `frontend` → it auto-detects Create React App → add
   `REACT_APP_BACKEND_URL` in Environment Variables → deploy.
4. Go back to Render and set `CORS_ORIGINS` to your new Vercel URL, then
   redeploy the backend so CORS allows it.
5. Test: open the app, try the AI chat assistant (Setu bot) and confirm it
   responds — that's the OpenAI call working. Also try SOS reporting,
   volunteer registration, and the shelter/region views since they hit the
   Mongo-backed routers.

## Notes

- The backend seeds mock/demo data into Mongo on startup
  (`setu_seed.seed(reset=False)` in `server.py`) — so the first request
  after a fresh deploy may take a moment while that runs, and your Atlas
  cluster will be populated automatically.
- If `OPENAI_API_KEY` is missing or invalid, AI-dependent endpoints
  (chat assistant, image-based reports, alert translation) will error;
  everything else in the app (regions, shelters, SOS, volunteers, map
  data) works independently of the AI key.
- Citizen sign-in no longer uses OTP: `POST /api/auth/citizen/login` with
  just a `mobile` (10 digits) creates the account on first use and logs
  the same citizen back in on every later call — no SMS/code step.
