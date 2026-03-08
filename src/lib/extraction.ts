// Rare sat extraction service
// Handles transaction creation for extracting rare sats from a UTXO
// MVP stub - actual implementation would use Xverse wallet signing

interface ExtractionRequest {
  utxo: {
    txid: string;
    vout: number;
    satRangeStart: number;
    satRangeEnd: number;
    value: number;
    script: string;
  };
  recipientAddress: string;
}

interface ExtractionResult {
  success: boolean;
  txid?: string;
  error?: string;
}

// Calculate extraction fee (network fees only, no hidden fees)
function calculateExtractionFee(utxoValue: number): number {
  // Rough estimate: ~150 vbytes for a simple extraction tx
  const vbytes = 150;
  const satsPerVbyte = 10; // 10 sats/vbyte default
  return vbytes * satsPerVbyte;
}

// Extract a rare sat - MVP stub
// In production, this would:
// 1. Construct a PSBT spending the rare sat UTXO
// 2. Send to Xverse wallet for signing
// 3. Broadcast the signed transaction
export async function extractRareSat(
  request: ExtractionRequest
): Promise<ExtractionResult> {
  try {
    const { utxo, recipientAddress } = request;
    
    // Calculate the extraction amount
    const extractionValue = 1;
    const fee = calculateExtractionFee(utxo.value);
    const change = utxo.value - extractionValue - fee;
    
    if (change < 0) {
      return {
        success: false,
        error: 'UTXO value too low to cover fees',
      };
    }
    
    // MVP: Return a message indicating this feature needs wallet integration
    // The actual implementation would use @sats-connect/core to:
    // 1. Create a PSBT with the rare sat as input
    // 2. Send to wallet for signing via signTransaction
    // 3. Broadcast via sendBtcTransaction
    
    return {
      success: false,
      error: 'Extraction requires wallet integration. Please use Xverse directly.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
    };
  }
}

// Calculate potential value of rare sats
export function estimateRareSatValue(satType: string): string {
  const estimates: Record<string, string> = {
    block9: '0.1 - 1+ BTC',
    palindrome: '0.01 - 0.5+ BTC',
    pizza: '0.1 - 1+ BTC',
    '符文': '0.05 - 0.5+ BTC',
    block: '0.01 - 0.1+ BTC',
    earth: '0.01 - 0.1+ BTC',
    mars: '0.01 - 0.1+ BTC',
    jupiter: '0.01 - 0.1+ BTC',
    saturn: '0.01 - 0.1+ BTC',
    sun: '0.01 - 0.1+ BTC',
    moon: '0.01 - 0.1+ BTC',
    star: '0.01 - 0.1+ BTC',
  };
  
  return estimates[satType] || 'Variable';
}
