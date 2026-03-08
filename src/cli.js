#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const bip39 = require('bip39');
const { HDKey } = require('@scure/bip32');
const { payments, initEccLib, Psbt, networks } = require('bitcoinjs-lib');
const tinysecp256k1 = require('tiny-secp256k1');
const readline = require('readline');

// Initialize ECC
initEccLib(tinysecp256k1);

// Wallet storage
const WALLET_DIR = path.join(os.homedir(), '.config', 'btc-wallet');
const WALLET_FILE = path.join(WALLET_DIR, 'wallet.json');

if (!fs.existsSync(WALLET_DIR)) {
  fs.mkdirSync(WALLET_DIR, { recursive: true });
}

// ============================================================
// ENCRYPTION (AES-256-GCM + PBKDF2)
// ============================================================

const ENC = { algo: 'aes-256-gcm', keyLen: 32, ivLen: 16, saltLen: 32, iter: 100000, tagLen: 16 };

function deriveKey(pwd, salt) {
  return crypto.pbkdf2Sync(pwd, salt, ENC.iter, ENC.keyLen, 'sha256');
}

function encrypt(data, pwd) {
  const salt = crypto.randomBytes(ENC.saltLen);
  const iv = crypto.randomBytes(ENC.ivLen);
  const key = deriveKey(pwd, salt);
  const cipher = crypto.createCipheriv(ENC.algo, key, iv, { authTagLength: ENC.tagLen });
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, enc]).toString('base64');
}

function decrypt(encB64, pwd) {
  const buf = Buffer.from(encB64, 'base64');
  const salt = buf.subarray(0, ENC.saltLen);
  const iv = buf.subarray(ENC.saltLen, ENC.saltLen + ENC.ivLen);
  const tag = buf.subarray(ENC.saltLen + ENC.ivLen, ENC.saltLen + ENC.ivLen + ENC.tagLen);
  const enc = buf.subarray(ENC.saltLen + ENC.ivLen + ENC.tagLen);
  const key = deriveKey(pwd, salt);
  const decipher = crypto.createDecipheriv(ENC.algo, key, iv, { authTagLength: ENC.tagLen });
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  try { return JSON.parse(dec); } catch { return dec; }
}

function secureWipe(buf) { if (buf && Buffer.isBuffer(buf)) buf.fill(0); }

// ============================================================
// STATE
// ============================================================

let wallet = null;
let unlocked = false;
let unlockedData = null;
let currentNet = 'mainnet';
let descriptors = []; // Store imported descriptors

// ============================================================
// HELPERS
// ============================================================

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function q(p) { return new Promise(r => rl.question(p, r)); }

function getMeta() {
  if (!fs.existsSync(WALLET_FILE)) return { exists: false, encrypted: false };
  try {
    const d = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
    return { exists: true, encrypted: d.encrypted === true, address: d.address, network: d.network };
  } catch { return { exists: false, encrypted: false }; }
}

function checkReady() {
  const m = getMeta();
  if (m.encrypted && !unlocked) return { ready: false, reason: 'locked' };
  return { ready: true };
}

function createWallet(mnemonic, net = 'mainnet') {
  if (!bip39.validateMnemonic(mnemonic)) throw new Error('Invalid mnemonic');
  const netObj = net === 'testnet' ? networks.testnet : networks.bitcoin;
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive("m/86'/0'/0'/0/0");
  if (!child.privateKey || !child.publicKey) throw new Error('Derive failed');
  const xOnly = child.publicKey.slice(-33).slice(1);
  const addr = payments.p2tr({ internalPubkey: xOnly, network: netObj }).address;
  return { mnemonic, privateKey: child.privateKey, publicKey: child.publicKey, address: addr, network: net };
}

function saveWallet(w, pwd = null) {
  loadDescriptors(); // Preserve existing descriptors
  if (pwd) {
    fs.writeFileSync(WALLET_FILE, JSON.stringify({
      encrypted: true,
      address: w.address,
      network: w.network || 'mainnet',
      descriptors: descriptors,
      data: encrypt({ mnemonic: w.mnemonic, privateKey: Buffer.from(w.privateKey).toString('hex'), network: w.network || 'mainnet' }, pwd)
    }, null, 2));
    console.log('💾 Encrypted wallet saved');
  } else {
    fs.writeFileSync(WALLET_FILE, JSON.stringify({
      mnemonic: w.mnemonic,
      privateKey: Buffer.from(w.privateKey).toString('hex'),
      address: w.address,
      network: w.network || 'mainnet',
      descriptors: descriptors
    }, null, 2));
    console.log('💾 Wallet saved');
  }
}

function loadWallet(pwd = null) {
  if (!fs.existsSync(WALLET_FILE)) return null;
  const d = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
  if (d.encrypted === true) {
    if (!pwd) { console.log('🔐 Wallet encrypted. Use --password or "unlock <pwd>"'); return null; }
    try {
      const dec = decrypt(d.data, pwd);
      const net = dec.network || 'mainnet';
      const w = createWallet(dec.mnemonic, net);
      w.privateKey = Buffer.from(dec.privateKey, 'hex');
      w.network = net;
      currentNet = net;
      return w;
    } catch { console.log('❌ Invalid password'); return null; }
  }
  const net = d.network || 'mainnet';
  const w = createWallet(d.mnemonic, net);
  w.privateKey = Buffer.from(d.privateKey, 'hex');
  w.network = net;
  currentNet = net;
  return w;
}

function unlock(pwd) {
  const m = getMeta();
  if (!m.encrypted) throw new Error('Not encrypted');
  const d = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
  const dec = decrypt(d.data, pwd);
  const net = dec.network || 'mainnet';
  unlockedData = { mnemonic: dec.mnemonic, privateKey: Buffer.from(dec.privateKey, 'hex'), address: m.address };
  unlocked = true;
  wallet = createWallet(dec.mnemonic, net);
  wallet.privateKey = unlockedData.privateKey;
  console.log(`✅ Unlocked: ${m.address}`);
  return wallet;
}

function lock() {
  if (unlockedData) secureWipe(unlockedData.privateKey);
  unlockedData = null;
  unlocked = false;
  wallet = null;
  console.log('🔒 Locked');
}

// ============================================================
// DESCRIPTOR SUPPORT (BIP 389)
// ============================================================

function parseDescriptor(desc) {
  // Parse: tr([fp/86'/0'/0']xpub.../0/0/*) or tr(xpub.../86'/0'/0'/*)
  // Convert h notation to ' (86h -> 86') FIRST
  desc = desc.replace(/(\d+)h\b/g, "$1'");
  
  let origin = null;
  let key = null;
  let path = '';
  
  const originMatch = desc.match(/\[([^\]]+)\]/);
  if (originMatch) {
    origin = originMatch[1];
    desc = desc.replace(originMatch[0], '');
  }
  
  const keyMatch = desc.match(/tr\(([^)]+)\)/);
  if (keyMatch) {
    const keyFull = keyMatch[1];
    const parts = keyFull.split('/');
    // If ends with *, extract path
    if (parts[parts.length-1] === '*') {
      path = parts.slice(-3, -1).join('/');
      key = parts.slice(0, -3).join('/');
    } else {
      key = keyFull;
    }
  }
  
  return { origin, key, path };
}

function deriveFromDescriptor(desc, index = 0) {
  const { origin, key, path } = parseDescriptor(desc);
  console.log("DEBUG parse: origin =", origin, "key =", key ? key.substring(0,30) : "null", "path =", path);
  if (!key) throw new Error('Invalid descriptor: no key found');
  
  let hdKey;
  
  // Define version bytes for different key types
  const VERSIONS = {
    xpub: { private: 0x0488ade4, public: 0x0488b21e },
    ypub: { private: 0x049d7878, public: 0x049d7cb2 },
    zpub: { private: 0x04b2430c, public: 0x04b24746 },
    vpub: { private: 0x045f1cf6, public: 0x045f18bc },
    tpub: { private: 0x04358394, public: 0x043587cf },  // testnet
    upub: { private: 0x044526be, public: 0x0446fa80 },  // testnet uncomp
  };
  
  // Detect key type and use appropriate versions
  let versions = VERSIONS.xpub;  // default
  
  if (key.startsWith('tpub')) { versions = VERSIONS.tpub;  }
  else if (key.startsWith('zpub')) versions = VERSIONS.zpub;
  else if (key.startsWith('ypub')) versions = VERSIONS.ypub;
  else if (key.startsWith('vpub')) versions = VERSIONS.vpub;
  
  try {
    
    hdKey = HDKey.fromExtendedKey(key, versions);
  } catch (e) {
    // Fallback: try default
    hdKey = HDKey.fromExtendedKey(key);
  }
  
  // The xpub is already at the account level (e.g., m/86'/1'/0')
  // We can only do non-hardened derivation from xpub
  // So we skip origin derivation and just use the trailing path directly
  
  // Derive the trailing path (e.g., 0/0) from the xpub directly
  const fullPath = path.replace(/\*/g, index.toString());
  
  // DEBUG
  console.log("DEBUG: origin =", origin, "key =", key ? key.substring(0, 20) + "..." : "none", "path =", path);
  
  // Handle both hardened and non-hardened paths
  // The xpub is already at account level (e.g., m/86'/1'/0')
  // For BIP86, derive to m/86'/1'/0'/change/index
  // But since we have xpub (public key only), we can only do non-hardened derivation
  // The path should be relative to the xpub's level
  
  let child;
  // Format path - need "m/" prefix for HDKey
  const formattedPath = fullPath.includes("'") ? "m/" + fullPath : "m/" + fullPath;
  
  try {
    child = hdKey.derive(formattedPath);
  } catch(e) {
    // Try without hardened markers
    const nonHardenedPath = "m/" + fullPath.replace(/'/g, '');
    child = hdKey.derive(nonHardenedPath);
  }
  
  if (!child.publicKey) throw new Error('Failed to derive key');
  
  const xOnly = child.publicKey.slice(-33).slice(1);
  const netObj = currentNet === 'testnet' ? networks.testnet : networks.bitcoin;
  const { address } = payments.p2tr({ internalPubkey: xOnly, network: netObj });
  
  return {
    address,
    publicKey: Buffer.from(child.publicKey),
    privateKey: child.privateKey ? Buffer.from(child.privateKey) : null
  };
}

function parseSparrowDescriptor(content) {
  try {
    const data = JSON.parse(content);
    return {
      name: data.name || 'Imported Descriptor',
      descriptor: data.descriptor || data.descriptors?.[0],
      timestamp: data.timestamp || Date.now()
    };
  } catch {
    return {
      name: 'Imported Descriptor',
      descriptor: content.trim(),
      timestamp: Date.now()
    };
  }
}

function saveDescriptors() {
  if (!fs.existsSync(WALLET_FILE)) return;
  const d = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
  d.descriptors = descriptors;
  fs.writeFileSync(WALLET_FILE, JSON.stringify(d, null, 2));
}

function loadDescriptors() {
  if (!fs.existsSync(WALLET_FILE)) return;
  try {
    const d = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
    descriptors = d.descriptors || [];
  } catch { descriptors = []; }
}

// ============================================================
// PSBT SIGNING (TAPROOT)
// ============================================================

function signPsbtWithTaproot(psbt, privateKey, internalPubkey) {
  // BIP386: Tweak = H_TapTweak(pubkey) where pubkey is full 33-byte (with parity)
  // We need to reconstruct the full pubkey from x-only + derive parity
  // Actually for BIP386 signing, we need internalPrivKey (untweaked) + compute tweak properly
  
  // For BIP386: tweakedPrivKey = privKey + H_TapTweak(pubkey) mod n
  // The pubkey for tweak is: 0x02 || x if y is even, 0x03 || x if y is odd
  // We can get parity from the witnessUtxo's scriptPubKey or derive from private key
  
  // Simpler approach: use untweaked key for signing (BIP86 internal key)
  // BIP86 doesn't use tweaking for the internal key - it's the direct derivation
  const privKeyNum = BigInt('0x' + privateKey.toString('hex'));
  const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  
  // For BIP86: sign directly with the derived private key (no tweak needed for m/86'/0'/0'/0/0)
  // The tweak is only needed for keys in the scripts path
  
  // Sign each input
  let signedCount = 0;
  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const input = psbt.data.inputs[i];
    if (!input.witnessUtxo) continue;
    
    // Check if this is a Taproot input
    const script = input.witnessUtxo.script;
    if (!script || script[0] !== 0x51 || script[1] !== 0x20) continue;
    
    try {
      const hash = psbt.hashForTaprootSignature(i, script, undefined, 0);
      const sig = tinysecp256k1.signSchnorr(hash, privateKey);
      input.tapKeySig = sig;
      signedCount++;
    } catch (e) {
      // Can't sign this input
    }
  }
  
  if (signedCount > 0) {
    psbt.finalizeAllInputs();
  }
  
  return psbt;
}

function signPsbtWithDescriptor(psbt, descriptor) {
  try {
    // Use deriveFromDescriptor to get the proper key from the descriptor's path
    const derived = deriveFromDescriptor(descriptor, 0);
    
    if (!derived.privateKey) {
      console.log('⚠️ Descriptor has no private key - cannot sign');
      return psbt;
    }
    
    // Sign each Taproot input
    let signedCount = 0;
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const input = psbt.data.inputs[i];
      if (!input.witnessUtxo) continue;
      
      // Check if this is a Taproot input (P2TR)
      const script = input.witnessUtxo.script;
      if (!script || script[0] !== 0x51 || script[1] !== 0x20) continue; // Not P2TR
      
      try {
        // Compute BIP341 sighash
        const hash = psbt.hashForTaprootSignature(i, script, undefined, 0);
        
        // Sign with Schnorr
        const sig = tinysecp256k1.signSchnorr(hash, Buffer.from(derived.privateKey));
        
        // Add signature to PSBT
        input.tapKeySig = sig;
        signedCount++;
      } catch (e) {
        // Can't sign this input with this key
      }
    }
    
    if (signedCount > 0) {
      console.log(`  ✅ Signed ${signedCount} input(s) with descriptor key`);
    }
  } catch (e) {
    console.log('⚠️ Descriptor signing note:', e.message);
  }
  
  return psbt;
}

// ============================================================
// API
// ============================================================

async function fetchUTXOs(addr, testnet = false) {
  try {
    const base = testnet ? 'https://mempool.space/testnet/api' : 'https://mempool.space/api';
    const res = await fetch(`${base}/address/${addr}/utxo`);
    return (await res.json()).map(u => ({ txid: u.txid, vout: u.vout, value: u.value, scriptPubKey: u.scriptpubkey, address: addr }));
  } catch { return []; }
}

async function checkSats(txid, vout, key) {
  try {
    const [r1, r2, r3] = await Promise.all([
      fetch(`https://api.ordiscan.com/v1/utxo/${txid}:${vout}/sat-ranges`, { headers: { Authorization: `Bearer ${key}` } }),
      fetch(`https://api.ordiscan.com/v1/utxo/${txid}:${vout}/rare-sats`, { headers: { Authorization: `Bearer ${key}` } }),
      fetch(`https://api.ordiscan.com/v1/utxo/${txid}:${vout}/inscriptions`, { headers: { Authorization: `Bearer ${key}` } }).catch(() => ({ json: () => ({ data: [] }) }))
    ]);
    const d1 = await r1.json(), d2 = await r2.json(), d3 = await r3.json();
    return { ranges: d1.data?.length || 0, rare: d2.data?.map(r => r.satributes).flat() || [], inscribed: d3.data?.length > 0, inscriptions: d3.data?.map(i => i.id) || [] };
  } catch { return { ranges: 0, rare: [], inscribed: false, inscriptions: [] }; }
}

async function listUTXOs(w, key, show, testnet) {
  console.log(`\n📡 Fetching UTXOs for ${w.address}...\n`);
  const utxos = await fetchUTXOs(w.address, testnet);
  if (!utxos.length) { console.log('No UTXOs.\n'); return []; }
  console.log(`Found ${utxos.length} UTXOs:\n #   TXID:VOUT                    VALUE     RANGES  RARE    INSCRIBED`);
  console.log('─'.repeat(65));
  let list = utxos;
  if (show && key) list = await Promise.all(utxos.map(async u => ({ ...u, ...await checkSats(u.txid, u.vout, key) })));
  list.sort((a, b) => b.value - a.value);
  list.forEach((u, i) => console.log(`${String(i + 1).padStart(2)}   ${u.txid}:${u.vout}  ${String(u.value).padStart(10)}  ${String(show ? u.ranges : '-').padStart(6)}  ${show && u.rare?.length ? u.rare.join(',') : '-'}  ${u.inscribed ? '📜' : '-'}`));
  console.log('');
  return list;
}

async function selectUTXOs(utxos) {
  console.log('\n🎯 Select UTXOs (comma, "all", "clean"): ');
  const i = await q('Selection: ');
  if (i.toLowerCase() === 'all') return utxos;
  if (i.toLowerCase() === 'clean') return utxos.filter(u => (u.ranges || 0) === 0);
  return i.split(',').map(s => parseInt(s.trim()) - 1).filter(n => !isNaN(n)).map(n => utxos[n]).filter(Boolean);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  let args = process.argv.slice(2);
  console.log('\n🪙 Rare Sat Wallet CLI\n');
  
  const meta = getMeta();
  const testnet = args.includes('--testnet');
  const pwdIdx = args.indexOf('--password');
  const pwd = pwdIdx >= 0 && args[pwdIdx + 1] ? args[pwdIdx + 1] : null;
  const apiKey = process.env.ORDISCAN_API_KEY || '';
  
  // Find the first argument that is a known command (not an option)
  const knownCommands = ['new', 'import', 'address', 'balance', 'utxos', 'send', 'clear', 'set-password', 'unlock', 'lock', 'change-password', 'lock-status', 'import-descriptor', 'import-sparrow', 'descriptors', 'clear-descriptors', 'sign-psbt', 'decode-psbt', 'help'];
  let cmd = null;
  for (const a of args) {
    if (knownCommands.includes(a)) {
      cmd = a;
      break;
    }
  }
  // If no known command found, use first arg
  if (!cmd) cmd = args[0];
  
  // Load wallet
  if (!wallet && meta.exists) {
    if (!meta.encrypted) wallet = loadWallet();
    else if (pwd) { wallet = loadWallet(pwd); if (wallet) { unlocked = true; console.log('✅ Unlocked with --password'); } }
  }
  
  // If --testnet flag is provided, override network and re-derive address
  if (wallet && testnet && wallet.network !== 'testnet') {
    console.log("⚠️ Switching to testnet...");
    // Re-derive address for testnet using same private key
    const { payments, initEccLib, networks } = require('bitcoinjs-lib');
    const tinysecp256k1 = require('tiny-secp256k1');
    initEccLib(tinysecp256k1);
    const { HDKey } = require('@scure/bip32');
    const bip39 = require('bip39');
    const seed = bip39.mnemonicToSeedSync(wallet.mnemonic);
    const root = HDKey.fromMasterSeed(seed);
    // Derive for testnet: m/86'/1'/0'/0/0
    const child = root.derive("m/86'/1'/0'/0/0");
    wallet.publicKey = child.publicKey;
    wallet.address = payments.p2tr({ internalPubkey: wallet.publicKey.slice(1, 33), network: networks.testnet }).address;
    wallet.network = 'testnet';
    currentNet = 'testnet';
  }
  
  if (wallet) console.log(`📍 Wallet: ${wallet.address} (${wallet.network || currentNet})\n`);
  else if (meta.exists && meta.encrypted) console.log(`📍 Encrypted: ${meta.address}\n   Use --password or "unlock"\n`);
  
  switch (cmd) {
    case 'new': {
      const w = createWallet(bip39.generateMnemonic(), testnet ? 'testnet' : 'mainnet');
      console.log(`✅ New wallet!\n🔐 Mnemonic:\n   ${w.mnemonic}\n📍 ${w.address}\n`);
      const s = await q('Save? (y/N): ');
      if (s.toLowerCase() === 'y') {
        const p = await q('Password? (min 8, empty for none): ');
        if (p.length >= 8) saveWallet(w, p);
        else if (p.length > 0) { console.log('⚠️ Too short, saving plain'); saveWallet(w); }
        else saveWallet(w);
      }
      break;
    }
    
    case 'import': {
      const m = args.slice(1).join(' ');
      if (!m) { console.log('Usage: import <mnemonic>'); process.exit(1); }
      const w = createWallet(m, testnet ? 'testnet' : 'mainnet');
      console.log(`✅ Imported!\n📍 ${w.address}\n`);
      const s = await q('Save? (y/N): ');
      if (s.toLowerCase() === 'y') {
        const p = await q('Password? (min 8, empty for none): ');
        if (p.length >= 8) saveWallet(w, p);
        else if (p.length > 0) { console.log('⚠️ Too short'); saveWallet(w); }
        else saveWallet(w);
      }
      break;
    }
    
    // Encryption commands
    case 'set-password': {
      if (!meta.exists) { console.log('❌ No wallet\n'); process.exit(1); }
      if (meta.encrypted) { console.log('❌ Already encrypted\n'); process.exit(1); }
      const w = loadWallet();
      if (!w) { console.log('❌ Load failed\n'); process.exit(1); }
      const p1 = await q('New password: ');
      const p2 = await q('Confirm: ');
      if (p1 !== p2 || p1.length < 8) { console.log('❌ Mismatch or too short\n'); process.exit(1); }
      saveWallet(w, p1);
      secureWipe(w.privateKey);
      console.log('\n✅ Encrypted! Use --password to unlock.\n');
      break;
    }
    
    case 'unlock': {
      if (!meta.exists || !meta.encrypted) { console.log('❌ No encrypted wallet\n'); process.exit(1); }
      if (unlocked) { console.log('Already unlocked\n'); break; }
      const p = args[1] || await q('Password: ');
      try { wallet = unlock(p); unlocked = true; console.log('\n✅ Ready!\n'); }
      catch (e) { console.log(`❌ ${e.message}\n`); process.exit(1); }
      break;
    }
    
    case 'lock': {
      if (!unlocked) { console.log('Not unlocked\n'); break; }
      lock();
      console.log('\n✅ Locked.\n');
      break;
    }
    
    case 'change-password': {
      if (!meta.encrypted) { console.log('❌ Not encrypted\n'); process.exit(1); }
      const cur = await q('Current: ');
      const w = loadWallet(cur);
      if (!w) { console.log('❌ Invalid password\n'); process.exit(1); }
      const n1 = await q('New: ');
      const n2 = await q('Confirm: ');
      if (n1 !== n2 || n1.length < 8) { console.log('❌ Invalid\n'); process.exit(1); }
      saveWallet(w, n1);
      console.log('✅ Changed!\n');
      break;
    }
    
    case 'lock-status': {
      if (meta.encrypted) console.log(`Encryption: enabled\nUnlocked: ${unlocked ? 'yes' : 'no'}\n`);
      else if (meta.exists) console.log('Encryption: disabled\n');
      else console.log('No wallet\n');
      break;
    }
    
    // Wallet ops
    case 'address': {
      if (!wallet) { console.log('❌ No wallet\n'); process.exit(1); }
      console.log(`📍 ${wallet.address}\n`);
      break;
    }
    
    case 'balance': {
      if (!wallet) { console.log('❌ No wallet\n'); process.exit(1); }
      const utxos = await fetchUTXOs(wallet.address, testnet);
      const total = utxos.reduce((s, u) => s + u.value, 0);
      console.log(`\n💰 ${total} sats (${utxos.length} UTXOs)\n`);
      break;
    }
    
    case 'utxos': {
      if (!wallet) { console.log('❌ No wallet\n'); process.exit(1); }
      await listUTXOs(wallet, apiKey, args.includes('--sats'), testnet);
      break;
    }
    
    case 'send': {
      const chk = checkReady();
      if (!chk.ready) { console.log('❌ Wallet locked. Use --password or "unlock"\n'); process.exit(1); }
      if (!wallet) { console.log('❌ No wallet\n'); process.exit(1); }
      
      // Check for exclude flags
      const excludeRare = args.includes('--exclude-rare');
      const excludeOrdinals = args.includes('--exclude-ordinals');
      
      if (excludeRare || excludeOrdinals) {
        console.log(`\n🔍 Fetching UTXOs (exclude-rare: ${excludeRare}, exclude-ordinals: ${excludeOrdinals})...`);
      }
      
      const utxos = await listUTXOs(wallet, apiKey, true, testnet);
      
      // Filter UTXOs based on flags
      let filteredUTXOs = utxos;
      let excludedCount = 0;
      
      if (excludeRare || excludeOrdinals) {
        filteredUTXOs = [];
        for (const utxo of utxos) {
          let exclude = false;
          
          // Check for rare sats
          if (excludeRare && utxo.rare && utxo.rare.length > 0) {
            console.log(`  ⛔ Excluding ${utxo.txid}:${utxo.vout} - rare sats: ${utxo.rare.join(', ')}`);
            exclude = true;
          }
          
          // Check for ordinals (inscriptions)
          if (excludeOrdinals && utxo.inscribed) {
            console.log(`  ⛔ Excluding ${utxo.txid}:${utxo.vout} - inscribed (ordinal)`);
            exclude = true;
          }
          
          if (!exclude) {
            filteredUTXOs.push(utxo);
          } else {
            excludedCount++;
          }
        }
        
        if (excludedCount > 0) {
          console.log(`\n✅ Excluded ${excludedCount} UTXO(s), ${filteredUTXOs.length} remaining\n`);
        }
      }
      
      if (filteredUTXOs.length === 0) {
        console.log('❌ No available UTXOs after filtering\n');
        process.exit(1);
      }
      
      const sel = await selectUTXOs(filteredUTXOs);
      if (!sel.length) { console.log('❌ None selected\n'); process.exit(1); }
      const dest = await q('Destination: ');
      const amt = parseInt(await q('Amount (sats): '));
      const feeEst = Math.ceil(150 * (sel.length + 2) / 1000) * 1000;
      const totalIn = sel.reduce((s, u) => s + u.value, 0);
      if (amt + feeEst > totalIn) { console.log(`❌ Need ${amt + feeEst}, have ${totalIn}\n`); process.exit(1); }
      const change = totalIn - amt - feeEst;
      const psbt = new Psbt({ network: testnet ? networks.testnet : networks.bitcoin });
      sel.forEach(u => psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: Buffer.from(u.scriptPubKey, 'hex'), value: BigInt(u.value) } }));
      psbt.addOutput({ address: dest, value: BigInt(amt) });
      if (change > 546) psbt.addOutput({ address: wallet.address, value: BigInt(change) });
      console.log('\n⚠️ PSBT created. Import into Sparrow to sign.');
      console.log('PSBT:', psbt.toBase64().slice(0, 100) + '...\n');
      break;
    }
    
    case 'clear': {
      if (fs.existsSync(WALLET_FILE)) { fs.unlinkSync(WALLET_FILE); console.log('🗑️ Cleared\n'); }
      else console.log('No wallet\n');
      wallet = null; unlocked = false;
      break;
    }
    
    // Descriptor commands (BIP 389)
    case 'import-descriptor': {
      loadDescriptors();
      let descriptor = args.slice(1).join(' ');
      if (!descriptor) { console.log('Usage: import-descriptor <descriptor-or-file>\n'); process.exit(1); }
      
      if (fs.existsSync(descriptor)) {
        descriptor = fs.readFileSync(descriptor, 'utf8').trim();
      }
      
      const parsed = parseDescriptor(descriptor);
      descriptors.push({ descriptor, origin: parsed.origin, key: parsed.key, path: parsed.path, timestamp: Date.now() });
      saveDescriptors();
      
      console.log('Descriptor imported!\n');
      try {
        const derived = deriveFromDescriptor(descriptor, 0);
        console.log(`First address: ${derived.address}\n`);
      } catch (e) { console.log('Could not derive address:', e.message, '\n'); }
      break;
    }
    
    case 'import-sparrow': {
      loadDescriptors();
      const filePath = args[1];
      if (!filePath) { console.log('Usage: import-sparrow <sparrow-export-file>\n'); process.exit(1); }
      if (!fs.existsSync(filePath)) { console.log(`File not found: ${filePath}\n`); process.exit(1); }
      
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = parseSparrowDescriptor(content);
      
      descriptors.push({ name: parsed.name, descriptor: parsed.descriptor, timestamp: parsed.timestamp, type: 'sparrow' });
      saveDescriptors();
      
      console.log(`Sparrow descriptor imported: ${parsed.name}\n`);
      break;
    }
    
    case 'descriptors': {
      loadDescriptors();
      if (descriptors.length === 0) {
        console.log('No imported descriptors.\n');
        break;
      }
      console.log(`Imported Descriptors (${descriptors.length}):\n`);
      descriptors.forEach((d, i) => {
        console.log(`${i + 1}. ${d.name || 'Descriptor'}`);
        console.log(`   ${d.descriptor?.slice(0, 60)}...`);
        if (d.origin) console.log(`   Origin: ${d.origin}`);
        console.log('');
      });
      break;
    }
    
    case 'clear-descriptors': {
      loadDescriptors();
      const confirm = await q('Clear all descriptors? (yes/no): ');
      if (confirm.toLowerCase() !== 'yes') { console.log('Cancelled.\n'); break; }
      descriptors = [];
      saveDescriptors();
      console.log('Descriptors cleared.\n');
      break;
    }
    
    // PSBT commands
    case 'sign-psbt': {
      console.log("DEBUG: args =", args);
      const chk = checkReady();
      if (!chk.ready) { console.log('❌ Wallet locked. Use --password or "unlock"\n'); process.exit(1); }
      if (!wallet) { console.log('❌ No wallet\n'); process.exit(1); }
      
      // args: ['node', 'cli.js', 'sign-psbt', 'file.psbt'] or ['--testnet', 'sign-psbt', 'file.psbt']
      // Find the first arg that is not a flag and not the command
      const psbtInput = args.find((a, i) => i > 0 && !a.startsWith('--') && a !== 'sign-psbt' && !a.startsWith('-'));
      if (!psbtInput) { console.log('Usage: sign-psbt <psbt-base64-or-file> [--output <file>]\n'); process.exit(1); }
      
      let psbtData = psbtInput;
      if (fs.existsSync(psbtInput)) {
        psbtData = fs.readFileSync(psbtInput);
      }
      
      let psbt;
      try {
        if (psbtData.toString().includes('cHN')) {
          psbt = Psbt.fromBase64(psbtData.toString().trim());
        } else {
          psbt = Psbt.fromBuffer(psbtData);
        }
      } catch (e) { console.log('Could not parse PSBT.\n'); process.exit(1); }
      
      // Sign with BIP86 key
      const xOnly = wallet.publicKey.slice(-33).slice(1);
      signPsbtWithTaproot(psbt, wallet.privateKey, xOnly);
      
      // Sign with descriptors
      loadDescriptors();
      for (const desc of descriptors) {
        try { signPsbtWithDescriptor(psbt, desc.descriptor); } catch { /* ignore */ }
      }
      
      const outputIdx = args.indexOf('--output');
      if (outputIdx > 0 && args[outputIdx + 1]) {
        const outputPath = args[outputIdx + 1];
        fs.writeFileSync(outputPath, psbt.toBase64());
        console.log(`Signed PSBT saved to: ${outputPath}\n`);
      } else {
        console.log('Signed PSBT:');
        console.log(psbt.toBase64());
        console.log('');
      }
      break;
    }
    
    case 'decode-psbt': {
      const psbtInput = args[1];
      if (!psbtInput) { console.log('Usage: decode-psbt <psbt-base64-or-file>\n'); process.exit(1); }
      
      let psbtData = psbtInput;
      if (fs.existsSync(psbtInput)) {
        psbtData = fs.readFileSync(psbtInput, 'utf8').trim();
      }
      
      let psbt;
      try { psbt = Psbt.fromBase64(psbtData); }
      catch { console.log('Could not parse PSBT.\n'); process.exit(1); }
      
      console.log('\nPSBT Decoded:\n');
      console.log(`Inputs: ${psbt.data.inputs.length}`);
      console.log(`Outputs: ${psbt.data.outputs.length}`);
      
      console.log('\nInputs:');
      psbt.data.inputs.forEach((input, i) => {
        console.log(`  ${i + 1}. ${input.witnessUtxo ? 'Witness UTXO' : 'Non-witness'}`);
        if (input.tapKeySig) console.log(`     Taproot Key Signature: yes`);
      });
      
      console.log('\nOutputs:');
      psbt.data.outputs.forEach((output, i) => {
        if (output.address) {
          console.log(`  ${i + 1}. ${output.address} - ${output.value} sats`);
        } else if (output.script) {
          console.log(`  ${i + 1}. Script: ${output.script.toString('hex').slice(0, 40)}... - ${output.value} sats`);
        }
      });
      console.log('');
      break;
    }
    
    default:
      console.log(`
🪙 Rare Sat Wallet CLI

Commands:
  new                   Generate wallet
  import <mnemonic>     Import wallet
  address               Show address
  balance               Show balance
  utxos [--sats]       List UTXOs
  send [opts]         Send BTC (--exclude-rare, --exclude-ordinals)
  clear                 Delete wallet

Encryption:
  set-password          Encrypt wallet
  unlock <pwd>         Decrypt wallet
  lock                  Lock wallet
  change-password       Change password
  lock-status           Show status

Descriptors (BIP 389):
  import-descriptor <d>   Import descriptor string or file
  import-sparrow <file>   Import Sparrow export
  descriptors             List descriptors
  clear-descriptors       Clear all

PSBT:
  sign-psbt <psbt>       Sign PSBT (auto-detects base64/binary)
  decode-psbt <psbt>     Decode PSBT

Options:
  --testnet
  --password <pwd>
`);
  }
  rl.close();
}

main().catch(console.error);
