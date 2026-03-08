// Xverse Wallet Integration for Rare Sat Extractor
// Supports desktop extension and mobile deep link

export type WalletState = {
  connected: boolean;
  address: string | null;
  ordinalsAddress: string | null;
};

// Check if running in Xverse mobile browser
function isXverseMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('xverse');
}

// Check if Xverse extension is installed (desktop)
function isXverseDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  // @ts-ignore
  return !!(window.XverseProviders?.Ordinals);
}

export async function connectWallet(): Promise<WalletState> {
  try {
    // For mobile (Xverse in-app browser), we need special handling
    if (isXverseMobile()) {
      // On mobile, use the Xverse web provider
      // The page needs to be opened in Xverse's in-app browser
      // and the provider should be available
      const provider = (window as any).XverseProviders?.Ordinals;
      
      if (provider) {
        const result = await provider.connect({
          network: { type: 'mainnet' },
        });
        
        if (result?.addresses) {
          return {
            connected: true,
            address: result.addresses.payment,
            ordinalsAddress: result.addresses.ordinals,
          };
        }
      }
      
      return {
        connected: false,
        address: null,
        ordinalsAddress: null,
      };
    }
    
    // For desktop, try Xverse extension
    if (isXverseDesktop()) {
      // @ts-ignore
      const xverse = window.XverseProviders?.Ordinals;
      
      if (xverse) {
        const result = await xverse.connect({
          network: { type: 'mainnet' },
        });
        
        if (result?.addresses) {
          return {
            connected: true,
            address: result.addresses.payment,
            ordinalsAddress: result.addresses.ordinals,
          };
        }
      }
    }
    
    // Try sats-connect library
    try {
      const { getAddress, AddressPurpose, BitcoinNetworkType } = await import('@sats-connect/core');
      
      const result = await getAddress({
        purposes: [AddressPurpose.Ordinals, AddressPurpose.Payment],
        network: {
          type: BitcoinNetworkType.Mainnet,
        },
      });
      
      if (result && result.addresses) {
        const ordinalsAddr = result.addresses.find(
          (a) => a.purpose === AddressPurpose.Ordinals
        );
        const paymentAddr = result.addresses.find(
          (a) => a.purpose === AddressPurpose.Payment
        );
        
        return {
          connected: true,
          address: paymentAddr?.address || null,
          ordinalsAddress: ordinalsAddr?.address || null,
        };
      }
    } catch (e) {
      console.log('SatsConnect not available:', e);
    }
    
    return {
      connected: false,
      address: null,
      ordinalsAddress: null,
    };
  } catch (error) {
    console.error('Wallet connection error:', error);
    return { connected: false, address: null, ordinalsAddress: null };
  }
}

export function isWalletInstalled(): boolean {
  return isXverseMobile() || isXverseDesktop();
}
