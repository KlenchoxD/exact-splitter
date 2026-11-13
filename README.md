# ExactSplitter

**Pitch:** ExactSplitter splits pooled ETH among three fixed payees by weight, awards rounding wei to the largest fractional shares, and supports amounts near the full `u256` range. Its Fe library exposes the same allocation method for bounded groups of up to eight parties.

## The problem

Integer token amounts cannot represent fractional wei. A common allocation formula, `amount * weight / total_weight`, can overflow before division. Independent per-recipient rounding can also leave wei permanently unallocated. These issues affect small payout pools, revenue shares, and other contracts that divide integer amounts by weights.

## Approach

`ExactSplitter` is a one-shot ETH pool for three fixed payees. The creator fixes unique payee addresses and positive weights at deployment. Contributors deposit ETH. The creator then finalizes the pool, which closes deposits and records each payee's claimable amount. Each payee withdraws their own amount separately. The pure Fe allocator also accepts a fixed array of up to eight weights plus an active count; the contract currently uses its three-payee wrapper.

For total amount `A`, total weight `D`, and each payee weight `w[i]`, the library first computes:

```text
q = A / D
r = A % D
base[i] = q * w[i] + floor(r * w[i] / D)
fraction[i] = (r * w[i]) % D
leftover = A - sum(base)
```

It adds one wei to each of the `leftover` payees with the largest fractional remainder. Ties go to the earliest active array index, so the three-payee contract gives ties to A, then B, then C. The full amount is never multiplied by a weight: `q * w[i] <= A`, and the weight cap keeps `r * w[i] < 10^36`, safely within `u256`. The active payouts always add up to the input amount, including one-wei pools and amounts near the `u256` limit. Unused output slots are zero.

The contract uses pull payments. It clears a payee's entitlement before the external value transfer, so a failed transfer reverts atomically and a reentrant claim sees no remaining entitlement.

## Usage lifecycle

Deploy with three distinct payee addresses and a positive weight for each address. The constructor takes the values as `(payee A, weight A, payee B, weight B, payee C, weight C)`; weights are relative, so `1:1:1` and `2:1:1` both work. Contributors call the payable `deposit()` function, and the creator calls `finalize()` once funding is complete. Each payee then calls `claim()` to withdraw its recorded share. `claimable(address)` lets a payee check its amount before withdrawing.

The pool is intentionally one-shot: finalization permanently closes deposits, and there is no refund path. Contributors should agree on the payees, weights, and who controls finalization before sending ETH.

## Fe highlight

Fe's typed `Wei` values keep ETH amounts separate from ordinary integers. The contract converts to `u256` only at the pure allocation boundary, then converts the payout back to `Wei`. Fe's explicit `uses` clauses also make storage writes, caller context, logging, and external calls visible at each handler.

```fe
let amount = total_funded.as_wei()
let (amount_a, amount_b, amount_c) = largest_remainder_shares(
    amount: amount,
    weight_a: weight_a,
    weight_b: weight_b,
    weight_c: weight_c,
)
claimable.set(key: payee_b, value: wei(amount_b))
```

## Architecture

- `src/lib.fe` contains `largest_remainder_shares_bounded` (1–8 parties), the three-payee wrapper, the `ExactSplitter` contract, and a small payable `ClaimForwarder` used to exercise contract recipients.
- `src/tests.fe` covers bounded counts, exact ratios, fractional-remainder ordering, ties, one-wei pools, maximum-`u256` payouts, the Alabama paradox, invalid weights, finalization, and contract payees.
- `fe.toml` identifies the Fe ingot as `exact_splitter`.
- `.github/workflows/ci.yml` runs formatting, tests, and compilation with Fe 26.5.0.

## Build and test

Use Fe 26.5.0 or later. On Windows, download the matching compiler from the [official Fe release](https://github.com/argotorg/fe/releases) and verify its published SHA-256 digest. Then run from this directory:

```sh
fe --version
fe fmt --check
fe test
fe build
```

The tested version for this prototype is `fe 26.5.0 (3dab95f)`. This working revision has 18 tests. A short reproducible example is:

```sh
fe test --filter equal_split_gives_remainder_to_first_payee_on_tie
```

It verifies that splitting 7 units across weights 1:1:1 produces 3, 2, and 2, and that the results sum to the original 7 units.

## Limitations

- The contract supports exactly three payees, native ETH, and one settlement round. The pure library supports up to eight parties.
- The creator controls when contributions close. Contributors should agree on that trust assumption before depositing. There is no refund path.
- The allocation order is fixed at deployment; payee A wins ties when fractional remainders are equal.
- Largest remainder can exhibit the Alabama paradox: with weights `1:3:3`, a pool of 3 units allocates `1/1/1`, while 4 units allocates `0/2/2`. This one-shot contract calculates shares only when the creator finalizes, so previously recorded claims do not change; the final amount can affect shares before finalization.
- The contract accounts for deposits made through `deposit()`. ETH forced into the contract outside that function is not included in `total_funded` and cannot be claimed by this prototype.
- A payee contract that rejects plain ETH transfers cannot claim until it can accept the transfer. A failed attempt leaves its entitlement unchanged.
- A contract payee must be able to call `claim()` itself; a contract that cannot originate that call cannot withdraw.
- This is an unreviewed contest prototype, not production-ready software. Fe itself is not yet recommended for production use.

## Demo

The tests deploy the contract in Fe's local EVM, deposit 7 wei, finalize, check claimable shares of 3/2/2, and have a contract payee claim successfully. Run:

```sh
fe test --filter contract_finalizes_exact_shares_and_pays_contract_payee
```

## Verification record

Commit `5cc1be9` passed [GitHub Actions CI](https://github.com/KlenchoxD/exact-splitter/actions/runs/43336922498) with Fe 26.5.0, formatting, 13 tests, and the compiler build. This revision also passed local `fe fmt --check`, all 18 tests, and `fe build` with Fe 26.5.0. It has not yet been pushed or submitted.

## Declaration

- **Pre-existing work:** The project began from the official Fe Builders Challenge starter at commit `f9d9aa92a03af82c2bbb0dc2e0810244eb13e686`. The starter supplied the ingot layout, Apache-2.0 license, CI workflow, and a sample vault. The sample vault was replaced. ExactSplitter and its tests were added during the contest window.
- **Third-party code:** Starter scaffolding and CI from [`fe-lang/builders-challenge-starter`](https://github.com/fe-lang/builders-challenge-starter), under Apache-2.0. The Fe compiler and standard library are used as published by the Fe project.
- **AI assistance:** ChatGPT and OpenAI Codex helped propose the project, write and revise the Fe implementation and tests, and draft this README. Claude Code (Opus) provided read-only reviews; its feedback informed the bounded allocator and documentation of the allocation tradeoff. GitHub Actions runs formatting, the test suite, and the compiler build with Fe 26.5.0.

## Submission status

Project `FE-051` is registered for the Fe Builders Challenge. The form currently shows the `5cc1be9` submission as received and pending validation. This working revision has not been submitted; receipt does not confirm acceptance. Technical eligibility is reviewed separately. The responsible human contact details are held privately by the organizers.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
