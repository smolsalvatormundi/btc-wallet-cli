/**
 * Taproot (BIP386) Signer for Bitcoin
 * Implements BIP341 Schnorr signatures for Taproot key path spending
 */

import * as bitcoin from 'bitcoinjs-lib';
import { initEccLib, Psbt, Transaction } from 'bitcoinjs-lib';
import * as tinysecp from 'tiny-secp256k1';
import { HDKey } from '@scure/bip32';
import { schnorr } from '@noble/secp256k1';
import * as crypto from 'crypto';

// Initialize ECC
initEccLib(tinysecp);

const NETWORK = bitcoin.networks.testnet;
const SATOSHI_PER_VBYTE = 1;

// BIP341 constants
const BIP341 Constants = {
  /** The number of bytes to hash for the sighash */
  TAPROOT_SIGHASH_SIZE: 32,
  /** Tag for BIP341 sighash */
  TAPROOT_TAG: 'TapTweak',
};

/**
 * Calculate BIP341 sighash for Taproot key path spending
 */
export function taprootSighash(
  tx: Transaction,
  scriptCode: Buffer,
  value: bigint,
  inputIndex: number,
  hashType: number = Transaction.SIGHASH_ALL
): Buffer {
  // Per BIP341, the sighash for key path is:
  // hash = SHA256(SHA256(tag) || SHA256(tag) || ...)
  
  const tagHash = hash256(Buffer.from('TapTweak'));
  
  const extFlag = (hashType & 0x80) !== 0 ? 1 : 0;
  const annexFlag = (hashType & 0x80) !== 0 ? 1 : 0;
  
  // For key path (spend type = 0), we use an empty script
  const scriptSpend = 0;
  const keySpend = 1;
  const spendType = (extFlag << 1) + keySpend;
  
  // Build the message
  const txVersion = Buffer.alloc(4);
  txVersion.writeUInt32LE(tx.version, 0);
  
  const txLockTime = Buffer.alloc(4);
  txLockTime.writeUInt32LE(tx.locktime, 0);
  
  const inputCount = Buffer.from([tx.txins.length]);
  const outputCount = Buffer.from([tx.txouts.length]);
  
  // For each input we need hashPrevouts, hashAmounts, hashScriptPubKeys, hashSequences, hashOutputs
  
  // Simplified: use the full serialization with all inputs
  const prevoutsHash = hash256(getPrevoutsSerialization(tx));
  const amountsHash = hash256(getAmountsSerialization(tx));
  const scriptPubKeysHash = hash256(getScriptPubKeysSerialization(tx));
  const sequencesHash = hash256(getSequencesSerialization(tx));
  const outputsHash = hash256(getOutputsSerialization(tx));
  
  // Input being signed
  const txIn = tx.txins[inputIndex];
  const prevoutHash = hash256(Buffer.concat([
    Buffer.from(txIn.hash),
    Buffer.alloc(4).writeUInt32LE(txIn.index)
  ]));
  
  const sequenceHash = hash256(Buffer.concat([
    Buffer.alloc(4).writeUInt32LE(txIn.sequence)
  ]));
  
  const sighashType = Buffer.alloc(4);
  sighashType.writeUInt32LE(hashType, 0);
  
  return hash256(Buffer.concat([
    txVersion,
    prevoutsHash,
    amountsHash,
    scriptPubKeysHash,
    sequencesHash,
    prevoutHash,
    sequenceHash,
    scriptCode,
    Buffer.alloc(8).writeBigUInt64LE(value),
    annexFlag ? Buffer.from([0x50]) : Buffer.alloc(0),
    sighashType,
    txLockTime
  ]));
}

function hash256(data: Buffer): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

function getPrevoutsSerialization(tx: Transaction): Buffer {
  return Buffer.concat(tx.txins.map(txIn => 
    Buffer.concat([Buffer.from(txIn.hash), Buffer.alloc(4).writeUInt32LE(txIn.index)])
  ));
}

function getAmountsSerialization(tx: Transaction): Buffer {
  return Buffer.concat(tx.txouts.map(txOut => 
    Buffer.alloc(8).writeBigUInt64LE(txOut.value)
  ));
}

function getScriptPubKeysSerialization(tx: Transaction): Buffer {
  return Buffer.concat(tx.txouts.map(txOut => 
    Buffer.concat([
      Buffer.from([txOut.script.length]),
      txOut.script
    ])
  ));
}

function getSequencesSerialization(tx: Transaction): Buffer {
  return Buffer.concat(tx.txins.map(txIn => 
    Buffer.alloc(4).writeUInt32LE(txIn.sequence)
  ));
}

function getOutputsSerialization(tx: Transaction): Buffer {
  return Buffer.concat(tx.txouts.map(txOut => 
    Buffer.concat([
      Buffer.alloc(8).writeBigUInt64LE(txOut.value),
      Buffer.from([txOut.script.length]),
      txOut.script
    ])
  ));
}

/**
 * Create a Taproot tweaked key pair from a seed
 */
export function createTaprootKeyPair(mnemonic: string, coinType: string = "1"): {
  privateKey: Buffer;
  publicKey: Buffer;
  internalPublicKey: Buffer;
  tweakedPublicKey: Buffer;
  address: string;
} {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const key = root.derive(`m/86'/${coinType}'/0'/0/0`);
  
  const privateKey = Buffer.from(key.privateKey);
  const internalPublicKey = tinysecp.pointFromScalar(privateKey);
  
  // BIP341 tweak: t = H_TapTweak(internalPubkey)
  const t = hash256(internalPublicKey);
  const tNum = BigInt('0x' + t.toString('hex'));
  
  // T = internalPubkey + t*G
  const tweakedPublicKey = tinysecp.pointAddScalar(internalPublicKey, t);
  if (!tweakedPublicKey) throw new Error('Failed to compute tweaked key');
  
  // Create address
  const { address } = bitcoin.payments.p2tr({
    internalPubkey: tinysecp.xOnlyPointFromScalar(privateKey),
    network: NETWORK
  });
  
  return {
    privateKey,
    publicKey: tweakedPublicKey,
    internalPublicKey,
    tweakedPublicKey,
    address: address!
  };
}

/**
 * Sign a Taproot PSBT with BIP341 Schnorr
 */
export async function signTaprootPsbt(
  psbt: Psbt,
  privateKey: Buffer,
  internalPublicKey: Buffer
): Promise<Psbt> {
  // Calculate tweaked private key: t = H_TapTweak(internalPubkey)
  const t = hash256(internalPublicKey);
  const tNum = BigInt('0x' + t.toString('hex'));
  const privKeyNum = BigInt('0x' + privateKey.toString('hex'));
  const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  const tweakedPrivKeyNum = (privKeyNum + tNum) % n;
  const tweakedPrivateKey = Buffer.from(tweakedPrivKeyNum.toString(16).padStart(64, '0'), 'hex');
  
  // For each input, compute sighash and sign
  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const input = psbt.data.inputs[i];
    if (!input.witnessUtxo) continue;
    
    const value = input.witnessUtxo.value;
    const scriptCode = input.witnessUtxo.script;
    
    // Build transaction for sighash
    const tx = psbt.extractTransaction();
    
    // Simplified sighash (BIP341 key path)
    const sighash = computeBip341Sighash(tx, scriptCode, value, i);
    
    // Sign with Schnorr
    const sig = schnorr.sign(sighash, tweakedPrivateKey);
    
    // Set the tap key signature
    input.tapKeySig = sig;
  }
  
  // Finalize inputs
  psbt.finalizeAllInputs();
  
  return psbt;
}

function computeBip341Sighash(
  tx: Transaction,
  scriptCode: Buffer,
  value: bigint,
  inputIndex: number
): Buffer {
  // Simplified BIP341 sighash
  // This is a basic implementation - for production, use a proper library
  
  const txVersion = Buffer.alloc(4);
  txVersion.writeUInt32LE(tx.version, 0);
  
  const txLockTime = Buffer.alloc(4);
  txLockTime.writeUInt32LE(tx.locktime, 0);
  
  // For key path spending, we need to serialize the transaction in BIP341 format
  const serialization = Buffer.concat([
    Buffer.from([0x00]), // epoch
    txVersion,
    txLockTime,
    // More fields per BIP341...
  ]);
  
  return hash256(serialization);
}

/**
 * Broadcast a transaction
 */
export async function broadcast(txHex: string, isTestnet: boolean = true): Promise<string> {
  const url = isTestnet 
    ? 'https://mempool.space/testnet/api/tx'
    : 'https://mempool.space/api/tx';
  
  const response = await fetch(url, {
    method: 'POST',
    body: txHex
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Broadcast failed: ${error}`);
  }
  
  return response.text();
}

/**
 * Create and sign a Taproot transaction
 */
export async function createAndSignTransaction(
  mnemonic: string,
  utxo: { txid: string; vout: number; value: number; scriptPubKey: string },
  outputs: { address: string; value: number }[],
  feeRate: number = SATOSHI_PER_VBYTE
): Promise<string> {
  const { privateKey, internalPublicKey, address } = createTaprootKeyPair(mnemonic);
  
  // Calculate fees
  const inputWeight = 57.5 * 4; // ~57.5 vBytes per taproot input
  const outputWeight = 43 * 4;  // ~43 vBytes per output
  const totalWeight = inputWeight + (outputs.length * outputWeight);
  const fee = Math.ceil(totalWeight / 4 * feeRate);
  
  const totalIn = utxo.value;
  const totalOut = outputs.reduce((sum, o) => sum + o.value, 0);
  const change = totalIn - totalOut - fee;
  
  if (change < 0) {
    throw new Error(`Insufficient funds: need ${totalOut + fee}, have ${totalIn}`);
  }
  
  // Add change output if needed
  if (change > 546) {
    outputs.push({ address, value: change });
  }
  
  // Create PSBT
  const psbt = new Psbt({ network: NETWORK });
  
  psbt.addInput({
    hash: utxo.txid,
    index: utxo.vout,
    witnessUtxo: {
      script: Buffer.from(utxo.scriptPubKey, 'hex'),
      value: BigInt(utxo.value)
    },
    tapInternalKey: tinysecp.xOnlyPointFromScalar(privateKey)
  });
  
  for (const output of outputs) {
    psbt.addOutput({
      address: output.address,
      value: BigInt(output.value)
    });
  }
  
  // Sign
  await signTaprootPsbt(psbt, privateKey, internalPublicKey);
  
  // Extract and broadcast
  const tx = psbt.extractTransaction();
  return tx.toHex();
}
