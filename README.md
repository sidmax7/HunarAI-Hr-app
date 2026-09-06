<div align="center">

# HunarAI HR

**An AI-voice-first HR operations console — screening, sourcing, and attendance, without the manual phone calls.**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.141-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Python](https://img.shields.io/badge/Python-3.14-3776AB?logo=python&logoColor=white)](https://www.python.org)

[Live demo](https://hunarhr.raihaan.in)

</div>

---

## What this is

Three traditionally manual, phone-heavy HR workflows, automated end to end:

- **Hiring** — paste a job description, an LLM extracts the screening criteria and auto-generates an AI voice agent, and candidates get called and screened without an HR rep making a single call.
- **Search & Reachout** — paste the same job description, source matching passive candidates from a people-search API, and pull the ones you want straight into a screening pipeline.
- **Attendance** — verify that a distributed, largely no-smartphone workforce is actually on-site today using the telecom network itself (no app, no employee action required), with an AI voice call as the automatic fallback when that silent check is inconclusive.

The mechanism a competitor can't casually copy: attendance that needs no employee action and no app — the phone network confirms presence, and a real AI phone call only happens when that silent check fails. Every module ends in a real, structured outcome an HR user reads as data (interest level, notice period, attendance status) — not audio they have to listen back to.

## How it looks

The UI runs its own design system — **"the gridded specimen sheet"** — a literal, visible construction grid instead of the usual rounded-card SaaS dashboard look: square corners everywhere, one indigo accent per screen, and pending states rendered as deliberate dashed "ghost cells" rather than blank space, so nothing that hasn't happened yet looks broken.

## Architecture

```
Browser
   │
   ▼
Next.js 16 (Vercel)  ──── HTTPS ────▶  FastAPI + SQLite (Cloudflare Tunnel)
                                                  │
                    ┌─────────────────┬──────────┴──────────┬─────────────────────┐
                    ▼                 ▼                     ▼                     ▼
             Hunar Voice AI     Google Gemini        People Data Labs       GSMA Open Gateway
             (outbound calls,   (JD parsing,          (passive candidate    CAMARA (device
              HMAC webhooks)     agent scripts)         search)              location verification)
```

- **Frontend**: Next.js 16 (App Router, TypeScript, no CSS framework — a hand-built token system), deployed on Vercel.
- **Backend**: FastAPI + async SQLAlchemy over SQLite, exposed publicly through a named Cloudflare Tunnel with a custom domain and real HTTPS (no raw port-forwarding).
- **Hunar Voice AI** places and manages the outbound calls, with HMAC-signed webhooks for call status/results.
- **Google Gemini** parses pasted job descriptions into structured search/screening criteria and generates the voice agent's script.
- **People Data Labs** sources passive candidates matching those criteria.
- **GSMA Open Gateway / CAMARA Device Location Verification** confirms an employee's real-world location from the telecom network itself, with a local USSD-simulator path kept as a documented fallback design.

## Getting started

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in your own API keys
uvicorn app.main:app --reload
```

Required in `.env`: `HUNAR_API_KEY`, `PDL_API_KEY`, `GEMINI_API_KEY`. CAMARA and webhook settings are optional — the app degrades gracefully (USSD-only attendance, polling instead of push) without them. See `.env.example` for the full list.

Every outbound call — screening, attendance reminders, and escalation — is blocked outside 8 AM–9 PM IST by a server-side guardrail (`CALLING_WINDOW_ENABLED=false` disables it for an off-hours demo).

**Tests:**

```bash
pip install -r requirements-dev.txt
pytest
```

Covers the webhook HMAC verification, the CSV import normalization, and the calling-window guardrail's boundary hours.

### Frontend

```bash
cd frontend
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

```
backend/
  app/
    models/      # SQLAlchemy models (jobs, candidates, interviews, attendance)
    routers/     # FastAPI route modules per domain
    services/    # Hunar/Gemini/PDL/CAMARA clients, webhook verification, calling window
  tests/         # pytest — webhook security, CSV import, calling-window guardrail
  requirements.txt
frontend/
  src/
    app/         # Next.js App Router pages (hiring, search, attendance)
    components/  # Shared UI primitives + design-system components
    lib/api.ts   # Typed backend API client
```

## Known limitations

- **No authentication.** This is currently a single-organization internal tool with no login or API-key layer on the backend. Don't point it at real employee data without adding auth first.
- **CAMARA attendance verification runs against GSMA's sandbox**, not a production telecom agreement — real-world verification would need an operator partnership.
- **People Data Labs' free tier masks contact fields** as booleans rather than real values, so sourced candidates need a phone number added manually before they're callable.
