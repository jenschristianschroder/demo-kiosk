# Demo Kiosk

A touch-first demo kiosk launcher designed for a large portrait touchscreen, deployed as Linux containers to Azure Container Apps.

## Architecture

The system consists of three containerized services deployed to the same Azure Container Apps Environment:

```
┌────────────────────────────────────────────────────────────┐
│  Azure Container Apps Environment                          │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Launcher   │  │  Registry    │  │    Admin     │    │
│  │  (React SPA) │──│    API       │──│  (React SPA) │    │
│  │  nginx :80   │  │  Express     │  │  nginx :80   │    │
│  │              │  │  :3001       │  │              │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│       public            internal          protected       │
│                                          (Entra ID)       │
└────────────────────────────────────────────────────────────┘
```

| Service | Path | Description |
|---------|------|-------------|
| `apps/launcher` | React SPA | Touch-first kiosk UI for browsing/launching demos |
| `services/registry-api` | Node.js/Express | REST API for demo metadata and kiosk settings |
| `apps/admin` | React SPA | Admin interface for managing demos and settings |

### Key Design Decisions

- **All demo data comes from the registry API** — no hardcoded URLs in the UI
- **Stateless frontend** — state is held client-side or in the registry
- **In-memory store** with a `DemoStore` interface designed for future swap to Azure Cosmos DB
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

## ACA Deployment Guidance

1. **Create Azure Container Registry (ACR)**
   ```bash
   az acr create -n <registry> -g <rg> --sku Basic
   ```

2. **Build and push images**
   ```bash
   az acr build -r <registry> -t registry-api:latest ./services/registry-api
   az acr build -r <registry> -t launcher:latest ./apps/launcher
   az acr build -r <registry> -t admin:latest ./apps/admin
   ```

3. **Create Container Apps Environment**
   ```bash
   az containerapp env create -n <env> -g <rg> --location <region>
   ```

4. **Deploy services**
   ```bash
   # Registry API (internal ingress)
   az containerapp create -n registry-api -g <rg> \
     --environment <env> \
     --image <registry>.azurecr.io/registry-api:latest \
     --target-port 3001 \
     --ingress internal \
     --min-replicas 1 \
     --env-vars PORT=3001

   # Launcher (external ingress, public)
   az containerapp create -n launcher -g <rg> \
     --environment <env> \
     --image <registry>.azurecr.io/launcher:latest \
     --target-port 80 \
     --ingress external \
     --min-replicas 0

   # Admin (external ingress, protected with Easy Auth)
   az containerapp create -n admin -g <rg> \
     --environment <env> \
     --image <registry>.azurecr.io/admin:latest \
     --target-port 80 \
     --ingress external \
     --min-replicas 0
   ```

5. **Enable authentication on Admin**
   Configure ACA built-in authentication (Easy Auth) with Entra ID for the admin container app.

6. **Configure health probes**
   Set startup, liveness, and readiness probes pointing to the `/health/*` endpoints on the registry API.

## License

[MIT](LICENSE)
