import { NextRequest, NextResponse } from 'next/server';

const ORDISCAN_API_KEY = process.env.ORDISCAN_API_KEY || '47cbdf56-7cb5-4da3-a26b-5bc053c7cffd';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');
  
  if (!address) {
    return NextResponse.json({ error: 'No address provided' }, { status: 400 });
  }

  console.log('Fetching rare sats for:', address);
  
  try {
    // Try Ordiscan via server-side request
    const ordiscanUrl = `https://ordiscan.com/api/v1/address/${address}/satranges?limit=100`;
    
    const ordiscanRes = await fetch(ordiscanUrl, {
      headers: {
        'x-api-key': ORDISCAN_API_KEY,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });
    
    console.log('Ordiscan status:', ordiscanRes.status);
    
    if (ordiscanRes.ok) {
      const data = await ordiscanRes.json();
      return NextResponse.json(data);
    }
    
    // If Ordiscan fails, try mempool fallback
    const errorText = await ordiscanRes.text();
    console.log('Ordiscan error:', errorText.substring(0, 200));
    
    // Try mempool as fallback
    const mempoolRes = await fetch(`https://mempool.space/api/address/${address}/utxo`, {
      signal: AbortSignal.timeout(10000),
    });
    
    if (mempoolRes.ok) {
      const utxos = await mempoolRes.json();
      return NextResponse.json({
        data: [],
        warning: 'Ordiscan unavailable, using mempool fallback',
        utxos
      });
    }
    
    return NextResponse.json({ 
      error: 'Both Ordiscan and mempool failed',
      ordiscanStatus: ordiscanRes.status 
    }, { status: 500 });
    
  } catch (error: any) {
    console.error('Fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
