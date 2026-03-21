import type { Connection, PublicKey, Signer } from "@solana/web3.js";
import * as splToken from "@solana/spl-token";

type TokenAccountResult = { address: PublicKey };

const TOKEN_PROGRAM_ID = (splToken as any).TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM_ID = (splToken as any).ASSOCIATED_TOKEN_PROGRAM_ID;

export async function createMintCompat(
  connection: Connection,
  payer: Signer,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey | null,
  decimals: number,
): Promise<PublicKey> {
  if (typeof (splToken as any).createMint === "function") {
    return (splToken as any).createMint(connection, payer, mintAuthority, freezeAuthority, decimals);
  }

  const token = await (splToken as any).Token.createMint(
    connection,
    payer,
    mintAuthority,
    freezeAuthority,
    decimals,
    TOKEN_PROGRAM_ID,
  );

  return token.publicKey;
}

export async function getOrCreateAssociatedTokenAccountCompat(
  connection: Connection,
  payer: Signer,
  mint: PublicKey,
  owner: PublicKey,
): Promise<TokenAccountResult> {
  if (typeof (splToken as any).getOrCreateAssociatedTokenAccount === "function") {
    return (splToken as any).getOrCreateAssociatedTokenAccount(connection, payer, mint, owner);
  }

  const token = new (splToken as any).Token(connection, mint, TOKEN_PROGRAM_ID, payer);
  const accountInfo = await token.getOrCreateAssociatedAccountInfo(owner);
  return { address: accountInfo.address ?? accountInfo.pubkey };
}

export async function mintToCompat(
  connection: Connection,
  payer: Signer,
  mint: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  amount: number,
): Promise<string> {
  if (typeof (splToken as any).mintTo === "function") {
    return (splToken as any).mintTo(connection, payer, mint, destination, authority, amount);
  }

  const token = new (splToken as any).Token(connection, mint, TOKEN_PROGRAM_ID, payer);
  return token.mintTo(destination, authority, [], amount);
}

export async function approveCompat(
  connection: Connection,
  payer: Signer,
  account: PublicKey,
  delegate: PublicKey,
  owner: PublicKey,
  amount: number,
): Promise<string> {
  if (typeof (splToken as any).approve === "function") {
    return (splToken as any).approve(connection, payer, account, delegate, owner, amount);
  }

  const ix = (splToken as any).Token.createApproveInstruction(
    TOKEN_PROGRAM_ID,
    account,
    delegate,
    owner,
    [],
    amount,
  );

  const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
  const tx = new Transaction().add(ix);
  return sendAndConfirmTransaction(connection, tx, [payer as Signer]);
}

export {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
};
