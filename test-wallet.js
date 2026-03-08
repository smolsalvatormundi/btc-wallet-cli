const { generateMnemonic } = require("bip39");
const { HDKey } = require("@scure/bip32");
const { payments, initEccLib, networks } = require("bitcoinjs-lib");
const tinysecp256k1 = require("tiny-secp256k1");
const fs = require("fs");
const path = require("path");

initEccLib(tinysecp256k1);
const network = networks.testnet;

// Generate wallet
const mnemonic = generateMnemonic();
console.log("Mnemonic:", mnemonic);

const bip39 = require("bip39");
const seed = bip39.mnemonicToSeedSync(mnemonic);
const root = HDKey.fromMasterSeed(seed);
const child = root.derive("m/86'/1'/0'/0/0");
const pubkey = child.publicKey;
const p2tr = payments.p2tr({ internalPubkey: pubkey.slice(1, 33), network });
console.log("Address:", p2tr.address);

// Generate a descriptor for this wallet using @scure/bip32's derive and public key methods
const rootPub = HDKey.fromExtendedKey(root.toExtendedPublicKey());
const derivedPub = rootPub.derive("m/86'/1'/0'");
const xpub = derivedPub.toExtendedPublicKey();
const descriptor = `tr([fp/86'/1'/0']${xpub}/0/0/*)`;
console.log("Descriptor:", descriptor);

// Save wallet
const walletData = {
  mnemonic,
  address: p2tr.address,
  network: "testnet"
};
const walletDir = path.join(process.env.HOME, ".config", "btc-wallet");
if (!fs.existsSync(walletDir)) fs.mkdirSync(walletDir, { recursive: true });
fs.writeFileSync(path.join(walletDir, "wallet.json"), JSON.stringify(walletData, null, 2));

// Save descriptor
fs.writeFileSync(path.join(walletDir, "test-descriptor.txt"), descriptor);
console.log("Wallet and descriptor saved");
