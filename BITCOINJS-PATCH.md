# Bitcoinjs-lib Taproot BIP86 Patch

## Problem
For BIP86 Taproot signing, bitcoinjs-lib checks the public key against `witnessUtxo.script` instead of `tapInternalKey`. This causes signing to fail for PSBTs where the witnessUtxo contains the output (tweaked) key while tapInternalKey contains the internal key.

## Fix
In `node_modules/bitcoinjs-lib/src/cjs/psbt.cjs`, function `getPrevoutTaprootKey`:

```javascript
// Around line 1374, add this fix:
function getPrevoutTaprootKey(inputIndex, input, cache) {
  // FIX: If tapInternalKey is available, use it instead of witnessUtxo key
  if (input.tapInternalKey) return input.tapInternalKey;
  
  // ... original code below
```

This ensures the library uses `tapInternalKey` (the key we can sign with) instead of `witnessUtxo.script` (the output key in the UTXO).

## Why This Works
In BIP86:
- `tapInternalKey` = internal public key (what we derive from BIP32)
- `witnessUtxo.script` = output (tweaked) public key (what's locked in the UTXO)

For signing, we have the internal private key. The library should check against tapInternalKey, not witnessUtxo.
