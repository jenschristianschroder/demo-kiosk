# Demo Kiosk

A touch-first demo kiosk launcher designed for a large portrait touchscreen, deployed as Linux containers to Azure Container Apps.

## Architecture

The system consists of three containerized services deployed to a VNet-integrated Azure Container Apps Environment. Storage accounts are secured by Azure Network Security Perimeter (NSP) and accessed via private endpoints.

```
┌────────────────────────────────────────────────────────────────────┐
│  VNet (10.0.0.0/16)                                                │
│                                                                    │
│  ┌─ snet-aca (10.0.0.0/23) ────────────────────────────────────┐  │
│  │  Azure Container Apps Environment                            │  │
│  │                                                              │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │  │
│  │  │   Launcher   │  │  Registry    │  │    Admin     │      │  │
│  │  │  (React SPA) │──│    API       │──│  (React SPA) │      │  │
│  │  │  nginx :80   │  │  Express     │  │  nginx :80   │      │  │
│  │  │              │  │  :3001       │  │              │      │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │  │
│  │       public            internal          protected         │  │
│  │                                          (Entra ID)         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                    │                               │
│  ┌─ snet-storage-pe (10.0.2.0/24) ┼────────────────────────────┐  │
│  │  Private Endpoints              │                            │  │
│  │  ┌─────────────┐  ┌────────────┴┐                           │  │
│  │  │ PE: demo    │  │ PE: token   │                           │  │
│  │  │ storage blob│  │ storage blob│                           │  │
│  │  └──────┬──────┘  └──────┬──────┘                           │  │
│  └─────────┼────────────────┼──────────────────────────────────┘  │
└────────────┼────────────────┼─────────────────────────────────────┘
             │                │
    ┌────────┴────────┐  ┌───┴──────────────────┐
    │ Demo Registry   │  │ Easy Auth Token Store │
    │ Storage Account │  │ Storage Account       │
    │ (SecuredByNSP)  │  │ (SecuredByNSP)        │
    └─────────────────┘  └───────────────────────┘
```

| Service | Path | Description |
|---------|------|-------------|
| `apps/launcher` | React SPA | Touch-first kiosk UI for browsing/launching demos |
| `services/registry-api` | Node.js/Express | REST API for demo metadata and kiosk settings |
| `apps/admin` | React SPA | Admin interface for managing demos and settings |

### Key Design Decisions

- **All demo data comes from the registry API** — no hardcoded URLs in the UI
- **Stateless frontend** — state is held client-side or in the registry
- **Blob-backed store** with a `DemoStore` interface (in-memory fallback for local dev)
- **Seed data included** — 5 demos, one per capability tag (Speech, Vision, Language, Decision, Agentic)

## Features

- **Launcher** — Welcome screen → Capability selector → Category demos → Launch
- **Demo Registry** — CRUD API for demo metadata with validation and filtering
- **Admin UI** — Create, edit, delete, activate/deactivate, reorder, and tag demos
- **Idle Timeout** — Configurable inactivity timer returns to Home (default: 60s)
- **Touch-First UX** — Large touch targets (≥44px), no hover-only interactions, persistent navigation
- **Health Probes** — `/health/startup`, `/health/live`, `/health/ready`

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Docker](https://www.docker.com/) (for container builds)
- [Azure CLI](https://learn.microsoft.com/cli/azure/) (for deployment)

### Run Locally (Development)

Start all three services in separate terminals:

```bash
# 1. Registry API (port 3001)
cd services/registry-api
npm install
npm run dev

# 2. Launcher (port 3000, proxies API to 3001)
cd apps/launcher
npm install
npm run dev

# 3. Admin UI (port 3002, proxies API to 3001)
cd apps/admin
npm install
npm run dev
```

Open:
- Launcher: http://localhost:3000
- Admin: http://localhost:3002

### Run Locally (Docker Compose)

```bash
docker compose up --build
```

Services will be available at:
- Launcher: http://localhost:3000
- Registry API: http://localhost:3001
- Admin: http://localhost:3002

## Container Build Commands

```bash
# Registry API
docker build -t demo-kiosk/registry-api ./services/registry-api

# Launcher
docker build -t demo-kiosk/launcher ./apps/launcher

# Admin
docker build -t demo-kiosk/admin ./apps/admin
```

## Project Structure

```
/
├── apps/
│   ├── launcher/          # Kiosk launcher SPA (React + TypeScript)
│   │   ├── src/
│   │   │   ├── pages/     # WelcomeScreen, CapabilitiesScreen, CategoryDemosScreen
│   │   │   ├── hooks/     # useIdleTimeout
│   │   │   ├── services/  # API client
│   │   │   └── App.tsx    # Router + idle timeout
│   │   ├── nginx.conf     # SPA serving + API proxy
│   │   └── Dockerfile
│   └── admin/             # Admin management SPA (React + TypeScript)
│       ├── src/
│       │   ├── pages/     # DemoList, DemoForm, Settings
│       │   └── services/  # API client
│       ├── nginx.conf
│       └── Dockerfile
├── services/
│   └── registry-api/      # Demo registry REST API (Node.js + Express)
│       ├── src/
│       │   ├── routes/    # demos, settings, health
│       │   ├── store/     # DemoStore interface + InMemoryStore
│       │   └── models.ts  # Demo, KioskSettings types
│       └── Dockerfile
├── infra/                 # Infrastructure (future: Bicep/Terraform)
├── docs/                  # Documentation
├── docker-compose.yml     # Local development with Docker
└── .env.example           # Environment variable template
```

## API Endpoints

### Registry API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/demos` | List all demos (query: `?tag=Speech&active=true`) |
| GET | `/api/demos/:id` | Get single demo |
| POST | `/api/demos` | Create demo |
| PUT | `/api/demos/:id` | Update demo |
| PATCH | `/api/demos/:id` | Partial update |
| DELETE | `/api/demos/:id` | Delete demo |
| GET | `/api/settings` | Get kiosk settings |
| PUT | `/api/settings` | Update kiosk settings |

### Health Probes

| Endpoint | Purpose |
|----------|---------|
| `GET /health/startup` | Startup probe |
| `GET /health/live` | Liveness probe |
| `GET /health/ready` | Readiness probe |

## Environment Variables

| Variable | Service | Default | Description |
|----------|---------|---------|-------------|
| `PORT` | registry-api | `3001` | API listen port |
| `CORS_ORIGIN` | registry-api | `*` | Allowed CORS origins |
| `VITE_API_BASE` | launcher, admin | (empty) | API base URL (empty = same origin) |
| `VITE_IDLE_TIMEOUT` | launcher | `60` | Idle timeout in seconds |

## ACA Deployment

The `bootstrap.sh` script provisions all Azure infrastructure and deploys the services. It is idempotent and safe to re-run.

```bash
# Set required inputs (or the script will prompt interactively)
export AZURE_SUBSCRIPTION_ID="<your-subscription-id>"
export AZURE_LOCATION="northeurope"
export RESOURCE_PREFIX="hub-demo-kiosk"

./bootstrap.sh
```

### What bootstrap.sh provisions

| Resource | Purpose |
|----------|---------|
| VNet + subnets | Network isolation for ACA and private endpoints |
| Private DNS Zone | Resolves `*.blob.core.windows.net` to private endpoint IPs |
| Azure Container Registry | Hosts container images |
| Storage Accounts (×2) | Demo registry blobs + Easy Auth token store |
| Private Endpoints | Blob access over the Azure backbone (no public internet) |
| Network Security Perimeter | Perimeter-secured storage (`publicNetworkAccess: SecuredByPerimeter`) |
| ACA Environment (VNet-integrated) | Hosts all three container apps |
| Container Apps (×3) | Launcher, Registry API, Admin |
| Entra ID App Registration | Easy Auth for Admin UI |

### Post-deployment

After the first run, the NSP starts in **Learning** mode. Once validated, switch to **Enforced**:

```bash
az network perimeter profile update \
  --perimeter-name nsp-<prefix> \
  --resource-group rg-<prefix> \
  --name profile-default \
  --access-mode Enforced
```

## License

[MIT](LICENSE)
