import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vectorsPath = path.join(root, "demo", "allocator-vectors.json");
const outputPath = path.join(root, "src", "generated_vectors.fe");
const vectors = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));
const MAX_U256 = (1n << 256n) - 1n;
const MAX_TOTAL_WEIGHT = 1_000_000_000_000_000_000n;

function parseUnsigned(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(label + " must be a canonical unsigned integer string.");
  }
  return BigInt(value);
}

function toFeInteger(value) {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "_");
}

function testName(name) {
  return "shared_vector_" + name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

const lines = [
  "// Generated from demo/allocator-vectors.json. Do not edit manually.",
  "use ingot::largest_remainder_shares",
  "",
];

if (!Array.isArray(vectors.cases) || vectors.cases.length === 0) {
  throw new Error("The vector fixture must contain at least one case.");
}
const usedTestNames = new Set();
for (const vector of vectors.cases) {
  if (typeof vector.name !== "string" || !/^[a-zA-Z0-9-]+$/.test(vector.name)) {
    throw new Error("Vector names must contain only letters, numbers, and hyphens.");
  }
  const generatedName = testName(vector.name);
  if (usedTestNames.has(generatedName)) {
    throw new Error("Vector names must generate unique Fe test names: " + vector.name);
  }
  usedTestNames.add(generatedName);

  if (!Array.isArray(vector.weights) || vector.weights.length < 1) {
    throw new Error("Vector must have at least one weight: " + vector.name);
  }
  if (!Array.isArray(vector.expected) || vector.expected.length !== vector.weights.length) {
    throw new Error("Expected payout count must match weights: " + vector.name);
  }
  const amount = parseUnsigned(vector.amount, "Amount in " + vector.name);
  if (amount > MAX_U256) {
    throw new Error("Amount exceeds u256 in " + vector.name);
  }
  const activeWeights = vector.weights.map((value) => parseUnsigned(value, "Weight in " + vector.name));
  let totalWeight = 0n;
  for (const weight of activeWeights) {
    if (weight === 0n || weight > MAX_TOTAL_WEIGHT - totalWeight) {
      throw new Error("Weights are zero or exceed the Fe bound in " + vector.name);
    }
    totalWeight += weight;
  }
  const activeExpected = vector.expected.map((value) => parseUnsigned(value, "Expected payout in " + vector.name));
  const expectedTotal = activeExpected.reduce((total, value) => total + value, 0n);
  if (activeExpected.some((value) => value > MAX_U256) || expectedTotal !== amount) {
    throw new Error("Expected payouts must be u256 values that sum to the amount in " + vector.name);
  }
  lines.push("#[test]");
  lines.push("fn " + generatedName + "() {");
  const weightValues = activeWeights.map(toFeInteger);
  const inlineCall = "    let payouts = largest_remainder_shares(amount: " + toFeInteger(amount)
    + ", weights: [" + weightValues.join(", ") + "])";
  const inlineWeights = "        weights: [" + weightValues.join(", ") + "],";
  if (inlineCall.length <= 100) {
    lines.push(inlineCall);
  } else {
    lines.push("    let payouts = largest_remainder_shares(");
    lines.push("        amount: " + toFeInteger(amount) + ",");
    if (inlineWeights.length > 100) {
      lines.push("        weights: [");
      for (const weight of weightValues) {
        lines.push("            " + weight + ",");
      }
      lines.push("        ],");
    } else {
      lines.push(inlineWeights);
    }
    lines.push("    )");
  }
  for (const [index, payout] of activeExpected.entries()) {
    const value = toFeInteger(payout);
    const inlineAssertion = "    assert!(payouts[" + index + "] == " + value + ")";
    if (inlineAssertion.length > 100) {
      lines.push("    assert!(");
      lines.push("        payouts[" + index + "]");
      lines.push("            == " + value + ",");
      lines.push("    )");
    } else {
      lines.push(inlineAssertion);
    }
  }
  lines.push("}");
  lines.push("");
}

const generated = lines.join("\n");
if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n")
    : "";
  if (current !== generated) {
    throw new Error("src/generated_vectors.fe is stale; run node scripts/generate-vectors.mjs");
  }
} else {
  fs.writeFileSync(outputPath, generated);
}
