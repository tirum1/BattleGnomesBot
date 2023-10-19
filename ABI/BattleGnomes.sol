/*
https://www.gnomescollective.xyz/

https://t.me/HungerGameserc20

https://twitter.com/HungerGamesERC
*/

// SPDX-License-Identifier: MIT

//██████╗░░█████╗░████████╗████████╗██╗░░░░░███████╗
//██╔══██╗██╔══██╗╚══██╔══╝╚══██╔══╝██║░░░░░██╔════╝
//██████╦╝███████║░░░██║░░░░░░██║░░░██║░░░░░█████╗░░
//██╔══██╗██╔══██║░░░██║░░░░░░██║░░░██║░░░░░██╔══╝░░
//██████╦╝██║░░██║░░░██║░░░░░░██║░░░███████╗███████╗
//╚═════╝░╚═╝░░╚═╝░░░╚═╝░░░░░░╚═╝░░░╚══════╝╚══════╝

//░██████╗░███╗░░██╗░█████╗░███╗░░░███╗███████╗░██████╗
//██╔════╝░████╗░██║██╔══██╗████╗░████║██╔════╝██╔════╝
//██║░░██╗░██╔██╗██║██║░░██║██╔████╔██║█████╗░░╚█████╗░
//██║░░╚██╗██║╚████║██║░░██║██║╚██╔╝██║██╔══╝░░░╚═══██╗
//╚██████╔╝██║░╚███║╚█████╔╝██║░╚═╝░██║███████╗██████╔╝
//░╚═════╝░╚═╝░░╚══╝░╚════╝░╚═╝░░░░░╚═╝╚══════╝╚═════╝░

pragma solidity ^0.8.0;


interface IGnomesCollective {
    function getMintAmount() external view returns (uint256);
    function ownerOf(uint256) external view returns (address);
}

interface IHungerGames {
    
}

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }
}
library Math {
    function ceil(uint256 a, uint256 m) internal pure returns (uint256) {
        return (a + m - 1) / m * m;
    }

    function log2(uint256 x) internal pure returns (uint256) {
        uint256 result = 0;
        while (x > 1) {
            result++;
            x /= 2;
        }
        return result;
    }
}

contract Ownable is Context {
    address private _owner;
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor () {
        address msgSender = _msgSender();
        _owner = msgSender;
        emit OwnershipTransferred(address(0), msgSender);
    }

    function owner() public view returns (address) {
        return _owner;
    }

    modifier onlyOwner() {
        require(_owner == _msgSender(), "Ownable: caller is not the owner");
        _;
    }

}

contract BattleContract is Ownable {
    uint256 public queuecounter;
    uint256 public amountOfWinners = 5;
    uint256 public StatsSize = 5;
    uint256 public _startTimer; 
    uint256 public constant roundDuration = 300;  
    uint256 public roundsCount; 
    uint256 public battlesCount;
    uint256 public minAmountOfRoundsRequired;
    uint256 public mintAmount;
    uint256[] private gameMatch;
    uint256 public uniqueOwnersCounter = 0;

    bool public HungerGamesBegin = false;
    bool public queueActive = true;

    bool public debug1 = false;
    bool public debug2 = false;
    bool public debug3 = false;
    bool public debug4 = false;

    address[] public topWinners; 
    address[] public roundWinners; 
    address public _maintenanceWallet;

    IGnomesCollective public nftContract;
    IHungerGames public tokenContract;

    mapping(address => bool) public uniqueOwners;
    mapping(uint256 => bool) public queue;
    mapping(uint256 => bool) public dead;
    mapping(uint256 => bool) public alive;
   
    mapping(uint256 => uint256[5]) public stats;
    mapping(uint256 => uint256) public winsOfNFT;
    mapping(uint256 => uint256) public lossOfNFT;
 
    event TimerStarted(uint256 timestamp);
    event TimerReset(uint256 timestamp);
    event JoinedQueue(uint[] idList);
    event matchingOpponents();
    event Enteredbattled();
    event QueueResettet();
    event WinnerDeclared(address indexed winner, uint256 wins);
    event WinnersFound();
    event RevivedAll();

    constructor(address _nftAddress, address _tokenAddress) {
        nftContract = IGnomesCollective(_nftAddress);
        tokenContract = IHungerGames(_tokenAddress);
        _maintenanceWallet = payable(address(0x7034990879D4E4C0F9DaDe892AD641bc45DEDbBf));
        queuecounter = 0;
    }

    modifier onlyMaintenance() {
        require(msg.sender == _maintenanceWallet, "Only maintenance wallet can perform this action");
        _;
    }
    
    function getMintAmount() public view returns (uint256){
        return nftContract.getMintAmount();
    }
    function ownerOf(uint256 id) public view returns (address){
        return nftContract.ownerOf(id);
    }

    function reviveAll() public onlyMaintenance {
        for (uint256 i = 0; i < mintAmount; i++) {
        dead[i] = false;
        alive[i] = false;
        }
    emit RevivedAll();
    }

    function startTimer() public onlyMaintenance{
        HungerGamesBegin = true;
        _startTimer = block.timestamp; 
        emit TimerStarted(_startTimer);
    }

    function hasTimerPassed() public view returns (bool) {
        if(HungerGamesBegin){
        return block.timestamp >= (_startTimer + roundDuration);
        } else {
            return false;
        }
    }

    function resetTimer() public onlyMaintenance {
        _startTimer = block.timestamp; 
        emit TimerReset(_startTimer);
    }

    function resetQueue() public onlyMaintenance {
    for (uint256 i = 0; i < mintAmount; i++) {
        queue[i] = false;
        queuecounter = 0;
    }
    emit QueueResettet();
    }

    function toggleQueue() public onlyMaintenance {
        queueActive = !queueActive;
    }

    function killNonQueued() public onlyMaintenance {
        for (uint256 i = 0; i<getMintAmount();i++){
            if(!queue[i]){
                dead[i] = true;
            }
        }
    }

    function joinQueue(uint256[] calldata idList, uint256[5][] calldata idStats) public onlyMaintenance {
        require(queueActive, "Queue inactive");
        require(!queue[idList[0]], "You already queued");
        require(idList.length == idStats.length, "Mismatched array lengths");
        

        for (uint256 i = 0; i < idList.length; i++) {
            if(!dead[idList[i]]){
                queue[idList[i]] = true;
                stats[idList[i]] = idStats[i];
                queuecounter++;
            }
        }

        if(queuecounter >= 2 && hasTimerPassed()){
            calculateMinAmountOfRoundsRequired();
            lookForOpponent();
            killNonQueued(); 
            resetTimer();
            roundsCount++;
            toggleQueue();
        }   

        
        
        emit JoinedQueue(idList);
    }

    function getUniqueOwners() public returns (uint256) {
        uniqueOwnersCounter = 0;

        for (uint256 tokenId = 1; tokenId <= mintAmount; tokenId++) {
            uniqueOwners[ownerOf(tokenId)] = false;
        }

        for (uint256 tokenId = 1; tokenId <= mintAmount; tokenId++) {
            if (!dead[tokenId]) {
                if (!uniqueOwners[ownerOf(tokenId)]) {
                    uniqueOwners[ownerOf(tokenId)] = true;
                    uniqueOwnersCounter++;
                    if (uniqueOwnersCounter <= amountOfWinners) {
                        topWinners[uniqueOwnersCounter] = ownerOf(tokenId);
                    }
                }
            }
        }
            return (uniqueOwnersCounter);
    }



    

    function checkForWinner() public onlyMaintenance {
    uint256 uniqueOwnersCount = getUniqueOwners();
    
    if (uniqueOwnersCount <= amountOfWinners) {
        reviveAll();
        resetQueue();
        toggleQueue();
        storeRoundWinners();
        resetTimer();
        emit WinnersFound();
    } else {
        resetWinnersList();
    }
    }

    function storeRoundWinners() internal {
    for (uint256 i = 0; i < topWinners.length; i++) {
        roundWinners.push(topWinners[i]);
        }
    }

    function getRoundWinnersLength() public view returns (uint256) {
        return roundWinners.length;
    }

    function resetWinnersList() public onlyMaintenance {
    for (uint256 i = 0; i < topWinners.length; i++) {
        topWinners[i] = address(0); 
    }
    }

   function calculateMinAmountOfRoundsRequired() public onlyMaintenance{
    if(getUniqueOwners() == 1 || queuecounter == 0 ) {
        minAmountOfRoundsRequired = 0;
    } else {
        uint256 counter = queuecounter;
        minAmountOfRoundsRequired = 0;
        while (counter > 1) {
            counter = (counter + 1) / 2;
            minAmountOfRoundsRequired++;
        }
    }
    }


    function lookForOpponent() public onlyMaintenance {

    uint256 firstOpponent = 0;
    debug1 = true;

    for (uint256 i = 1; i <= mintAmount; i++) {
        if(queue[i]) {
            if(firstOpponent == 0) {
                firstOpponent = i;
                debug2 = true;
            } else {
                if(ownerOf(i) != ownerOf(firstOpponent)) {
                    debug3 = true;
                    enterBattle(firstOpponent, i);
                    i = firstOpponent;
                    firstOpponent = 0; 
                }
            }
        }
    }
    emit matchingOpponents();
    }


    function enterBattle(uint256 First, uint256 Second) internal onlyMaintenance  {
        debug4 = true;
        require(stats[First].length == StatsSize, "Invalid stats for the first NFT");
        require(stats[Second].length == StatsSize, "Invalid stats for the second NFT");

        uint256 P1 = stats[First][0] + stats[First][1] + stats[First][2] + stats[First][3] + stats[First][4];
        uint256 P2 = stats[Second][0] + stats[Second][1] + stats[Second][2] + stats[Second][3] + stats[Second][4];

        uint256 totalPower = P1 + P2;
        
        uint256 COW1 = P1 * 1e18 / totalPower; 
        uint256 COW2 = 1e18 - COW1; 

        uint256 RF1 = uint256(keccak256(abi.encodePacked(block.timestamp, blockhash(block.number - 1), First))) % 1e18;
        uint256 RF2 = uint256(keccak256(abi.encodePacked(block.timestamp, blockhash(block.number - 1), Second))) % 1e18;

        uint256 ACOW1 = COW1 * RF1 / 1e18; 
        uint256 ACOW2 = COW2 * RF2 / 1e18;

        if (ACOW1 > ACOW2) {
            dead[Second] = true;
            alive[First] = true;
            winsOfNFT[First]++;
            lossOfNFT[Second]--;
        } else {
            dead[First] = true;
            alive[Second] = true;
            winsOfNFT[Second]++;
            lossOfNFT[First]--;
        }
         if (roundsCount >= minAmountOfRoundsRequired) {
            checkForWinner();
        }
        battlesCount++;
    }
}

   


