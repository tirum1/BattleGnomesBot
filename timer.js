require('dotenv').config();
const fs = require('fs');
const { ethers} = require('ethers');

// Set up provider. (You can change this to your specific provider)
const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);

const battleContractAddress = '0x4FF4dd60888F9D640b49ec71662Ca9C000E76124';
const tokenContractAddress = '0xc4797381163C492159C30c1d42E633EC0b372006';
const battleContractABI = JSON.parse(fs.readFileSync('./ABI/BattleContract.json', 'utf8')).abi;
const tokenContractABI = JSON.parse(fs.readFileSync('./ABI/HungerGames.json', 'utf8')).abi;
const battleContract = new ethers.Contract(battleContractAddress, battleContractABI, provider);

async function fetchAndWriteValue() {
    try {
        const balance = await provider.getBalance(tokenContractAddress);
        const ethersBalance = ethers.utils.formatEther(balance) + ' ETH';
        fs.writeFileSync('Prizepool.txt', ethersBalance, 'utf8');

        console.log("Fetching game state from the contract...");
        let value;
        const newGame = await battleContract.newGame();
        console.log("newGame:", newGame);

        const HungerGamesBegin = await battleContract.HungerGamesBegin();
        console.log("HungerGamesBegin:", HungerGamesBegin);

        const timerPassed = await battleContract.hasTimerPassed();
        console.log("timerPassed:", timerPassed);

        const roundsCount = await battleContract.roundsCount();
        console.log("roundsCount:", roundsCount);

        const currentTime = Math.floor(Date.now() / 1000);
        console.log("currentTime:", currentTime);

        const startTimer = await battleContract._startTimer();
        console.log("startTimer:", startTimer);

        let intervalTime = await battleContract.roundDuration();
        console.log("intervalTime:", intervalTime);

        let notificationMessage;

        const roundsCountNum = roundsCount.toNumber(); 
        console.log("Converted roundsCount:", roundsCountNum);
        
        const startTimerNum = startTimer.toNumber();
        console.log("Converted startTimer:", startTimerNum);
        
        let intervalTimeNum = intervalTime.toNumber();
        console.log("Converted intervalTime:", intervalTimeNum);
        
        if (newGame) {
        intervalTimeNum = intervalTimeNum * 6;
            notificationMessage = `New Hunger Games will begin in `;
            console.log("Setting interval for new game:", intervalTimeNum);
        } else if (!newGame && HungerGamesBegin) {
            notificationMessage = `The next round will begin in `;
            console.log("Setting interval for next round:", intervalTime);
        }
        console.log("Converted new intervalTime:", intervalTimeNum);
        const remainingTime = startTimerNum + intervalTimeNum - currentTime;
        console.log("remainingTime:", remainingTime);

        const minutes = Math.floor(remainingTime / 60);
        const seconds = remainingTime % 60;
        console.log("Computed minutes and seconds:", minutes, seconds);

        if (timerPassed) {
            value = `The timer has passed!`;
            fs.writeFileSync('timer.txt', value.toString(), 'utf8');
        } else if (remainingTime > 0) {
            value = notificationMessage + `${minutes}:${seconds.toString().padStart(2, '0')} minutes!`;
            fs.writeFileSync('timer.txt', value.toString(), 'utf8');
        } else {
            value = `The Hunger Games or round has begun!`;
            fs.writeFileSync('timer.txt', value.toString(), 'utf8');
        }

        if (newGame) {
        value = `Round: 0`;
        fs.writeFileSync('round.txt', value.toString(), 'utf8');
    } else {
        value = `Round: ${roundsCountNum}`;
        fs.writeFileSync('round.txt', value.toString(), 'utf8');
    }
    
        
    } catch (error) {
        console.error("Error in the /time command:", error);
    }

}

fetchAndWriteValue();

setInterval(fetchAndWriteValue, 1000);


