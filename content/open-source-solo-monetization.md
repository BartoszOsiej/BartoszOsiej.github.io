---
title: "I ship open-source security tools solo — here's the full stack, the pricing, and the (zero) revenue so far"
description: "A Rust/eBPF ransomware killer, a language that compiles to Python and Bash, and two paid products wrapped around MIT code. Full transparency post: architecture, honest numbers, and why I charge for the curated path instead of the code."
tags: [rust, security, opensource, ebpf]
date: 2026-09-21
canonical_url: https://bartoszosiej.github.io/content/open-source-solo-monetization
layout: post
published: true
tldr: "A solo dev's transparent monetization setup: MIT-licensed security tooling, two paid products ($50 Talus Enterprise pack, $29 Externum Pro Pack), and the honest zero-revenue-so-far report."
---

## TL;DR

I'm a 19-year-old solo developer building security and devtools under the name **Hartwell Labs**. Everything is MIT-licensed and free. Two weeks ago I wrapped paid products around two of them — and I'm documenting the whole experiment, including the part nobody likes to publish: **revenue so far is exactly $0**.

This post is the full stack: what the tools do, what I sell, why the code stays free, and what I've learned about the difference between downloads and dollars.

## The free stack (what you can take today, no money involved)

**[talus-process-monitor](https://github.com/BartoszOsiej/talus-process-monitor)** — a ransomware detection & response agent for Linux. It hooks `execve`/`openat` tracepoints with eBPF (via [aya](https://aya-rs.dev)), streams events through per-CPU perf buffers, counts `openat` calls per PID in a 1-second sliding window, and SIGKILLs the process when it crosses the threshold. ~280k events/s at under 8% CPU, zero false positives in simulation, MIT.

**[externum](https://github.com/BartoszOsiej/externum)** — a self-hosted typed language that compiles to readable Python, standalone Bash (`set -euo pipefail`, real functions, recursion), and its own `.exbc` bytecode VM. ~380 tests, differential harness in CI that runs every case through all three backends, MIT, on PyPI (431 installs last month).

**[pqbit](https://github.com/BartoszOsiej/pqbit)** — a post-quantum Bitcoin experiment: ML-DSA-44/SLH-DSA signatures from genesis, UTXO + PoW node in Rust, fair-launch constitution. Early, public, and open for design review.

## What I actually sell

**[Talus Enterprise Pack — $50](https://buy.polar.sh/polar_cl_E577BTilme4dnUFsfbG0aE4qo7QILaugmEjsA0oajKK)**: a deployment & operations guide for running the detector in production — tuning the threshold per workload, dealing with backup-tool false positives, systemd hardening, alert routing, and a support channel. The binary was always free; this is the path from "cool demo" to "running on my servers".

**[Externum Pro Pack — $29](https://buy.polar.sh/polar_cl_qR2GOfEhXRqlTlPICwyo8XVqKkXjv4mj15cq926Dh1F)**: a 10-page production guide for the language — choosing between the three targets, the ownership model, the real-world workflow I use, troubleshooting. Delivered by email within 24h (honest trade-off: Polar's file-delivery API has a checksum bug, so delivery is manual until they fix it).

## Why charge for guides instead of the code

Three reasons, in order of honesty:

1. **The code benefits more from being free than from being paid.** MIT got talus into awesome-list PR queues, got externum 431 PyPI installs, and got strangers talking to me on Mastodon. A paywall on a 2-week-old repo would have bought none of that.
2. **What people actually lack is not the binary — it's operational judgment.** The tuning thresholds, the false-positive triage, the "which target do I pick" decision. That's worth packaging.
3. **$29–50 is a tip with a deliverable attached.** I'm not pretending this is enterprise pricing. It's "if this saved you an hour, here's a way to say thanks that gets you something back".

## The numbers so far (the part most posts skip)

- Downloads: externum **431/month** on PyPI — the only channel with real organic pull
- GitHub stars across 10+ repos: **~1 total** (yes, really)
- Mastodon followers: 6. Bluesky: 6. Telegram channel: 2 people (hi, mom)
- Polar orders: **0** across both products
- Cold outreach: ~110 emails to media/newsletters over 10 days, one article accepted (LinuxSecurity, publishing this week), one legend of the industry reacted with a single emoji — which honestly made my week

So: **distribution is the bottleneck, not the product, and not the price.** The free code travels; the paid wrapper hasn't moved at all yet. I suspect the missing piece is trust surface — 0★ repos and a fresh brand asking for $50 is a hard sell no matter how good the README is. The experiment now is whether published writing (this post, the LinuxSecurity article, upcoming Show HN launches) converts better than cold email did.

## If you want to follow along

- Everything free: [github.com/BartoszOsiej](https://github.com/BartoszOsiej)
- [Talus Enterprise Pack ($50)](https://buy.polar.sh/polar_cl_E577BTilme4dnUFsfbG0aE4qo7QILaugmEjsA0oajKK)
- [Externum Pro Pack ($29)](https://buy.polar.sh/polar_cl_qR2GOfEhXRqlTlPICwyo8XVqKkXjv4mj15cq926Dh1F)
- Build log: [t.me/hartwell_info](https://t.me/hartwell_info)

Next milestone I'll report on: first sale, or the first piece of evidence that this pricing model is wrong. Both are useful data.
