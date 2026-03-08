import { NextRequest, NextResponse } from 'next/server';
import { Ordiscan } from 'ordiscan';

const ordiscan = new Ordiscan('47cbdf56-7cb5-4da3-a26b-5bc053c7cffd');

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address');
  
  if (!address) {
    return NextResponse.json({ error: 'No address provided' }, { status: 400 });
  }
  
  console.log('=== Scanning:', address, '===');
  
  try {
    // Try Ordiscan SDK first
    const ordiscanData = await ordiscan.address.getRareSats({ address });
    console.log('Ordiscan found:', ordiscanData.length, 'rare sats');
    
    if (ordiscanData && ordiscanData.length > 0) {
      return NextResponse.json({
        satRanges: ordiscanData,
        sources: ['ordiscan']
      });
    }
    
    // Try mempool for UTXOs
    try {
      const mempoolRes = await fetch(`https://mempool.space/api/address/${address}/utxo`, {
        signal: AbortSignal.timeout(10000),
      });
      if (mempoolRes.ok) {
        const utxos = await mempoolRes.json();
        return NextResponse.json({
          satRanges: [],
          utxos,
          sources: ['ordiscan', 'mempool'],
          message: 'No rare sats found, but UTXOs returned'
        });
      }
    } catch (e) {
      console.log('Mempool failed:', e);
    }
    
    return NextResponse.json({
      satRanges: [],
      sources: ['ordiscan'],
      message: 'No rare sats found for this address'
    });
    
  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({ 
      error: error.message,
      sources: []
    }, { status: 500 });
  }
}
