import { Connection, PublicKey } from "@solana/web3.js";
import axios from "axios";
import * as fs from 'fs';
import { getMultipleAccountsInfoSafe, getPricesForAllLps, tokenAccountStruct } from "./helpers";

export class UberWatch {
    private connection: Connection;
    private data: any;

    constructor(connection: Connection, freshStart: boolean) {
        this.connection = connection;
        if(freshStart) {
            this.data = {
                whales: [],
                addedWallets: [],
                wallets: [],
                tokenHoldings: [],
            };
            this.updateData();
            console.log(this.data.tokenHoldings)
        } else {
            this.data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
        }
    }

    public async findRaydiumLpWhales(number: number) {
        //TODO: find raydium whales and add them to the list
        let raydiumMarkets = (await axios.get("https://api.raydium.io/v2/sdk/liquidity/mainnet.json")).data.official;
        // console.log(raydiumMarkets);
        let marketAddresses = raydiumMarkets.map((market: any) => {return market.id});

        let prices = await getPricesForAllLps(this.connection, marketAddresses);

        let largeHoldersPromises: Promise<any>[] = [];

        for(let lp of prices) {
            let mint = lp.lpMint;
            largeHoldersPromises.push(this.connection.getTokenLargestAccounts(new PublicKey(mint)).catch((e: any) => {return {value: []}}));
        }

        let largestHoldersArray = await Promise.all(largeHoldersPromises);

        let tokenAccsArray: PublicKey[] = [];

        let tokenAccToWorth: Map<string, number> = new Map();

        for(let i = 0; i< prices.length; i++) {
            let price = prices[i].price;
            let largestHolders = largestHoldersArray[i].value;
            for(let holder of largestHolders) {
                tokenAccsArray.push(holder.address);
                if(!tokenAccToWorth.has(holder.address.toBase58())) {
                    tokenAccToWorth.set(holder.address.toBase58(), 0);
                }
                let current: number = tokenAccToWorth.get(holder.address.toBase58()) as number;
                current += holder.uiAmount * price;
                tokenAccToWorth.set(holder.address.toBase58(), current);
            }
        }

        let holderToWorth: Map<string, number> = new Map();

        let tokenAccsInfos = await getMultipleAccountsInfoSafe(this.connection, tokenAccsArray);

        for(let i = 0; i < tokenAccsArray.length; i++) {
            let addr = tokenAccsArray[i];
            let info = tokenAccsInfos[i];
            let parsed = tokenAccountStruct.deserialize(info.data)[0];
            if(!holderToWorth.has(parsed.owner.toBase58())) {
                holderToWorth.set(parsed.owner.toBase58(), 0);
            }
            let current: number = holderToWorth.get(parsed.owner.toBase58()) as number;
            current += tokenAccToWorth.get(addr.toBase58()) as number;
            holderToWorth.set(parsed.owner.toBase58(), current);
        }

        let arr: any[] = [];

        for(let holder of holderToWorth) {
            arr.push([holder[1], holder[0]]);
        }

        arr.sort((a, b) => {return (b[0] - a[0])});

        let returnArr: any[] = [];
        for(let i = 0; i < number; i++){
            returnArr.push({
                address: arr[i][1],
                lpValue: arr[i][0],
            });
        }
        return returnArr;
    }

    public async addRaydiumWhales(number: number) {
        let whales = await this.findRaydiumLpWhales(number);
        this.data.whales = [];
        for(let whale of whales) {
            this.data.whales.push(whale.address);
        }
        this.updateWallets();
        this.updateData();
    }

    public async updateWallets() {
        this.data.wallets = [];
        for(let whale of this.data.whales) this.data.wallets.push(whale.address);
        for(let wal of this.data.addedWallets) this.data.wallets.push(wal);
    }


    public async updateData() {
        fs.writeFileSync('./data.json', JSON.stringify(this.data), 'utf8');
    }

    public async readData() {
        this.data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
    }

    public async updateHoldings() {
        this.readData();
        let wallets: PublicKey[] = this.data.wallets;
        //TODO: update holdings of each wallet, and log data of their trades

        let currentData: any = {
            whales: [],
            addedWallets: [],
            wallets: [],
            tokenHoldings: [],
        };
        let id = 0;
        for(let addr of wallets) {
            console.log("Updates for: ", addr);
            let requestUrl = "https://portfolio-api.sonar.watch/v1/portfolio/fetch?owner=";
            requestUrl += addr;
            requestUrl += "&addressSystem=solana";
            let response = await axios.get(requestUrl);
            let data = response.data;
            currentData.tokenHoldings.push(data);
            // logging differences in token holdings between now and last update
            let previousTokens = this.data.tokenHoldings[id].elements[0].data.assets;
            let currentTokens = data.elements[0].data.assets;
            // console.log("Previous: ", previousTokens);
            // console.log("Current: ", currentTokens);
            let tokenMap: Map<string, any> = new Map();
            for(let token of previousTokens) {
                let defaul = {
                    previous: token,
                    current: {data: {address: token.data.address, amount: 0, price: 0}},
                };
                tokenMap.set(token.data.address, defaul);
                // console.log(token.data.address, token.data.amount, token.data.price);
            }
            
            for(let token of currentTokens) {
                if(tokenMap.has(token.data.address)) {
                    let defaul: any = tokenMap.get(token.data.address);
                    defaul.current = token;
                    tokenMap.set(token.data.address, defaul);
                }
                else {
                    let defaul = {
                        previous: {data: {address: token.data.address, amount: 0, price: 0}},
                        current: token,
                    };
                    tokenMap.set(token.data.address, defaul);
                }
                // console.log(token.data.address, token.data.amount, token.data.price);
            }
            // console.log(data.elements);

            console.log("Token updates: ")
            for(let token of tokenMap) {
                if(token[1].previous.data.amount != token[1].current.data.amount) {
                    let diff = token[1].current.data.amount - token[1].previous.data.amount;
                    if(diff < 0) {
                        console.log("Sold", Math.abs(diff), token[0], "Value: ", Math.abs(diff) * token[1].current.data.price);
                    }
                    else {
                        console.log("Bought", diff, token[0], "Value: ", diff * token[1].current.data.price);
                    }
                }
            }

            console.log("\nLP token updates: ");

            let previousLps = this.data.tokenHoldings[id].elements[1].data.liquidities;
            let currentLps = data.elements[1].data.liquidities;

            tokenMap.clear();
            for(let lp of previousLps) {
                let defaul = {
                    previous: {value: lp.value, base: lp.assets[0].data.address, quote: lp.assets[1].data.address},
                    current: {value: 0, base: lp.assets[0].data.address, quote: lp.assets[1].data.address},
                };
                if(!tokenMap.has(lp.assets[0].data.address + lp.assets[1].data.address)) {
                    tokenMap.set(lp.assets[0].data.address + lp.assets[1].data.address, defaul);
                }
            }
            
            for(let lp of currentLps) {
                if(tokenMap.has(lp.assets[0].data.address + lp.assets[1].data.address)) {
                    let defaul: any = tokenMap.get(lp.assets[0].data.address + lp.assets[1].data.address);
                    defaul.current = {value: lp.value, base: lp.assets[0].data.address, quote: lp.assets[1].data.address};
                    tokenMap.set(lp.assets[0].data.address + lp.assets[1].data.address, defaul);
                }
                else {
                    let defaul = {
                        previous: {value: 0, base: lp.assets[0].data.address, quote: lp.assets[1].data.address},
                        current: {value: lp.value, base: lp.assets[0].data.address, quote: lp.assets[1].data.address},
                    };
                    tokenMap.set(lp.assets[0].data.address + lp.assets[1].data.address, defaul);
                }
            }
            for(let token of tokenMap) {
                if(token[1].previous.value != token[1].current.value) {
                    let diff = token[1].current.value - token[1].previous.value;
                    if(diff < 0) {
                        console.log("Sold", token[1].current.base + "/" + token[1].current.quote, "Value: ", Math.abs(diff));
                    }
                    else {
                        console.log("Bought", token[1].current.base + "/" + token[1].current.quote, "Value: ", Math.abs(diff));
                    }
                }
            }
            this.data.tokenHoldings = currentData.tokenHoldings;
            this.updateData();
            id++;
        }

    }

    public async addAddressToWatch(address: PublicKey) {
        this.data.addedWallets.push(address.toBase58());
        this.updateWallets();
        this.updateData();
    }
}