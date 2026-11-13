"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { allocate } = require("./allocator.js");

const vectors = JSON.parse(
  fs.readFileSync(path.join(__dirname, "allocator-vectors.json"), "utf8"),
);

for (const vector of vectors.cases) {
  test(vector.name, () => {
    const amount = BigInt(vector.amount);
    const { shares, leftover } = allocate(amount, vector.weights.map(BigInt));
    const sum = shares.reduce((total, share) => total + share.payout, 0n);
    assert.deepEqual(
      shares.map((share) => share.payout.toString()),
      vector.expected,
    );
    assert.equal(sum, amount);
    assert.equal(leftover, shares.reduce((count, share) => count + (share.bonus ? 1n : 0n), 0n));
    assert.equal(leftover, amount - shares.reduce((total, share) => total + share.base, 0n));
  });
}

test("rejects more than eight payees", () => {
  assert.throws(() => allocate(1n, Array(9).fill(1n)), RangeError);
});

test("rejects a zero weight", () => {
  assert.throws(() => allocate(1n, [1n, 0n]), RangeError);
});

test("rejects a total weight above the Fe bound", () => {
  assert.throws(
    () => allocate(1n, [1_000_000_000_000_000_000n, 1n]),
    RangeError,
  );
});

test("rejects an amount above u256", () => {
  assert.throws(
    () => allocate((1n << 256n), [1n]),
    RangeError,
  );
});
