import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { moveTime, moveBlocks } from './utils/testutils';

const TOKEN_ID_0 = 0;
const TOKEN_ID_1 = 1;

const UPDATE_INTERVAL_SEC = 60;
const DECIMALS = 8;
const INITIAL_PRICE = 3000000000000;

const VRF_FUND_AMOUNT = "1000000000000000000000";

const BASE_FEE = "250000000000000000";
const GAS_PRICE_LINK = 1e9; // 0.000000001 LINK per gas

const checkData = ethers.keccak256(ethers.toUtf8Bytes(""));

describe("Test Bull&Bear", () => {
  async function bullAndBearFixture() {
    const [deployer, owner1] = await ethers.getSigners();

    // Setup Price Feeds
    const PriceFeedMock = await ethers.getContractFactory("MockV3Aggregator");
    const priceFeedMock = await PriceFeedMock.deploy(DECIMALS, INITIAL_PRICE);

    // Setup VRF and Subscription
    const VrfCoordinatorMock = await ethers.getContractFactory("VRFCoordinatorV2Mock");
    const vrfCoordinatorMock = await VrfCoordinatorMock.deploy(
      BASE_FEE,
      GAS_PRICE_LINK
    );
    const transactionResponse = await vrfCoordinatorMock.createSubscription();
    const transactionReceipt = await transactionResponse.wait();
    const subscriptionEvent = transactionReceipt?.logs
      .map((log) => {
        try {
          return VrfCoordinatorMock.interface.parseLog(log);
        } catch (e) {
          return null; // Ignore logs that aren't from this contract
        }
      })
      .find((parsedLog) => parsedLog && parsedLog.name === "SubscriptionCreated");
    const subscriptionId = subscriptionEvent?.args.subId;
    // Fund the subscription
    // Our mock makes it so we don't actually have to worry about sending fund
    await vrfCoordinatorMock.fundSubscription(subscriptionId, VRF_FUND_AMOUNT);

    // Setup dNFT
    const Token = await ethers.getContractFactory("BullBear");
    const tokenContract = await Token.deploy(
      UPDATE_INTERVAL_SEC,
      await priceFeedMock.getAddress(),
      deployer,
      await vrfCoordinatorMock.getAddress()
    );

    await tokenContract.setSubscriptionId(subscriptionId);
    await vrfCoordinatorMock.addConsumer(subscriptionId, await tokenContract.getAddress())

    return { tokenContract, deployer, owner1, priceFeedMock, vrfCoordinatorMock };
  }

  it("Should deploy Bull&Bear token contract correctly", async () => {
    const { tokenContract, deployer } = await loadFixture(bullAndBearFixture);

    const bigNum = await tokenContract.totalSupply();
    expect(bigNum).to.equal(0);

    expect(await tokenContract.owner()).to.equal(deployer.address);
    expect(await tokenContract.balanceOf(deployer.address)).to.equal(0);

    await expect(tokenContract.ownerOf(TOKEN_ID_0)).to.be.revertedWithCustomError(
      tokenContract,
      "ERC721NonexistentToken"
    );
    await expect(tokenContract.tokenURI(TOKEN_ID_0)).to.be.revertedWithCustomError(
      tokenContract,
      "ERC721NonexistentToken"
    );
  });

  it("should mint token correctly", async () => {
    const { tokenContract, owner1 } = await loadFixture(bullAndBearFixture);
    await tokenContract.safeMint(owner1.address);

    expect(await tokenContract.ownerOf(TOKEN_ID_0)).to.equal(owner1.address);
    expect(await tokenContract.tokenURI(TOKEN_ID_0)).to.include(
      "filename=gamer_bull.json"
    );

    await expect(tokenContract.tokenURI(TOKEN_ID_1)).to.be.revertedWithCustomError(
      tokenContract,
      "ERC721NonexistentToken"
    );
  });

  it("Should correctly retrieve latest price from price feed ", async () => {
    const { tokenContract, priceFeedMock } = await loadFixture(bullAndBearFixture);

    expect(await tokenContract.currentPrice()).to.equal(
      INITIAL_PRICE
    );

    // Update price feed with new increased price.
    const increasedPrice = INITIAL_PRICE + 12345;
    await priceFeedMock.updateAnswer(increasedPrice);

    let latestPriceBigNum = await tokenContract.getLatestPrice();

    expect(latestPriceBigNum).to.equal(increasedPrice);
    expect(await tokenContract.currentPrice()).to.equal(INITIAL_PRICE);

    // Update price feed with new decreased price.
    const decreasedPrice = INITIAL_PRICE - 99995;
    await priceFeedMock.updateAnswer(decreasedPrice);

    latestPriceBigNum = await tokenContract.getLatestPrice();

    expect(latestPriceBigNum).to.equal(decreasedPrice);
    expect(await tokenContract.currentPrice()).to.equal(INITIAL_PRICE);
  });

  it("checkUpkeep should return correctly", async () => {
    const { tokenContract } = await loadFixture(bullAndBearFixture);

    let { upkeepNeeded } = await tokenContract.checkUpkeep(checkData);
    expect(upkeepNeeded).to.be.false;

    // Fast forward less than update interval.
    await moveTime(10);
    await moveBlocks(1);
    upkeepNeeded = (await tokenContract.checkUpkeep(checkData)).upkeepNeeded;
    expect(upkeepNeeded).to.be.false;

    // Fast forward by more than Update Interval.
    await moveTime(UPDATE_INTERVAL_SEC + 1);
    await moveBlocks(1);

    upkeepNeeded = (await tokenContract.checkUpkeep(checkData)).upkeepNeeded;
    expect(upkeepNeeded).to.be.true;
  });

  it("Correctly does not perform upkeep", async () => {
    const { tokenContract, priceFeedMock, owner1 } = await loadFixture(bullAndBearFixture);
    await tokenContract.safeMint(owner1.address);

    // Get initial Token URI
    const currentUri = await tokenContract.tokenURI(TOKEN_ID_0);
    console.log(" CURRENT URI: ", currentUri);

    // No change in price.
    await tokenContract.performUpkeep(checkData);
    expect(await tokenContract.tokenURI(TOKEN_ID_0)).to.equal(currentUri);

    // Change in price but no Upkeep interval not past.
    let newPrice = INITIAL_PRICE + 10000;
    await priceFeedMock.updateAnswer(newPrice);

    await tokenContract.performUpkeep(checkData);
    expect(await tokenContract.tokenURI(TOKEN_ID_0)).to.equal(currentUri);
  });

  it("Correctly updates timestamp during performUpkeep ", async () => {
    const { tokenContract } = await loadFixture(bullAndBearFixture);

    let lastUpkeepTs = await tokenContract.lastTimeStamp();

    moveTime(UPDATE_INTERVAL_SEC + 1);
    moveBlocks(1);

    // Perform upkeep to update last upkeep timestamp in Token contract.
    await tokenContract.performUpkeep(checkData);
    const updatedUpkeepTs = await tokenContract.lastTimeStamp();

    expect(updatedUpkeepTs).to.not.equal(lastUpkeepTs);
    expect(updatedUpkeepTs).to.be.greaterThan(lastUpkeepTs);
  });

  // ======================================================================================
  //  *** The following two it() blocks have the changes for the VRF randomness testing ***
  // ======================================================================================
  it("Upkeep correctly updates Token URIs on consecutive price decreases", async () => {
    const { tokenContract, priceFeedMock, owner1, vrfCoordinatorMock } = await loadFixture(bullAndBearFixture);
    await tokenContract.safeMint(owner1.address);

    let newPrice = INITIAL_PRICE - 10000;
    await priceFeedMock.updateAnswer(newPrice);

    // Move forward time to go past interval.
    moveTime(UPDATE_INTERVAL_SEC + 1);
    moveBlocks(1);

    const REQUEST_ID = 1;
    await tokenContract.performUpkeep("0x");
    await vrfCoordinatorMock.fulfillRandomWords(
      REQUEST_ID,
      await tokenContract.getAddress()
    );

    const newTokenUri = await tokenContract.tokenURI(TOKEN_ID_0);

    expect(newTokenUri).to.include("_bear.json");
  });

  it("Upkeep correctly updates Token URIs on consecutive price increases", async () => {
    const { tokenContract, priceFeedMock, owner1, vrfCoordinatorMock } = await loadFixture(bullAndBearFixture);
    await tokenContract.safeMint(owner1.address);

    let newPrice = INITIAL_PRICE + 10000;
    await priceFeedMock.updateAnswer(newPrice);

    // Move forward time to go past interval.
    moveTime(UPDATE_INTERVAL_SEC + 1);
    moveBlocks(1);

    await tokenContract.performUpkeep(checkData);

    const REQUEST_ID = 1;
    await vrfCoordinatorMock.fulfillRandomWords(
      REQUEST_ID,
      await tokenContract.getAddress()
    );

    const newTokenUri = await tokenContract.tokenURI(TOKEN_ID_0);

    expect(newTokenUri).to.include("bull.json");
  });
});
