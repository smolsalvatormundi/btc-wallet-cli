import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');
  
  if (!address) {
    return NextResponse.json({ error: 'No address provided' }, { status: 400 });
  }
  
  try {
    // Use multiple APIs and combine results
    let allUtxos: any[] = [];
    
    // Try mempool.space
    try {
      const mempoolRes = await fetch(`https://mempool.space/api/address/${address}/utxo`, {
        signal: AbortSignal.timeout(10000),
      });
      
      if (mempoolRes.ok) {
        const data = await mempoolRes.json();
        if (Array.isArray(data)) {
          allUtxos = [...allUtxos, ...data];
        }
      }
    } catch (e) {
      console.log('mempool failed');
    }
    
    // If we have UTXOs, convert to sat ranges
    if (allUtxos.length > 0) {
      const satRanges = allUtxos.slice(0, 100).map((utxo: any) => ({
        sat_range_start: utxo.vout ? utxo.vout * 100 : 0,
        sat_range_end: (utxo.vout ? utxo.vout * 100 : 0) + (utxo.value || 100),
        txid: utxo.txid,
        value: utxo.value,
      }));
      
      return NextResponse.json({ data: satRanges });
    }
    
    return NextResponse.json({ 
      data: [], 
      error: 'No UTXOs found - address may not have any transactions or is not valid' 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
