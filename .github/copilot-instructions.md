# GitHub Copilot Instructions (Repository-Wide)

> This file lives at `.github/copilot-instructions.md` and provides repository-wide guidance for Copilot. 
> Goal: ship a reliable, touch-first demo kiosk launcher hosted on Azure Container Apps (ACA).

## 1) Project Summary (What we’re building)
This repository contains a **touch-first demo kiosk launcher** designed for a **large portrait touchscreen**.
- The kiosk UI lets users browse and launch multiple demos.
- Demos are **self-contained web apps** (external URLs) managed via a **demo registry**.
- An **admin interface** allows adding, editing, removing demos and managing kiosk settings.
- The launcher is deployed as a **Linux container image** to **Azure Container Apps**. 

## 2) Azure Container Apps (ACA) deployment assumptions (hard constraints)
- The app must run as a **Linux-based container image**. 
- Do **not** require privileged containers or root-required host capabilities; ACA does not support privileged containers/processes that require root access. 
- Expect an ACA **environment** boundary with shared networking/logging for apps in the same environment. 
- Ingress is fronted by the ACA **edge ingress proxy**, which provides TLS termination and traffic splitting between revisions. 

## 3) Core Concepts & Non-Goals
### Core concepts
- **Launcher**: home screen + demo selector + demo launcher.
- **Demo Registry**: persistent store/API for demo metadata (title, URL, thumbnail, tags, launch mode, enabled flag).
- **Admin UI**: authenticated interface to manage registry + kiosk configuration (idle timeout, ordering, featured demos).
- **Demos**: independent web apps served elsewhere; this repo does not contain demo code.

### Non-goals
- Don’t build per-demo bespoke integrations in the kiosk.
- Don’t hardcode demo URLs in the UI (use the registry).
- Don’t add plugin systems or remote code loading.

## 4) UX Rules for Touch + Portrait
- Large touch targets (min 44px).
- Avoid hover-only interactions.
- Persistent navigation: Home/Back must always be visible.
- Predictable demo exit back to launcher (e.g., overlay Home button or return URL).
- Implement **idle timeout** that returns to Home and resets session state.

## 5) Data Model (Demo Registry)
Use a single canonical model for demos:
- id (GUID/string)
- title
- description (short)
- demoUrl (absolute URL)
- thumbnailUrl
- tags (array)
- launchMode: `sameTab | newTab | iframe`
- isActive (bool)
- sortOrder (number)
- owner (string/email/alias if needed)
- lastVerifiedAt (datetime, optional)
- healthCheckUrl (optional)

## 6) Ingress, routing, and session affinity (ACA)
- Ingress traffic arrives through the ACA ingress proxy which supports TLS termination and routing/traffic splitting between active revisions. 
- Only enable **session affinity** if the kiosk requires sticky sessions; otherwise keep it disabled. (ACA supports session affinity on ingress.) 
- Prefer stateless server design; store state client-side or in the registry store.

## 7) Health probes (Required for kiosk reliability)
- Implement endpoints suitable for ACA health probes:
  - `/health/startup`
  - `/health/live`
  - `/health/ready`
- ACA supports **Startup, Liveness, Readiness** probes using **HTTP(S) or TCP**; HTTP probe success is status **200–399**. 
- Keep probe handlers fast and dependency-aware (readiness can validate downstream dependencies; liveness should be minimal).

## 8) Scaling rules (ACA)
- By default, plan for **scale-to-zero** (min replicas = 0) for cost efficiency unless explicitly required to be always-on. 
- If the kiosk must always be instant-on, set minimum replicas to **1+**. 
- Treat changes to scaling rules/config as changes that can create new revisions (revisions are immutable snapshots). 

## 9) Authentication for Admin (ACA built-in auth preferred)
- Admin endpoints/UI must be protected by authentication/authorization.
- Prefer ACA built-in authentication (“Easy Auth”) for ingress-enabled apps (minimal/no code).
- Built-in auth supports multiple identity providers (including Microsoft Entra ID) and uses sign-in endpoints like:
  - `/.auth/login/aad`, `/.auth/login/github`, `/.auth/login/google`, etc. 
- Never expose write endpoints without auth.

## 10) Secrets & configuration
- Never commit secrets.
- Use environment variables and secret references at deploy time (e.g., registry connection strings, admin allowlists).
- Treat registry content and demo URLs as untrusted input; validate URLs and avoid rendering untrusted HTML.

## 11) Logging & Telemetry (Practical)
Log key events:
- launcher_loaded, demo_launched, demo_exited, idle_reset, registry_fetch_failed
Use structured logs; do not log PII.

## 12) Testing expectations
- Unit tests for registry logic, URL validation, and key UI state transitions.
- Integration test: fetch demos -> render tiles -> launch demo.
- Tests must not depend on external demo apps being reachable (mock them).

## 13) How Copilot should operate in this repo
When implementing a change:
1. State which files will change and why.
2. Prefer minimal diffs; avoid refactors unless requested or required.
3. If uncertain, propose 1–2 safe options and pick the simplest default.
4. Add/adjust tests when behavior changes.

## 14) “Do NOT” list (Hard rules)
- Do not introduce new frameworks/major deps without explicit request.
- Do not bypass security headers or suggest insecure embedding workarounds.
- Do not add plugin systems or arbitrary remote code loading.
- Do not store credentials/tokens in repo.
- Do not hardcode demo URLs; always use the demo registry.
- Do not rely on privileged container features; ACA can’t run privileged/root-required processes. 