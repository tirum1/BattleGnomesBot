console.log("Starting the script...");
require('colors');
require('dotenv').config({ path: './.env' });
const fs = require('fs');
const { ethers } = require('ethers');
const bluebird = require('bluebird');
const Bottleneck = require('bottleneck');
const redis = require('redis');
const axios = require('axios');
const token = process.env.MAIN_BOT_TOKEN;
const TELEGRAM_BASE_URL = `https://api.telegram.org/bot${token}/`;
const CHANNEL_ID = '-1001672659906';

const MainRedisUrl = process.env.MAIN_REDIS_URL;
const MYMaintenance = process.env.MYMAINTENANCE;
const hungerGamesAddress = '0x3511910Cd2c60a77a7f095Ce3c5d8AE1fBf680cd';
const GnomesCollectiveAddress = "0x6742eE08d1ac25f72d741708E37AD69C9e7F4b22";
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

let initialProgressMessage;
let battlecoun = 0;
let roundWinners = []; 
let _decimals = 18;
let aliveByID = [];
let time = 0;
let activeRound = false;
const maxAmountOfWinners = 5;
const roundDuration = 300;
let queue = new Map();
let alive = new Map();
let dead = new Map();
let roundsCount = 0;
let newGame = true;
let HungerGamesBegin = false;
let queuecounter = 0;
let StatsSize = 5;
let messageId = 0;
let editCounter = 0;
const checked = [];
let balance = 0;


const BattleResult = {
    Won: "Won",
    Lost: "Lost",
    Skipped: "Skipped"
};
const limiter = new Bottleneck({
    reservoir: 100, 
    reservoirRefreshAmount: 100, 
    reservoirRefreshInterval: 60 * 1000, 
    maxConcurrent: 1, 
});
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
     balance = await provider.getBalance(hungerGamesAddress);
     if (newGame && hasTimerPassed() && balance >= 100000000000000000n && !activeRound) {
       // startHungerGames();
     }
    await setAsync("time", time);
    await setAsync("newGame", newGame);
    await setAsync("hasTimerPassed", hasTimerPassed());
    await setAsync("HungerGamesBegin", HungerGamesBegin);
    await setAsync("roundsCount", roundsCount);
    await setAsync("dead", JSON.stringify(Array.from(dead.entries())));
    await setAsync("queue", JSON.stringify(Array.from(queue.entries())));
    await setAsync("aliveByID", JSON.stringify(aliveByID));
    await setAsync("roundDuration", roundDuration.toString());
    await setAsync("roundWinners", JSON.stringify(roundWinners));
    await setAsync("roundWinnersLength", JSON.stringify(roundWinners.length));
    await setAsync("queuecounter", queuecounter.toString());
    const mintAmount = await NFTContract.getMintAmount();
    await setAsync("maxAmountOfWinners", maxAmountOfWinners.toString());
    await setAsync("mintAmount", mintAmount.toString());
    await setAsync("stats", JSON.stringify(stats));
    if(!activeRound && queuecounter >= 2 && hasTimerPassed()){
    // await lookForOpponent();
    }
}, 500);

function startTimer() {
    HungerGamesBegin = true;
    time = Math.floor(Date.now() / 1000); 
}
async function startHungerGames () {
    activeRound = true;
    let ownerAddress=null;
    let minBalanceRequired = 0;
    let ownerBalance=0;
    const tokenTotalSupply = await TokenContract.totalSupply();
    if (balance >= 250000000000000000n) {
        sendMessageViaAxios(CHANNEL_ID, "MAX CAP WAS REACHED: STARTING GAMES");
    }
    sendMessageViaAxios(CHANNEL_ID, "HUNGERGAMES INITIATED");
    console.log("HUNGERGAMES INITIATED");
    initialProgressMessage = await sendMessageViaAxios(CHANNEL_ID, "Queue Progress: 0.00%");
    mintAmount = await NFTContract.getMintAmount();

    for (let i = 1; i <= mintAmount; i++) {
        if (!checked.includes(i)){
        const minBalanceRequiredBIG = tokenTotalSupply.div(2888);
        const ownerAddress = await NFTContract.ownerOf(i);
        const ownerBalanceBIG = await TokenContract.balanceOf(ownerAddress);
        const ownerNFTsBIG = await NFTContract.walletOfOwner(ownerAddress);
        const ownerNFTs = ownerNFTsBIG.map(nftId => nftId.toNumber());
        let balance =  parseFloat(ownerBalanceBIG.toString());
        console.log("minBalanceRequired: ", minBalanceRequiredBIG.toString());
        console.log("ownerBalance: ", ownerBalanceBIG.toString());
        console.log("i: ", i);
        console.log("ownerNFTs[0]: ", ownerNFTs[0].toString());
      
        if (i === ownerNFTs[0] && balance>=(minBalanceRequiredBIG)) {
          queue.set(i, true);
          checked.push(i);
          console.log("pushed: ", i);
          for (let j = 1; j < ownerNFTs.length; j++) {
            const requiredBalance = minBalanceRequiredBIG.add(
                minBalanceRequiredBIG.div(2).mul(j - 1)
            );
            
            if (balance>=(requiredBalance)) {
              queue.set(ownerNFTs[j], true);
              checked.push(ownerNFTs[j]);
              console.log("pushed: ", ownerNFTs[j]);
            }
          }
        }
      }
      const progressPercentage = ((i / mintAmount) * 100).toFixed(2);

      if (initialProgressMessage && editCounter >= 100 || i == mintAmount) {
          if(i == mintAmount){
          await editMessageViaAxios(CHANNEL_ID, initialProgressMessage.message_id, `Queue Progress: 100%`);
            
          } else{
          await editMessageViaAxios(CHANNEL_ID, initialProgressMessage.message_id, `Queue Progress: ${progressPercentage}%`);
          console.log("QUEUE PROGRESS: ", progressPercentage )

          }
          editCounter = 0; 
      }
      
      editCounter++; 
    }
    queuecounter = checked.length;
    newGame = false;
    activeRound = false;
    sendMessageViaAxios(CHANNEL_ID, `${queuecounter} Contestants entered the Arena!`);
    console.log(`${queuecounter} ENTERED THE ARENA`);
}
async function lookForOpponent() {
    activeRound = true;
     await sendMessageViaAxios(CHANNEL_ID, "ROUND INITIATED");
    console.log("ROUND INITIATED");
    aliveByID = [];
    let firstOpponent = 0;
    initialProgressMessage = await sendMessageViaAxios(CHANNEL_ID, "Round Progress: 0.00%");

    for (let i = 0; i < queuecounter; i++) {

        if (queue.get(checked[i]) && !alive.get(checked[i]) && !dead.get(checked[i])) {
            if (firstOpponent == 0) {
                firstOpponent = checked[i];
                console.log(`First: ${firstOpponent}`);
            } else {
                console.log("Looking for second opponent");
                const owneroffirst = await NFTContract.ownerOf(firstOpponent);
                console.log(`Owner of first opponent (${firstOpponent}): ${owneroffirst}`);
                let secondOpponent = await getRandomOpponent(checked[i], owneroffirst);
                console.log(`Second opponent: ${secondOpponent}`);
                if (secondOpponent == firstOpponent) {
                    secondOpponent = 0;
                }

                if (secondOpponent != 0) {
                    await enterBattle(firstOpponent, secondOpponent);
                    console.log(`Entered battle: ${firstOpponent} vs. ${secondOpponent}`);
                    firstOpponent = 0;
                } else {
                    let nextAvailableOpponent = getNextAvailable(firstOpponent);
                    console.log(`Next available opponent: ${nextAvailableOpponent}`);
                    if (nextAvailableOpponent == firstOpponent) {
                        nextAvailableOpponent = 0;
                    }

                    if (nextAvailableOpponent != 0) {
                        await enterBattle(firstOpponent, nextAvailableOpponent);
                        console.log(`Entered battle: ${firstOpponent} vs. ${nextAvailableOpponent}`);
                        firstOpponent = 0;
                    }
                }
            }
        }

        const progressPercentage = ((i / queuecounter) * 100).toFixed(2);
        console.log("i: ", i);
        console.log("progress: ", progressPercentage);
        if (initialProgressMessage && editCounter >= 100 || i >= queuecounter) {
            if(i >= queuecounter){
           await editMessageViaAxios(CHANNEL_ID, initialProgressMessage.message_id, `Round Progress: 100%`);
            } else{
            await editMessageViaAxios(CHANNEL_ID, initialProgressMessage.message_id, `Round Progress: ${progressPercentage}%`);
            }
            editCounter = 0; 
        }
        editCounter++; 
    }

    let nonDeads = getAmountOfNonDead();
    sendMessageViaAxios(CHANNEL_ID, `${aliveByID.length} Survived the Round!`);
   console.log(`${aliveByID.length} SURVIVED THE ROUND`);
    if (nonDeads <= maxAmountOfWinners) {
        sendMessageViaAxios(CHANNEL_ID, `Initiating PAYOUT!`);
        console.log("ENTERED WINNERS");
        
        await storeRoundWinners();
        await payoutWinners(nonDeads);
        reviveAll();
        resetQueue();
        roundsCount = 0;
        newGame = true;
    } 

    roundsCount++;
    resetTimer();
    resetAlive();
     await removePotions();
    activeRound = false;
    console.log("Look For Opponend PASS");
}
async function editMessageViaAxios(chatId, messageId, newText) {
    try {
        console.log("editing following messageID: ",messageId );
        const response = await axios.post(TELEGRAM_BASE_URL + 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: newText,
            parse_mode: 'Markdown',
        });
        console.log(response.data);
    } catch (error) {
        console.error(`Error editing message: ${error.message}`);
    }
}
function hasTimerPassed() {
    if(balance >= 250000000000000000n && newGame){
        return true
    } else if (newGame) {
        return Math.floor(Date.now() / 1000) >= (time + roundDuration * 3); 
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

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const inputForHash = ethers.utils.solidityKeccak256(['uint', 'uint'], [currentTimestamp, startIndex]);
        const keccak256HashNum = ethers.BigNumber.from(inputForHash);
        const randomIndex = keccak256HashNum.mod(lengthOrCounter).add(1);
        const randomID = aliveLength === 0 ? randomIndex.toNumber() : aliveByID[randomIndex.toNumber()];

        if (queue.get(checked[randomID]) && !alive.get(checked[randomID]) && !dead.get(checked[randomID])) {
            if (await NFTContract.ownerOf(checked[randomID]) !== firstOpponentOwner) {
                console.log(`Found a valid opponent: Random ID ${checked[randomID]}`);
                return checked[randomID];
            }
        }
    }

    console.log('No valid opponent found.');
    return 0;
}
function getNextAvailable(first) {
        for (let i = 0; i < queuecounter; i++) {
            if (queue.get(checked[i]) && !alive.get(checked[i]) && !dead.get(checked[i]) && checked[i] != first) {
                return checked[i];
            }
        }
        console.log('No valid opponent found in getNext.');
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
        alive.set(First, true);
        alive.set(Second, true);
        dead.set(First, false);
        dead.set(Second, false);
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
    battlecoun++;
}
async function collectNFTData(tokenId) {
    console.log("collecting data for: ", tokenId);
    const data = {
        XTRA: await getAsync(`${tokenId}XTRABalance`).then(value => value === "true"),
        BOOST: await getAsync(`${tokenId}BOOSTBalance`).then(value => value === "true"),
        V: await getAsync(`${tokenId}VBalance`).then(value => value === "true"),
        SKIP: await getAsync(`${tokenId}SKIPBalance`).then(value => value === "true"),
    };
    return data;
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
    dead.set(winnerId, false);
    alive.set(winnerId, true);
    alive.set(loserId, false);
    } else{
        dead.set(loserId, false);
        dead.set(winnerId, false);
        alive.set(loserId, true);
        alive.set(winnerId, true);
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
async function removePotions() {

    const mintAmount = await NFTContract.getMintAmount();
    const potionsToRemove = ['XTRA', 'BOOST', 'V', 'SKIP'];
    console.log("DEBUG3")
    for (let i = 0; i < queuecounter; i++) {
        for(let j = 0; j< potionsToRemove.length; j++){
        await setAsync(`${checked[i]}${potionsToRemove[j]}Balance`, false);
        }
    }

}
function getAmountOfNonDead() {
    let nonDeadCount = 0;

    for (let i = 0; i < queuecounter; i++) {
        if (!dead.get(checked[i])) {
            nonDeadCount++;
            aliveByID.push(checked[i]); 
        }
    }
    console.log(`nonDeadCount: ${nonDeadCount}`);
    console.log(`battlecount: ${battlecoun}`);
    return nonDeadCount;
}
async function storeRoundWinners() {
    roundWinners = [];
    for (let i = 0; i < aliveByID.length; i++) {
        console.log("DEBUG2");
        const roundWinsOfNFT = await getAsync(`roundWinsOf${aliveByID[i]}`);
        console.log("DEBUG2.1");
        const owner = await NFTContract.ownerOf(aliveByID[i]);
        console.log("DEBUG3");
        roundWinners.push(owner);

        const parsedWins = parseInt(roundWinsOfNFT);
        if (!isNaN(parsedWins)) {
            await setAsync(`roundWinsOf${aliveByID[i]}`, parsedWins + 1);
        } else {
            await setAsync(`roundWinsOf${aliveByID[i]}`, 1);
        }
    }
    console.log(roundWinners);
    return roundWinners;
}


async function payoutWinners(nonDeads) {
    if (nonDeads === 0) {
        console.log("RETURNED");
        return;
    }
    const contractBalance = await provider.getBalance(hungerGamesAddress);
    const balanceInWei = contractBalance; 
    const balanceInEther = ethers.utils.formatUnits(balanceInWei, 'ether');
    const balanceInEtherBN = ethers.utils.parseUnits(balanceInEther, 'ether');
    const share = balanceInEtherBN.div(nonDeads); 


    console.log('Contract Balance:', contractBalance);
    console.log('Balance in Ether:', balanceInEther);
    console.log("nonDeads: ", nonDeads);
    console.log('Share:', share.toString());
    console.log("RoundWinners: ", roundWinners);

    const gasBufferPercentage = 10;
    const gasPrice = await provider.getGasPrice();
    const gasLimit = await TokenContractWithSigner.estimateGas.payoutWinners(roundWinners, share, nonDeads);
    
    const gasBuffer = Math.ceil(gasLimit.toNumber() * (1 + gasBufferPercentage / 100));

    const tx = await TokenContractWithSigner.payoutWinners(roundWinners, share, nonDeads, {
        gasLimit: gasBuffer, 
        gasPrice: gasPrice,
    });

    try {
        const receipt = await tx.wait();
        const etherscanLink = `https://etherscan.io/tx/${receipt.transactionHash}`;
        roundMessage = `⚔️ THE GAME HAS ENDED AND WE HAVE ${aliveByID.length} SURVIVORS ${aliveByID.join(', ')}. \n\n [View on EtherScan](${etherscanLink})`;
        sendMessageViaAxios(CHANNEL_ID, roundMessage);
     console.log(roundMessage);
    } catch (error) {
        console.error('Error:', error);
    }
}
function reviveAll(){
    for (let i = 1; i <= queuecounter; i++) {
        dead.set(checked[i], false);
        alive.set(checked[i], false);
    }
}
function resetQueue() {
    for (let i = 1; i <= queuecounter; i++) {
        queue.set(checked[i], false);
    }
    queuecounter = 0;
}
function resetTimer() {
    time = Math.floor(Date.now() / 1000); 
    console.log('Timer reset at timestamp:', time);
}
async function resetAlive() {
    for (let i = 0; i < queuecounter; i++) {
        alive.set(checked[i], false);
    }
}
async function sendMessageViaAxios(chatId, text, parseMode = 'Markdown') {
    try {
        const response = await axios.post(TELEGRAM_BASE_URL + 'sendMessage', {
            chat_id: chatId,
            text: text,
            parse_mode: parseMode,
        });

        if (response.data && response.data.result) {
            return response.data.result;
        } else {
            console.error('No message object found in the response:', response.data);
            return null;
        }
    } catch (error) {
        console.error(`Error sending message: ${error.message}`);
        return null;
    }
}

