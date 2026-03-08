// Test script to verify descriptor derivation
const { HDKey } = require("@scure/bip32");
const { payments, initEccLib, networks } = require("bitcoinjs-lib");
const tinysecp256k1 = require("tiny-secp256k1");
initEccLib(tinysecp256k1);

const network = networks.testnet;

// Test descriptor with origin
const testDesc = "tr([fp/86'/1'/0']tpubDDKy6XPqRhQ7r6q1oJFqLp7xG9Fqf8q2gZiZ5W4PQ1ZVjJ8X5L4Y8K2P4M6N9Q1R2S3T4U5V6W7X8Y9Z0A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R/0/0/*)";

function parseDescriptor(desc) {
  let origin = null;
  let key = null;
  let path = '';
  
  // Extract origin [fp/86'/0'/0']
  const originMatch = desc.match(/\[([^\]]+)\]/);
  if (originMatch) {
    origin = originMatch[1];
    desc = desc.replace(originMatch[0], '');
  }
  
  // Extract key and path from tr(...)
  const keyMatch = desc.match(/tr\(([^)]+)\)/);
  if (keyMatch) {
    const keyFull = keyMatch[1];
    const parts = keyFull.split('/');
    
    // If ends with /*, extract path
    if (parts[parts.length - 1] === '*') {
      path = parts.slice(-3, -1).join('/'); // ["0", "0"] -> "0/0"
      key = parts.slice(0, -3).join('/');
    } else {
      key = keyFull;
    }
  }
  
  return { origin, key, path };
}

const parsed = parseDescriptor(testDesc);
console.log("Parsed:", parsed);

// Derive
let hdKey = HDKey.fromExtendedKey(parsed.key);
console.log("Loaded xpub");

if (parsed.origin) {
  const originPathMatch = parsed.origin.match(/\/(\d+'\/\d+'\/\d+')/);
  if (originPathMatch) {
    const originPath = "m/" + originPathMatch[1];
    console.log("Origin path:", originPath);
    hdKey = hdKey.derive(originPath);
  }
}

const fullPath = parsed.path.replace(/\*/g, "0");
console.log("Full path:", fullPath);
const child = hdKey.derive(fullPath);

if (child.publicKey) {
  const xOnly = child.publicKey.slice(-33).slice(1);
  const p2tr = payments.p2tr({ internalPubkey: xOnly, network });
  console.log("Address:", p2tr.address);
  console.log("Private key:", child.privateKey ? "YES" : "NO");
}
