// Ordiscan API service for sat range queries
// API docs: https://ordiscan.com/

const ORDISCAN_API_BASE = 'https://ordiscan.com/api';

interface SatRange {
  start: number;
  end: number;
  offset: number;
  timestamp: number;
  block_height: number;
}

interface SatRangesResponse {
  success: boolean;
  data: SatRange[];
  pagination?: {
    cursor: string;
    has_more: boolean;
  };
}

interface AddressUtxosResponse {
  success: boolean;
  data: {
    txid: string;
    vout: number;
    sat_range_start: number;
    sat_range_end: number;
    script: string;
    value: number;
  }[];
}

// Rare sat categories
export type RareSatType = 
  | 'block9'
  | 'palindrome'
  | 'pizza'
  | '符文' // Rune
  | 'block'
  | ' Genesis'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'sun'
  | 'moon'
  | 'star'
  | 'black'
  | 'white'
  | 'prime'
  | 'fibonacci'
  | 'round'
  | ' Repeating';

export interface RareSat {
  satRange: SatRange;
  type: RareSatType;
  name: string;
}

const ORDISCAN_API_KEY = process.env.NEXT_PUBLIC_ORDISCAN_API_KEY || '';

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(ORDISCAN_API_KEY && { 'x-api-key': ORDISCAN_API_KEY }),
  };
}

export async function getAddressUtxos(address: string): Promise<AddressUtxosResponse> {
  const response = await fetch(`${ORDISCAN_API_BASE}/address/${address}/utxos`, {
    headers: getHeaders(),
  });
  
  if (!response.ok) {
    throw new Error(`Ordiscan API error: ${response.status}`);
  }
  
  return response.json();
}

export async function getSatRanges(
  address: string,
  cursor?: string
): Promise<SatRangesResponse> {
  const url = new URL(`${ORDISCAN_API_BASE}/address/${address}/sat-ranges`);
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }
  
  const response = await fetch(url.toString(), {
    headers: getHeaders(),
  });
  
  if (!response.ok) {
    throw new Error(`Ordiscan API error: ${response.status}`);
  }
  
  return response.json();
}

// Check if a sat number is a rare sat
export function identifyRareSat(satNumber: number): RareSat | null {
  const satHex = satNumber.toString(16).toUpperCase();
  
  // Block 9 (first sat of block 9)
  if (satNumber >= 90000000 && satNumber <= 90000199) {
    return {
      satRange: {
        start: satNumber,
        end: satNumber + 1,
        offset: 0,
        timestamp: 0,
        block_height: 9,
      },
      type: 'block9',
      name: 'Block 9',
    };
  }
  
  // Palindrome check
  if (satHex === satHex.split('').reverse().join('')) {
    return {
      satRange: {
        start: satNumber,
        end: satNumber + 1,
        offset: 0,
        timestamp: 0,
        block_height: 0,
      },
      type: 'palindrome',
      name: `Palindrome: ${satHex}`,
    };
  }
  
  // Pizza sats (210,000 - block of first pizza transaction)
  if (satNumber >= 21000000 && satNumber <= 21000199) {
    return {
      satRange: {
        start: satNumber,
        end: satNumber + 1,
        offset: 0,
        timestamp: 0,
        block_height: 210000,
      },
      type: 'pizza',
      name: 'Pizza Sats',
    };
  }
  
  // ASCII text patterns
  const textPatterns: Record<string, RareSatType> = {
    'PIZZA': 'pizza',
    'BLOCK': 'block',
    'GENESIS': ' Genesis',
    'EARTH': 'earth',
    'MARS': 'mars',
    'JUPITER': 'jupiter',
    'SATURN': 'saturn',
    'SUN': 'sun',
    'MOON': 'moon',
    'STAR': 'star',
    'BLACK': 'black',
    'WHITE': 'white',
    '符文': '符文',
  };
  
  for (const [pattern, type] of Object.entries(textPatterns)) {
    if (satHex.includes(pattern)) {
      return {
        satRange: {
          start: satNumber,
          end: satNumber + 1,
          offset: 0,
          timestamp: 0,
          block_height: 0,
        },
        type,
        name: type,
      };
    }
  }
  
  return null;
}

// Get all rare sats from an address
export async function getRareSats(address: string): Promise<RareSat[]> {
  const rareSats: RareSat[] = [];
  let cursor: string | undefined;
  
  do {
    const response = await getSatRanges(address, cursor);
    
    for (const satRange of response.data) {
      // Check each sat in the range
      const satCount = satRange.end - satRange.start;
      
      for (let i = 0; i < Math.min(satCount, 100); i++) {
        const satNumber = satRange.start + i;
        const rare = identifyRareSat(satNumber);
        
        if (rare) {
          rareSats.push(rare);
        }
      }
    }
    
    cursor = response.pagination?.cursor;
  } while (cursor && rareSats.length < 100);
  
  return rareSats;
}
