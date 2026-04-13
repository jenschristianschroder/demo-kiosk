# Demo Kiosk

A touch-first demo kiosk launcher designed for a large portrait touchscreen, deployed as a Linux container to Azure Container Apps.

## Overview

The kiosk UI lets users browse and launch multiple demos. Demos are self-contained web apps (external URLs) managed via a demo registry. An admin interface allows adding, editing, removing demos and managing kiosk settings.

## Features

- **Launcher** — Home screen with demo selector and demo launcher
- **Demo Registry** — Persistent store/API for demo metadata (title, URL, thumbnail, tags, launch mode, etc.)
- **Admin UI** — Authenticated interface to manage the registry and kiosk configuration (idle timeout, ordering, featured demos)
- **Idle Timeout** — Automatically returns to Home and resets session state after inactivity
- **Touch-First UX** — Large touch targets, persistent navigation, no hover-only interactions

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/)
- [Docker](https://www.docker.com/)
- [Azure CLI](https://learn.microsoft.com/cli/azure/) (for deployment)

### Development

```bash
npm install
npm run dev
```

### Build & Run Container

```bash
docker build -t demo-kiosk .
docker run -p 3000:3000 demo-kiosk
```

## Deployment

The app is deployed as a Linux container image to **Azure Container Apps**. See the infrastructure and deployment files for details.

## Health Endpoints

| Endpoint            | Purpose   |
|---------------------|-----------|
| `/health/startup`   | Startup probe   |
| `/health/live`      | Liveness probe  |
| `/health/ready`     | Readiness probe |

## License

[MIT](LICENSE)
