import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { moveTime, moveBlocks } from './utils/testutils';

const TOKEN_ID_0 = 0;
const TOKEN_ID_1 = 1;
const UPDATE_INTERVAL_SEC = 60;
const DECIMALS = 8;
const INITIAL_PRICE = 3000000000000;
const checkData = ethers.keccak256(ethers.toUtf8Bytes(""));

describe("Test Bull&Bear", () => {
  async function bullAndBearFixture() {
    const [deployer, owner1] = await ethers.getSigners();

    const PriceFeedMock = await ethers.getContractFactory("MockV3Aggregator");
    const priceFeedMock = await PriceFeedMock.deploy(DECIMALS, INITIAL_PRICE);

    const Token = await ethers.getContractFactory("BullBear");
    const tokenContract = await Token.deploy(
      UPDATE_INTERVAL_SEC,
      await priceFeedMock.getAddress(),
      deployer
    );

    return { tokenContract, deployer, owner1, priceFeedMock };
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

  it("Upkeep correctly updates Token URIs on consecutive price decreases", async () => {
    const { tokenContract, priceFeedMock, owner1 } = await loadFixture(bullAndBearFixture);
    await tokenContract.safeMint(owner1.address);

    let newPrice = INITIAL_PRICE - 10000;
    await priceFeedMock.updateAnswer(newPrice);

    // Move forward time to go past interval.
    moveTime(UPDATE_INTERVAL_SEC + 1);
    moveBlocks(1);

    await tokenContract.performUpkeep(checkData);

    const newTokenUri = await tokenContract.tokenURI(TOKEN_ID_0);

    expect(newTokenUri).to.include("filename=beanie_bear.json");

    // Decrease price again to check that Token URI does not update.
    newPrice = newPrice - 30000;
    await priceFeedMock.updateAnswer(newPrice);

    moveTime(UPDATE_INTERVAL_SEC + 1);
    moveBlocks(1);

    await tokenContract.performUpkeep(checkData);

    expect(newTokenUri).to.include("filename=beanie_bear.json");
  });

  it("Upkeep correctly updates Token URIs on consecutive price increases", async () => {
    const { tokenContract, priceFeedMock, owner1 } = await loadFixture(bullAndBearFixture);
    await tokenContract.safeMint(owner1.address);

    let newPrice = INITIAL_PRICE + 10000;
    await priceFeedMock.updateAnswer(newPrice);

    // Move forward time to go past interval.
    moveTime(UPDATE_INTERVAL_SEC + 1);
    moveBlocks(1);

    await tokenContract.performUpkeep(checkData);

    const newTokenUri = await tokenContract.tokenURI(TOKEN_ID_0);

    expect(newTokenUri).to.include("filename=gamer_bull.json");

    // Decrease price again to check that Token URI does not update.
    newPrice = newPrice + 30000;
    await priceFeedMock.updateAnswer(newPrice);

    moveTime(UPDATE_INTERVAL_SEC + 1);
    moveBlocks(1);

    await tokenContract.performUpkeep(checkData);

    expect(newTokenUri).to.include("filename=gamer_bull.json");
  });
});
