---
title: "Building a Solana-like validator in Rust: what PoH, Tower BFT and Sealevel actually force you to think about"
description: "TrustNode is a Solana-style cluster in Rust — Proof of History clock, Tower BFT consensus, Sealevel-style parallel execution. The lessons are about clock design, not just blockchains."
tags: [rust, blockchain, consensus, systems, architecture]
date: 2026-09-15
canonical_url: https://bartoszosiej.github.io/content/trustnode-validator-lessons
layout: post
published: true
tldr: "Re-implementing a Solana-like node in Rust teaches more than the whitepaper does: the PoH clock is a schedule problem, Tower BFT is a voting-height game, and Sealevel parallelism lives or dies on account locks."
---

## TL;DR

TrustNode is a from-scratch Solana-style cluster in Rust: a verified Proof-of-History clock, Tower BFT-style consensus, a Sealevel-like parallel execution engine, gossip, and erasure-coded block recovery. The point was never to clone Solana — it's that these three subsystems force concrete, painful design decisions that generic "blockchain in Rust" tutorials skip. This is what they actually force.

## The PoH clock is a scheduling problem, not a hash chain

The naive description — "hash a counter, publish a chain of hashes" — is one line. The real problem is that the clock sources events (`TickHeight`, sequential slot heights) and the *validators* re-derive them locally to trust the chain. When it breaks, it breaks as ordering: two validators disagree on which tick a transaction belonged to, and the whole ledger forks at that point.

What actually mattered in the implementation:

- **Batching ticks, not hashing every transaction.** Hash a counter on each tick, but let a batch of entries commute into one tick. Constant re-hashing per-transaction kills throughput and makes the clock the bottleneck.
- **The clock must be derivable from the ledger.** If "slot N belongs to slot N" isn't an independent statement any node can recompute from the block alone, you've built a chain that needs a trusted signer — the exact thing you were trying to cryptographically remove.
- **Verifier side must match generator side bit-for-bit.** Off-by-one in the tick batching turns up as a consensus failure weeks later, not a compile error.

Lesson: in a PoH system the clock *is* the consensus substrate. Get the pure function right first; consensus is downstream of it.

## Tower BFT is a voting game at fixed heights

Tower BFT simplifies PBFT by anchoring votes to the PoH slot height. The trick (and the trap) is that votes happen at *heights*, and each validator commits to "I have not voted against this fork above slot X for Y slots." The consequence that's easy to miss until you implement it:

- **Vote lifetime is a number you have to choose.** How many slots does a lock hold? Too short and liveness collapses (validators flip-flop, the fork battle never ends); too long and the network can be bricked.
- **Commit vs. finalize are different states.** Reaching "commit" as a local statement is easy; broadcasting finalization so *other* nodes can rely on it is where cloudblocks appear.
- **The lock mechanism is per-validator bookkeeping.** Track highest lock height, refuse to vote below it, and explain that in tests — because half the bugs turn out to be "validator voted against its own lock."

Lesson: BFT flavors differ in *where they put the voting rules*, not in whether they have them. Implementing one in your own repo makes the whitepaper read like a checklist instead of a mystery.

## Sealevel parallelism lives or dies on account locks

Parallel execution is the marketing line; the implementation is "which accounts does this instruction touch, and can I prove they don't overlap." The real work is:

- **Static account-readset/writeset extraction.** Every instruction declares accounts before execution. If it doesn't, you can't schedule safely — so the API forces it.
- **Overlap detection decides throughput.** Two programs touching disjoint accounts run in parallel; any overlap serializes. Most of the performance cliff lives in a naive overlap check (collision on account keys, not program IDs).
- **The price of conflict is determinism.** Any scheduler that reorders conflicting instructions must be *reproducible across all validators*, or the same block executes differently on different machines.

Lesson: "parallel VM" is 20% scheduling and 80% proving it's deterministic while parallel.

## What I'd build differently

Real transaction processing over RPC is the current frontier in the repo (commits land almost daily). The honest retro:

- **Boot the consensus before the clock.** I built PoH first because it looks like the foundation. In hindsight the vote/lock rules are the design core; the clock is just the substrate they sit on.
- **Fuzz the ledger reconstruction.** Erasure-coded recovery looks simple until a node survives with 2-of-4 shards and has to rebuild *without* trusting what it already has.
- **Determinism tests on the scheduler early.** Portable scheduling is the difference between a demo and a network.

## Repo

[TrustNode](https://github.com/BartoszOsiej/TrustNode) — PoH clock, Tower BFT, Sealevel-style execution, gossip + erasure coding, real transaction processing over RPC (Rust, MIT).