use anchor_lang::solana_program::{account_info::AccountInfo, entrypoint::ProgramResult};
use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lending_pool::accounts::MarkDefault as MarkDefaultAccounts;
use lending_pool::instruction::MarkDefault as MarkDefaultInstruction;
use lending_pool::state::{
    EscrowStatus, EscrowVaultState, Loan, LoanStatus, PoolState, BPS_DENOMINATOR,
    DEFAULT_PRICE_MAX_AGE_SECS, EVM_TARGET_CHAIN_ID, GRACE_PERIOD_SECS, PRECISION,
};
use solana_program_test::{processor, ProgramTest};
use solana_sdk::{
    account::Account, instruction::Instruction, pubkey::Pubkey, rent::Rent, signature::Signer,
    transaction::Transaction,
};

fn anchor_account_data<T: AccountSerialize>(account: &T) -> Vec<u8> {
    let mut data = Vec::new();
    account.try_serialize(&mut data).unwrap();
    data
}

fn process_lending_pool_instruction<'a, 'b, 'c>(
    program_id: &'a Pubkey,
    accounts: &'b [AccountInfo<'c>],
    instruction_data: &[u8],
) -> ProgramResult {
    let accounts: &'b [AccountInfo<'b>] = unsafe { std::mem::transmute(accounts) };
    lending_pool::entry(program_id, accounts, instruction_data)
}

fn program_account<T: AccountSerialize>(account: &T) -> Account {
    let data = anchor_account_data(account);
    Account {
        lamports: Rent::default().minimum_balance(data.len()),
        data,
        owner: lending_pool::ID,
        executable: false,
        rent_epoch: 0,
    }
}

#[tokio::test]
async fn mark_default_runtime_transitions_active_loan_and_updates_pool_state() {
    let program_id = lending_pool::ID;
    let mut program_test = ProgramTest::new(
        "lending_pool",
        program_id,
        processor!(process_lending_pool_instruction),
    );

    let token_mint = Pubkey::new_unique();
    let borrower = Pubkey::new_unique();
    let collateral_mint = Pubkey::new_unique();
    let (pool_state_key, pool_bump) =
        Pubkey::find_program_address(&[b"pool", token_mint.as_ref()], &program_id);

    let loan_key = Pubkey::new_unique();
    let escrow_key = Pubkey::new_unique();

    let principal = 3_000_000_000u64;
    let collateral_amount = 5_000_000u64;

    let pool_state = PoolState {
        authority: Pubkey::new_unique(),
        collateral_price_oracle: Pubkey::new_unique(),
        token_mint,
        collateral_mint,
        total_deposited: 50_000_000_000,
        total_borrowed: principal,
        total_interest_earned: 0,
        total_defaults: 0,
        active_loans: 1,
        total_loans_issued: 1,
        next_loan_id: 2,
        base_rate_bps: 0,
        max_utilization_bps: 8_000,
        collateral_price_usdt_6: 0,
        collateral_price_updated_at: 0,
        max_price_age_secs: DEFAULT_PRICE_MAX_AGE_SECS,
        interest_index: PRECISION,
        last_update_ts: 0,
        is_paused: false,
        bump: pool_bump,
        vault_bump: 0,
    };
    program_test.add_account(pool_state_key, program_account(&pool_state));

    let loan = Loan {
        loan_id: 1,
        pool: pool_state_key,
        borrower,
        lending_agent: Pubkey::new_unique(),
        principal,
        interest_rate_bps: 650,
        start_time: 0,
        due_date: -GRACE_PERIOD_SECS - 1,
        repaid_amount: 0,
        status: LoanStatus::Active,
        escrow: escrow_key,
        schedule: Pubkey::default(),
        agent_decision_hash: [0xCC; 32],
        index_snapshot: PRECISION,
        bump: 0,
    };
    program_test.add_account(loan_key, program_account(&loan));

    let escrow = EscrowVaultState {
        loan_id: 1,
        borrower,
        collateral_mint,
        collateral_amount,
        status: EscrowStatus::Locked,
        locked_at: 0,
        released_at: 0,
        bump: 0,
        vault_bump: 0,
    };
    program_test.add_account(escrow_key, program_account(&escrow));

    let context = program_test.start_with_context().await;
    let payer = &context.payer;

    let accounts = MarkDefaultAccounts {
        pool_state: pool_state_key,
        loan: loan_key,
        escrow_state: escrow_key,
        caller: payer.pubkey(),
    };
    let instruction = Instruction {
        program_id,
        accounts: accounts.to_account_metas(None),
        data: MarkDefaultInstruction {}.data(),
    };

    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&payer.pubkey()),
        &[payer],
        blockhash,
    );

    context.banks_client.process_transaction(transaction).await.unwrap();

    let updated_loan = context
        .banks_client
        .get_account(loan_key)
        .await
        .unwrap()
        .unwrap();
    let updated_pool = context
        .banks_client
        .get_account(pool_state_key)
        .await
        .unwrap()
        .unwrap();

    let mut loan_data: &[u8] = &updated_loan.data;
    let decoded_loan = Loan::try_deserialize(&mut loan_data).unwrap();
    assert!(matches!(decoded_loan.status, LoanStatus::Defaulted));

    let mut pool_data: &[u8] = &updated_pool.data;
    let decoded_pool = PoolState::try_deserialize(&mut pool_data).unwrap();

    let expected_minimum_recovery =
        principal * ((BPS_DENOMINATOR - 300 - 50) as u64) / (BPS_DENOMINATOR as u64);

    assert_eq!(decoded_pool.total_borrowed, 0);
    assert_eq!(decoded_pool.total_defaults, principal);
    assert_eq!(decoded_pool.active_loans, 0);
    assert_eq!(expected_minimum_recovery, 2_895_000_000);
    assert_eq!(EVM_TARGET_CHAIN_ID, 1);
}
