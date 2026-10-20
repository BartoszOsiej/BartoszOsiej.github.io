---
layout: post
title: "eBPF vs Traditional Monitoring: Why Kernel-Level Wins"
description: "eBPF vs traditional monitoring — kernel-attached events beat polling and log parsing for accuracy, overhead, and response time on Linux."
canonical_url: https://bo.hartwell-labs.pl/content/ebpf-vs-traditional-monitoring
tags: [ebpf, monitoring, linux, performance, talus]
date: 2026-10-20
tldr: "Traditional monitoring polls /proc or parses logs — both are lossy under load. eBPF attaches in-kernel and never blocks the traced task, so you see the ransomware before it finishes."
---
## The latency tax of polling

Traditional Linux monitoring is built on two lies:

1. "Sampling every second is good enough."
2. "Logs arrive in order and are never dropped."

Both break under load. A ransomware process that opens 4000 files in 120 ms
between two 1s polls is invisible to generation-1 `/proc` scrapers. A
`journald`/syslog pipeline that buffers under burst **reorders** events, so the
alert that says "encryptor X ran" arrives after X has already finished.

eBPF does not have this problem. An eBPF tracepoint fires **in kernel space at
the syscall boundary** — the event is read by userspace from a lockless ring
buffer, with a timestamp taken before the syscall returns to userspace. There is
no polling interval to miss, no log line to drop, no context switch to stall.

## The overhead inversion

The counterintuitive result, which I verified while writing
[ebpf-ransomware-monitor-lessons](https://bo.hartwell-labs.pl/content/ebpf-ransomware-monitor-lessons),
is that eBPF monitoring has **lower overhead** than doing nothing under pressure:

- `ptrace(PTRACE_ATTACH)` stops the tracee on every syscall — throughput
  collapses the instant you attach broadly. eBPF does **not** stop the task; it
  runs a verified callback and returns to userspace.
- Parsing `/proc` is O(pids) and grows with process churn; eBPF is O(events)
  and the kernel already had those events.
- At >100k open/s the `/proc` scraper starts competing with the workload for
  inode and dentry locks; the eBPF program does not touch those locks at all.

## Accuracy: attribution that can't be faked

Traditional tools attribute work to a **PID** (a number that recycles) or to
**stdout/stderr text** (which an attacker can write to selectively). eBPF
tracepoints come with the kernel's own view: pid, tgid, uid, gid, absolute
inode, and `task->comm` — all kernel-attributed, none spoofable from userspace.

For ransomware this is the difference between "alert: something wrote files" and
"alert: pid 3412 (`systemd-resolve`... no, a renamed `python` with inode
`/var/lib/.x/enc`) opened 3412 files for write in 0.8 s and is renaming each
`.doc` → `.doc.ez`." The second one kills processes safely; the first one pages
an on-call engineer at 3 a.m. for a backup job.

## Response without round-trips

Traditional monitors detect, page, and wait for a human. eBPF programs can
**act in the same kernel boundary**: queue a `SIGKILL`, open a Landlock
restrict, or drop network — before the syscall returns to userspace. That is
not theoretical: Talus's `--auto-kill` fires `SIGKILL` in under 1 s of the first
mass-open, on the same box, no network hop.

## When traditional still wins

eBPF is not magic duct tape:

- **Portability to old kernels.** eBPF CO-RE needs 5.8+ / BTF. Ships in 2020,
  but some long-term enterprise distros still lag.
- **One-off debugging.** `strace` remains the fastest way to answer "what did my
  one test do just now." eBPF tools like bpftrace own this too, but the mental
  model is heavier.
- **Compliance retention.** Some auditors still ask for logs you can grep in
  vim at 2 a.m. eBPF pipelines still ship to a log sink; it is complementary.

## The kernel-level conclusion

Monitoring that lives in userspace and polls is, by construction, watching the
past. Monitoring that lives in the kernel with eBPF is watching the present —
and can act before it becomes history. That is why Talus ships its detector as
an eBPF program and its response guardrails in the same one-second window.

<a href="https://hartwell-labs.pl/talus-process-monitor/?utm_source=blog&utm_medium=cta&utm_campaign=ebpf-vs-traditional-monitoring"
   class="buy-button">Run Talus on your servers →</a>

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article",
"headline":"eBPF vs Traditional Monitoring: Why Kernel-Level Wins",
"description":"Kernel-attached eBPF events beat polling and log parsing for accuracy, overhead and same-second response.",
"author":{"@type":"Person","name":"Bartosz Osiej"},
"datePublished":"2026-10-20","dateModified":"2026-10-20",
"mainEntityOfPage":{"@type":"WebPage","@id":"https://bo.hartwell-labs.pl/content/ebpf-vs-traditional-monitoring"}}
</script>
