# ExactSplitter

**Pitch:** ExactSplitter splits pooled ETH among three fixed payees by weight, awards rounding wei to the largest fractional shares, and supports amounts near the full `u256` range. Its Fe library exposes the same allocation method for any fixed number of parties through a const-generic array API.

## The problem

Integer token amounts cannot represent fractional wei. A common allocation formula, `amount * weight / total_weight`, can overflow before division. Independent per-recipient rounding can also leave wei permanently unallocated. These issues affect small payout pools, revenue shares, and other contracts that divide integer amounts by weights.

## Approach

`ExactSplitter` is a one-shot ETH pool for three fixed payees. The creator fixes unique payee addresses and positive weights at deployment. Contributors deposit ETH. The creator then finalizes the pool, which closes deposits and records each payee's claimable amount. Each payee withdraws their own amount separately. The pure Fe allocator, `largest_remainder_shares<const N: usize>(amount: u256, weights: [u256; N]) -> [u256; N]`, accepts any fixed-length weight array and returns a payout array of the same length; the contract calls it with three weights.

For total amount `A`, total weight `D`, and each payee weight `w[i]`, the library first computes:

```text
q = A / D
r = A % D
base[i] = q * w[i] + floor(r * w[i] / D)
fraction[i] = (r * w[i]) % D
leftover = A - sum(base)
```

It adds one wei to each of the `leftover` payees with the largest fractional remainder. Ties go to the earliest array index, so the three-payee contract gives ties to A, then B, then C. The full amount is never multiplied by a weight: `q * w[i] <= A`, and the weight cap keeps `r * w[i] < 10^36`, safely within `u256`. The payouts always add up to the input amount, including one-wei pools and amounts near the `u256` limit. An empty array (`N = 0`) reverts instead of leaving the amount unallocated.

The contract uses pull payments. It clears a payee's entitlement before the external value transfer, so a failed transfer reverts atomically and a reentrant claim sees no remaining entitlement.

## Usage lifecycle

Deploy with three distinct payee addresses and a positive weight for each address. The constructor takes the values as `(payee A, weight A, payee B, weight B, payee C, weight C)`; weights are relative, so `1:1:1` and `2:1:1` both work. Contributors call the payable `deposit()` function, and the creator calls `finalize()` once funding is complete. Each payee then calls `claim()` to withdraw its recorded share. `claimable(address)` lets a payee check its amount before withdrawing.

The pool is intentionally one-shot: finalization permanently closes deposits, and there is no refund path. Contributors should agree on the payees, weights, and who controls finalization before sending ETH.

## Fe highlight

Fe's typed `Wei` values keep ETH amounts separate from ordinary integers. The contract converts to `u256` only at the pure allocation boundary, then converts the payout back to `Wei`. Fe's explicit `uses` clauses also make storage writes, caller context, logging, and external calls visible at each handler.

The reusable Fe function `largest_remainder_shares` uses a const generic, so the party count is part of the array type. Callers pass `[u256; N]` and receive `[u256; N]`: no padding, no runtime count, and no party cap other than the weight-total bound and gas. The contract passes its three stored weights directly.

```fe
let amount = total_funded.as_wei()
let payouts = largest_remainder_shares(
    amount: amount,
    weights: [weight_a, weight_b, total_weight - weight_a - weight_b],
)
claimable.set(key: payee_b, value: wei(payouts[1]))
```

## Architecture

- `src/lib.fe` contains the const-generic `largest_remainder_shares`, the `ExactSplitter` contract, and small receiver contracts that exercise normal, rejecting, and reentrant claim paths.
- `src/tests.fe` covers one-, eight-, and twelve-party arrays, the empty-array revert, exact ratios, fractional-remainder ordering, ties, one-wei pools, maximum-`u256` payouts, the Alabama paradox, invalid weights, finalization, and failed/reentrant transfers.
- `fe.toml` identifies the Fe ingot as `exact_splitter`.
- `src/generated_vectors.fe` is generated from the shared payout fixture and adds cross-language Fe assertions.
- `scripts/generate-vectors.mjs` validates the fixture and keeps the generated Fe tests synchronized.
- `demo/page.test.js` exercises the explorer default, paradox preset, and invalid-input state.
- `.github/workflows/ci.yml` checks vector synchronization, runs Node checks, and runs Fe formatting, tests, and compilation with Fe 26.5.0.

## Build and test

Use Fe 26.5.0 or later. On Windows, download the matching compiler from the [official Fe release](https://github.com/argotorg/fe/releases) and verify its published SHA-256 digest. Then run from this directory:

```sh
fe --version
fe fmt --check
fe test
fe build
```

The tested version for this prototype is `fe 26.5.0 (3dab95f)`. This working revision has 27 tests. A short reproducible example is:

```sh
fe test --filter equal_split_gives_remainder_to_first_payee_on_tie
```

It verifies that splitting 7 units across weights `[1, 1, 1]` produces `[3, 2, 2]`, and that the results sum to the original 7 units.

## Limitations

- The contract supports exactly three payees, native ETH, and one settlement round. The pure library accepts any array length `N >= 1`, subject to the weight-total bound and gas.
- Allocator gas grows with `N`: weight validation and base shares are linear, and awarding the `leftover < N` remaining wei scans all parties per award, so the worst case is quadratic in `N`. Each distinct `N` is a separate monomorphized copy in the bytecode.
- The creator controls when contributions close. Contributors should agree on that trust assumption before depositing. There is no refund path.
- The allocation order is fixed at deployment; payee A wins ties when fractional remainders are equal.
- Largest remainder can exhibit the Alabama paradox: with weights `1:3:3`, a pool of 3 units allocates `1/1/1`, while 4 units allocates `0/2/2`. This one-shot contract calculates shares only when the creator finalizes, so previously recorded claims do not change; the final amount can affect shares before finalization.
- The contract accounts for deposits made through `deposit()`. ETH forced into the contract outside that function is not included in `total_funded` and cannot be claimed by this prototype.
- A payee contract that rejects plain ETH transfers cannot claim until it can accept the transfer. A failed attempt reverts and leaves its entitlement unchanged; a callback that tries to reenter cannot claim the same entitlement twice.
- A contract payee must be able to call `claim()` itself; a contract that cannot originate that call cannot withdraw.
- This is an unreviewed contest prototype, not production-ready software. Fe itself is not yet recommended for production use.

## Interactive demo

Open [`demo/index.html`](demo/index.html) in a modern browser to explore exact payouts for 1–8 weighted payees (a demo UI limit; the Fe allocator has no fixed party cap). The page accepts integer amounts in wei up to `2^256 - 1`, shows each base share and fractional remainder, and marks the one-wei awards and tie order. The `3 → 4 wei paradox` preset reproduces the Alabama-paradox test case: with weights `1:3:3`, Payee A falls from 1 wei to 0 when the pool grows from 3 to 4 wei. It uses JavaScript `BigInt`, makes no network requests, and never connects a wallet. It is an educational reference view; the Fe implementation remains authoritative.

## Contract demo

The tests deploy the contract in Fe's local EVM, deposit 7 wei, finalize, check claimable shares of 3/2/2, and have a contract payee claim successfully. Run:

```sh
fe test --filter contract_finalizes_exact_shares_and_pays_contract_payee
```

## Shared allocation vectors

The offline browser explorer and Node use the same allocation module. A JSON fixture holds exact payouts for tie ordering, one and eight payees, maximum total weight, the Alabama paradox, and maximum-u256 arithmetic. A generator turns those same vectors into Fe tests that pass each case's weights at their natural array length, so the browser calculation and the Fe implementation check against identical expected outputs. Locally, run `node scripts/generate-vectors.mjs --check` and `node --test demo/allocator.test.js demo/page.test.js` before the Fe commands. CI runs these checks plus Fe formatting, tests, and build. Fe remains the authoritative implementation; the browser is an educational view.

## Declaration

- **Pre-existing work:** The project began from the official Fe Builders Challenge starter at commit `f9d9aa92a03af82c2bbb0dc2e0810244eb13e686`. The starter supplied the ingot layout, Apache-2.0 license, CI workflow, and a sample vault. The sample vault was replaced. ExactSplitter and its tests were added during the contest window.
- **Third-party code:** Starter scaffolding and CI from [`fe-lang/builders-challenge-starter`](https://github.com/fe-lang/builders-challenge-starter), under Apache-2.0. The Fe compiler and standard library are used as published by the Fe project.
- **AI assistance:** ChatGPT and OpenAI Codex helped propose the project and write or revise the Fe implementation, tests, offline allocation explorer, and README. Claude Code (Opus) reviewed the design and implemented the const-generic allocator, related Fe tests, vector-generator updates, and documentation; it also ran the local validation commands. OpenAI Codex reviewed the changes and reran the validation. GitHub Actions runs generated-vector synchronization, Node tests, Fe formatting and tests, and the compiler build with Fe 26.5.0.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
