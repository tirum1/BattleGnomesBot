require('dotenv').config({ path: './.env' });
require('colors');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { ethers } = require('ethers');
const bluebird = require('bluebird');
const redis = require('redis');
const axios = require('axios');
const FormData = require('form-data');

const registerBotToken = process.env.REGISTER_BOT_TOKEN;
const mainBotToken = process.env.MAIN_BOT_TOKEN;
const redisUrl = process.env.MAIN_REDIS_URL;
const MYMaintenance = process.env.MYMAINTENANCE;
const TELEGRAM_BASE_URL = `https://api.telegram.org/bot${mainBotToken}/`;

const registerBot = new TelegramBot(registerBotToken, { polling: true });
const hungerGamesAddress = '0xb7df1df9c07424eb62a3154c141fb0a857b87a40';
const GnomesCollectiveAddress = "0xF447E3a627F924EA8b064724001C484fEB39F6f9";
const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);
const MYMaintenanceWallet = new ethers.Wallet(MYMaintenance, provider);
const TokenABI = JSON.parse(fs.readFileSync('./ABI/HungerGames.json', 'utf8')).abi;
const NFTABI = JSON.parse(fs.readFileSync('./ABI/GnomesCollective.json', 'utf8')).abi;
const NFTContract = new ethers.Contract(GnomesCollectiveAddress, NFTABI, provider);
const TokenContract = new ethers.Contract(hungerGamesAddress, TokenABI, provider);
const TokenContractWithSigner = TokenContract.connect(MYMaintenanceWallet);


const client = redis.createClient({ 
    url: redisUrl,
    retry_strategy: function(options) {
        if (options.error && options.error.code === 'ECONNREFUSED') {
            return new Error('The server refused the connection');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
            return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
    }
});

bluebird.promisifyAll(client);

client.on('connect', () => {
    console.log('[PASS]'.green + ' Redis Connected');
});
client.on('error', (err) => {
    console.error('Redis error:', err);
});

const getAsync = bluebird.promisify(client.get).bind(client);
const setAsync = bluebird.promisify(client.set).bind(client);
const delAsync = bluebird.promisify(client.del).bind(client);

function startBot() {

    let userOngoingTransactions = {};
    let ongoingTransactions = {};

    registerBot.onText(/\/?start/i, async (msg) => {
        const username = msg.from.username;
    
        if (!username) {
            console.error("Username is not defined.");
            registerBot.sendMessage(msg.chat.id, `❌ You haven't setup a Telegram Username.`);
            return;
        }
        
        const walletAddress = await client.getAsync(username);
        const referral = await client.getAsync(`referredBy:${username}`);
        const refCode = await client.getAsync(`referral:${username}`);
        const safeUsername = username.replace(/_/g, '\\_');
        
        let response = `🏛 Welcome to the Hunger Games Colosseum, @${safeUsername}! 🏛\n\n`;
    
        if (walletAddress) {
            const shortWalletAddress = shortenWalletAddress(walletAddress);
            response += `🔗 *Wallet Address:* \n${shortWalletAddress}\n\n`;
        } else {
            response += "❗️ *Warning:* Your wallet isn't set up yet. Please set it up for smoother transactions.\n\n";
        }

        if (referral) {
            const safeReferral = referral.replace(/_/g, '\\_');
            response += `📩 *Referred By:* \n@${safeReferral}\n\n`;
        } else {
            response += "💡 *Suggestion:* No referrals yet? Shop using a referral code to enjoy extra benefits!\n\n";
        }

        if(refCode){
            response += `🎁 *Your Referral Code:* \n${refCode}\n\n`;
        } else{
            response += "⚠️ *Notice:* You don't have a referral code. Create one to start referring friends!\n\n";
        }

        response += `🛠 *Commands:* \n`;
        response += `📝 - /register [YourWalletAddress]: Register your wallet.\n`;
        response += `🔍 - /wallet: Display your registered wallet.\n`;
        response += `⚖️ - /balance: Check your shop balance.\n`;
        response += `💰 - /price: Get current potion prices.\n`;
        response += `📊 - /status: View your NFTs and their potion statuses.\n\n`;
        response += `🛒 *Shop:* \nTo deposit and shop, [click here](www.gnomescollective.xyz).\n\n`;
        response += `🧪 *Potions:* \nUse the following commands to buy and apply:\n`;
        response += `🛍️ - /buy [potionName] [potionAmount]\n`;
        response += `🖌️ - /apply [potionName] [NFTID1,NFTID2, ...]\n\n`; 
        response += `🤝 *Referral System:* \nUse the commands to set and use referral codes:\n`; 
        response += `✏️ - /setRef [YourRefCode]: Set your referral code.\n`;
        response += `👥 - /addRef [ReferralCode]: Set someone else's referral code.\n`;
    
        registerBot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' }).catch((err) => {
            console.error("Error sending message:", err);
        });
    });
    
    registerBot.onText(/\/?register (\w+)/i, async (msg, match) => {
        const username = msg.from.username;
        if (!username) {
            console.error("Username is not defined.");
            registerBot.sendMessage(msg.chat.id, `❌ You haven't set up a Telegram Username.`);
            return;
        }
    
        const newWalletAddress = match[1];
    
        if (!isValidEthereumAddress(newWalletAddress)) {
            registerBot.sendMessage(msg.chat.id, "❌ Invalid input! Please ensure you're providing a valid Ethereum address.");
            return;
        }
    
        try {
            const existingWalletAddressForUser = await getAsync(username);
            const existingUsernameForWallet = await getAsync(newWalletAddress);
    
            if (existingWalletAddressForUser && existingWalletAddressForUser === newWalletAddress) {
                registerBot.sendMessage(msg.chat.id, "✅ You've already registered with this wallet address.");
                return;
            }
    
            if (existingUsernameForWallet && existingUsernameForWallet !== username) {
                registerBot.sendMessage(msg.chat.id, "⚠️ Oops! This wallet address is already associated with another user. Please use a different wallet address.");
                return;
            }
    
            await setAsync(username, newWalletAddress);
            await setAsync(newWalletAddress, username);
    
            if (existingWalletAddressForUser) {
                registerBot.sendMessage(msg.chat.id, "🔄 Your wallet address has been updated successfully!");
            } else {
                registerBot.sendMessage(msg.chat.id, "✨ Success! Your wallet address has been registered.");
            }
    
        } catch (error) {
            console.error('Error registering wallet address:', error);
            registerBot.sendMessage(msg.chat.id, "🚫 Oops! There was an error registering your wallet. Please try again in a moment.");
        }
    });
    
    registerBot.onText(/\/?wallet/i, async (msg) => {
        const username = msg.from.username;
        if (!username) {
            console.error("Username is not defined.");
            registerBot.sendMessage(msg.chat.id, `❌ You haven't setup a Username.`);
            return;
        }
        console.log('Attempting to retrieve wallet for username:', username);
    
        try {
            const walletAddress = await client.getAsync(username);
            console.log('Retrieved wallet address:', walletAddress);
    
            if (walletAddress) {
                const shortWalletAddress = shortenWalletAddress(walletAddress);
                console.log(`Sending to @${username}: Wallet address: ${shortWalletAddress}`);
                registerBot.sendMessage(msg.chat.id, `🔐 *Wallet Address for @${username}:* \n${shortWalletAddress}`, {parse_mode: 'Markdown'});
            } else {
                console.log(`Informing @${username}: No registered wallet.`);
                registerBot.sendMessage(msg.chat.id, `❌ @${username}, you haven't registered a wallet address yet. Use the /register command to set one up.`);
            }
        } catch (error) {
            console.error('Error retrieving wallet for user:', error);
            registerBot.sendMessage(msg.chat.id, "🚫 Oops! We encountered an issue fetching your wallet. Please give it another try in a moment.");
        }
    });
    
    registerBot.onText(/\/?balance/i, async (msg) => {
        const username = msg.from.username;
        if (!username) {
            console.error("Username is not defined.");
            registerBot.sendMessage(msg.chat.id, `❌ You haven't setup a Telegram Username.`);
            return;
        }
        console.log('Fetching balance for username:', username);
    
        try {
            const walletAddress = await client.getAsync(username);
            if (!walletAddress) {
                registerBot.sendMessage(msg.chat.id, `No wallet registered for @${username}`);
                return;
            }
    
            const hgmsBalance = await TokenContract.hgmsShopBalances(walletAddress);
            const ethBalance = await TokenContract.ethShopBalances(walletAddress);
            const xtraBalance = await TokenContract.XTRAShopBalances(walletAddress);
            const boostBalance = await TokenContract.BOOSTShopBalances(walletAddress);
            const vBalance = await TokenContract.VShopBalances(walletAddress);
            const skipBalance = await TokenContract.SKIPShopBalances(walletAddress);
            const NFTByID = await NFTContract.walletOfOwner(walletAddress);
    
            const hgmsBalanceInFullUnits = parseFloat(ethers.utils.formatUnits(hgmsBalance, 0));
            const ethBalanceInFullUnits = parseFloat(ethers.utils.formatUnits(ethBalance, 9));
            const hgmsBalanceInMillions = (hgmsBalanceInFullUnits / 1000);
    
            const shortWalletAddress = shortenWalletAddress(walletAddress);
    
            const NFTChunks = chunkArray(NFTByID, 50); 

            if (NFTChunks.length === 0) {

                const noNFTsResponse =
                "─────────────────────────────────\n" +
                "🔹 Hunger Games Balance 🔹 \n" +
                "─────────────────────────────────\n" +
                "\n" +
                "👤 User: @" + username + "\n" +
                "🔗 Wallet Address: " + shortWalletAddress + "\n" +
                "\n" +
                
                    "🟢 HGMS: " + hgmsBalanceInMillions + "K $HGMS\n" +
                    "🔵 ETH: " + ethBalanceInFullUnits + " ETH\n" +
                    "🟣 XTRA: " + xtraBalance + " XTRA\n" +
                    "🟠 BOOST: " + boostBalance + " BOOST\n" +
                    "🔷 V: " + vBalance + " V\n" +
                    "🟡 SKIP: " + skipBalance + " SKIP\n" +
                  
                "🔖 NFT IDs: None " +"\n" +
                "\n" +
                "Thank you for using the Hunger Games Colosseum!\n" +
                "──────────────────────────────────\n";
            
                await registerBot.sendMessage(msg.chat.id, noNFTsResponse);
            } else {
                for (const [index, chunk] of NFTChunks.entries()) {
                    const response =
                        "─────────────────────────────────\n" +
                        "🔹 Hunger Games Balance 🔹 (Page " + (index + 1) + "/" + NFTChunks.length + ")\n" +
                        "─────────────────────────────────\n" +
                        "\n" +
                        "👤 User: @" + username + "\n" +
                        "🔗 Wallet Address: " + shortWalletAddress + "\n" +
                        "\n" +
                        (index === 0 ? (
                            "🟢 HGMS: " + hgmsBalanceInMillions + "K $HGMS\n" +
                            "🔵 ETH: " + ethBalanceInFullUnits + " ETH\n" +
                            "🟣 XTRA: " + xtraBalance + " XTRA\n" +
                            "🟠 BOOST: " + boostBalance + " BOOST\n" +
                            "🔷 V: " + vBalance + " V\n" +
                            "🟡 SKIP: " + skipBalance + " SKIP\n"
                        ) : "") +
                        "🔖 NFT IDs: " + chunk.join(', ') + "\n" +
                        "\n" +
                        "Thank you for using the Hunger Games Colosseum!\n" +
                        "──────────────────────────────────\n";
            
                    await registerBot.sendMessage(msg.chat.id, response);
                }
            }
            

        } catch (err) {
            console.error('Error fetching balance:', err);
            registerBot.sendMessage(msg.chat.id, "Error fetching the balance. Please try again later.");
        }
    });
    
    registerBot.onText(/\/?price/i, async (msg) => {
        try {
            const BOOSTPriceETHBig = await TokenContract.BOOSTPriceETH();
            const BOOSTPriceHGMSBig = await TokenContract.BOOSTPriceHGMS();
            const VPriceETHBig = await TokenContract.VPriceETH();
            const VPriceHGMSBig = await TokenContract.VPriceHGMS();
            const SKIPPriceETHBig = await TokenContract.SKIPPriceETH();
            const SKIPPriceHGMSBig = await TokenContract.SKIPPriceHGMS();
            const XTRAPriceETHBig = await TokenContract.XTRAPriceETH();
            const XTRAPriceHGMSBig = await TokenContract.XTRAPriceHGMS();
    
            const BOOSTPriceETH = ethers.utils.formatUnits(BOOSTPriceETHBig, 9);
            const BOOSTPriceHGMS = ethers.utils.formatUnits(BOOSTPriceHGMSBig, 0)/1000;
            const VPriceETH = ethers.utils.formatUnits(VPriceETHBig, 9);
            const VPriceHGMS = ethers.utils.formatUnits(VPriceHGMSBig, 0)/1000;
            const SKIPPriceETH = ethers.utils.formatUnits(SKIPPriceETHBig, 9);
            const SKIPPriceHGMS = ethers.utils.formatUnits(SKIPPriceHGMSBig, 0)/1000;
            const XTRAPriceETH = ethers.utils.formatUnits(XTRAPriceETHBig, 9);
            const XTRAPriceHGMS = ethers.utils.formatUnits(XTRAPriceHGMSBig, 0)/1000;
    
            let response = '';

            response += "🔮 *Alchemy Market Rates:* 🔮\n\n";
            
            response += "🚀 *BOOST Potion – The Rocket Fuel:*\n";
            response += `  💰 ETH: ${BOOSTPriceETH} ETH\n`;
            response += `  🪙 HGMS: ${BOOSTPriceHGMS}K HGMS\n\n`;
            
            response += "💠 *V Potion – The Essence of Vitality:*\n";
            response += `  💰 ETH: ${VPriceETH} ETH\n`;
            response += `  🪙 HGMS: ${VPriceHGMS}K HGMS\n\n`;
            
            response += "⏭️ *SKIP Potion – Time's Winged Potion:*\n";
            response += `  💰 ETH: ${SKIPPriceETH} ETH\n`;
            response += `  🪙 HGMS: ${SKIPPriceHGMS}K HGMS\n\n`;
            
            response += "🌟 *XTRA Potion – Glimmer of Fortune:*\n";
            response += `  💰 ETH: ${XTRAPriceETH} ETH\n`;
            response += `  🪙 HGMS: ${XTRAPriceHGMS}K HGMS`;
            
            registerBot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
            
        } catch (err) {
            console.error('Error fetching prices:', err);
            registerBot.sendMessage(msg.chat.id, "Error fetching prices. Please try again later.");
        }
    });

    registerBot.onText(/\/?buy ([\w]+) (\d+)/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const username = msg.from.username;

        if (!username) {
            console.error("Username is not defined.");
            registerBot.sendMessage(msg.chat.id, "🔮 *Mystical Alert!* 🔮\nAh, adventurer! It seems you've yet to carve your name in the Telegram scrolls. Please inscribe your Telegram Username to proceed on this quest.");
            return;
        }

        if (userOngoingTransactions[username]) {
            let response = '';

            response += "🧙‍♂️ *Easy there, wizard!* 🧙‍♂️\n\n";
            response += "Your magic is still ✨ _brewing_ ✨.\n";
            response += "Please let the current spell 🌀 _settle_ 🌀 before casting the next.\n\n";
            response += "🔮 *Patience is a virtue of the wise!* 🔮";

            registerBot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
            return;
        }
        userOngoingTransactions[username] = true;
        const potionName = match[1].toUpperCase();
        const amount = parseInt(match[2])
        console.log("Amount:", amount);
        console.log("Potion Name:", potionName);

        try {
            const shopOwnerAddress = await client.getAsync(username);
            if (!shopOwnerAddress) {
                registerBot.sendMessage(msg.chat.id, `🔮 *Mystical Bindings Alert!* 🔮\nGreetings, @${username}! The cosmos whispers that your wallet remains unbound. Please tether your etheric pouch to journey further.`);
                userOngoingTransactions[username] = false;
                return;
            }
            const BOOSTPriceETHBig = await TokenContract.BOOSTPriceETH();
            const BOOSTPriceHGMSBig = await TokenContract.BOOSTPriceHGMS();
            const VPriceETHBig = await TokenContract.VPriceETH();
            const VPriceHGMSBig = await TokenContract.VPriceHGMS();
            const SKIPPriceETHBig = await TokenContract.SKIPPriceETH();
            const SKIPPriceHGMSBig = await TokenContract.SKIPPriceHGMS();
            const XTRAPriceETHBig = await TokenContract.XTRAPriceETH();
            const XTRAPriceHGMSBig = await TokenContract.XTRAPriceHGMS();
    
            const BOOSTPriceETH = ethers.utils.formatUnits(BOOSTPriceETHBig, 9);
            const VPriceETH = ethers.utils.formatUnits(VPriceETHBig, 9);
            const SKIPPriceETH = ethers.utils.formatUnits(SKIPPriceETHBig, 9);
            const XTRAPriceETH = ethers.utils.formatUnits(XTRAPriceETHBig, 9);
    
            const convertedPrices = {
                BOOST: { ETH: BOOSTPriceETH, HGMS: BOOSTPriceHGMSBig },
                V: { ETH: VPriceETH, HGMS: VPriceHGMSBig },
                SKIP: { ETH: SKIPPriceETH, HGMS: SKIPPriceHGMSBig },
                XTRA: { ETH: XTRAPriceETH, HGMS: XTRAPriceHGMSBig }
            };
    
            if (!convertedPrices[potionName]) {
                registerBot.sendMessage(chatId, "🚫 Uh-Oh, Invalid Potion Name.");
                userOngoingTransactions[username] = false;
                return;
            }
    
            const totalCostETH = amount * convertedPrices[potionName].ETH;
            const totalCostHGMS = amount * convertedPrices[potionName].HGMS;
            const userBalanceETH = (await TokenContract.ethShopBalances(shopOwnerAddress)).toNumber();
            const userBalanceHGMS = (await TokenContract.hgmsShopBalances(shopOwnerAddress)).toNumber();
            const ethBalanceInFullUnits = parseFloat(ethers.utils.formatUnits(userBalanceETH, 9));
            
            console.log("Total Cost in ETH:", totalCostETH);
            console.log("Total Cost in HGMS:", totalCostHGMS);
            console.log("User ETH Balance:", userBalanceETH);
            console.log("User HGMS Balance:", userBalanceHGMS);
            console.log("User ETH Balance (Full Units):", ethBalanceInFullUnits);
            

            if (ethBalanceInFullUnits < totalCostETH || userBalanceHGMS < totalCostHGMS) {
                let response = '';

                response += "🚫 *Whoa, hold your horses!* 🐎\n\n";
                response += "_Seems like you're running a tad short on funds for this adventure._\n\n";
                response += `🟢 *Your HGMS Vault:* ${userBalanceHGMS/1000}K HGMS\n`;
                response += `🔵 *Price Tag in HGMS:* ${totalCostHGMS/1000}K HGMS\n\n`;
                response += `🟢 *Your ETH Stash:* ${ethBalanceInFullUnits} ETH\n`;
                response += `🔵 *Price Tag in ETH:* ${totalCostETH} ETH\n\n`;
                response += "_No biggie! Add a little sparkle to your treasure, and we'll be here, waiting for your grand return._\n\n";
                response += "💎 *Shine on, legend!* 💎";
                
                registerBot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
                userOngoingTransactions[username] = false;
                return;
            }

            let confirmMessage = '';

            confirmMessage += "🔮 *Mystic Trade Portal*\n\n";
            confirmMessage += "Adventurer, you stand at the crossroads of a magical transaction.\n\n";
            confirmMessage += `🧪 *Potion:* __${potionName}__\n`;
            confirmMessage += `📊 *Volume:* __${amount}__\n\n`;
            confirmMessage += `💎 *Treasure Required (HGMS):* __${totalCostHGMS/1000}K__\n`;
            confirmMessage += `💰 *Treasure Required (ETH):* __${totalCostETH}__ ETH\n\n`;
            confirmMessage += "Choose your path wisely:\n";
            confirmMessage += "✅ For destiny, tap \"Confirm\".\n";
            confirmMessage += "❌ For reflection, tap \"Decline\".\n\n";
            confirmMessage += "_May your choices echo in eternity!_";
            
            const transactionId = `${chatId}_${Date.now()}`;

            ongoingTransactions[transactionId] = {
                username: username,
                status: 'pending',
                potionName: potionName,
                amount: amount,
                shopOwnerAddress: shopOwnerAddress, 
                transactionType: 'buyPotion',
                ethAmount: totalCostETH,
                hgmsAmount: totalCostHGMS/1000,
            };

            const keyboard = {
                inline_keyboard: [
                    [{ text: 'Confirm', callback_data: `yes_${transactionId}` }],
                    [{ text: 'Decline', callback_data: `no_${transactionId}` }]
                ]
            };

            registerBot.sendMessage(chatId, confirmMessage, { parse_mode: 'Markdown', reply_markup: keyboard });

        } catch (error) {
            console.error('Error in /buy handler:', error);
            registerBot.sendMessage(chatId, "An error occurred while processing your request. Please try again later.");
        }
    });

    registerBot.onText(/\/?apply (\w+) ([\d,]+)/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const username = msg.from.username;
        const potionName = match[1];
        const nftIds = [...new Set(match[2].split(',').map(id => parseInt(id)))];

        if (!username) {
            console.error("Username is not defined.");
            registerBot.sendMessage(msg.chat.id, `❌ You haven't set up a Telegram Username.`);
            return;
        }
    
        if (userOngoingTransactions[username]) {
            let response = '';

            response += "🧙‍♂️ *Easy there, wizard!* 🧙‍♂️\n\n";
            response += "Your magic is still ✨ _brewing_ ✨.\n";
            response += "Please let the current spell 🌀 _settle_ 🌀 before casting the next.\n\n";
            response += "🔮 *Patience is a virtue of the wise!* 🔮";

            registerBot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
            return;
        }
        userOngoingTransactions[username] = true;

        const walletAddress = await getAsync(username);

        if (!walletAddress) {
            registerBot.sendMessage(msg.chat.id, `No wallet registered for @${username}`);
            userOngoingTransactions[username] = false;
            return;
        }
        try {

            const shopOwnerAddress = await client.getAsync(username);
            if (!shopOwnerAddress) {
                registerBot.sendMessage(msg.chat.id, `No wallet registered for @${username}`);
                userOngoingTransactions[username] = false;
                return;
            }
            const xtraBalance = await TokenContract.XTRAShopBalances(walletAddress);
            const boostBalance = await TokenContract.BOOSTShopBalances(walletAddress);
            const vBalance = await TokenContract.VShopBalances(walletAddress);
            const skipBalance = await TokenContract.SKIPShopBalances(walletAddress);
            const ownedNFTs = await NFTContract.walletOfOwner(walletAddress);
            const ownedNFTsAsNumbers = ownedNFTs.map(bn => bn.toNumber());

            console.log('ownedNFTsAsNumbers:', ownedNFTsAsNumbers);
            console.log('nftIds:', nftIds);
            // Filter out NaN values from nftIds
            const validNFTIds = nftIds.filter(id => !isNaN(id));

            // Check if the user owns all the valid NFTs
            const ownsAllNFTs = validNFTIds.every(id => ownedNFTsAsNumbers.includes(id));

            if (!ownsAllNFTs) {
                registerBot.sendMessage(chatId, "❌ You don't own all the provided NFT IDs.");
                userOngoingTransactions[username] = false;
                return;
            }


            const retrievedDead = await getAsync("dead");

            if (retrievedDead) {
                const parsedDead = JSON.parse(retrievedDead);
            
                if (Array.isArray(parsedDead)) {
                    let isAnyNFTDead = false;
            
                    for (const entry of parsedDead) {
                        if (Array.isArray(entry) && entry.length === 2 && nftIds.includes(entry[0]) && entry[1] === true) {
                            const nftID = entry[0];
                            console.log(`NFT with ID ${nftID} is marked as dead.`);
                            isAnyNFTDead = true;
                        }
                    }
            
                    if (!isAnyNFTDead) {
                        console.log("No NFTs in nftIds are marked as dead in Redis.");
                    }
                } else {
                    console.log("Invalid or empty dead array.");
                }
            } else {
                console.log("No dead data found in Redis.");
            }
            
           
            
            let hasSufficientBalance = false;

            switch (potionName.toLowerCase()) {
                case 'xtra':
                    hasSufficientBalance = xtraBalance >= nftIds.length;
                    break;
                case 'boost':
                    hasSufficientBalance = boostBalance >= nftIds.length;
                    break;
                case 'v':
                    hasSufficientBalance = vBalance >= nftIds.length;
                    break;
                case 'skip':
                    hasSufficientBalance = skipBalance >= nftIds.length;
                    break;
                default:
                    registerBot.sendMessage(msg.chat.id, "❌ Unknown potion name.");
                    userOngoingTransactions[username] = false;
                    return;
            }
    
            if (!hasSufficientBalance) {
                registerBot.sendMessage(msg.chat.id, `❌ Insufficient ${potionName.toUpperCase()} balance for the provided NFT IDs.`);
                userOngoingTransactions[username] = false;
                return;
            }

            const potionFunctionName = `NFT${potionName.toUpperCase()}Balance`;

            console.log(`Using function name: ${potionFunctionName}`);

            const nftsWithPotionPromises = await Promise.all(nftIds.map(async id => {
                const hasPotion = await TokenContract[potionFunctionName](id);
                console.log(`NFT ID: ${id}, hasPotion: ${hasPotion}`);
                return {
                    id: id,
                    hasPotion: hasPotion
                };
            }));

            const nftsWithPotion = nftsWithPotionPromises.filter(nft => nft.hasPotion).map(nft => nft.id);

            console.log(`NFTs with the potion applied: ${nftsWithPotion.join(', ')}`);

            if (nftsWithPotion.length) { 
                registerBot.sendMessage(chatId, `❌ The following NFT IDs already have the specified potion applied: ${nftsWithPotion.join(', ')}.`);
                userOngoingTransactions[username] = false;
                return;
            }

            let confirmMessage = '';

            confirmMessage += "🔮 *Potion Enchantment Portal*\n\n";
            confirmMessage += "Valiant traveler of the digital realm! 🔭\n\n";
            confirmMessage += `A potion of power awaits – the **${potionName.toLocaleUpperCase()}**! Ready to amplify the essence of your NFTs?\n\n`;
            confirmMessage += `✨ Selected NFTs: ${nftIds.join(', ')}\n\n`;
            confirmMessage += `Choose your fate:\n`;
            confirmMessage += "🟢 To wield this potion's magic, tap \"Confirm\".\n";
            confirmMessage += "🔴 To retract and ponder, tap \"Decline\".\n\n";
            confirmMessage += "_May the ethereal winds guide your choice and your NFTs ascend to new horizons!_ 🌠";
            
            const transactionId = `${chatId}_${Date.now()}`;
            ongoingTransactions[transactionId] = {
                username: username,
                status: 'pending',
                potionName: potionName,
                nftIds: nftIds,
                shopOwnerAddress: shopOwnerAddress, 
                transactionType: 'applyPotion',
            };
    
            const keyboard = {
                inline_keyboard: [
                    [{ text: 'Confirm', callback_data: `yes_${transactionId}` }],
                    [{ text: 'Decline', callback_data: `no_${transactionId}` }]
                ]
            };
    
            registerBot.sendMessage(chatId, confirmMessage, { parse_mode: 'Markdown', reply_markup: keyboard });
    
        } catch (error) {
            console.error('Error in /apply handler:', error);
            registerBot.sendMessage(chatId, "An error occurred while processing your request. Please try again later.");
        }
    });

    registerBot.onText(/\/deposit/i, (msg) => {
        const chatId = msg.chat.id;

        const message = 'Please use the website [click here](http://www.gnomescollective.xyz)';
        registerBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    registerBot.onText(/\/status/i, async (msg) => {
        const username = msg.from.username;
        if (!username) {
            console.error("Username is not defined.");
            registerBot.sendMessage(msg.chat.id, `❌ You haven't set up a Telegram Username.`);
            return;
        }
        console.log('Fetching NFT status for username:', username);

        try {
            const walletAddress = await client.getAsync(username);
            if (!walletAddress) {
                registerBot.sendMessage(msg.chat.id, `No wallet registered for @${username}`);
                return;
            }
            const NFTsOwned = await NFTContract.walletOfOwner(walletAddress);
            
            if (NFTsOwned.length === 0) {
                registerBot.sendMessage(msg.chat.id, "You don't own any NFTs.");
                return;
            }

            let progressMessage = await registerBot.sendMessage(msg.chat.id, "Fetching NFT status... 0%");

            let completedCount = 0;

            const fetchDetails = async (NFTId, totalNFTs) => {
                const retrievedDead = await getAsync("dead"); 
                let isDead = false; 
            
                if (retrievedDead) {
                    const parsedDead = JSON.parse(retrievedDead);
            
                    if (Array.isArray(parsedDead)) {
                        isDead = parsedDead.some(entry => Array.isArray(entry) && entry.length === 2 && entry[0] === NFTId && entry[1] === true);
                    }
                }

                const [boostBalance, vBalance, xtraBalance, skipBalance] = await Promise.all([
                    TokenContract.NFTBOOSTBalance(NFTId),
                    TokenContract.NFTVBalance(NFTId),
                    TokenContract.NFTXTRABalance(NFTId),
                    TokenContract.NFTSKIPBalance(NFTId)
                ]);
            
                let response = `NFT ID: ${NFTId} - ${isDead ? "Dead" : "Alive"}\n`;
                if (boostBalance) response += `BOOST ✅\n`;
                if (vBalance) response += `V ✅\n`;
                if (xtraBalance) response += `XTRA ✅\n`;
                if (skipBalance) response += `SKIP ✅\n`;
                response += '\n';
            
                completedCount++;
                const progress = Math.round((completedCount / totalNFTs) * 100);
                await registerBot.editMessageText(`Fetching NFT status... ${progress}%`, {
                    chat_id: msg.chat.id,
                    message_id: progressMessage.message_id
                });
            
                return response;
            };
            
            
            const results = await Promise.all(NFTsOwned.map(nft => {
                const NFTId = nft.toNumber();
                return fetchDetails(NFTId, NFTsOwned.length);
            }));

            const responseMessage = `🖼️ *Your NFTs and Their Status & Active Potions:* 🖼️\n\n` + results.join('');
            registerBot.sendMessage(msg.chat.id, responseMessage, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error fetching NFT status:', error);
            registerBot.sendMessage(msg.chat.id, "🚫 Oops! We encountered an issue fetching your NFT status. Please give it another try in a moment.");
        }
    });

    registerBot.onText(/\/setRef (\w+)/i, async (msg, match) => {
        const username = msg.from.username;
        if (!username) {
            console.error("Username is not defined.");
            registerBot.sendMessage(msg.chat.id, `❌ You haven't set up a Telegram Username.`);
            return;
        }
    
        const referralCode = match[1].toLowerCase();
    
        const isValid = validateReferralCode(referralCode);
        if (!isValid) {
            let guidelines = "Your referral code should:\n";
            guidelines += "- Be between 3 and 16 characters.\n";
            guidelines += "- Only contain alphanumeric characters, underscore (_), dash (-), or dot (.).\n";
            guidelines += "- Not consist of only repetitive characters (e.g., AAA or BBB).\n";
            guidelines += "- Reflect your Display Name or Social Media handle.\n";
        
            registerBot.sendMessage(msg.chat.id, "❌ Invalid referral code. Please follow the guidelines:\n\n" + guidelines);
            return;
        }

        try {
            const existingUsername = await getAsync(`referral:${referralCode}`);
            if (existingUsername && existingUsername !== username) {
                registerBot.sendMessage(msg.chat.id, `🚫 The referral code ${referralCode} is already in use. Please choose a different one.`);
                return;
            }
        } catch (error) {
            console.error('Error checking existing referral code:', error);
            registerBot.sendMessage(msg.chat.id, "🚫 Oops! There was an error. Please try again in a moment.");
            return;
        }

        try {
            const oldReferralCode = await getAsync(`referral:${username}`);
            if (oldReferralCode) {
                await delAsync(`referral:${oldReferralCode}`);
            }
        } catch (error) {
            console.error('Error deleting old referral code:', error);
        }

        try {
            await setAsync(`referral:${referralCode}`, username);
            await setAsync(`referral:${username}`, referralCode);
            await setAsync(`chatId:${username}`, msg.chat.id);
            registerBot.sendMessage(msg.chat.id, `✨ Your referral code has been set to: ${referralCode}`);
        } catch (error) {
            console.error('Error setting referral code:', error);
            registerBot.sendMessage(msg.chat.id, "🚫 Oops! There was an error setting your referral code. Please try again in a moment.");
        }
    });

    registerBot.onText(/\/addRef (\w+)/i, async (msg, match) => {
        const username = msg.from.username;
        if (!username) {
            console.error("Username is not defined.");
            registerBot.sendMessage(msg.chat.id, `❌ You haven't set up a Telegram Username.`);
            return;
        }
    
        const referredByCode = match[1].toLowerCase();
    
        try {
            const referrer = await getAsync(`referral:${referredByCode}`);
            if (!referrer) {
                registerBot.sendMessage(msg.chat.id, "❌ The referral code you provided does not belong to any user.");
                return;
            }
            if (referrer == username) {
                registerBot.sendMessage(msg.chat.id, "❌ You cannot refer yourself.");
                return;
            }
    
            await setAsync(`referredBy:${username}`, referrer);
            registerBot.sendMessage(msg.chat.id, `✨ You have been referred by: @${referrer}`);
        } catch (error) {
            console.error('Error setting referrer:', error);
            registerBot.sendMessage(msg.chat.id, "🚫 Oops! There was an error setting your referrer. Please try again in a moment.");
        }
    });
    
    registerBot.on('callback_query', async (callbackQuery) => {
        const data = callbackQuery.data;
        const chatId = callbackQuery.message.chat.id;
        
        try {
            const parts = data.split('_');
            const action = parts[0];
            const transactionId = parts.slice(1).join('_'); 
            const transaction = ongoingTransactions[transactionId];
            const username = transaction.username;
            const safeUsername = username.replace(/_/g, '\\_');
            
            console.log('Callback data:', data);
            console.log('Transaction ID:', transactionId);
            console.log('ongoingTransactions:', ongoingTransactions);
            console.log('action:', action)
    
            if (!transaction) {
                console.log(`Transaction ${transactionId} not found.`);
                return;
            }
        if(transaction.transactionType === 'buyPotion'){
            if (action === 'yes') {
                    if (transaction.status === 'declined') {
                        registerBot.sendMessage(chatId, "🔮 *Mystic Alert!* 🔮\n\nAh, traveler! The ethers whisper that this transaction has already been declined. Perhaps fate has other plans?", { parse_mode: 'Markdown' });
                    } else if (transaction.status === 'confirmed') {
                        registerBot.sendMessage(chatId, "🌟 *Celestial Confirmation!* 🌟\n\nAdventurer, the stars align and the cosmos has spoken: This transaction stands confirmed in the annals of time. Journey forth!", { parse_mode: 'Markdown' });
                    } else {
                        console.log(`User clicked "Confirm" for transaction ${transactionId}`);
                        try {
                            transaction.status = 'confirmed';
                            const referrer = await getAsync(`referredBy:${transaction.username}`);
                            console.log("referrer Name:", referrer);
                            let count = 0;
                            
                            if (referrer) {
                                count = parseInt(await getAsync(`userPotionCount:${transaction.username}`) || "0") + transaction.amount;
                            }

                            let extraPotions = Math.floor(count / 10); 
                            count -= (10 * extraPotions);
                            
                            if (referrer) {
                                referrerAddress = await getAsync(`${referrer}`);
                                const potions = [];
                                for (let i = 0; i < extraPotions; i++) {
                                    const potion = getRandomPotion();
                                    potions.push(potion);
                                }
                                
                                const gasBufferPercentage = 20; 

                                try {
                                    const estimatedGas = await TokenContractWithSigner.estimateGas.buyPotion(
                                        [transaction.potionName, ...potions],
                                        [transaction.amount, ...Array(extraPotions).fill(1)],
                                        transaction.shopOwnerAddress,
                                        extraPotions
                                    );
                                
                                    const gasLimit = Math.ceil(estimatedGas * (1 + gasBufferPercentage / 100));
                                
                                    tx = await TokenContractWithSigner.buyPotion(
                                        [transaction.potionName, ...potions],
                                        [transaction.amount, ...Array(extraPotions).fill(1)],
                                        transaction.shopOwnerAddress,
                                        extraPotions,
                                        { gasLimit }
                                    );
                                
                                    if (extraPotions !== 0) {
                                        try {
                                            const rtxGas = await TokenContractWithSigner.estimateGas.buyPotion(
                                                potions,
                                                Array(extraPotions).fill(1),
                                                referrerAddress,
                                                extraPotions
                                            );
                                
                                            const rtxGasLimit = Math.ceil(rtxGas * (1 + gasBufferPercentage / 100));
                                
                                            rtx = await TokenContractWithSigner.buyPotion(
                                                potions,
                                                Array(extraPotions).fill(1),
                                                referrerAddress,
                                                extraPotions,
                                                { gasLimit: rtxGasLimit }
                                            );
                                        } catch (error) {
                                            console.error("Error while executing the 'rtx' transaction:", error);
                                            throw error; 
                                        }
                                    }
                                } catch (error) {
                                    console.error("Error while executing the 'tx' transaction:", error);
                                    return;
                                }
                            
                                const potionWord = potions.length === 1 ? 'potion' : 'potions';
                                const potionList = potions.length === 2 ? potions.join(' and ') : potions.join(', ');
                                const hasOrHave = potions.length === 1 ? 'has' : 'have';
                                const safeTXUsername = transaction.username.replace(/_/g, '\\_');
                                if(extraPotions>0){
                                registerBot.sendMessage(
                                    chatId,
                                    `🔮 *Potion Blessing Alert!* 🔮\n\nBravo, kindred spirit! Your voyage through the referral realms has been rewarded. Behold, ${extraPotions} extra ${potionWord}: ${potionList} ${hasOrHave} chosen you! 🌌✨`,
                                    { parse_mode: 'Markdown' }
                                );
                                if(rtx){
                                const rtxEtherscanLink = `https://goerli.etherscan.io/tx/${rtx.hash}`;
                                registerBot.sendMessage(
                                    await getAsync(`chatId:${referrer}`),
                                    `✨ *Alliance Triumph!* ✨\n\nHail, noble ally! Thanks to our referral bond and @${safeTXUsername}'s commendable endeavors, ${potions.length === 1 ? ' a' : ''} special ${potionWord} ${hasOrHave} chosen you: ${potionList}! May our alliance continue to shine brilliantly! 🔮 Behold the magical scroll of details: \n\n 🔍 [View on Etherscan](${rtxEtherscanLink}). `,
                                    { parse_mode: 'Markdown' }
                                );
                                }
                                }
                            } else {
                                try {
                                    tx = await TokenContractWithSigner.buyPotion([transaction.potionName], [transaction.amount], transaction.shopOwnerAddress, '0');
                                } catch (error) {
                                    console.error("Error executing the transaction for main user:", error);
                                }
                            }
                            
                            const etherscanLink = `https://goerli.etherscan.io/tx/${tx.hash}`;
                            registerBot.sendMessage(chatId, `✨ *Potion Procurement Ritual Initiated!* ✨\n\nYour potion is brewing in the cauldron of transactions. Behold the magical scroll of details: \n\n 🔍 [View on Etherscan](${etherscanLink}).`, { parse_mode: 'Markdown' });
                            await tx.wait();
                            registerBot.sendMessage(chatId, `🪄 *Potion Acquired!* 🪄\n\nYour incantation has borne fruit! The potion is yours, oh seeker of mystic arts. 🌟`, { parse_mode: 'Markdown' });

                            const potionEmojis = generatePotionEmojis(transaction.amount);
                            let response = '';

                            response += '🔮 *Potion BUY Alert!* 🔮\n';
                            response += '⚡ A mystic transaction has been conjured! ⚡\n\n';
                            response += ` ${potionEmojis}\n\n`;
                            response += `🧪 *Potion:* __${transaction.potionName}__\n`;
                            response += `🪄 *Conjurer:* @${safeUsername}__\n`;
                            response += `📊 *Volume:* __${transaction.amount}x__\n`;
                            response += `💸 *Gold Spent:* __${transaction.ethAmount} ETH__\n`;
                            response += `🔥 *Burned Offerings:* __${transaction.hgmsAmount}K $HGMS__\n\n`;
                            response += `🔍 [View on Etherscan](${etherscanLink})\n\n`;
                            response += '🌀 May the ethers keep swirling and the potions keep twirling! 🌀';
                            
                            sendViaMainBot(
                                '-1001672659906', 
                                response,
                                `./src/${transaction.potionName}.gif`,
                                'Markdown'
                            );

                            await setAsync(`userPotionCount:${transaction.username}`, count.toString());
                            delete userOngoingTransactions[username];
                        } catch (error) {
                            console.error('Error while calling buyPotion:', error);
                            registerBot.sendMessage(chatId, "🌟 *Mystic Mishap!* 🌟\n\nAlas, a celestial hiccup has occurred during this transaction. Fear not, for the arcane forces are ever-shifting. Please, try once more when the stars align. 🪄🔮", { parse_mode: 'Markdown' });
                            delete userOngoingTransactions[username];
                        }
                    }
            } else if (action === 'no') {
                    if (transaction.status === 'declined') {
                        registerBot.sendMessage(chatId, "🌙 *Celestial Reminder* 🌙\n\nWorry not, dear traveler! The ethers whisper that this transaction has already been declined. Let your path be guided by the stars towards other cosmic adventures. 🌙", { parse_mode: 'Markdown' });
                    } else if (transaction.status === 'confirmed') {
                        registerBot.sendMessage(chatId, "🌟 *Celestial Confirmation!* 🌟\n\nBehold, traveler! The astral records unveil that this transaction stands confirmed, etched in the cosmos. Journey onward with celestial blessings! 🌟", { parse_mode: 'Markdown' });
                    } else {
                        ongoingTransactions[transactionId].status = 'declined';
                        console.log(`User clicked "Decline" for transaction ${transactionId}`);
                        registerBot.sendMessage(chatId, "🪄 *Magical Intervention* 🪄\n\nMystical energies have interceded, and this transaction has been enchanted with the mark of cancellation. Fear not, for new adventures await on the enchanted path. 🌠", { parse_mode: 'Markdown' });
                        delete userOngoingTransactions[username];
                    }
            }
        }          
        if (transaction.transactionType === 'applyPotion') {
            console.log(`Processing transaction of type: ${transaction.transactionType}`);
        
            if (action === 'yes') {
                console.log(`Action received: ${action}`);
                if (transaction.status === 'declined') {
                    registerBot.sendMessage(chatId, "🪄 *Magical Insight* 🪄\n\nThis potion has already been declined in the scrolls of fate. Seek new enchantments on your journey.", { parse_mode: 'Markdown' });
                } else if (transaction.status === 'confirmed') {
                    registerBot.sendMessage(chatId, "🌟 *Celestial Confirmation* 🌟\n\nTraveler, the stars reveal that this potion was confirmed long ago. Your path is already illuminated.", { parse_mode: 'Markdown' });
                } else {
                    console.log(`User clicked "Confirm" for transaction ${transactionId}`);
                    try {
                        ongoingTransactions[transactionId].status = 'confirmed';
                        
                        const estimatedGas = await TokenContractWithSigner.estimateGas.applyPotion(
                            transaction.shopOwnerAddress,
                            transaction.nftIds,
                            transaction.potionName.toUpperCase()
                        );
                    
                        const gasBufferPercentage = 20; 
                        const gasLimit = Math.ceil(estimatedGas * (1 + gasBufferPercentage / 100));
                    
                        const tx = await TokenContractWithSigner.applyPotion(
                            transaction.shopOwnerAddress,
                            transaction.nftIds,
                            transaction.potionName.toUpperCase(),
                            { gasLimit }
                        );
                    
                        console.log(`Received transaction hash: ${tx.hash}`);
                        const etherscanLink = `https://goerli.etherscan.io/tx/${tx.hash}`;
                        console.log(`Etherscan Link: ${etherscanLink}`);
                    
                        registerBot.sendMessage(chatId, `✨ *Potion Procurement Ritual Initiated!* ✨\n\nYour potion is brewing in the cauldron of transactions. Behold the magical scroll of details: \n\n 🔍 [View on Etherscan](${etherscanLink}).`, { parse_mode: 'Markdown' });
                        await tx.wait();
                        registerBot.sendMessage(chatId, `🪄 *Potion Applied!* 🪄\n\nThe mystic incantation has taken effect! The potion has been successfully applied to your enchanting artifacts. 🌟`, { parse_mode: 'Markdown' });
                        delete userOngoingTransactions[username];
                    } catch (error) {
                        console.error('Error while calling applyPotion:', error);
                        registerBot.sendMessage(chatId, "🌟 *Mystical Conundrum* 🌟\n\nAlas, the arcane currents have stirred in an unexpected fashion, causing a momentary bewilderment. Seek your path anew when the celestial tides are more favorable. 🪄🔮", { parse_mode: 'Markdown' });
                        delete userOngoingTransactions[username];
                    }
                }
            } else if (action === 'no') {
                console.log(`Action received: ${action}`);
                if (transaction.status === 'declined') {
                    registerBot.sendMessage(chatId, "🪄 *Magical Insight* 🪄\n\nThis potion has already been declined in the scrolls of fate. Seek new enchantments on your journey.", { parse_mode: 'Markdown' });
                } else if (transaction.status === 'confirmed') {
                    registerBot.sendMessage(chatId, "🌟 *Celestial Confirmation* 🌟\n\nTraveler, the stars reveal that this potion was confirmed long ago. Your path is already illuminated.", { parse_mode: 'Markdown' });
                } else {
                    ongoingTransactions[transactionId].status = 'declined';
                    console.log(`User clicked "Decline" for transaction ${transactionId}`);
                    registerBot.sendMessage(chatId, "🪄 *Magical Intervention* 🪄\n\nMystical energies have interceded, and this transaction has been enchanted with the mark of cancellation. Fear not, for new adventures await on the enchanted path. 🌟", { parse_mode: 'Markdown' });
                    delete userOngoingTransactions[username];
                }
            }
        }
         
            } catch (error) {
                console.error('Error in callback query handler:', error);
                registerBot.sendMessage(chatId, "🌟 *Mystical Conundrum* 🌟\n\nAlas, the arcane currents have stirred in an unexpected fashion, causing a momentary bewilderment. Seek your path anew when the celestial tides are more favorable. 🪄", { parse_mode: 'Markdown' });
            }
    });
}

function isValidEthereumAddress(address) {

    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(address)) {
        return false;
    }

    try {
        const checksumAddress = ethers.utils.getAddress(address);
        return checksumAddress === address;
    } catch (error) {
        return false; 
    }
}

function shortenWalletAddress(walletAddress) {
    const firstPart = walletAddress.substring(0, 6);
    const lastPart = walletAddress.substring(walletAddress.length - 4);
    return `${firstPart}...${lastPart}`;
}

function validateReferralCode(code) {
    if (code.length < 3 || code.length > 16) {
        return false;
    }

    const validChars = /^[a-zA-Z0-9_.-]*$/;
    if (!validChars.test(code)) {
        return false;
    }

    const repetitiveChars = /^(.)\1+$/;
    if (repetitiveChars.test(code)) {
        return false;
    }

    return true;
}

function getRandomPotion() {
    const potions = ['BOOST', 'V', 'SKIP', 'XTRA'];
    const randomIndex = Math.floor(Math.random() * potions.length);
    return potions[randomIndex];
}

function generatePotionEmojis(amount) {
    return '🧪'.repeat(amount);
}

async function sendViaMainBot(chatId, text, animationPath = null, parseMode = null) {
    try {
        if (animationPath) {
            const formData = new FormData();
            formData.append('chat_id', chatId);
            formData.append('animation', fs.createReadStream(animationPath));
            formData.append('caption', text);
            formData.append('parse_mode', parseMode || 'Markdown');

            const response = await axios.post(TELEGRAM_BASE_URL + 'sendAnimation', formData, {
                headers: {
                    ...formData.getHeaders(),
                },
            });
            console.log("Animation (GIF) with caption sent:", response.data);
        } else {
            const response = await axios.post(TELEGRAM_BASE_URL + 'sendMessage', {
                chat_id: chatId,
                text: text,
                parse_mode: parseMode || 'Markdown',
            });
            console.log("Message sent:", response.data);
        }
    } catch (error) {
        console.error("Failed to send message:", error);
    }
}

function chunkArray(arr, chunkSize) {
    const result = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        result.push(arr.slice(i, i + chunkSize));
    }
    return result;
}


startBot();
