#!/usr/bin/env node

import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { payments, initEccLib, Psbt, networks } from 'bitcoinjs-lib';
import * as tinysecp256k1 from 'tiny-secp256k1';
import * as readline from 'readline';

// Initialize ECC
initEccLib(tinysecp256k1);
const network = networks.bitcoin;

interface UTXO {
  txid: string;
  vout: number;
  value: number;
  scriptPubKey: string;
  address: string;
  satRanges?: number;
  rareSats?: string[];
}

interface Wallet {
  mnemonic: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  address: string;
}

// Helper for input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

// Generate new wallet
function generateWallet(): Wallet {
  const mnemonic = generateMnemonic(wordlist);
  return createWalletFromMnemonic(mnemonic);
}

// Create wallet from mnemonic
function createWalletFromMnemonic(mnemonic: string): Wallet {
  const seed = mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  
  // Derive taproot path: m/86'/0'/0'/0/0
  const child = root.derive("m/86'/0'/0'/0/0");
  
  if (!child.privateKey || !child.publicKey) {
    throw new Error('Failed to derive key');
  }
  
  // Create taproot address
  const { address } = payments.p2tr({
    pubkey: child.publicKey,
    network
  });
  
  return {
    mnemonic,
    privateKey: child.privateKey,
    publicKey: child.publicKey,
    address: address!
  };
}

// Fetch UTXOs from mempool
async function fetchUTXOs(address: string): Promise<UTXO[]> {
  try {
    const response = await fetch(`https://blockstream.info/api/address/${address}/utxo`);
    const data = await response.json();
    
    return data.map((utxo: any) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      value: utxo.value,
      scriptPubKey: utxo.scriptpubkey,
      address: address
    }));
  } catch (error) {
    console.error('Error fetching UTXOs:', error);
    return [];
  }
}

// Check sat ranges for a UTXO
async function checkSatRanges(txid: string, vout: number, apiKey: string): Promise<{ranges: number, rare: string[]}> {
  try {
    const response = await fetch(
      `https://api.ordiscan.com/v1/utxo/${txid}:${vout}/sat-ranges`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    const data = await response.json();
    const rangeCount = data.data?.length || 0;
    
    // Check for rare sats
    const rareResponse = await fetch(
      `https://api.ordiscan.com/v1/utxo/${txid}:${vout}/rare-sats`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    const rareData = await rareResponse.json();
    const rare = rareData.data?.map((r: any) => r.satributes).flat() || [];
    
    return { ranges: rangeCount, rare };
  } catch {
    return { ranges: 0, rare: [] };
  }
}

// Display UTXOs with details
async function listUTXOs(wallet: Wallet, apiKey: string, showSatDetails: boolean = false) {
  console.log(`\n� fetch UTXOs for ${wallet.address}...\n`);
  
  const utxos = await fetchUTXOs(wallet.address);
  
  if (utxos.length === 0) {
    console.log('No UTXOs found.\n');
    return [];
  }
  
  console.log(`Found ${utxos.length} UTXOs:\n`);
  console.log(' #   TXID:VOUT          VALUE     RANGES  RARE');
  console.log('─'.repeat(60));
  
  // Get sat details if requested
  let utxosWithDetails = utxos;
  if (showSatDetails && apiKey) {
    utxosWithDetails = await Promise.all(
      utxos.map(async (utxo) => {
        const { ranges, rare } = await checkSatRanges(utxo.txid, utxo.vout, apiKey);
        return { ...utxo, satRanges: ranges, rareSats: rare };
      })
    );
  }
  
  // Sort by value descending
  utxosWithDetails.sort((a, b) => b.value - a.value);
  
  utxosWithDetails.forEach((utxo, i) => {
    const txid = utxo.txid.slice(0, 12) + '...';
    const ranges = showSatDetails ? (utxo.satRanges ?? '?') : '-';
    const rare = showSatDetails && utxo.rareSats?.length ? utxo.rareSats.join(',') : '-';
    console.log(
      `${String(i + 1).padStart(2)}   ${utxo.txid}:${utxo.vout}  ${String(utxo.value).padStart(8)}  ${String(ranges).padStart(6)}  ${rare}`
    );
  });
  
  console.log('');
  return utxosWithDetails;
}

// Interactive coin selection
async function selectUTXOs(utxos: UTXO[]): Promise<UTXO[]> {
  console.log('\n🎯 Interactive UTXO Selection');
  console.log('Enter UTXO numbers separated by commas (e.g., 1,3,5)');
  console.log('Or "all" to select all UTXOs');
  console.log('Or "clean" to select only UTXOs with no inscriptions\n');
  
  const input = await question('Selection: ');
  
  if (input.toLowerCase() === 'all') {
    return utxos;
  }
  
  if (input.toLowerCase() === 'clean') {
    return utxos.filter(u => (u.satRanges ?? 0) === 0);
  }
  
  const indices = input.split(',').map(s => parseInt(s.trim()) - 1).filter(i => !isNaN(i));
  return indices.map(i => utxos[i]).filter(Boolean);
}

// Create transaction with output sorting
async function createTransaction(
  wallet: Wallet,
  inputs: UTXO[],
  outputs: { address: string; value: number }[],
  feeRate: number = 2
): Promise<string> {
  const psbt = new Psbt({ network });
  
  // Add inputs
  for (const utxo of inputs) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence: 0xfffffffd,
      witnessUtxo: {
        script: Buffer.from(utxo.scriptPubKey, 'hex'),
        value: BigInt(utxo.value)
      }
    });
  }
  
  // Add outputs
  for (const output of outputs) {
    psbt.addOutput({
      address: output.address,
      value: BigInt(output.value)
    });
  }
  
  // Sign
  psbt.signInput(0, {
    publicKey: wallet.publicKey,
    sign: (hash) => {
      // Use tinysecp256k1 for signing
      const { sign } = require('tiny-secp256k1');
      return sign(hash, wallet.privateKey);
    }
  });
  
  psbt.finalizeAllInputs();
  
  return psbt.toBase64();
}

// Main CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  console.log('\n🪙 Rare Sat Wallet CLI\n');
  
  let wallet: Wallet | null = null;
  let apiKey = process.env.ORDISCAN_API_KEY || '';
  
  switch (command) {
    case 'new': {
      wallet = generateWallet();
      console.log('✅ New wallet generated!\n');
      console.log('🔐 Mnemonic (SAVE THIS!):');
      console.log(`   ${wallet.mnemonic}\n`);
      console.log(`📍 Address: ${wallet.address}\n`);
      break;
    }
    
    case 'import': {
      const mnemonic = args.slice(1).join(' ');
      if (!mnemonic) {
        console.log('Usage: import <12-or-24-word-mnemonic>');
        process.exit(1);
      }
      wallet = createWalletFromMnemonic(mnemonic);
      console.log(`✅ Wallet imported!\n`);
      console.log(`📍 Address: ${wallet.address}\n`);
      break;
    }
    
    case 'utxos': {
      if (!wallet) {
        console.log('❌ No wallet loaded. Use "new" or "import" first.\n');
        process.exit(1);
      }
      const showDetails = args.includes('--sats');
      await listUTXOs(wallet, apiKey, showDetails);
      break;
    }
    
    case 'send': {
      if (!wallet) {
        console.log('❌ No wallet loaded. Use "new" or "import" first.\n');
        process.exit(1);
      }
      const utxos = await listUTXOs(wallet, apiKey, true);
      const selected = await selectUTXOs(utxos);
      
      if (selected.length === 0) {
        console.log('❌ No UTXOs selected.\n');
        process.exit(1);
      }
      
      console.log('\nSelected UTXOs:');
      selected.forEach((u, i) => console.log(`  ${i + 1}. ${u.value} sats`));
      
      const dest = await question('\nDestination address: ');
      const amount = await question('Amount (sats): ');
      
      const totalIn = selected.reduce((sum, u) => sum + u.value, 0);
      const totalOut = parseInt(amount);
      const fee = Math.ceil(150 * (selected.length + 2) / 1000) * 1000; // Rough estimate
      
      if (totalOut + fee > totalIn) {
        console.log(`❌ Not enough funds. Need ${totalOut + fee}, have ${totalIn}\n`);
        process.exit(1);
      }
      
      const change = totalIn - totalOut - fee;
      
      const psbt = new Psbt({ network });
      
      for (const utxo of selected) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: Buffer.from(utxo.scriptPubKey, 'hex'),
            value: BigInt(utxo.value)
          }
        });
      }
      
      psbt.addOutput({ address: dest, value: BigInt(totalOut) });
      if (change > 546) {
        psbt.addOutput({ address: wallet.address, value: BigInt(change) });
      }
      
      // Note: signing requires proper key handling
      console.log('\n⚠️  PSBT created. Import into Sparrow to sign.');
      console.log('PSBT:', psbt.toBase64().slice(0, 100) + '...\n');
      break;
    }
    
    default:
      console.log(`
Usage:
  new                   Generate new wallet
  import <mnemonic>     Import existing wallet
  utxos [--sats]       List UTXOs (--sats shows sat ranges)
  send                 Create transaction with coin control
  
Environment:
  ORDISCAN_API_KEY     Your Ordiscan API key
  
Examples:
  btc-wallet new
  btc-wallet import paper evil still fluid bird drill truth three spoil loyal birth arrow
  btc-wallet utxos --sats
  btc-wallet send
`);
  }
  
  rl.close();
}

main().catch(console.error);
