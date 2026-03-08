const bip39 = require("bip39");
const { HDKey } = require("@scure/bip32");

const mnemonic = "paper evil still fluid bird drill truth three spoil loyal birth arrow";
const seed = bip39.mnemonicToSeedSync(mnemonic);
const root = HDKey.fromMasterSeed(seed);

// Derive to m/86'/1'/0' to get the xpub
const derived = root.derive("m/86'/1'/0'");
const xpub = derived.toExtendedPublicKey();

console.log("Our xpub:", xpub);
console.log("Sparrow xpub: tpubDCGTMhRKMmPgT99WCpBQ1ZHHstsopiVWw3ttBdPzrXjp2JrJNmuKcy6b8HjJ5VbbHcajWgh7ZMZ6JBTfsqceCK6Ybk5REbe8sQUw6TV3L9r");
console.log("Match:", xpub === "tpubDCGTMhRKMmPgT99WCpBQ1ZHHstsopiVWw3ttBdPzrXjp2JrJNmuKcy6b8HjJ5VbbHcajWgh7ZMZ6JBTfsqceCK6Ybk5REbe8sQUw6TV3L9r");
