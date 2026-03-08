const { default: bs58check } = require("bs58check");
const { HDKey } = require("@scure/bip32");

const tpub = "tpubDCGTMhRKMmPgT99WCpBQ1ZHHstsopiVWw3ttBdPzrXjp2JrJNmuKcy6b8HjJ5VbbHcajWgh7ZMZ6JBTfsqceCK6Ybk5REbe8sQUw6TV3L9r";

// Decode and swap version to zpub (0x04b24746)
const decoded = bs58check.decode(tpub);
console.log("Original version:", decoded.slice(0,4).toString("hex"));

// Change version to zpub 
decoded[0] = 0x04;
decoded[1] = 0xb2;
decoded[2] = 0x47;
decoded[3] = 0x46;

const zpub = bs58check.encode(decoded);
console.log("New zpub:", zpub);

try {
  const hdKey = HDKey.fromExtendedKey(zpub);
  console.log("Parsed:", hdKey.publicKey ? "YES" : "NO");
  
  // Derive path m/86'/1'/0'/0/0
  const child = hdKey.derive("m/86'/1'/0'/0/0");
  console.log("Derived:", child.publicKey ? "YES" : "NO");
} catch(e) {
  console.log("Error:", e.message);
}
