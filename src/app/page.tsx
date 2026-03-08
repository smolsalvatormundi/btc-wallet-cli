'use client';

import { useState, useEffect } from 'react';
import { LaserEyesProvider, useLaserEyes } from '@omnisat/lasereyes-react';
import { MAINNET, XVERSE, UNISAT } from '@omnisat/lasereyes-core';

type RareSat = {
  satNumber: number;
  type: string;
  name: string;
  txid: string;
  vout: number;
  value: number;
};

type UtxoInput = {
  txid: string;
  vout: number;
  satRange: string;
  value: number;
};

function WalletApp() {
  const { address, connected, connect, disconnect, isInitializing, hasXverse, hasUnisat } = useLaserEyes();
  
  const [manualAddr, setManualAddr] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rareSats, setRareSats] = useState<RareSat[]>([]);
  const [utxoInputs, setUtxoInputs] = useState<UtxoInput[]>([]);
  const [newUtxo, setNewUtxo] = useState<{txid: string; vout: string; satRange: string; value: string}>({txid: '', vout: '', satRange: '', value: ''});
  const [selectedSats, setSelectedSats] = useState<Set<number>>(new Set());
  const [psbt, setPsbt] = useState<string | null>(null);
  const [debug, setDebug] = useState<string>('Loading...');
  const [walletLoading, setWalletLoading] = useState(false);

  useEffect(() => {
    setDebug(`Init: ${isInitializing ? 'Y' : 'N'} | Xverse: ${hasXverse ? 'Y' : 'N'} | UniSat: ${hasUnisat ? 'Y' : 'N'}`);
  }, [isInitializing, hasXverse, hasUnisat]);

  useEffect(() => {
    if (connected && address) {
      setDebug('Connected! Scanning...');
      scanAddress(address);
    }
  }, [connected, address]);

  const scanAddress = async (addr: string) => {
    setScanning(true);
    setError(null);
    setDebug('Scanning...');
    
    try {
      const response = await fetch(`/api/satranges?address=${encodeURIComponent(addr)}`);
      const data = await response.json();
      
      if (data.satRanges && data.satRanges.length > 0) {
        const found: RareSat[] = [];
        for (const satRange of data.satRanges) {
          const satStart = satRange.range?.start || satRange.start;
          const satEnd = satRange.range?.end || satRange.end;
          
          if (satStart !== undefined && satEnd !== undefined) {
            for (let sat = satStart; sat <= satEnd && found.length < 50; sat++) {
              const rare = identifyRareSat(sat);
              if (rare) {
                found.push({
                  satNumber: sat,
                  type: rare.type,
                  name: rare.name,
                  txid: satRange.txid || '',
                  vout: satRange.vout || 0,
                  value: satRange.value || 1,
                });
              }
            }
          }
        }
        setRareSats(found);
        setDebug(`Found ${found.length} rare sats!`);
      } else {
        setDebug('No rare sats found');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  };

  const identifyRareSat = (satNumber: number): { type: string; name: string } | null => {
    if (satNumber >= 90000000 && satNumber <= 90000199) return { type: 'block9', name: 'Block 9' };
    if (satNumber >= 57000000 && satNumber <= 57000199) return { type: 'pizza', name: 'Pizza' };
    if (satNumber < 10000) return { type: 'genesis', name: 'Genesis' };
    const satHex = satNumber.toString(16).toUpperCase();
    if (satHex.length >= 4 && satHex === satHex.split('').reverse().join('')) {
      return { type: 'palindrome', name: `Palindrome: ${satHex}` };
    }
    return null;
  };

  const handleConnect = async (wallet: string) => {
    setWalletLoading(true);
    setError(null);
    setDebug(`Connecting to ${wallet}...`);
    
    try {
      await connect(wallet);
    } catch (e: any) {
      setError(e.message || 'Connection failed');
      setDebug('Connection failed');
    } finally {
      setWalletLoading(false);
    }
  };

  const addUtxo = () => {
    if (!newUtxo.txid || !newUtxo.vout) return;
    setUtxoInputs([...utxoInputs, {
      txid: newUtxo.txid,
      vout: parseInt(newUtxo.vout),
      satRange: newUtxo.satRange,
      value: parseInt(newUtxo.value) || 1,
    }]);
    setNewUtxo({txid: '', vout: '', satRange: '', value: ''});
  };

  const removeUtxo = (i: number) => {
    setUtxoInputs(utxoInputs.filter((_, idx) => idx !== i));
  };

  const toggleSat = (sat: number) => {
    const newSet = new Set(selectedSats);
    if (newSet.has(sat)) newSet.delete(sat);
    else newSet.add(sat);
    setSelectedSats(newSet);
  };

  const handleManualScan = async () => {
    if (!manualAddr.trim()) return;
    await scanAddress(manualAddr.trim());
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-900 to-black text-white p-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">🔴 Rare Sat Extractor</h1>
          <p className="text-orange-200">Extract rare sats - <span className="text-green-400">No hidden fees</span></p>
        </div>

        <div className="mb-4 text-center text-yellow-400 text-xs font-mono">{debug}</div>

        {/* Wallet Connection */}
        {!connected ? (
          <div className="space-y-4 mb-8">
            <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
              <button 
                onClick={() => handleConnect(XVERSE)}
                disabled={walletLoading}
                className="bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800 text-white font-bold py-3 px-4 rounded-lg"
              >
                {walletLoading ? 'Connecting...' : 'Connect Xverse'}
              </button>
              <button 
                onClick={() => handleConnect(UNISAT)}
                disabled={walletLoading}
                className="bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800 text-white font-bold py-3 px-4 rounded-lg"
              >
                {walletLoading ? 'Connecting...' : 'Connect UniSat'}
              </button>
            </div>
            
            <p className="text-center text-orange-300 text-sm">Or enter address manually:</p>
            
            <div className="flex gap-2">
              <input
                type="text"
                value={manualAddr}
                onChange={(e) => setManualAddr(e.target.value)}
                placeholder="bc1q... or bc1p..."
                className="flex-1 bg-orange-900/50 border border-orange-700 rounded-lg px-4 py-3 text-white placeholder-orange-500 font-mono text-sm"
              />
              <button 
                onClick={handleManualScan}
                disabled={scanning || !manualAddr.trim()}
                className="bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800 text-white font-bold py-3 px-6 rounded-lg"
              >
                Scan
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-6">
            <div className="bg-orange-950/50 rounded-lg p-4 mb-4 flex justify-between items-center">
              <div>
                <p className="text-sm text-orange-200">Connected:</p>
                <p className="font-mono text-xs break-all">{address}</p>
              </div>
              <button onClick={disconnect} className="text-red-400 text-sm">Disconnect</button>
            </div>
          </div>
        )}

        {/* Rare Sats Found */}
        {rareSats.length > 0 && (
          <div className="bg-green-900/30 rounded-lg p-4 mb-4">
            <h3 className="font-bold mb-3 text-green-400">Rare Sats: {rareSats.length}</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {rareSats.map((sat, i) => (
                <div key={i} className="flex justify-between items-center bg-green-900/50 rounded px-3 py-2">
                  <div>
                    <span className="inline-block bg-green-600 text-xs font-bold px-2 py-1 rounded mr-2">{sat.type}</span>
                    <span className="font-mono text-sm">#{sat.satNumber.toLocaleString()}</span>
                  </div>
                  <button onClick={() => toggleSat(sat.satNumber)} className={`text-xl px-3 py-1 rounded ${selectedSats.has(sat.satNumber) ? 'bg-green-500' : 'bg-green-800'}`}>
                    {selectedSats.has(sat.satNumber) ? '✓' : '+'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Manual UTXO Entry */}
        <div className="bg-orange-800/30 rounded-lg p-4 mb-4">
          <h3 className="font-bold mb-3">Add UTXO (from ordinals.com)</h3>
          <div className="grid grid-cols-4 gap-2 mb-2">
            <input type="text" value={newUtxo.txid} onChange={(e) => setNewUtxo({...newUtxo, txid: e.target.value})} placeholder="TXID" className="col-span-2 bg-orange-900/50 border border-orange-700 rounded px-2 py-2 text-white text-xs font-mono" />
            <input type="text" value={newUtxo.vout} onChange={(e) => setNewUtxo({...newUtxo, vout: e.target.value})} placeholder="vout" className="bg-orange-900/50 border border-orange-700 rounded px-2 py-2 text-white text-xs" />
            <input type="text" value={newUtxo.value} onChange={(e) => setNewUtxo({...newUtxo, value: e.target.value})} placeholder="sats" className="bg-orange-900/50 border border-orange-700 rounded px-2 py-2 text-white text-xs" />
          </div>
          <input type="text" value={newUtxo.satRange} onChange={(e) => setNewUtxo({...newUtxo, satRange: e.target.value})} placeholder="Sat range (e.g., 4500000000000000-4500000000000999)" className="w-full bg-orange-900/50 border border-orange-700 rounded px-3 py-2 text-white text-sm font-mono mb-3" />
          <button onClick={addUtxo} disabled={!newUtxo.txid || !newUtxo.vout} className="bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800 text-white font-bold py-2 px-4 rounded-lg text-sm">+ Add UTXO</button>
        </div>

        {/* UTXO List */}
        {utxoInputs.length > 0 && (
          <div className="bg-orange-800/30 rounded-lg p-4 mb-4">
            <h3 className="font-bold mb-3">UTXOs ({utxoInputs.length})</h3>
            {utxoInputs.map((utxo, i) => (
              <div key={i} className="flex justify-between items-center bg-orange-900/50 rounded px-3 py-2 mb-1">
                <span className="font-mono text-xs">{utxo.txid.slice(0,8)}...:{utxo.vout}</span>
                <button onClick={() => removeUtxo(i)} className="text-red-400 text-xs">✕</button>
              </div>
            ))}
          </div>
        )}

        {error && <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 mb-4"><p className="text-red-200">{error}</p></div>}
        
        <div className="mt-8 text-center text-orange-500/50 text-sm"><p>Club 42 ordinals holders 🔴</p></div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <LaserEyesProvider config={{ network: MAINNET }}>
      <WalletApp />
    </LaserEyesProvider>
  );
}
