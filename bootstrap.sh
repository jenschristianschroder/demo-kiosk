#!/usr/bin/env bash
# bootstrap.sh — Provision Azure infrastructure for the demo-kiosk and deploy all services.
# Idempotent: safe to re-run. Works on Linux natively or Windows via WSL / Git Bash.
# All inputs can be passed as environment variables to skip interactive prompts.
set -euo pipefail

###############################################################################
# Helpers
###############################################################################
info()  { printf '\033[0;34m[INFO]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[0;32m[OK]\033[0m    %s\n' "$*"; }
warn()  { printf '\033[0;33m[WARN]\033[0m  %s\n' "$*"; }
err()   { printf '\033[0;31m[ERROR]\033[0m %s\n' "$*" >&2; }
fail()  { err "$@"; exit 1; }

prompt_with_default() {
  local var_name="$1" prompt_text="$2" default="$3"
  # If the variable is already set and non-empty, use it (CI-friendly).
  local current_val="${!var_name:-}"
  if [[ -n "$current_val" ]]; then
    printf -v "$var_name" '%s' "$current_val"
    return
  fi
  read -rp "$prompt_text [$default]: " input
  printf -v "$var_name" '%s' "${input:-$default}"
}

###############################################################################
# Banner
###############################################################################
cat <<'EOF'

  ╔══════════════════════════════════════════════════════╗
  ║        Demo Kiosk — Azure Bootstrap Script          ║
  ║  Provisions ACA, ACR, and deploys all services.     ║
  ╚══════════════════════════════════════════════════════╝

EOF

###############################################################################
# Step 1 — Prerequisites
###############################################################################
info "Checking prerequisites…"

command -v az >/dev/null 2>&1 || fail "Azure CLI (az) is not installed. See https://aka.ms/install-az-cli"

# Ensure logged in
if ! az account show --output none 2>/dev/null; then
  fail "Not logged into Azure CLI. Run 'az login' first."
fi
ok "Azure CLI is installed and logged in."

###############################################################################
# Step 2 — Collect inputs
###############################################################################
info "Collecting configuration…"

prompt_with_default AZURE_SUBSCRIPTION_ID "Azure Subscription ID" "$(az account show --query id -o tsv 2>/dev/null || echo '')"
prompt_with_default AZURE_LOCATION        "Azure region"          "northeurope"
prompt_with_default RESOURCE_PREFIX        "Resource name prefix"  "hub-demo-kiosk"
prompt_with_default SECRET_LIFETIME_DAYS   "Admin app client secret lifetime (days)" "30"

az account set --subscription "$AZURE_SUBSCRIPTION_ID"
ok "Subscription: $AZURE_SUBSCRIPTION_ID"
ok "Location:     $AZURE_LOCATION"
ok "Prefix:       $RESOURCE_PREFIX"

###############################################################################
# Step 3 — Derive resource names
###############################################################################
RESOURCE_GROUP="rg-${RESOURCE_PREFIX}"
ACR_NAME="${RESOURCE_PREFIX//[-_]/}acr"   # alphanumeric only — ACR forbids dashes
ACA_ENV="cae-${RESOURCE_PREFIX}"
LOG_WORKSPACE="log-${RESOURCE_PREFIX}"

CA_API="ca-registry-api"
CA_LAUNCHER="ca-launcher"
CA_ADMIN="ca-admin"

ENTRA_APP_NAME="${RESOURCE_PREFIX}-admin-auth"

info "Derived resource names:"
info "  Resource group:  $RESOURCE_GROUP"
info "  ACR:             $ACR_NAME"
info "  ACA Environment: $ACA_ENV"
info "  Log Analytics:   $LOG_WORKSPACE"
info "  Container Apps:  $CA_API, $CA_LAUNCHER, $CA_ADMIN"

###############################################################################
# Step 4 — Resource Group
###############################################################################
info "Creating resource group '$RESOURCE_GROUP'…"
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$AZURE_LOCATION" \
  --output none
ok "Resource group ready."

###############################################################################
# Step 5 — Log Analytics Workspace
###############################################################################
info "Creating Log Analytics workspace '$LOG_WORKSPACE'…"
az monitor log-analytics workspace create \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LOG_WORKSPACE" \
  --location "$AZURE_LOCATION" \
  --output none 2>/dev/null || true

LOG_WORKSPACE_ID="$(az monitor log-analytics workspace show \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LOG_WORKSPACE" \
  --query customerId -o tsv)"

LOG_WORKSPACE_KEY="$(az monitor log-analytics workspace get-shared-keys \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LOG_WORKSPACE" \
  --query primarySharedKey -o tsv)"

ok "Log Analytics workspace ready (ID: ${LOG_WORKSPACE_ID:0:8}…)."

###############################################################################
# Step 6 — Azure Container Registry
###############################################################################
info "Creating Azure Container Registry '$ACR_NAME'…"
if az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "ACR '$ACR_NAME' already exists."
else
  az acr create \
    --name "$ACR_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --sku Basic \
    --admin-enabled true \
    --location "$AZURE_LOCATION" \
    --output none
  ok "ACR '$ACR_NAME' created."
fi

ACR_LOGIN_SERVER="$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query loginServer -o tsv)"

###############################################################################
# Step 7 — ACA Environment
###############################################################################
info "Creating Container Apps environment '$ACA_ENV'…"
if az containerapp env show --name "$ACA_ENV" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "ACA environment '$ACA_ENV' already exists."
else
  az containerapp env create \
    --name "$ACA_ENV" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" \
    --logs-workspace-id "$LOG_WORKSPACE_ID" \
    --logs-workspace-key "$LOG_WORKSPACE_KEY" \
    --output none
  ok "ACA environment '$ACA_ENV' created."
fi

###############################################################################
# Step 8 — Build & push container images (ACR cloud build)
###############################################################################
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info "Building registry-api image in ACR…"
az acr build \
  --registry "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "registry-api:latest" \
  --file "$SCRIPT_DIR/services/registry-api/Dockerfile" \
  "$SCRIPT_DIR/services/registry-api" \
  --output none
ok "registry-api image built."

info "Building launcher image in ACR…"
az acr build \
  --registry "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "launcher:latest" \
  --file "$SCRIPT_DIR/apps/launcher/Dockerfile" \
  "$SCRIPT_DIR/apps/launcher" \
  --output none
ok "launcher image built."

info "Building admin image in ACR…"
az acr build \
  --registry "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "admin:latest" \
  --file "$SCRIPT_DIR/apps/admin/Dockerfile" \
  "$SCRIPT_DIR/apps/admin" \
  --output none
ok "admin image built."

###############################################################################
# Step 9 — ACR credentials for ACA
###############################################################################
ACR_USERNAME="$(az acr credential show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query username -o tsv)"
ACR_PASSWORD="$(az acr credential show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query 'passwords[0].value' -o tsv)"

###############################################################################
# Step 10 — Deploy registry-api (internal ingress)
###############################################################################
info "Deploying container app '$CA_API'…"
if az containerapp show --name "$CA_API" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az containerapp update \
    --name "$CA_API" \
    --resource-group "$RESOURCE_GROUP" \
    --image "${ACR_LOGIN_SERVER}/registry-api:latest" \
    --output none
  ok "$CA_API updated."
else
  az containerapp create \
    --name "$CA_API" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ACA_ENV" \
    --image "${ACR_LOGIN_SERVER}/registry-api:latest" \
    --registry-server "$ACR_LOGIN_SERVER" \
    --registry-username "$ACR_USERNAME" \
    --registry-password "$ACR_PASSWORD" \
    --target-port 3001 \
    --ingress internal \
    --min-replicas 1 \
    --max-replicas 1 \
    --env-vars \
      PORT=3001 \
      CORS_ORIGIN='*' \
      NODE_ENV=production \
    --output none
  ok "$CA_API created."
fi

# Retrieve the internal FQDN for the registry-api
API_FQDN="$(az containerapp show --name "$CA_API" --resource-group "$RESOURCE_GROUP" --query 'properties.configuration.ingress.fqdn' -o tsv)"
API_INTERNAL_URL="http://${API_FQDN}"
info "Registry API internal URL: $API_INTERNAL_URL"

###############################################################################
# Step 11 — Deploy launcher (external ingress)
###############################################################################
info "Deploying container app '$CA_LAUNCHER'…"
if az containerapp show --name "$CA_LAUNCHER" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az containerapp update \
    --name "$CA_LAUNCHER" \
    --resource-group "$RESOURCE_GROUP" \
    --image "${ACR_LOGIN_SERVER}/launcher:latest" \
    --set-env-vars "API_BACKEND_URL=${API_INTERNAL_URL}" \
    --output none
  ok "$CA_LAUNCHER updated."
else
  az containerapp create \
    --name "$CA_LAUNCHER" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ACA_ENV" \
    --image "${ACR_LOGIN_SERVER}/launcher:latest" \
    --registry-server "$ACR_LOGIN_SERVER" \
    --registry-username "$ACR_USERNAME" \
    --registry-password "$ACR_PASSWORD" \
    --target-port 80 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 1 \
    --env-vars \
      "API_BACKEND_URL=${API_INTERNAL_URL}" \
    --output none
  ok "$CA_LAUNCHER created."
fi

LAUNCHER_FQDN="$(az containerapp show --name "$CA_LAUNCHER" --resource-group "$RESOURCE_GROUP" --query 'properties.configuration.ingress.fqdn' -o tsv)"
LAUNCHER_URL="https://${LAUNCHER_FQDN}"

###############################################################################
# Step 12 — Deploy admin (external ingress)
###############################################################################
info "Deploying container app '$CA_ADMIN'…"
if az containerapp show --name "$CA_ADMIN" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az containerapp update \
    --name "$CA_ADMIN" \
    --resource-group "$RESOURCE_GROUP" \
    --image "${ACR_LOGIN_SERVER}/admin:latest" \
    --set-env-vars "API_BACKEND_URL=${API_INTERNAL_URL}" \
    --output none
  ok "$CA_ADMIN updated."
else
  az containerapp create \
    --name "$CA_ADMIN" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ACA_ENV" \
    --image "${ACR_LOGIN_SERVER}/admin:latest" \
    --registry-server "$ACR_LOGIN_SERVER" \
    --registry-username "$ACR_USERNAME" \
    --registry-password "$ACR_PASSWORD" \
    --target-port 80 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 1 \
    --env-vars \
      "API_BACKEND_URL=${API_INTERNAL_URL}" \
    --output none
  ok "$CA_ADMIN created."
fi

ADMIN_FQDN="$(az containerapp show --name "$CA_ADMIN" --resource-group "$RESOURCE_GROUP" --query 'properties.configuration.ingress.fqdn' -o tsv)"
ADMIN_URL="https://${ADMIN_FQDN}"

###############################################################################
# Step 13 — Entra ID App Registration for Admin Easy Auth
###############################################################################
info "Configuring Entra ID app registration for admin auth…"
ADMIN_REDIRECT_URI="${ADMIN_URL}/.auth/login/aad/callback"

# Check if app registration already exists
EXISTING_APP_ID="$(az ad app list --display-name "$ENTRA_APP_NAME" --query '[0].appId' -o tsv 2>/dev/null || echo '')"

if [[ -n "$EXISTING_APP_ID" && "$EXISTING_APP_ID" != "None" ]]; then
  info "Entra ID app '$ENTRA_APP_NAME' already exists (appId: $EXISTING_APP_ID)."
  CLIENT_ID="$EXISTING_APP_ID"
  # Update redirect URI in case admin URL changed
  APP_OBJECT_ID="$(az ad app list --display-name "$ENTRA_APP_NAME" --query '[0].id' -o tsv)"
  az ad app update --id "$APP_OBJECT_ID" \
    --web-redirect-uris "$ADMIN_REDIRECT_URI" \
    --output none 2>/dev/null || true
else
  info "Creating Entra ID app registration '$ENTRA_APP_NAME'…"
  CLIENT_ID="$(az ad app create \
    --display-name "$ENTRA_APP_NAME" \
    --web-redirect-uris "$ADMIN_REDIRECT_URI" \
    --sign-in-audience AzureADMyOrg \
    --query appId -o tsv)"
  ok "Entra ID app created (appId: $CLIENT_ID)."
fi

# Create/reset client secret (lifetime configurable to comply with tenant policies)
info "Creating client secret (lifetime: ${SECRET_LIFETIME_DAYS} days)…"
SECRET_END_DATE="$(date -u -d "+${SECRET_LIFETIME_DAYS} days" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+${SECRET_LIFETIME_DAYS}d '+%Y-%m-%dT%H:%M:%SZ')"
CLIENT_SECRET="$(az ad app credential reset \
  --id "$CLIENT_ID" \
  --display-name "bootstrap-secret" \
  --end-date "$SECRET_END_DATE" \
  --query password -o tsv)"

###############################################################################
# Step 14 — Enable Easy Auth on admin container app
###############################################################################
info "Enabling Easy Auth (Microsoft provider) on '$CA_ADMIN'…"
TENANT_ID="$(az account show --query tenantId -o tsv)"

# Store client secret as ACA secret
az containerapp secret set \
  --name "$CA_ADMIN" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets "microsoft-provider-authentication-secret=${CLIENT_SECRET}" \
  --output none 2>/dev/null || true

az containerapp auth microsoft update \
  --name "$CA_ADMIN" \
  --resource-group "$RESOURCE_GROUP" \
  --client-id "$CLIENT_ID" \
  --client-secret-name "microsoft-provider-authentication-secret" \
  --issuer "https://sts.windows.net/${TENANT_ID}/v2.0" \
  --yes \
  --output none 2>/dev/null || {
    # If auth update fails, try enabling auth first then configuring
    az containerapp auth update \
      --name "$CA_ADMIN" \
      --resource-group "$RESOURCE_GROUP" \
      --unauthenticated-client-action RedirectToLoginPage \
      --output none 2>/dev/null || true
    az containerapp auth microsoft update \
      --name "$CA_ADMIN" \
      --resource-group "$RESOURCE_GROUP" \
      --client-id "$CLIENT_ID" \
      --client-secret-name "microsoft-provider-authentication-secret" \
      --issuer "https://sts.windows.net/${TENANT_ID}/v2.0" \
      --yes \
      --output none
  }

ok "Easy Auth configured on admin."

###############################################################################
# Step 15 — Smoke test
###############################################################################
info "Running smoke tests…"

SMOKE_OK=true

if command -v curl >/dev/null 2>&1; then
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${LAUNCHER_URL}/health/ready" 2>/dev/null || echo '000')"
  if [[ "$HTTP_CODE" =~ ^2 ]]; then
    ok "Launcher /health/ready → $HTTP_CODE"
  else
    warn "Launcher /health/ready → $HTTP_CODE (may need a moment to start)"
    SMOKE_OK=false
  fi

  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${LAUNCHER_URL}/" 2>/dev/null || echo '000')"
  if [[ "$HTTP_CODE" =~ ^2 ]]; then
    ok "Launcher / → $HTTP_CODE"
  else
    warn "Launcher / → $HTTP_CODE"
    SMOKE_OK=false
  fi

  # Admin should redirect (302) to login
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${ADMIN_URL}/" 2>/dev/null || echo '000')"
  if [[ "$HTTP_CODE" =~ ^(2|3) ]]; then
    ok "Admin / → $HTTP_CODE (auth redirect expected)"
  else
    warn "Admin / → $HTTP_CODE"
    SMOKE_OK=false
  fi
else
  warn "curl not found — skipping smoke tests."
  SMOKE_OK=false
fi

###############################################################################
# Step 16 — Summary
###############################################################################
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║             Deployment Complete!                     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Launcher URL:      $LAUNCHER_URL"
echo "  Admin URL:         $ADMIN_URL  (Entra ID protected)"
echo "  Registry API:      $API_INTERNAL_URL  (internal only)"
echo ""
echo "  Resource Group:    $RESOURCE_GROUP"
echo "  ACR:               $ACR_NAME ($ACR_LOGIN_SERVER)"
echo "  ACA Environment:   $ACA_ENV"
echo "  Entra App ID:      $CLIENT_ID"
echo ""
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  NEXT STEP: Restrict admin access               │"
echo "  │                                                  │"
echo "  │  1. Go to Azure Portal → Entra ID →             │"
echo "  │     App registrations → '$ENTRA_APP_NAME'       │"
echo "  │  2. Under 'Properties', set                     │"
echo "  │     'Assignment required?' to Yes                │"
echo "  │  3. Under 'Users and groups', add the           │"
echo "  │     users/groups who should access admin.        │"
echo "  └─────────────────────────────────────────────────┘"
echo ""

if [[ "$SMOKE_OK" == "true" ]]; then
  ok "All smoke tests passed."
else
  warn "Some smoke tests failed — services may still be starting up. Retry in a minute."
fi
