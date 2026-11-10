// Vanity Dawg — deployment configuration.
// SET THESE before going live (see README, "Luke's steps"):
export const APP_CONFIG = {
  // Your production domain, no protocol, e.g. "vanity.dexmorrow.xyz".
  // Used for the fc:miniapp embed meta URLs. The manifest's
  // accountAssociation signature is bound to this exact string.
  domain: 'vanity-dawg.vercel.app',

  // The EVM address that receives unlock payments (Base USDC).
  // Payments are sent by the user's wallet directly to this address —
  // the app never custodies funds.
  payoutAddress: '0xYOUR_EVM_PAYOUT_ADDRESS',

  // Unlock price: 2 USDC. `amount` is in the token's smallest unit
  // (USDC has 6 decimals, so 2 USDC = "2000000"). CAIP-19 asset ID for
  // USDC on Base (chain 8453).
  price: {
    token: 'eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amount: '2000000',
    display: '2 USDC',
  },
};
