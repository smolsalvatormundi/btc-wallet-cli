#!/bin/bash
# Backup script for BTC Wallet CLI

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=~/.config/btc-wallet/backups
mkdir -p $BACKUP_DIR

# Backup CLI
cp src/cli.js src/cli.js.backup_$DATE

# Backup wallet data
if [ -f ~/.config/btc-wallet/wallet.json ]; then
    cp ~/.config/btc-wallet/wallet.json $BACKUP_DIR/wallet_$DATE.json
fi

# Backup descriptors
if [ -f ~/.config/btc-wallet/descriptors.json ]; then
    cp ~/.config/btc-wallet/descriptors.json $BACKUP_DIR/descriptors_$DATE.json
fi

echo "Backup created: $DATE"
ls -la src/cli.js.backup_$DATE
