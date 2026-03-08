import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { utxos, recipientAddress } = body;
    
    if (!utxos || utxos.length === 0) {
      return NextResponse.json({ error: 'No UTXOs provided' }, { status: 400 });
    }

    console.log('Creating PSBT:', { utxos, recipientAddress });

    // For now, return a template PSBT that the user can use
    // Full PSBT creation requires the previous transaction data
    
    // Create a simple PSBT template
    // This is a placeholder - real implementation needs blockchain data
    
    const template = {
      inputs: utxos.map((u: any) => ({
        txid: u.txid,
        vout: u.vout,
        satRange: u.satRange,
        value: u.value,
      })),
      recipient: recipientAddress || '',
      note: 'This is a template. Full PSBT requires fetching previous transaction data.',
    };

    return NextResponse.json({
      success: true,
      template,
      message: 'PSBT template created. For full PSBT, we need to fetch previous transactions.',
    });

  } catch (error: any) {
    console.error('PSBT error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create PSBT' }, { status: 500 });
  }
}
