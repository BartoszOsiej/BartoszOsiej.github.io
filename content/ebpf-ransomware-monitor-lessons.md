---
title: "Catching ransomware with eBPF: what execve/openat tracing taught me about false positives"
description: "Lessons from building talus-process-monitor, a Rust + eBPF ransomware detector: per-CPU perf buffers, behavioural pattern matching, and why build systems are a detector's worst enemy."
tags: [ebpf, rust, linux, security, ransomware]
date: 2026-09-13
canonical_url: https://bartoszosiej.github.io/content/ebpf-ransomware-monitor-lessons
published: true
---

## TL;DR

talus-process-monitor is an eBPF-based ransomware detector for Linux: it traces `execve`/`openat` from the kernel, streams events over per-CPU perf buffers, and flags behavioural patterns — mass file rewrites plus extension churn — in real time. The hard part is not the tracing; it's scoring patterns without crying wolf on every `cargo build`.

## Why behaviour, not signatures

Signature detection on Linux ransomware is nearly useless — most samples are short-lived, often scripts wrapping legitimate tools (`find`, `mv`, `gzip` in a loop). What you *can* catch is the shape of the damage: hundreds of files opened, rewritten, renamed or re-extensioned within seconds across directories the process has no business touching.

So talus watches:

- **`execve`/`execveat`** — what process tree is doing this?
- **`openat`/`openat2`** — with which flags? (`O_WRONLY|O_CREAT` churn is the signature move)
- **`unlink`/`rename`** — destruction and renaming patterns

All of it from kernel probes, before the data hits disk crypto.

## The plumbing: per-CPU perf buffers or nothing

First mistake I made: a single global ring buffer. Under parallel load (which is exactly when ransomware runs — it wants throughput), events collide and drop. The fix is standard but worth repeating: **per-CPU perf buffers** with a userspace loader pinning CPUs and reassembling event order per process.

The userspace side is Rust; the eBPF side is libbpf/C with CO-RE. Compile once, run across kernel 6.x — in theory. In practice, verify your field offsets: `struct file` layout differences bit me twice.

## The scoring problem: build systems are innocent ransomware

A naive "N files written in T seconds" rule fires constantly on:

- `cargo build` touching thousands of files in `target/`
- kernel module compilation
- any test suite with fixtures

Three heuristics that made the detector usable:

1. **Extension churn, not just writes.** Ransomware renames (`doc.docx` → `doc.docx.locked`) or re-extensions in bulk. Builders write new files but rarely *rename* existing ones at volume.
2. **Write-after-read density.** Encryptors must read the plaintext before rewriting it. A builder writes fresh output without having read those exact files.
3. **Directory breadth vs. depth.** `target/` is one deep subtree; ransomware sweeps breadth-first across `$HOME`.

None of these is a silver bullet; the score is a weighted blend, and the weights are the actual product.

## What I'd do differently

- Ship the **audit mode first**: weeks of logs on a real desktop before enforcing anything. False-positive rates you *guess* are wrong.
- Make the threshold config per-directory-class (`build-dirs`, `home`, `media`), not global.
- eBPF verifier limits are a design constraint from day one — bounded loops, no unbounded map iteration — or you'll redesign the detection logic twice.

## Repo

Code, architecture notes and verification checklist: [talus-process-monitor](https://github.com/BartoszOsiej/talus-process-monitor) (Rust + libbpf/C, Linux 6.x).
