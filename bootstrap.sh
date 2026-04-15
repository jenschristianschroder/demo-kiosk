#!/usr/bin/env bash
# bootstrap.sh — Provision Azure infrastructure for the demo-kiosk and deploy all services.
# Idempotent: safe to re-run. Works on Linux natively or Windows via WSL / Git Bash.
# All inputs can be passed as environment variables to skip interactive prompts.
set -euo pipefail

# Prevent Git Bash/MSYS from rewriting Azure resource IDs like /subscriptions/...
# into Windows paths when passing arguments to Azure CLI commands.
export MSYS_NO_PATHCONV=1

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

# ensure_blob_container <storage_resource_id> <container_name>
# Creates a blob container via the ARM management plane if it does not already exist.
# Uses az rest to bypass data-plane firewall restrictions and shared-key-disabled accounts.
ensure_blob_container() {
  local storage_resource_id="$1" container_name="$2"
  local container_url="${storage_resource_id}/blobServices/default/containers/${container_name}?api-version=2023-05-01"
  local check_output create_output
  info "Ensuring blob container '$container_name' exists…"
  if check_output="$(az rest --method GET --url "$container_url" --output none 2>&1)"; then
    ok "Blob container '$container_name' already exists."
  elif printf '%s' "$check_output" | grep -Eq 'ContainerNotFound|ResourceNotFound|404'; then
    if create_output="$(az rest --method PUT --url "$container_url" --body '{}' --output none 2>&1)"; then
      ok "Blob container '$container_name' created."
    elif printf '%s' "$create_output" | grep -Eq 'ContainerAlreadyExists|409'; then
      ok "Blob container '$container_name' already exists."
    else
      fail "Failed to create blob container '$container_name': $create_output"
    fi
  else
    fail "Failed to check blob container '$container_name': $check_output"
  fi
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
prompt_with_default ROTATE_SECRET          "Rotate admin app client secret if it already exists? (true/false)" "false"

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

# Derive a compliant Storage Account name: lowercase alphanumeric, 3–24 chars, globally unique.
# Strip non-alphanumeric chars, lowercase, then append a 6-char hex hash of the
# subscription ID + resource group to avoid global name collisions.
_sa_base="${RESOURCE_PREFIX//[^a-zA-Z0-9]/}"
_sa_base="${_sa_base,,}"
_sa_hash="$(printf '%s' "${AZURE_SUBSCRIPTION_ID}${RESOURCE_GROUP}" | sha256sum | cut -c1-6)"
STORAGE_ACCOUNT="${_sa_base:0:18}${_sa_hash}"   # max 18-char base + 6-char hash ≤ 24 chars
unset _sa_base _sa_hash

# Validate the derived name satisfies Azure Storage account naming rules.
[[ ${#STORAGE_ACCOUNT} -ge 3 && ${#STORAGE_ACCOUNT} -le 24 ]] \
  || fail "Derived storage account name '$STORAGE_ACCOUNT' is ${#STORAGE_ACCOUNT} chars; must be 3–24."
[[ "$STORAGE_ACCOUNT" =~ ^[a-z0-9]+$ ]] \
  || fail "Derived storage account name '$STORAGE_ACCOUNT' contains invalid characters; only lowercase letters and numbers are allowed."

TOKEN_CONTAINER="easyauthtokens"

# Storage account for the demo registry. Can be overridden via DEMO_STORAGE_ACCOUNT env var.
# Defaults to the well-known existing account 'hubdemokioskst'.
DEMO_STORAGE_ACCOUNT="${DEMO_STORAGE_ACCOUNT:-hubdemokioskst}"
DEMO_REGISTRY_CONTAINER="demo-registry"

# Networking — VNet, subnets, private endpoints, NSP
VNET_NAME="vnet-${RESOURCE_PREFIX}"
SUBNET_ACA="snet-aca"
SUBNET_PE="snet-storage-pe"
VNET_ADDRESS_SPACE="10.0.0.0/16"
SUBNET_ACA_PREFIX="10.0.0.0/23"       # /23 minimum required by ACA
SUBNET_PE_PREFIX="10.0.2.0/24"
NSP_NAME="nsp-${RESOURCE_PREFIX}"
NSP_PROFILE="profile-default"
PE_DEMO_STORAGE="pe-${DEMO_STORAGE_ACCOUNT}-blob"
PE_TOKEN_STORAGE="pe-${STORAGE_ACCOUNT}-blob"
PRIVATE_DNS_ZONE="privatelink.blob.core.windows.net"

info "Derived resource names:"
info "  Resource group:        $RESOURCE_GROUP"
info "  ACR:                   $ACR_NAME"
info "  ACA Environment:       $ACA_ENV"
info "  Log Analytics:         $LOG_WORKSPACE"
info "  Storage Account:       $STORAGE_ACCOUNT"
info "  Token Container:       $TOKEN_CONTAINER"
info "  Demo Storage Account:  $DEMO_STORAGE_ACCOUNT"
info "  Demo Registry Container: $DEMO_REGISTRY_CONTAINER"
info "  Container Apps:        $CA_API, $CA_LAUNCHER, $CA_ADMIN"
info "  VNet:                  $VNET_NAME ($VNET_ADDRESS_SPACE)"
info "  ACA Subnet:            $SUBNET_ACA ($SUBNET_ACA_PREFIX)"
info "  PE Subnet:             $SUBNET_PE ($SUBNET_PE_PREFIX)"
info "  NSP:                   $NSP_NAME"

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
info "Ensuring Log Analytics workspace '$LOG_WORKSPACE' exists…"
if az monitor log-analytics workspace show \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LOG_WORKSPACE" \
  --output none 2>/dev/null; then
  info "Log Analytics workspace '$LOG_WORKSPACE' already exists; skipping creation."
else
  az monitor log-analytics workspace create \
    --resource-group "$RESOURCE_GROUP" \
    --workspace-name "$LOG_WORKSPACE" \
    --location "$AZURE_LOCATION" \
    --output none
fi

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
# Step 5.1 — Virtual Network and Subnets
#   VNet integration is required for ACA to reach storage accounts that have
#   public network access disabled (SecuredByPerimeter).  ACA containers route
#   outbound traffic through the VNet and reach storage via private endpoints.
###############################################################################
info "Ensuring VNet '$VNET_NAME' exists…"
if az network vnet show --name "$VNET_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "VNet '$VNET_NAME' already exists."
else
  az network vnet create \
    --name "$VNET_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" \
    --address-prefix "$VNET_ADDRESS_SPACE" \
    --output none
  ok "VNet '$VNET_NAME' created."
fi

info "Ensuring subnet '$SUBNET_ACA' exists…"
if az network vnet subnet show --vnet-name "$VNET_NAME" --name "$SUBNET_ACA" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "Subnet '$SUBNET_ACA' already exists."
else
  az network vnet subnet create \
    --vnet-name "$VNET_NAME" \
    --name "$SUBNET_ACA" \
    --resource-group "$RESOURCE_GROUP" \
    --address-prefix "$SUBNET_ACA_PREFIX" \
    --delegations "Microsoft.App/environments" \
    --output none
  ok "Subnet '$SUBNET_ACA' created."
fi

SUBNET_ACA_ID="$(az network vnet subnet show \
  --vnet-name "$VNET_NAME" --name "$SUBNET_ACA" \
  --resource-group "$RESOURCE_GROUP" --query id -o tsv)"

info "Ensuring subnet '$SUBNET_PE' exists…"
if az network vnet subnet show --vnet-name "$VNET_NAME" --name "$SUBNET_PE" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "Subnet '$SUBNET_PE' already exists."
else
  az network vnet subnet create \
    --vnet-name "$VNET_NAME" \
    --name "$SUBNET_PE" \
    --resource-group "$RESOURCE_GROUP" \
    --address-prefix "$SUBNET_PE_PREFIX" \
    --output none
  ok "Subnet '$SUBNET_PE' created."
fi

SUBNET_PE_ID="$(az network vnet subnet show \
  --vnet-name "$VNET_NAME" --name "$SUBNET_PE" \
  --resource-group "$RESOURCE_GROUP" --query id -o tsv)"

###############################################################################
# Step 5.2 — Private DNS Zone for blob storage
#   All private endpoints for blob storage share a single DNS zone.
###############################################################################
info "Ensuring Private DNS Zone '$PRIVATE_DNS_ZONE' exists…"
if az network private-dns zone show --name "$PRIVATE_DNS_ZONE" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "Private DNS Zone '$PRIVATE_DNS_ZONE' already exists."
else
  az network private-dns zone create \
    --name "$PRIVATE_DNS_ZONE" \
    --resource-group "$RESOURCE_GROUP" \
    --output none
  ok "Private DNS Zone '$PRIVATE_DNS_ZONE' created."
fi

info "Ensuring VNet link for Private DNS Zone…"
DNS_LINK_NAME="${VNET_NAME}-link"
if az network private-dns link vnet show --zone-name "$PRIVATE_DNS_ZONE" --name "$DNS_LINK_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "VNet link '$DNS_LINK_NAME' already exists."
else
  az network private-dns link vnet create \
    --zone-name "$PRIVATE_DNS_ZONE" \
    --name "$DNS_LINK_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --virtual-network "$VNET_NAME" \
    --registration-enabled false \
    --output none
  ok "VNet link '$DNS_LINK_NAME' created."
fi

###############################################################################
# Step 6 — Azure Container Registry
###############################################################################
info "Ensuring Azure Container Registry '$ACR_NAME' exists…"
if az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "ACR '$ACR_NAME' already exists."
else
  az acr create \
    --name "$ACR_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --sku Basic \
    --location "$AZURE_LOCATION" \
    --output none
  ok "ACR '$ACR_NAME' created."
fi

ACR_LOGIN_SERVER="$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query loginServer -o tsv)"
ACR_RESOURCE_ID="$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)"

###############################################################################
# Step 6.1 — Storage Account for Easy Auth token store (perimeter-secured)
###############################################################################
info "Ensuring Storage Account '$STORAGE_ACCOUNT' exists…"
if az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "Storage Account '$STORAGE_ACCOUNT' already exists; enforcing security settings…"
  az storage account update \
    --name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --allow-blob-public-access false \
    --allow-shared-key-access false \
    --min-tls-version TLS1_2 \
    --public-network-access SecuredByPerimeter \
    --output none
  ok "Storage Account security settings enforced."
else
  # Create with Deny first; SecuredByPerimeter requires NSP association which comes later.
  az storage account create \
    --name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --allow-blob-public-access false \
    --allow-shared-key-access false \
    --default-action Deny \
    --bypass AzureServices \
    --min-tls-version TLS1_2 \
    --output none
  ok "Storage Account '$STORAGE_ACCOUNT' created."
fi

STORAGE_RESOURCE_ID="$(az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" --query id -o tsv)"

# Create blob container via ARM management plane (bypasses data plane firewall + key restrictions)
ensure_blob_container "$STORAGE_RESOURCE_ID" "$TOKEN_CONTAINER"

TOKEN_BLOB_URI="https://${STORAGE_ACCOUNT}.blob.core.windows.net/${TOKEN_CONTAINER}"

###############################################################################
# Step 6.2 — Demo-registry blob container in DEMO_STORAGE_ACCOUNT
###############################################################################
info "Ensuring demo storage account '$DEMO_STORAGE_ACCOUNT' exists…"
demo_storage_check_output=""
DEMO_STORAGE_RESOURCE_ID=""
if demo_storage_check_output="$(az storage account show \
  --name "$DEMO_STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --query id -o tsv 2>&1)"; then
  DEMO_STORAGE_RESOURCE_ID="$demo_storage_check_output"
  ok "Demo storage account '$DEMO_STORAGE_ACCOUNT' found."
elif printf '%s' "$demo_storage_check_output" | grep -Eqi 'could not be found|was not found|ResourceNotFound|NotFound'; then
  fail "Demo storage account '$DEMO_STORAGE_ACCOUNT' not found in resource group '$RESOURCE_GROUP'. Ensure it exists or set DEMO_STORAGE_ACCOUNT to an existing account name in that group."
else
  fail "Failed to check demo storage account '$DEMO_STORAGE_ACCOUNT': $demo_storage_check_output"
fi

# Create blob container via ARM management plane (bypasses data plane firewall + key restrictions)
ensure_blob_container "$DEMO_STORAGE_RESOURCE_ID" "$DEMO_REGISTRY_CONTAINER"

###############################################################################
# Step 6.3 — User-assigned managed identity for ACR image pull
###############################################################################
IDENTITY_NAME="${RESOURCE_PREFIX}-acr-pull"
info "Ensuring managed identity '$IDENTITY_NAME' exists…"
if az identity show --name "$IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  info "Managed identity '$IDENTITY_NAME' already exists."
else
  az identity create \
    --name "$IDENTITY_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" \
    --output none
  ok "Managed identity '$IDENTITY_NAME' created."
fi

IDENTITY_RESOURCE_ID="$(az identity show --name "$IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)"
IDENTITY_PRINCIPAL_ID="$(az identity show --name "$IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" --query principalId -o tsv)"

info "Ensuring AcrPull role assignment for managed identity…"
if az role assignment create \
  --assignee "$IDENTITY_PRINCIPAL_ID" \
  --role AcrPull \
  --scope "$ACR_RESOURCE_ID" \
  --output none 2>/dev/null; then
  ok "AcrPull role assigned to managed identity."
else
  info "AcrPull role already assigned to managed identity."
fi
ok "Managed identity ready for ACR pull."

###############################################################################
# Step 6.4 — Private Endpoints for Storage Accounts
#   Private endpoints enable the ACA VNet-integrated environment to reach
#   storage accounts over the Azure backbone without public network access.
#   DNS resolution is handled by the Private DNS Zone created in Step 5.2.
###############################################################################

# Helper: create a private endpoint + DNS zone group for a storage account.
ensure_private_endpoint() {
  local pe_name="$1" storage_account_name="$2" storage_resource_id="$3"
  info "Ensuring private endpoint '$pe_name' for '$storage_account_name'…"
  if az network private-endpoint show --name "$pe_name" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
    ok "Private endpoint '$pe_name' already exists."
  else
    az network private-endpoint create \
      --name "$pe_name" \
      --resource-group "$RESOURCE_GROUP" \
      --location "$AZURE_LOCATION" \
      --vnet-name "$VNET_NAME" \
      --subnet "$SUBNET_PE" \
      --private-connection-resource-id "$storage_resource_id" \
      --group-id blob \
      --connection-name "${pe_name}-conn" \
      --output none
    ok "Private endpoint '$pe_name' created."
  fi

  local dns_group_name="${pe_name}-dns"
  info "Ensuring DNS zone group '$dns_group_name'…"
  if az network private-endpoint dns-zone-group show --endpoint-name "$pe_name" --name "$dns_group_name" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
    ok "DNS zone group '$dns_group_name' already exists."
  else
    az network private-endpoint dns-zone-group create \
      --endpoint-name "$pe_name" \
      --name "$dns_group_name" \
      --resource-group "$RESOURCE_GROUP" \
      --private-dns-zone "$PRIVATE_DNS_ZONE" \
      --zone-name blob \
      --output none
    ok "DNS zone group '$dns_group_name' created."
  fi
}

ensure_private_endpoint "$PE_TOKEN_STORAGE" "$STORAGE_ACCOUNT" "$STORAGE_RESOURCE_ID"
ensure_private_endpoint "$PE_DEMO_STORAGE" "$DEMO_STORAGE_ACCOUNT" "$DEMO_STORAGE_RESOURCE_ID"

###############################################################################
# Step 6.5 — Network Security Perimeter
#   Creates an NSP with a default profile and associates both storage accounts.
#   The profile starts in Learning mode for safe rollout; switch to Enforced
#   after validating traffic flows:
#     az network perimeter profile update --perimeter-name "$NSP_NAME" \
#       --resource-group "$RESOURCE_GROUP" --name "$NSP_PROFILE" \
#       --access-mode Enforced
#
#   NSP delegates network access control away from per-resource IP/VNet rules.
#   Resources in the same perimeter trust each other; inbound access rules
#   control external access.  The storage accounts' publicNetworkAccess is
#   set to SecuredByPerimeter on re-runs (Step 6.1 update path).
###############################################################################
info "Ensuring Network Security Perimeter '$NSP_NAME'…"
if az network perimeter show --name "$NSP_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "NSP '$NSP_NAME' already exists."
else
  az network perimeter create \
    --name "$NSP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" \
    --output none
  ok "NSP '$NSP_NAME' created."
fi

info "Ensuring NSP profile '$NSP_PROFILE'…"
if az network perimeter profile show --perimeter-name "$NSP_NAME" --name "$NSP_PROFILE" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "NSP profile '$NSP_PROFILE' already exists."
else
  az network perimeter profile create \
    --perimeter-name "$NSP_NAME" \
    --name "$NSP_PROFILE" \
    --resource-group "$RESOURCE_GROUP" \
    --output none
  ok "NSP profile '$NSP_PROFILE' created."
fi

# Add an inbound access rule allowing the ACA subnet.
info "Ensuring NSP inbound access rule for ACA subnet…"
NSP_RULE_ACA="allow-aca-subnet"
if az network perimeter profile access-rule show \
  --perimeter-name "$NSP_NAME" --profile-name "$NSP_PROFILE" \
  --name "$NSP_RULE_ACA" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  ok "NSP access rule '$NSP_RULE_ACA' already exists."
else
  az network perimeter profile access-rule create \
    --perimeter-name "$NSP_NAME" \
    --profile-name "$NSP_PROFILE" \
    --name "$NSP_RULE_ACA" \
    --resource-group "$RESOURCE_GROUP" \
    --address-prefixes "$SUBNET_ACA_PREFIX" \
    --direction Inbound \
    --output none
  ok "NSP access rule '$NSP_RULE_ACA' created."
fi

# Associate storage accounts with the NSP.
# Uses az rest because az network perimeter association create requires
# --private-link-resource and --profile parameters on the REST body.
ensure_nsp_association() {
  local assoc_name="$1" resource_id="$2"
  local nsp_id
  nsp_id="$(az network perimeter show --name "$NSP_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)"
  local assoc_url="${nsp_id}/resourceAssociations/${assoc_name}?api-version=2023-08-01-preview"
  local profile_id="${nsp_id}/profiles/${NSP_PROFILE}"

  info "Ensuring NSP association '$assoc_name'…"
  if az rest --method GET --url "$assoc_url" --output none 2>/dev/null; then
    ok "NSP association '$assoc_name' already exists."
  else
    az rest --method PUT --url "$assoc_url" \
      --body "{
        \"properties\": {
          \"privateLinkResource\": {\"id\": \"${resource_id}\"},
          \"profile\": {\"id\": \"${profile_id}\"},
          \"accessMode\": \"Learning\"
        }
      }" --output none
    ok "NSP association '$assoc_name' created (Learning mode)."
  fi
}

ensure_nsp_association "assoc-token-storage" "$STORAGE_RESOURCE_ID"
ensure_nsp_association "assoc-demo-storage" "$DEMO_STORAGE_RESOURCE_ID"

# Now that NSP associations are in place, switch storage to SecuredByPerimeter.
info "Switching '$STORAGE_ACCOUNT' to SecuredByPerimeter…"
az storage account update \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --public-network-access SecuredByPerimeter \
  --output none
ok "'$STORAGE_ACCOUNT' public network access set to SecuredByPerimeter."

info "Switching '$DEMO_STORAGE_ACCOUNT' to SecuredByPerimeter…"
az storage account update \
  --name "$DEMO_STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --public-network-access SecuredByPerimeter \
  --output none
ok "'$DEMO_STORAGE_ACCOUNT' public network access set to SecuredByPerimeter."

###############################################################################
# Step 7 — ACA Environment (VNet-integrated)
#   The ACA environment must be VNet-integrated so containers can reach
#   storage private endpoints.  Note: VNet integration cannot be added to
#   an existing environment — it must be recreated.
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
    --infrastructure-subnet-resource-id "$SUBNET_ACA_ID" \
    --output none
  ok "ACA environment '$ACA_ENV' created (VNet-integrated)."
fi

###############################################################################
# Step 8 — Build & push container images (ACR cloud build)
###############################################################################
# On Git Bash / MSYS, pwd returns /c/... which az acr build cannot resolve.
# Convert to Windows-style path (C:\...) when cygpath is available.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if command -v cygpath >/dev/null 2>&1; then
  SCRIPT_DIR="$(cygpath -w "$SCRIPT_DIR")"
fi

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
# Step 10 — Deploy registry-api (internal ingress)
###############################################################################
info "Deploying container app '$CA_API'…"
if az containerapp show --name "$CA_API" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az containerapp identity assign \
    --name "$CA_API" \
    --resource-group "$RESOURCE_GROUP" \
    --user-assigned "$IDENTITY_RESOURCE_ID" \
    --output none
  az containerapp registry set \
    --name "$CA_API" \
    --resource-group "$RESOURCE_GROUP" \
    --server "$ACR_LOGIN_SERVER" \
    --identity "$IDENTITY_RESOURCE_ID" \
    --output none
  az containerapp update \
    --name "$CA_API" \
    --resource-group "$RESOURCE_GROUP" \
    --image "${ACR_LOGIN_SERVER}/registry-api:latest" \
    --min-replicas 1 \
    --max-replicas 1 \
    --set-env-vars \
      PORT=3001 \
      CORS_ORIGIN='*' \
      NODE_ENV=production \
    --output none
  az containerapp ingress update \
    --name "$CA_API" \
    --resource-group "$RESOURCE_GROUP" \
    --type internal \
    --target-port 3001 \
    --output none
  ok "$CA_API updated."
else
  az containerapp create \
    --name "$CA_API" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ACA_ENV" \
    --image "${ACR_LOGIN_SERVER}/registry-api:latest" \
    --registry-server "$ACR_LOGIN_SERVER" \
    --registry-identity "$IDENTITY_RESOURCE_ID" \
    --user-assigned "$IDENTITY_RESOURCE_ID" \
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
# Step 10.1 — System-assigned MI for ca-registry-api (blob access)
###############################################################################
info "Ensuring system-assigned managed identity on '$CA_API'…"
az containerapp identity assign \
  --name "$CA_API" \
  --resource-group "$RESOURCE_GROUP" \
  --system-assigned \
  --output none
API_MI_PRINCIPAL_ID="$(az containerapp show --name "$CA_API" --resource-group "$RESOURCE_GROUP" --query 'identity.principalId' -o tsv)"
[[ -n "$API_MI_PRINCIPAL_ID" ]] || fail "Failed to resolve system-assigned managed identity principalId for '$CA_API'."
ok "System-assigned MI enabled (principalId: ${API_MI_PRINCIPAL_ID:0:8}…)."

info "Assigning Storage Blob Data Contributor to $CA_API MI on '$DEMO_STORAGE_ACCOUNT'…"
EXISTING_API_ROLE_COUNT="$(az role assignment list \
  --assignee-object-id "$API_MI_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope "$DEMO_STORAGE_RESOURCE_ID" \
  --query 'length(@)' \
  -o tsv)"

if [[ "$EXISTING_API_ROLE_COUNT" -gt 0 ]]; then
  info "Storage Blob Data Contributor already assigned to $CA_API MI."
else
  az role assignment create \
    --assignee-object-id "$API_MI_PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "Storage Blob Data Contributor" \
    --scope "$DEMO_STORAGE_RESOURCE_ID" \
    --output none
  ok "Storage Blob Data Contributor assigned to $CA_API MI."
fi

###############################################################################
# Step 10.2 — Enable blob backend on ca-registry-api
#   Set STORE_BACKEND *after* MI + RBAC are in place so the new revision
#   starts with working credentials.  Network access is handled by the
#   VNet-integrated environment + private endpoints + NSP (Steps 5.1–6.5).
#   The readiness probe (/health/ready) will not return 200 until
#   BlobStore.ping() succeeds, confirming blob storage is reachable.
###############################################################################
info "Switching $CA_API to blob store backend…"
az containerapp update \
  --name "$CA_API" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars \
    STORE_BACKEND=blob \
    "AZURE_STORAGE_ACCOUNT_NAME=${DEMO_STORAGE_ACCOUNT}" \
    "AZURE_STORAGE_CONTAINER_NAME=${DEMO_REGISTRY_CONTAINER}" \
  --output none
ok "$CA_API blob backend env vars applied."

###############################################################################
# Step 11 — Deploy launcher (external ingress)
###############################################################################
info "Deploying container app '$CA_LAUNCHER'…"
if az containerapp show --name "$CA_LAUNCHER" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az containerapp identity assign \
    --name "$CA_LAUNCHER" \
    --resource-group "$RESOURCE_GROUP" \
    --user-assigned "$IDENTITY_RESOURCE_ID" \
    --output none
  az containerapp registry set \
    --name "$CA_LAUNCHER" \
    --resource-group "$RESOURCE_GROUP" \
    --server "$ACR_LOGIN_SERVER" \
    --identity "$IDENTITY_RESOURCE_ID" \
    --output none
  az containerapp update \
    --name "$CA_LAUNCHER" \
    --resource-group "$RESOURCE_GROUP" \
    --image "${ACR_LOGIN_SERVER}/launcher:latest" \
    --min-replicas 1 \
    --max-replicas 1 \
    --set-env-vars "API_BACKEND_URL=${API_INTERNAL_URL}" \
    --output none
  az containerapp ingress update \
    --name "$CA_LAUNCHER" \
    --resource-group "$RESOURCE_GROUP" \
    --type external \
    --target-port 80 \
    --output none
  ok "$CA_LAUNCHER updated."
else
  az containerapp create \
    --name "$CA_LAUNCHER" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ACA_ENV" \
    --image "${ACR_LOGIN_SERVER}/launcher:latest" \
    --registry-server "$ACR_LOGIN_SERVER" \
    --registry-identity "$IDENTITY_RESOURCE_ID" \
    --user-assigned "$IDENTITY_RESOURCE_ID" \
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
  az containerapp identity assign \
    --name "$CA_ADMIN" \
    --resource-group "$RESOURCE_GROUP" \
    --user-assigned "$IDENTITY_RESOURCE_ID" \
    --output none
  az containerapp registry set \
    --name "$CA_ADMIN" \
    --resource-group "$RESOURCE_GROUP" \
    --server "$ACR_LOGIN_SERVER" \
    --identity "$IDENTITY_RESOURCE_ID" \
    --output none
  az containerapp update \
    --name "$CA_ADMIN" \
    --resource-group "$RESOURCE_GROUP" \
    --image "${ACR_LOGIN_SERVER}/admin:latest" \
    --min-replicas 1 \
    --max-replicas 1 \
    --set-env-vars "API_BACKEND_URL=${API_INTERNAL_URL}" \
    --output none
  az containerapp ingress update \
    --name "$CA_ADMIN" \
    --resource-group "$RESOURCE_GROUP" \
    --type external \
    --target-port 80 \
    --output none
  ok "$CA_ADMIN updated."
else
  az containerapp create \
    --name "$CA_ADMIN" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ACA_ENV" \
    --image "${ACR_LOGIN_SERVER}/admin:latest" \
    --registry-server "$ACR_LOGIN_SERVER" \
    --registry-identity "$IDENTITY_RESOURCE_ID" \
    --user-assigned "$IDENTITY_RESOURCE_ID" \
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
# Step 12.1 — System-assigned MI for ca-admin (token store blob access)
###############################################################################
info "Ensuring system-assigned managed identity on '$CA_ADMIN'…"
az containerapp identity assign \
  --name "$CA_ADMIN" \
  --resource-group "$RESOURCE_GROUP" \
  --system-assigned \
  --output none
ADMIN_MI_PRINCIPAL_ID="$(az containerapp show --name "$CA_ADMIN" --resource-group "$RESOURCE_GROUP" --query 'identity.principalId' -o tsv)"
[[ -n "$ADMIN_MI_PRINCIPAL_ID" ]] || fail "Failed to resolve system-assigned managed identity principalId for '$CA_ADMIN'."
ok "System-assigned MI enabled (principalId: ${ADMIN_MI_PRINCIPAL_ID:0:8}…)."

info "Assigning Storage Blob Data Contributor to ca-admin MI on '$STORAGE_ACCOUNT'…"
EXISTING_ROLE_ASSIGNMENT_COUNT="$(az role assignment list \
  --assignee-object-id "$ADMIN_MI_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope "$STORAGE_RESOURCE_ID" \
  --query 'length(@)' \
  -o tsv)"

if [[ "$EXISTING_ROLE_ASSIGNMENT_COUNT" -gt 0 ]]; then
  info "Storage Blob Data Contributor already assigned to ca-admin MI."
else
  az role assignment create \
    --assignee-object-id "$ADMIN_MI_PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "Storage Blob Data Contributor" \
    --scope "$STORAGE_RESOURCE_ID" \
    --output none
  ok "Storage Blob Data Contributor assigned to ca-admin MI."
fi

###############################################################################
# Step 13 — Entra ID App Registration for Admin Easy Auth
###############################################################################
info "Configuring Entra ID app registration for admin auth…"
ADMIN_REDIRECT_URI="${ADMIN_URL}/.auth/login/aad/callback"

# Check if app registration already exists
EXISTING_APP_ID="$(az ad app list --display-name "$ENTRA_APP_NAME" --query '[0].appId' -o tsv 2>/dev/null || echo '')"

SECRET_UNCHANGED=false
SECRET_END_DATE="$(date -u -d "+${SECRET_LIFETIME_DAYS} days" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+${SECRET_LIFETIME_DAYS}d '+%Y-%m-%dT%H:%M:%SZ')"

if [[ -n "$EXISTING_APP_ID" && "$EXISTING_APP_ID" != "None" ]]; then
  info "Entra ID app '$ENTRA_APP_NAME' already exists (appId: $EXISTING_APP_ID)."
  CLIENT_ID="$EXISTING_APP_ID"
  # Update redirect URI in case admin URL changed
  APP_OBJECT_ID="$(az ad app list --display-name "$ENTRA_APP_NAME" --query '[0].id' -o tsv)"
  az ad app update --id "$APP_OBJECT_ID" \
    --web-redirect-uris "$ADMIN_REDIRECT_URI" \
    --output none 2>/dev/null || true

  # Only create/rotate the secret if one doesn't already exist or rotation is explicitly requested.
  EXISTING_SECRET_EXPIRY="$(az ad app credential list \
    --id "$CLIENT_ID" \
    --query "[?displayName=='bootstrap-secret'].endDateTime | [0]" \
    -o tsv 2>/dev/null || echo '')"

  if [[ -n "$EXISTING_SECRET_EXPIRY" && "$EXISTING_SECRET_EXPIRY" != "None" ]]; then
    if [[ "${ROTATE_SECRET}" == "true" ]]; then
      info "Rotating client secret (ROTATE_SECRET=true, lifetime: ${SECRET_LIFETIME_DAYS} days)…"
      CLIENT_SECRET="$(az ad app credential reset \
        --id "$CLIENT_ID" \
        --display-name "bootstrap-secret" \
        --end-date "$SECRET_END_DATE" \
        --query password -o tsv)"
    else
      warn "Client secret 'bootstrap-secret' already exists (expires: $EXISTING_SECRET_EXPIRY)."
      warn "Set ROTATE_SECRET=true to rotate credentials."
      SECRET_UNCHANGED=true
    fi
  else
    info "No existing 'bootstrap-secret' found. Creating client secret (lifetime: ${SECRET_LIFETIME_DAYS} days)…"
    CLIENT_SECRET="$(az ad app credential reset \
      --id "$CLIENT_ID" \
      --display-name "bootstrap-secret" \
      --end-date "$SECRET_END_DATE" \
      --query password -o tsv)"
  fi
else
  info "Creating Entra ID app registration '$ENTRA_APP_NAME'…"
  CLIENT_ID="$(az ad app create \
    --display-name "$ENTRA_APP_NAME" \
    --web-redirect-uris "$ADMIN_REDIRECT_URI" \
    --sign-in-audience AzureADMyOrg \
    --query appId -o tsv)"
  ok "Entra ID app created (appId: $CLIENT_ID)."

  info "Creating client secret (lifetime: ${SECRET_LIFETIME_DAYS} days)…"
  CLIENT_SECRET="$(az ad app credential reset \
    --id "$CLIENT_ID" \
    --display-name "bootstrap-secret" \
    --end-date "$SECRET_END_DATE" \
    --query password -o tsv)"
fi

# Enable ID token issuance (required for Easy Auth server-directed flow)
info "Ensuring ID token issuance is enabled…"
az ad app update --id "$CLIENT_ID" --enable-id-token-issuance true --output none
ok "ID token issuance enabled."

# Ensure a service principal exists (required for sign-in to work)
info "Ensuring service principal exists for '$ENTRA_APP_NAME'…"
if az ad sp show --id "$CLIENT_ID" --output none 2>/dev/null; then
  info "Service principal already exists."
else
  az ad sp create --id "$CLIENT_ID" --output none
  ok "Service principal created."
fi

###############################################################################
# Step 14 — Enable Easy Auth on admin container app
###############################################################################
info "Configuring Easy Auth (Microsoft provider) on '$CA_ADMIN'…"
TENANT_ID="$(az account show --query tenantId -o tsv)"

# Store client secret as ACA secret — only when a fresh secret was created/rotated.
if [[ "$SECRET_UNCHANGED" != "true" ]]; then
  if ! az containerapp secret set \
    --name "$CA_ADMIN" \
    --resource-group "$RESOURCE_GROUP" \
    --secrets "microsoft-provider-authentication-secret=${CLIENT_SECRET}" \
    --output none; then
    fail "Failed to set Container App secret on '$CA_ADMIN'. Cannot proceed with Easy Auth configuration — aborting bootstrap."
  fi
else
  # Verify the ACA secret exists — it may be missing if the container app was
  # recreated or the secret was manually deleted since the last run.
  if ! az containerapp secret show \
    --name "$CA_ADMIN" \
    --resource-group "$RESOURCE_GROUP" \
    --secret-name "microsoft-provider-authentication-secret" \
    --output none 2>/dev/null; then
    fail "Container App secret 'microsoft-provider-authentication-secret' does not exist on '$CA_ADMIN' but the Entra client secret was not rotated. Re-run with ROTATE_SECRET=true to create a fresh secret."
  fi
  info "Client secret unchanged; reusing existing ACA secret."
fi

# Always (re-)apply the Microsoft auth provider configuration so that the issuer
# and other settings are correct even on re-runs or after an interrupted previous attempt.
if ! az containerapp auth microsoft update \
  --name "$CA_ADMIN" \
  --resource-group "$RESOURCE_GROUP" \
  --client-id "$CLIENT_ID" \
  --client-secret-name "microsoft-provider-authentication-secret" \
  --issuer "https://login.microsoftonline.com/${TENANT_ID}/v2.0" \
  --yes \
  --output none 2>/dev/null; then
  # If provider configuration fails, try enabling auth first and then configure again.
  az containerapp auth update \
    --name "$CA_ADMIN" \
    --resource-group "$RESOURCE_GROUP" \
    --unauthenticated-client-action RedirectToLoginPage \
    --enabled true \
    --output none 2>/dev/null || fail "Failed to enable Easy Auth on '$CA_ADMIN'."
  az containerapp auth microsoft update \
    --name "$CA_ADMIN" \
    --resource-group "$RESOURCE_GROUP" \
    --client-id "$CLIENT_ID" \
    --client-secret-name "microsoft-provider-authentication-secret" \
    --issuer "https://login.microsoftonline.com/${TENANT_ID}/v2.0" \
    --yes \
    --output none || fail "Failed to configure Microsoft auth provider on '$CA_ADMIN'."
fi

# Always explicitly enable auth and enforce redirect-to-login for unauthenticated requests.
# Enable token store backed by blob storage (using system-assigned MI for access).
az containerapp auth update \
  --name "$CA_ADMIN" \
  --resource-group "$RESOURCE_GROUP" \
  --unauthenticated-client-action RedirectToLoginPage \
  --enabled true \
  --token-store true \
  --blob-container-uri "$TOKEN_BLOB_URI" \
  --output none || fail "Failed to configure Easy Auth on '$CA_ADMIN'."

# Verify the unauthenticated action is correctly set.
AUTH_ACTION="$(az containerapp auth show \
  --name "$CA_ADMIN" \
  --resource-group "$RESOURCE_GROUP" \
  --query 'globalValidation.unauthenticatedClientAction' \
  -o tsv)" || fail "Failed to query Easy Auth configuration on '$CA_ADMIN'."
[[ "$AUTH_ACTION" == "RedirectToLoginPage" ]] || fail "Easy Auth configuration succeeded but verification failed: unauthenticated client action is '${AUTH_ACTION}', expected 'RedirectToLoginPage' on '$CA_ADMIN'."

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

  # Registry API reachability via launcher proxy — confirms blob storage
  # network access is working (readiness probe gates on BlobStore.ping()).
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${LAUNCHER_URL}/api/demos" 2>/dev/null || echo '000')"
  if [[ "$HTTP_CODE" =~ ^2 ]]; then
    ok "Registry API /api/demos (via launcher) → $HTTP_CODE (blob storage reachable)"
  else
    warn "Registry API /api/demos (via launcher) → $HTTP_CODE (registry-api may still be starting or blob storage unreachable)"
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
echo "  ACA Environment:   $ACA_ENV (VNet: $VNET_NAME)"
echo "  NSP:               $NSP_NAME (Learning mode)"
echo "  Entra App ID:      $CLIENT_ID"
echo ""
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  NEXT STEPS                                     │"
echo "  │                                                  │"
echo "  │  1. Restrict admin access:                       │"
echo "  │     Azure Portal → Entra ID →                   │"
echo "  │     App registrations → '$ENTRA_APP_NAME'       │"
echo "  │     → 'Assignment required?' = Yes               │"
echo "  │     → 'Users and groups' → add allowed users     │"
echo "  │                                                  │"
echo "  │  2. Switch NSP to Enforced mode once validated:  │"
echo "  │     az network perimeter profile update \\        │"
echo "  │       --perimeter-name $NSP_NAME \\              │"
echo "  │       --resource-group $RESOURCE_GROUP \\        │"
echo "  │       --name $NSP_PROFILE \\                     │"
echo "  │       --access-mode Enforced                     │"
echo "  └─────────────────────────────────────────────────┘"
echo ""

if [[ "$SMOKE_OK" == "true" ]]; then
  ok "All smoke tests passed."
else
  warn "Some smoke tests failed — services may still be starting up. Retry in a minute."
fi
