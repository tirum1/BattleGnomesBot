console.log("Starting the script...");
require('colors');
require('dotenv').config({ path: './.env' });
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { ethers } = require('ethers');
const bluebird = require('bluebird');
const redis = require('redis');
const axios = require('axios');
const FormData = require('form-data');
const csv = require('csv-parser');
const { Console } = require('console');
const token = process.env.MAIN_BOT_TOKEN;
const TELEGRAM_BASE_URL = `https://api.telegram.org/bot${token}/`;
const CHANNEL_ID = '-1001672659906';
const MainRedisUrl = process.env.MAIN_REDIS_URL;
const MYMaintenance = process.env.MYMAINTENANCE;
const hungerGamesAddress = '0xfaAEFD5D384113d4b87D5eE41c5DD4c28329697f';
const GnomesCollectiveAddress = "0xF447E3a627F924EA8b064724001C484fEB39F6f9";
const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);
const MYMaintenanceWallet = new ethers.Wallet(MYMaintenance, provider);
const TokenABI = JSON.parse(fs.readFileSync('./ABI/HungerGames.json', 'utf8')).abi;
const NFTABI = JSON.parse(fs.readFileSync('./ABI/GnomesCollective.json', 'utf8')).abi;
const TokenContract = new ethers.Contract(hungerGamesAddress, TokenABI, provider);
const TokenContractWithSigner = TokenContract.connect(MYMaintenanceWallet);
const NFTContract = new ethers.Contract(GnomesCollectiveAddress, NFTABI, provider);

const client = redis.createClient({ 
    url: MainRedisUrl,
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

let roundWinners = []; 
let _decimals = 18;
let aliveByID = [];
let time = 0;
let activeRound = false;
const maxAmountOfWinners = 5;
const roundDuration = 5;
let queue = new Map();
let alive = new Map();
let dead = new Map();
let roundsCount = 0;
let newGame = true;
let HungerGamesBegin = false;
let queuecounter = 0;
let StatsSize = 5;
let previousProgressPercentage = -1; 

const BattleResult = {
    Won: "Won",
    Lost: "Lost",
    Skipped: "Skipped"
};
const stats = [[0, 0, 0, 0, 0]];
const csvData = fs.readFileSync('stats.csv', 'utf8');
const rows = csvData.split('\n');

rows.forEach((row) => {
    const trimmedRow = row.trim();
    if (trimmedRow !== '') {
        const values = trimmedRow.split(',').map(Number);

        stats.push(values);
    }
});

startTimer();

setInterval(async () => {
    if(newGame && hasTimerPassed()){
    startHungerGames();
    }
    await setAsync("time", time);
    await setAsync("newGame", newGame);
    await setAsync("hasTimerPassed", hasTimerPassed());
    await setAsync("HungerGamesBegin", HungerGamesBegin);
    await setAsync("roundsCount", roundsCount);
    await setAsync("dead", JSON.stringify(Array.from(dead.entries())));
    await setAsync("queue", JSON.stringify(Array.from(queue.entries())));
    await setAsync("aliveByID", JSON.stringify(aliveByID));
    await setAsync("roundWinners", JSON.stringify(roundWinners));
    await setAsync("queuecounter", queuecounter.toString());
    if(!activeRound){
    lookForOpponent();
    }
}, 500);


function startTimer() {
    HungerGamesBegin = true;
    time = Math.floor(Date.now() / 1000); 
}
async function startHungerGames () {
    queuecounter = await NFTContract.getMintAmount();
    for (let i=1;i<=queuecounter;i++){
    queue.set(i, true);
    aliveByID.push(i);
    }
    newGame = false;
}
async function lookForOpponent (){

    if(queuecounter <= 2) return;
    if(!hasTimerPassed()) return;
    activeRound = true;
    console.log("started");
    aliveByID = [];
    let firstOpponent = 0;
    for (let i = 1; i <= queuecounter; i++) {
        if (queue.get(i) && !alive.get(i) && !dead.get(i)) {
            if (firstOpponent == 0) {
                firstOpponent = i;
                console.log(`First: ${firstOpponent}`);
            } else {
                console.log("lookign for second opponent");
                const owneroffirst = await NFTContract.ownerOf(firstOpponent);
                let secondOpponent = await getRandomOpponent(i, owneroffirst);
                console.log(`secondopponent: ${secondOpponent}`);
                if(secondOpponent == firstOpponent) {
                    secondOpponent = 0;
                }

                if (secondOpponent != 0) {
                    await enterBattle(firstOpponent, secondOpponent);
                    i = firstOpponent;
                    firstOpponent = 0;
                } else {
                    let nextAvailableOpponent = getNextAvailable(i);
                    console.log(`nextAvailableOpponent: ${nextAvailableOpponent}`);
                    if (nextAvailableOpponent === firstOpponent) {
                        nextAvailableOpponent = 0;
                    }                    

                    if (nextAvailableOpponent != 0) {
                        await enterBattle(firstOpponent, nextAvailableOpponent);
                        i = firstOpponent;
                        firstOpponent = 0;
                    }
                }

                const progressPercentage = Math.round((i / queuecounter) * 100);

                if (progressPercentage !== previousProgressPercentage) {
                    sendMessageViaAxios(CHANNEL_ID, `Round Progress: ${progressPercentage.toFixed(2)}%`);
                    previousProgressPercentage = progressPercentage;
                }

            }
        }
    }

    let nonDeads = getAmountOfNonDead();
    if (nonDeads <= maxAmountOfWinners) {
        await storeRoundWinners();
        payoutWinners(nonDeads);
        reviveAll();
        resetQueue();
        roundsCount = 0;
    } 

    roundsCount++;
    resetTimer();
    resetAlive();
    activeRound = false;
    console.log("Look For Opponend PASS");
}
function hasTimerPassed() {
    if (newGame) {
        return Math.floor(Date.now() / 1000) >= (time + roundDuration * 6); 
    } else if (HungerGamesBegin) {
        return Math.floor(Date.now() / 1000) >= (time + roundDuration);
    } else {
        return false;
    }
}


async function getRandomOpponent(startIndex, firstOpponentOwner) {
    const aliveLength = aliveByID.length;
    const lengthOrCounter = aliveLength === 0 ? queuecounter : aliveLength;
    const maxAttempts = 4;

    console.log('Finding a random opponent...');
    console.log(`Alive Length: ${aliveLength}`);
    console.log(`Length Or Counter: ${lengthOrCounter}`);

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const inputForHash = ethers.utils.solidityKeccak256(['uint', 'uint'], [currentTimestamp, startIndex]);
        const keccak256HashNum = ethers.BigNumber.from(inputForHash);
        const randomIndex = keccak256HashNum.mod(lengthOrCounter).add(1);
        const randomID = aliveLength === 0 ? randomIndex.toNumber() : aliveByID[randomIndex.toNumber()];

        console.log(`Attempt ${attempts + 1}: Random Index: ${randomIndex.toNumber()}, Random ID: ${randomID}`);

        if (queue.get(randomID) && !alive.get(randomID) && !dead.get(randomID)) {
            if (await NFTContract.ownerOf(randomID) !== firstOpponentOwner) {
                console.log(`Found a valid opponent: Random ID ${randomID}`);
                return randomID;
            }
        }
    }

    console.log('No valid opponent found.');
    return 0;
}

function getNextAvailable(startIndex) {
        for (let i = startIndex; i <= queuecounter; i++) {
            if (queue.get(i) && !alive.get(i) && !dead.get(i)) {
                return i;
            }
        }
        return 0;  
}
async function fillLastBattle(First, Second, result, firstNFTData, secondNFTData) {
    const firstBattleResult = {
        opponentId: Second,
        result,
        ...firstNFTData,
    };

    const secondBattleResult = {
        opponentId: First,
        result: getOpponentResult(result),
        ...secondNFTData,
    };

    const firstBattleResultJson = JSON.stringify(firstBattleResult);
    const secondBattleResultJson = JSON.stringify(secondBattleResult);

    await setAsync(`${First}BattleResult`, firstBattleResultJson);
    await setAsync(`${Second}BattleResult`, secondBattleResultJson);

}
function getOpponentResult(result) {
    switch (result) {
        case BattleResult.Won:
            return BattleResult.Lost;
        case BattleResult.Lost:
            return BattleResult.Won;
        default:
            return BattleResult.Skipped;
    }
}
async function enterBattle(First, Second) {
    console.log(`${First} entered the battle.`);
    console.log(`against ${Second}.`);    
    const isFirstAlive = !dead.get(First);
    const isSecondAlive = !dead.get(Second);
    const firstNFTData = await collectNFTData(First);
    const secondNFTData = await collectNFTData(Second);

    if (!(isFirstAlive && isSecondAlive)) {
        throw new Error("Both NFTs must be alive to battle");
    }
    console.log("stats[First]: ", stats[First]);
    console.log("stats[Second]: ", stats[Second]);
    if (stats[First].length !== StatsSize || stats[Second].length !== StatsSize) {
        throw new Error("Invalid stats for one of the NFTs");
    }

    if (shouldSkipBattle(firstNFTData, secondNFTData)) {
        fillLastBattle(First, Second, BattleResult.Skipped, firstNFTData, secondNFTData);
        removePotions(First, Second);
        alive.set(First, true);
        alive.set(Second, true);
        return;
    }

    const originalStatsFirst = [...stats[First]];
    const originalStatsSecond = [...stats[Second]];

    if (hasBOOSTBalance(firstNFTData)) {
        setRandomStats(First);
    }

    if (hasBOOSTBalance(secondNFTData)) {
        setRandomStats(Second);
    }

    if (hasVBalance(firstNFTData)) {
        setAllStatsTo10(First);
    }

    if (hasVBalance(secondNFTData)) {
        setAllStatsTo10(Second);
    }

    const P1 = calculateTotalPower(stats[First]);
    const P2 = calculateTotalPower(stats[Second]);

    if (P1 + P2 <= 0) {
        throw new Error("Total power must be greater than zero");
    }

    const randomFactor = calculateRandomFactor();
    const isFirstWinner = determineWinner(P1, P2, randomFactor);

    await updateNFTStatus(First, Second, isFirstWinner, firstNFTData, secondNFTData);
    restoreOriginalStats(First, Second, originalStatsFirst, originalStatsSecond);
    await removePotions(First, Second);
}
async function collectNFTData(tokenId) {
    console.log("collecting data for: ", tokenId);
    return {
        XTRA: await TokenContract.getNFTXTRABalance(tokenId),
        BOOST: await TokenContract.getNFTBOOSTBalance(tokenId),
        V: await TokenContract.getNFTVBalance(tokenId),
        SKIP: await TokenContract.getNFTSKIPBalance(tokenId),
    };
}
function shouldSkipBattle(firstNFTData, secondNFTData) {
    return (firstNFTData.SKIP && !secondNFTData.V) || (secondNFTData.SKIP && !firstNFTData.V);
}
function hasBOOSTBalance(nftData) {
    return nftData.BOOST;
}
function hasVBalance(nftData) {
    return nftData.V;
}
function setRandomStats(tokenId) {
    const stat1 = Math.floor(Math.random() * 5);
    const stat2 = (stat1 + 1 + Math.floor(Math.random() * 4)) % 5;
    stats[tokenId][stat1] = 10;
    stats[tokenId][stat2] = 10;
}
function setAllStatsTo10(tokenId) {
    for (let i = 0; i < 5; i++) {
        stats[tokenId][i] = 10;
    }
}
function calculateTotalPower(statsArray) {
    return statsArray.reduce((acc, value) => acc + value, 0);
}
function calculateRandomFactor() {
    return (Date.now() + Math.floor(Math.random() * 1000)) % 100;
}
function determineWinner(P1, P2, randomFactor) {
    if (P1 > P2) {
        return randomFactor < 70;
    } else if (P1 < P2) {
        return randomFactor >= 30;
    } else {
        return randomFactor < 50;
    }
}
async function updateNFTStatus(First, Second, isFirstWinner, firstNFTData, secondNFTData) {
    const loserId = isFirstWinner ? Second : First;
    const winnerId = isFirstWinner ? First : Second;
    const isLoserDead = shouldSetNFTDead(loserId, First, firstNFTData, secondNFTData);
    const result = isFirstWinner ? BattleResult.Won : BattleResult.Lost;
    fillLastBattle(First, Second, result, firstNFTData, secondNFTData);

    if (isFirstWinner) {
        const battleWinsOfFirst = await getAsync(`battleWinsOf${First}`);
        const battleLossOfSecond = await getAsync(`battleLossOf${Second}`);
        
        await setAsync(`battleWinsOf${First}`, parseInt(battleWinsOfFirst || 0) + 1);
        await setAsync(`battleLossOf${Second}`, parseInt(battleLossOfSecond || 0) + 1);
    } else {
        const battleWinsOfSecond = await getAsync(`battleWinsOf${Second}`);
        const battleLossOfFirst = await getAsync(`battleLossOf${First}`);
        
        await setAsync(`battleWinsOf${Second}`, parseInt(battleWinsOfSecond || 0) + 1);
        await setAsync(`battleLossOf${First}`, parseInt(battleLossOfFirst || 0) + 1);
    }
    if(isLoserDead){
    dead.set(loserId, true);
    alive.set(winnerId, true)
    } else{
        alive.set(loserId, true)
        alive.set(winnerId, true)
    }
    console.log(`${winnerId} won the battle against`, loserId);
}
function shouldSetNFTDead(loserId, First, firstNFTData, secondNFTData) {
    const loserXTRA = loserId === First ? firstNFTData.XTRA : secondNFTData.XTRA;
    return !loserXTRA;
}
function restoreOriginalStats(First, Second, originalStatsFirst, originalStatsSecond) {
    stats[First] = originalStatsFirst;
    stats[Second] = originalStatsSecond;
}
async function removePotions(First, Second) {
    // const tx = await TokenContractWithSigner.removePotions(First, Second);
}
function getAmountOfNonDead() {
    let nonDeadCount = 0;

    for (let i = 1; i <= queuecounter; i++) {
        if (!dead.has(i)) {
            nonDeadCount++;
            aliveByID.push(i); 
        }
    }
    console.log(`nonDeadCount: ${nonDeadCount}`);
    return nonDeadCount;
}
async function storeRoundWinners() {
    
    for (let i = 0; i < aliveByID.length; i++) {
            const roundWinsOfNFT = await getAsync(`roundWinsOf${aliveByID[i]}`);
            const owner = await NFTContract.ownerOf(aliveByID[i]);
            roundWinners.push(owner);
            await setAsync(`roundWinsOf${i}`, parseInt(roundWinsOfNFT || 0) + 1);
    }

    return roundWinners; 
}
async function payoutWinners(nonDeads) {
    if (nonDeads === 0) {
        return;
    }
    const contractBalance = await provider.getBalance(hungerGamesAddress);
    const balanceInEther = ethers.utils.formatEther(contractBalance);
    const share = Math.floor(balanceInEther * 10**_decimals / nonDeads);

    console.log('Contract Balance:', contractBalance);
    console.log('Balance in Ether:', balanceInEther);
    console.log("nonDeads: ", nonDeads);
    console.log('Share:', share);
    console.log("RoundWinners: ", roundWinners);

    try {
        tx = await TokenContractWithSigner.payoutWinners(
            roundWinners,
            share,
            nonDeads
        );
        let receipt = await tx.wait();
        console.log(`Successfully called payoutWinners! Transaction hash: ${receipt.transactionHash}`);
    } catch (error) {
        console.error('Error:', error);
    }
}

function reviveAll(){
    for (let i = 1; i <= queuecounter; i++) {
        dead.set(i, false);
        alive.set(i, false);
    }
}
function resetQueue() {
    for (let i = 1; i <= queuecounter; i++) {
        queue.set(i, false);
    }
    queuecounter = 0;
}
function resetTimer() {
    time = Math.floor(Date.now() / 1000); 
    console.log('Timer reset at timestamp:', time);
}
async function resetAlive() {
    for (let i = 1; i <= queuecounter; i++) {
        alive.set(i, false);
    }
}

async function sendMessageViaAxios(chatId, text, parseMode = 'Markdown') {
    try {
        const response = await axios.post(TELEGRAM_BASE_URL + 'sendMessage', {
            chat_id: chatId,
            text: text,
            parse_mode: parseMode
        });
        console.log(response.data);
    } catch (error) {
        console.error(`Error sending message: ${error.message}`);
    }
}

