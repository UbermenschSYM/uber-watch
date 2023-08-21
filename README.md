# uber-watch

To initialize sdk
```typescript
let uberWatch = new UberWatch(new Connection("https://api.mainnet-beta.solana.com"), false); // pass true if cache doesn't exist yet
```

For finding raydium lp token whales
```typescript
let raydiumWhales = await uberWatch.findRaydiumLpWhales(20);
```

For adding pubkey to watching list
```typescript
await uberWatch.addAddressToWatch(new PublicKey("PUBKEY"));
```

To get updates for all the addresses you are watching
```typescript
await uberWatch.updateHoldings();
```
