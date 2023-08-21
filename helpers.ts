import { Connection, PublicKey } from "@solana/web3.js";
import {
    SPL_ACCOUNT_LAYOUT,
    LIQUIDITY_STATE_LAYOUT_V4,
    getMultipleAccountsInfo,
    BigNumberish,
  } from "@raydium-io/raydium-sdk";
import { OpenOrders } from "@project-serum/serum";
import { BN } from "@coral-xyz/anchor";
import axios from "axios";
import { BeetStruct, u32, u8, bool, u64 } from '@metaplex-foundation/beet';
import { publicKey } from '@metaplex-foundation/beet-solana';
import { BigNumber } from 'bignumber.js';

const OPENBOOK_PROGRAM_ID = new PublicKey("srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX");

export async function getPricesForAllLps(connection: Connection, marketAddresses: string[]) {
    let accountInfos = await getMultipleAccountsInfoSafe(connection, marketAddresses.map((addr) => new PublicKey(addr)));
    let lpInfos: any[] = [];
    for(let i = 0; i<accountInfos.length; i++) {
        let accountInfo = accountInfos[i];
        let data = Buffer.from(accountInfo.data);
        let poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(data);
        try {
        const openOrders = await OpenOrders.load(
            connection,
            poolState.openOrders,
            OPENBOOK_PROGRAM_ID // OPENBOOK_PROGRAM_ID(marketProgramId) of each pool can get from api: https://api.raydium.io/v2/sdk/liquidity/mainnet.json
          ).catch((e) => {return {baseTokenTotal: new BN(0), quoteTokenTotal: new BN(0)}});
        const baseTokenAmount = await connection.getTokenAccountBalance(
            poolState.baseVault
        );
        const quoteTokenAmount = await connection.getTokenAccountBalance(
            poolState.quoteVault
        );
        
        const baseDecimal = 10 ** poolState.baseDecimal.toNumber(); // e.g. 10 ^ 6
        const quoteDecimal = 10 ** poolState.quoteDecimal.toNumber();


        const basePnl = poolState.baseNeedTakePnl.toNumber() / baseDecimal;
        const quotePnl = poolState.quoteNeedTakePnl.toNumber() / quoteDecimal;
    
        const openOrdersBaseTokenTotal =
        openOrders.baseTokenTotal.toNumber() / baseDecimal;
        const openOrdersQuoteTokenTotal =
        openOrders.quoteTokenTotal.toNumber() / quoteDecimal;
    
        const base =
        (baseTokenAmount.value?.uiAmount || 0) + openOrdersBaseTokenTotal - basePnl;
        const quote =
        (quoteTokenAmount.value?.uiAmount || 0) +
        openOrdersQuoteTokenTotal -
        quotePnl;
        let lpMint = poolState.lpMint;
        lpInfos.push({
            mint: lpMint,
            baseAmount: base,
            baseToken: poolState.baseMint,
            quoteAmount: quote,
            quoteToken: poolState.quoteMint,
        });
        }catch(e){}
    }

    let tokenToPrice = await getTokenToPrices(lpInfos, connection);


    return tokenToPrice;
}

export async function getTokenToPrices(lpInfos: any[], connection: Connection){
    let tokenToPrice: Map<string, number> = new Map();
    let lpAndPrice: any[] = [];

    for(let lpInfo of lpInfos) {
        let basePrice: number = await getTokenPrice(lpInfo.baseToken.toBase58(), tokenToPrice);
        let quotePrice = await getTokenPrice(lpInfo.quoteToken.toBase58(), tokenToPrice);
        if(basePrice != 0 && quotePrice != 0){
            // TODO: find circulating supply of lpToken
            let lpMintInfo = await connection.getAccountInfo(lpInfo.mint);
            let lpInfoDeserialized = mintAccountStruct.deserialize(lpMintInfo?.data as Buffer)[0];
            let circSupply = lpInfoDeserialized.supply.div(new BN(10 ** lpInfoDeserialized.decimals)).toNumber();
            if(circSupply < 1)continue;
            let lpPrice = (lpInfo.baseAmount * basePrice + lpInfo.quoteAmount * quotePrice) / circSupply;
            lpAndPrice.push({
                lpMint:lpInfo.mint.toBase58(), 
                price: lpPrice
            });
        }
    }
    return lpAndPrice;
}

export async function getTokenPrice(tokenAddress: string, map: &Map<string, number>): Promise<number> {
    let price: number = 0;
    if(map.get(tokenAddress)) {
        return map.get(tokenAddress) as number;
    }
    try {
        price = (await axios.get("https://price.jup.ag/v4/price?ids=" + tokenAddress)).data.data[tokenAddress].price;
    } catch(e){}
    map.set(tokenAddress, price);
    return price;
}

const MAX_ACCOUNT = 100;

export async function getMultipleAccountsInfoSafe(
  connection: Connection,
  publicKeys: PublicKey[]
) {
  if (publicKeys.length <= MAX_ACCOUNT) {
    return connection.getMultipleAccountsInfo(publicKeys);
  }
  const accountsInfo: any = [];
  const publicKeysToFetch = [...publicKeys];
  while (publicKeysToFetch.length !== 0) {
    const currPublicKeysToFetch = publicKeysToFetch.splice(0, MAX_ACCOUNT);
    const accountsInfoRes = await connection.getMultipleAccountsInfo(
      currPublicKeysToFetch
    );
    accountsInfo.push(...accountsInfoRes);
  }
  return accountsInfo;
}

export type MintAccount = {
  readonly mintAuthorityOption: number;
  readonly mintAuthority: PublicKey;
  readonly supply: BigNumber;
  readonly decimals: number;
  readonly initialized: boolean;
  readonly freezeAuthorityOption: number;
  readonly freezeAuthority: PublicKey;
};

export const mintAccountStruct = new BeetStruct<MintAccount>(
  [
    ['mintAuthorityOption', u32],
    ['mintAuthority', publicKey],
    ['supply', u64],
    ['decimals', u8],
    ['initialized', bool],
    ['freezeAuthorityOption', u32],
    ['freezeAuthority', publicKey],
  ],
  (args) => args as MintAccount,
  'MintAccount'
);


export enum AccountState {
    Uninitialized = 0,
    Initialized = 1,
    Frozen = 2,
  }
  
  export type TokenAccount = {
    readonly mint: PublicKey;
    readonly owner: PublicKey;
    readonly amount: BigNumber;
    readonly delegateOption: number;
    readonly delegate: PublicKey;
    readonly state: AccountState;
    readonly isNativeOption: number;
    readonly isNative: BigNumber;
    readonly delegatedAmount: BigNumber;
    readonly closeAuthorityOption: number;
    readonly closeAuthority: PublicKey;
  };
  
  export const tokenAccountStruct = new BeetStruct<TokenAccount>(
    [
      ['mint', publicKey],
      ['owner', publicKey],
      ['amount', u64],
      ['delegateOption', u32],
      ['delegate', publicKey],
      ['state', u8],
      ['isNativeOption', u32],
      ['isNative', u64],
      ['delegatedAmount', u64],
      ['closeAuthorityOption', u32],
      ['closeAuthority', publicKey],
    ],
    (args) => args as TokenAccount,
    'TokenAccount'
  );