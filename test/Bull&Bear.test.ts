import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";

describe("Test Bull&Bear", () => {
  async function bullAndBearFixture() {
    const [deployer, owner1] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("BullBear");
    const tokenContract = await Token.deploy(deployer);
    const TOKEN_ID_0 = 0;
    const TOKEN_ID_1 = 1;

    return { tokenContract, deployer, owner1, TOKEN_ID_0, TOKEN_ID_1 };
  }

  it("Should deploy Bull&Bear token contract correctly", async () => {
    const { tokenContract, deployer, TOKEN_ID_0 } = await loadFixture(bullAndBearFixture);

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
    const { tokenContract, owner1, TOKEN_ID_0, TOKEN_ID_1 } = await loadFixture(bullAndBearFixture);
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
});