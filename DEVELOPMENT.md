# CLI Development Workflow

## Before Making Changes

1. **Always create a backup first:**
   ```bash
   cp src/cli.js src/cli.js.backup
   ```

2. **Or use git:**
   ```bash
   git add src/cli.js && git commit -m "Backup before changes"
   ```

## Recovery Steps

If CLI gets corrupted:
1. Check git history: `git log --oneline`
2. Restore last working: `git checkout HEAD~1 src/cli.js`
3. Or check backups: `ls src/cli.js.backup*`

## Key Files to Backup
- `src/cli.js` - Main CLI
- `~/.config/btc-wallet/wallet.json` - Wallet data
- `~/.config/btc-wallet/descriptors.json` - Imported descriptors

## Testing Checklist
After any changes:
- [ ] `node src/cli.js --testnet address` - Works
- [ ] `node src/cli.js --testnet descriptors` - Works  
- [ ] `node src/cli.js --testnet import-descriptor "<test-descriptor>"` - Works

## Emergency Recovery
```bash
# Restore from git
cd ~/.openclaw/workspace/rare-sat-extractor-dapp
git checkout HEAD -- src/cli.js

# Or restore wallet from seed
# mnemonic: paper evil still fluid bird drill truth three spoil loyal birth arrow
```
