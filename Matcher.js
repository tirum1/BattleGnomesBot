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

const MainRedisUrl = process.env.MAIN_REDIS_URL;
const MYMaintenance = process.env.MYMAINTENANCE;
const hungerGamesAddress = '0x86B8837f50Cb1f6d07a0245fDC123A66CC50d581';
const GnomesCollectiveAddress = "0x2391C069B5262E5c1aC2dfD84b09743a91657239";
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

let _decimals = 9;
let aliveByID = [];
let time = 0;
const roundDuration = 300;
let queue = new Map();
let alive = new Map();
let dead = new Map();
let roundsCount = 0;
let newGame = true;
let HungerGamesBegin = false;
const roundWinsOfNFT = {};
let queuecounter = 0;
let StatsSize = 5;

const BattleResult = {
    Won: "Won",
    Lost: "Lost",
    Skipped: "Skipped"
};
const stats = [];
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
startHungerGames();

setInterval(async () => {
    await setAsync("hasTimerPassed", hasTimerPassed());
    await setAsync("newGame", newGame);
    await setAsync("HungerGamesBegin", HungerGamesBegin);
    await setAsync("roundsCount", roundsCount);
    await setAsync("time", time);
    await setAsync("stats", stats);

    const retrievedStats = await getAsync("stats");
    console.log("First Element:", stats[5][4]);

}, 1000);


function startTimer() {
    HungerGamesBegin = true;
    time = Math.floor(Date.now() / 1000); 
}
async function startHungerGames () {
    queuecounter = await NFTContract.getMintAmount();
    for (let i=0;i<queuecounter;i++){
    queue.set(i, true);
    aliveByID.push(i);
    }
    newGame = false;
}
async function lookForOpponent (){
    hasTimerPassed = await battleContract.hasTimerPassed();

    if(queuecounter <= 2) return;
    if(!hasTimerPassed) return;

    aliveByID = [];

    let firstOpponent = 0;
    for (let i = 1; i <= queuecounter; i++) {
        if (queue[i] && !alive[i] && !dead[i]) {
            if (firstOpponent == 0) {
                firstOpponent = i;
            } else {
                let secondOpponent = getRandomOpponent(i, await NFTContract.ownerOf(firstOpponent));

                if(secondOpponent != firstOpponent) {
                    throw new Error("Second opponent shouldn't be the same as the first")
                }

                if (secondOpponent != 0) {
                    await enterBattle(firstOpponent, secondOpponent);
                    i = firstOpponent;
                    firstOpponent = 0;
                } else {
                    let nextAvailableOpponent = getNextAvailable(i);

                    if (nextAvailableOpponent === firstOpponent) {
                        throw new Error("Next available opponent shouldn't be the same as the first");
                    }                    

                    if (nextAvailableOpponent != 0) {
                        await enterBattle(firstOpponent, nextAvailableOpponent);
                        i = firstOpponent;
                        firstOpponent = 0;
                    }
                }
            }
        }
    }

    let nonDeads = getAmountOfNonDead();
    if (nonDeads <= maxAmountOfWinners) {
        storeRoundWinners();
        payoutWinners(nonDeads);
        reviveAll();
        resetQueue();
        roundsCount = 0;
    } 

    roundsCount++;
    resetTimer();
    resetAlive();

}
function hasTimerPassed() {
    if (newGame) {
        return Date.now() >= (time + roundDuration * 6 * 1000); 
    } else if (HungerGamesBegin) {
        return Date.now() >= (time + roundDuration * 1000); 
    } else {
        return false;
    }
}

function getRandomOpponent(){
    let aliveLength = aliveByID.length;
        let lengthOrCounter = aliveLength == 0 ? queuecounter : aliveLength;
        let maxAttempts = Math.min(100, lengthOrCounter);

        for (let attempts = 0; attempts < maxAttempts; attempts++) { 
            let randomIndex = (uint256(keccak256(abi.encodePacked(block.timestamp, startIndex))) % lengthOrCounter) + 1;
            let randomID = (aliveLength == 0 ? randomIndex : aliveByID[randomIndex]);

            if (queue[randomID] && !alive[randomID] && !dead[randomID] && 
                ownerOf(randomID) != firstOpponentOwner) {
                
                return randomID;
            }
        }

    return 0;  
}

function getNextAvailable(startIndex) {
        for (let i = startIndex; i <= queuecounter; i++) {
            if (queue[i] && !alive[i] && !dead[i]) {
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

    lastBattleDetails[First] = firstBattleResult;
    lastBattleDetails[Second] = secondBattleResult;
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
    const isFirstAlive = !dead[First];
    const isSecondAlive = !dead[Second];
    const firstNFTData = await collectNFTData(First);
    const secondNFTData = await collectNFTData(Second);

    if (!(isFirstAlive && isSecondAlive)) {
        throw new Error("Both NFTs must be alive to battle");
    }

    if (stats[First].length !== StatsSize || stats[Second].length !== StatsSize) {
        throw new Error("Invalid stats for one of the NFTs");
    }

    if (shouldSkipBattle(firstNFTData, secondNFTData)) {
        fillLastBattle(First, Second, BattleResult.Skipped, firstNFTData, secondNFTData);
        removePotions(First, Second);
        alive[First] = true;
        alive[Second] = true;
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

    updateNFTStatus(First, Second, isFirstWinner, firstNFTData, secondNFTData);
    restoreOriginalStats(First, Second, originalStatsFirst, originalStatsSecond);
    removePotions(First, Second);
    battlesCount++;
}

async function collectNFTData(tokenId) {
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

function updateNFTStatus(First, Second, isFirstWinner, firstNFTData, secondNFTData) {
    const loserId = isFirstWinner ? Second : First;
    const isLoserDead = shouldSetNFTDead(loserId, firstNFTData, secondNFTData);
    const isWinnerAlive = !isLoserDead;
    const result = isFirstWinner ? BattleResult.Won : BattleResult.Lost;
    fillLastBattle(First, Second, result, firstNFTData, secondNFTData);

    if (isFirstWinner) {
        battleWinsOfNFT[First]++;
        battleLossOfNFT[Second]++;
    } else {
        battleWinsOfNFT[Second]++;
        battleLossOfNFT[First]++;
    }

    dead[loserId] = isLoserDead;
    alive[First] = isWinnerAlive;
    alive[Second] = isWinnerAlive;
}

function shouldSetNFTDead(loserId, firstNFTData, secondNFTData) {
    const loserXTRA = loserId === First ? firstNFTData.XTRA : secondNFTData.XTRA;
    return !loserXTRA;
}

function restoreOriginalStats(First, Second, originalStatsFirst, originalStatsSecond) {
    stats[First] = originalStatsFirst;
    stats[Second] = originalStatsSecond;
}

async function removePotions(First, Second) {
    await TokenContract.removePotions(First, Second);
}

function getAmountOfNonDead() {
    let nonDeadCount = 0;

    for (let i = 1; i <= queuecounter; i++) {
        if (!dead[i]) {
            nonDeadCount++;
            aliveByID.push(i); 
        }
    }

    return nonDeadCount;
}

async function storeRoundWinners() {
    
    for (let i = 1; i <= queuecounter; i++) {
        if (!dead[i]) {
            const owner = await NFTContract.ownerOf(i); 
            roundWinners.push(owner);
            roundWinsOfNFT[i]++;
        }
    }
    
    return roundWinners;
}

async function payoutWinners(nonDeads) {
    if (nonDeads === 0) {
        return;
    }
    const contractBalance = await provider.getBalance(hungerGamesAddress);
    console.log("contractBalance: ", contractBalance);
    const balanceInEther = ethers.utils.formatEther(contractBalance);
    console.log("balanceInEther: ", balanceInEther);
    const share = balanceInEther * 10**_decimals / nonDeads;
    console.log("share: ", share);
    try {
        const estimatedGas = await TokenContractWithSigner.estimateGas[payoutWinners](roundWinners, share, nonDeads);
        const gasWithBuffer = estimatedGas.mul(ethers.BigNumber.from("120")).div(ethers.BigNumber.from("100"));

        let tx = await TokenContractWithSigner[payoutWinners]({ gasLimit: gasWithBuffer }, roundWinners, share, nonDeads);
        let receipt = await tx.wait();
        console.log(`Successfully called ${payoutWinners}! Transaction hash: ${receipt.transactionHash}`);
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
        queue[i] = false;
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

