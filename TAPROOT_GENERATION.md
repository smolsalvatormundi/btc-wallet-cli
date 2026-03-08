# Taproot (BIP86) Address Generation

## The Correct Way

```javascript
const bip39 = require('bip39');
const { payments, initEccLib, networks } = require('bitcoinjs-lib');
const tiny = require('tiny-secp256k1');
const { HDKey } = require('@scure/bip32');

// Initialize ECC
initEccLib(tiny);
const network = networks.bitcoin;

// Your mnemonic
const mnemonic = 'witness fine topic kiss harsh monster ahead enjoy treat short improve solve';

// 1. Generate seed from mnemonic
const seed = bip39.mnemonicToSeedSync(mnemonic);
const root = HDKey.fromMasterSeed(seed);

// 2. Derive BIP86 path: m/86'/0'/0'/0/0
const key = root.derive("m/86'/0'/0'/0/0");

// 3. CRITICAL: Convert to Buffer
const privkey = Buffer.from(key.privateKey);

// 4. Get x-only public key for Taproot
const internalPubkey = tiny.xOnlyPointFromScalar(privkey);

// 5. CRITICAL: Use internalPubkey (not pubkey!) in payments.p2tr()
const { address } = payments.p2tr({
  internalPubkey,
  network
});

console.log('Taproot Address:', address);
```

## Key Fixes (The subtle parts)

### Fix 1: Buffer conversion
```javascript
// WRONG:
const xOnly = tiny.xOnlyPointFromScalar(key.privateKey);

// RIGHT:
const internalPubkey = tiny.xOnlyPointFromScalar(Buffer.from(key.privateKey));
```

### Fix 2: Use internalPubkey parameter
```javascript
// WRONG:
const { address } = payments.p2tr({ pubkey: xOnly, network });

// RIGHT:
const { address } = payments.p2tr({ internalPubkey, network });
```

## Why This Matters

- Taproot uses BIP341 key tweaking internally
- `payments.p2tr()` with `internalPubkey` handles the tweak automatically
- Using `pubkey` produces a completely different (wrong) address
- The Buffer conversion is needed because `@scure/bip32` returns Uint8Array, not Node Buffer

## Libraries Used

- `bip39` - BIP39 mnemonic processing
- `@scure/bip32` - HD key derivation  
- `tiny-secp256k1` - ECC operations (use `xOnlyPointFromScalar`)
- `bitcoinjs-lib` - Bitcoin address creation (`payments.p2tr`)

## Compatible With

- Xverse
- Sparrow
- Leather Wallet
- Other standard Taproot wallets
