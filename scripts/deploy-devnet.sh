#!/usr/bin/env bash
# Deploy all 3 CredAgent programs to Solana devnet
set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}━━━ CredAgent Devnet Deployment ━━━${NC}"

# Verify cluster
CLUSTER=$(solana config get | grep "RPC URL" | awk '{print $3}')
if [[ ! "$CLUSTER" == *"devnet"* ]]; then
    echo "ERROR: Not on devnet. Run: solana config set -ud"
    exit 1
fi

echo -e "${GREEN}[✓]${NC} Cluster: devnet"
echo -e "${GREEN}[✓]${NC} Wallet: $(solana address)"
echo -e "${GREEN}[✓]${NC} Balance: $(solana balance)"

# Build
echo -e "\n${CYAN}Building programs...${NC}"
anchor build

# Extract program IDs
echo -e "\n${CYAN}Syncing program keys...${NC}"
anchor keys sync

# Deploy
echo -e "\n${CYAN}Deploying credit_score_oracle...${NC}"
anchor deploy --program-name credit_score_oracle --provider.cluster devnet

echo -e "\n${CYAN}Deploying agent_permissions...${NC}"
anchor deploy --program-name agent_permissions --provider.cluster devnet

echo -e "\n${CYAN}Deploying lending_pool...${NC}"
anchor deploy --program-name lending_pool --provider.cluster devnet

# Print program IDs
echo -e "\n${CYAN}━━━ Deployed Program IDs ━━━${NC}"
anchor keys list

echo -e "\n${GREEN}━━━ Deployment complete ━━━${NC}"
echo "Update .env with the program IDs above."
