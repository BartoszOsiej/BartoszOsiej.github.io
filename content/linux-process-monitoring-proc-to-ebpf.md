---
layout: post
title: "Linux Process Monitoring: From /proc to eBPF"
description: "Evolution of Linux process monitoring from /proc and strace to eBPF tracepoints, with per-process scoring and fleet dashboards provided by Talus."
canonical_url: https://bo.hartwell-labs.pl/content/linux-process-monitoring-proc-to-ebpf
tags: [linux, ebpf, monitoring, process-monitor, talus]
date: 2026-10-20
tldr: "From /proc polling to eBPF tracepoints: the three generations of Linux process monitoring, and why modern detection needs kernel-attached, per-process, windowed scoring — not log parsing."
---
## Three generations

Linux process monitoring moved through three generations, and most orgs are
still on generation two while reading alerts from generation three.

| Generation | Mechanism | Strengths | Weaknesses |
|---|---|---|---|
| 1. `/proc` polling | read `/proc/<pid>/stat` every N seconds | trivially portable, no deps | lossy, high overhead at scale, no events |
| 2. `ptrace` + `exec` hooks | `strace`-style attach | precise, per-syscall | stops the world on every syscall, no fleet |
| 3. eBPF tracepoints | kernel callback, no attach cost | lossless, kernel-attributed, fleet-capable | requires BTF, kernel 5.8+ |

## Generation 1: `/proc` polling

Everyone starts here. A cron or daemon loops `for pid in /proc/[0-9]*` and reads
`stat` to snapshot `utime`/`stime`/`state`, then diffs between polls to derive
CPU% and detect a process that opened many files.

Problems that bite by year two:

- **Polling is lossy.** A process that opens 5000 files and exits in 50 ms
  between 1s polls is invisible.
- **Overhead scales as O(pids × fields × freqs)**. On a 16k-PID CI box polled
  at 10 Hz you are reading ~160k files/sec of kernel state — you spend more
  time reading `/proc` than the workload does.
- **No parent/child lineage.** Reconstructing the tree means storing state per
  sample and stitching PPID across polls — racy and expensive.

## Generation 2: ptrace/exec

Tools like `strace`, `sysdig`, and early eBPF wrappers use `ptrace(PTRACE_ATTACH)`
or seccomp-notify to get per-event visibility. Precise, but:

- `ptrace` **stops the tracee** on every syscall — throughput collapses.
- You attach to what you *know* to attach to. Unknown binaries launched by an
  attacker are missed unless you already hook `exec`.
- State is local to one machine; nothing here speaks fleet.

sysdig (pre-3.x) is this generation's poster child: brilliant forensics, poor
for always-on production load.

## Generation 3: eBPF tracepoints

eBPF tracepoints attach in kernel space and never stop the traced task. You get
an event per syscall entry/exit with a **kernel-attributed pid**, a timestamp,
and a ring-buffer export to userspace. The program is verified at load time —
if it can crash the kernel, it won't load.

The modern pattern is **not** raw `bpftrace` one-liners (generation 2.5) but a
**per-process scorer**: maintain a map keyed by `pid` (or better, by
`pid + start_time` to defeat PID recycling), increment a counter on
`openat`-for-write, and emit a verdict when the windowed rate exceeds a
threshold. That is the core of Talus's detector, and it is ~120 lines of eBPF
plus a ~200-line ring-buffer drain in Rust.

Key correctness notes:

- **Window size matters.** 1-second windows give same-second verdicts; 10s
  windows give you alerts after encryption. Talus ships 1s.
- **Path vs name.** Matching on the binary name is spoofable; matching on the
  binary **path + inode** and the open **path** is not.
- **PID recycling** is real under churn. Key maps by `pid + start_time`; that is
  what Talus does, and what naive `/proc` scrapers forget.

## Fleet: the missing third act

Single-host eBPF monitoring is a solved problem (run the binary). Fleet is
where generation 3 beats 1+2 decisively: a single agent per host streams events
to a central sink (Kafka / ClickHouse / MemGraph), and the verdict engine
correlates across hostnames by `machine-id`. That is how you spot a lateral
spray that opens files on 3 hosts within 200 ms.

Talus ships that sink and an Enterprise fleet dashboard; the agent stays a
single static binary per host. Per-machine license:

```bash
pip install talus-process-monitor
talus license activate <KEY>
talus monitor --auto-kill        # detects + SIGKILL + streams to fleet
```

<a href="https://hartwell-labs.pl/talus-process-monitor/pricing.html?utm_source=blog&utm_medium=cta&utm_campaign=linux-process-monitoring"
   class="buy-button">View fleet pricing →</a>

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article",
"headline":"Linux Process Monitoring: From /proc to eBPF",
"description":"Three generations of Linux process monitoring and why eBPF tracepoints win for per-process, fleet-scale detection.",
"author":{"@type":"Person","name":"Bartosz Osiej"},
"datePublished":"2026-10-20","dateModified":"2026-10-20",
"mainEntityOfPage":{"@type":"WebPage","@id":"https://bo.hartwell-labs.pl/content/linux-process-monitoring-proc-to-ebpf"}}
</script>
