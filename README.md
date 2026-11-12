# ExactSplitter

**Pitch:** ExactSplitter turns weighted ETH contributions into deterministic pull claims with no rounding dust, even when the pool amount is close to the full `u256` range.

## The problem

Integer token amounts cannot represent fractional wei. A common allocation formula, `amount * weight / total_weight`, can overflow before division. Independent per-recipient rounding can also leave wei permanently unallocated. These issues affect small payout pools, revenue shares, and other contracts that divide integer amounts by weights.

## Approach

`ExactSplitter` is a one-shot ETH pool for three fixed payees. The creator fixes unique payee addresses and positive weights at deployment. Contributors deposit ETH. The creator then finalizes the pool, which closes deposits and records each payee's claimable amount. Each payee withdraws their own amount separately.

For a total amount `A`, total weight `D`, and cumulative boundary `p`, the library computes:

```text
q = A / D
r = A % D
F(p) = q * p + floor(r * p / D)
share[a, b) = F(b) - F(a)
```

This is exactly `floor(A * p / D)` without multiplying the full amount by the weight. Since `0 <= p <= D`, `q * p <= A`; the configured maximum denominator keeps `r * p < 10^36`, which is safely within `u256`. Consecutive interval shares telescope: their sum is `F(D) - F(0) = A`. Any indivisible remainder is assigned deterministically by payee order, so no wei is stranded.

The contract uses pull payments. It clears a payee's entitlement before the external value transfer, so a failed transfer reverts atomically and a reentrant claim sees no remaining entitlement.

## Fe highlight

Fe's typed `Wei` values keep ETH amounts separate from ordinary integers. The contract converts to `u256` only at the pure allocation boundary, then converts the payout back to `Wei`. Fe's explicit `uses` clauses also make storage writes, caller context, logging, and external calls visible at each handler.

```fe
let amount = total_funded.as_wei()
let payout_b = wei(share_amount(
    amount: amount,
    previous_weight: boundary_a,
    cumulative_weight: boundary_b,
    total_weight: total_weight,
))
claimable.set(key: payee_b, value: payout_b)
```

## Architecture

- `src/lib.fe` contains `cumulative_amount`, `share_amount`, the `ExactSplitter` contract, and a small payable `ClaimForwarder` used to exercise contract recipients.
- `src/tests.fe` covers exact ratios, uneven and one-wei pools, maximum-`u256` arithmetic, invalid ranges, constructor validation, finalization, contract payees, and replayed claims.
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

The tested version for this prototype is `fe 26.5.0 (3dab95f)`. The current test suite has 12 passing tests. A short reproducible example is:

```sh
fe test --filter equal_split_assigns_every_remainder_unit
```

It verifies that splitting 7 units across weights 1:1:1 produces 2, 2, and 3, and that the results sum to the original 7 units.

## Limitations

- The contract supports exactly three payees, native ETH, and one settlement round.
- The creator controls when contributions close. Contributors should agree on that trust assumption before depositing. There is no refund path.
- The allocation order is fixed at deployment; later payees can receive indivisible remainder units.
- The contract accounts for deposits made through `deposit()`. ETH forced into the contract outside that function is not included in `total_funded` and cannot be claimed by this prototype.
- A payee contract that rejects plain ETH transfers cannot claim until it can accept the transfer. A failed attempt leaves its entitlement unchanged.
- This is an unreviewed contest prototype, not production-ready software. Fe itself is not yet recommended for production use.

## Demo

The tests deploy the contract in Fe's local EVM, deposit 7 wei, finalize, check claimable shares of 2/2/3, and have a contract payee claim successfully. Run:

```sh
fe test --filter contract_finalizes_exact_shares_and_pays_contract_payee
```

## Declaration

- **Pre-existing work:** The project began from the official Fe Builders Challenge starter at commit `f9d9aa92a03af82c2bbb0dc2e0810244eb13e686`. The starter supplied the ingot layout, Apache-2.0 license, CI workflow, and a sample vault. The sample vault was replaced. ExactSplitter and its tests were added during the contest window.
- **Third-party code:** Starter scaffolding and CI from [`fe-lang/builders-challenge-starter`](https://github.com/fe-lang/builders-challenge-starter), under Apache-2.0. The Fe compiler and standard library are used as published by the Fe project.
- **AI assistance:** ChatGPT helped propose the project, write and revise the Fe implementation and tests, and draft this README. GitHub Actions runs formatting, the test suite, and the compiler build with Fe 26.5.0.

## Team

The project is registered for the Fe Builders Challenge. The final submission has not yet been sent; its private submission link is provided separately by the contest organizers. The contest requires one responsible human contact reachable by email.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
