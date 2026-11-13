(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ExactSplitterAllocator = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const MAX_U256 = (1n << 256n) - 1n;
  const MAX_TOTAL_WEIGHT = 1_000_000_000_000_000_000n;
  const MAX_PAYEES = 12;

  function allocate(amount, weights) {
    if (typeof amount !== "bigint" || amount < 0n || amount > MAX_U256) {
      throw new RangeError("Amount must be an unsigned u256.");
    }
    if (!Array.isArray(weights) || weights.length < 1 || weights.length > MAX_PAYEES) {
      throw new RangeError(`Use between 1 and ${MAX_PAYEES} weights.`);
    }

    let totalWeight = 0n;
    for (const weight of weights) {
      if (typeof weight !== "bigint" || weight <= 0n) {
        throw new RangeError("Weights must be positive integers.");
      }
      if (weight > MAX_TOTAL_WEIGHT - totalWeight) {
        throw new RangeError("Total weight exceeds 10^18.");
      }
      totalWeight += weight;
    }

    const quotient = amount / totalWeight;
    const remainder = amount % totalWeight;
    let baseTotal = 0n;
    const shares = weights.map((weight, index) => {
      const weightedRemainder = remainder * weight;
      const base = quotient * weight + weightedRemainder / totalWeight;
      const fraction = weightedRemainder % totalWeight;
      baseTotal += base;
      return { index, weight, base, fraction, bonus: false, payout: base };
    });

    const leftover = amount - baseTotal;
    if (leftover < 0n || leftover >= BigInt(shares.length)) {
      throw new Error("Allocation invariant failed.");
    }
    const ranked = [...shares].sort((left, right) => {
      if (left.fraction === right.fraction) return left.index - right.index;
      return left.fraction > right.fraction ? -1 : 1;
    });
    for (let index = 0; index < Number(leftover); index += 1) {
      ranked[index].bonus = true;
      ranked[index].payout += 1n;
    }
    return { shares, leftover };
  }

  return { MAX_U256, MAX_TOTAL_WEIGHT, MAX_PAYEES, allocate };
});
