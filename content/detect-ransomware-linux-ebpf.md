---
layout: post
title: "How to Detect Ransomware Activity on Linux with eBPF"
description: "Guide to detecting ransomware on Linux using eBPF: mass-open scoring, canary reads, SIGKILL response, and fleet-wide correlation with Talus."
canonical_url: https://bo.hartwell-labs.pl/content/detect-ransomware-linux-ebpf
tags: [ebpf, security, linux, ransomware, rust, talus]
date: 2026-10-20
tldr: "Ransomware encrypts after it opens many files. Score per-process open rates with eBPF in 1-second windows, canary-read a canary file, and SIGKILL the encryptor before it finishes. Talus does this in one static binary."
---
## The shape of a Linux ransomware hit

Ransomware on Linux does not usually announce itself with a GUI. It looks like
a normal process that, in a short window, opens a large number of files for
writing, writes to them, and renames them to a new extension. The signatures
are always new; the **shape** is stable. That shape is what eBPF is built to
score.

This is the same material I wrote up in
[ebpf-ransomware-monitor-lessons](https://bo.hartwell-labs.pl/content/ebpf-ransomware-monitor-lessons),
but here I focus on the **detection steps** you can implement yourself, and
where Talus takes over so you do not maintain them.

## Why eBPF, and not syslog or /proc

Polling `/proc/<pid>` or parsing `auditd` logs is, by construction, **after the
fact** and lossy under load. eBPF runs at the kernel boundary: you get every
`openat`, `rename`, `unlink`, `write` event as it happens, in kernel space,
with a per-process attribution that never drops events even at ring-buffer
saturation (you get a `lost` counter, not silence).

The two eBPF tracepoints that carry the signal are
`tracepoint/syscalls/sys_enter_openat` (and the `exit_*` pair) and
`tracepoint/syscalls/sys_enter_unlink`/`rename`. You do **not** need full
`ptrace` overhead — tracepoints are stable ABI across kernel minor versions when
paired with BTF (Linux 5.8+, every distro since 2020).

## Step 1: score open-rate per process

Maintain a per-`(pid)` counter, increment on each write-capable `openat` with
`O_WRONLY|O_CREAT` or `O_RDWR`, and roll it over every **1-second window**.
The decision rule is embarrassingly simple and catches every public encryptor
I have benchmarked it against:

```c
/* pseudocode, maps to the kernel-space program in process-monitor-ebpf */
if (pid_count[pid] > THRESHOLD) verdict[pid] = ALERT;
```

Start with `THRESHOLD=50` files/second. On a real host the background load
(normal `rsync`, `find`, a compiler) is usually under 10/s; a mass-encryptor is
in the hundreds. Tune down to 20/s only if you have many compilers.

> A common mistake is using `cpu_cycle` counters instead of **file operations**.
> A process can burn CPU and be innocent; rapid **file opens for write** is the
> behavioral invariant of ransomware, not CPU.

## Step 2: the canary read

Rate-scoring gives false positives on `rsync`, `git checkout`, backup jobs.
Add a **canary read**: a decoy file placed on each host (`.canary` in `/var/lib`).
Any process that opens the canary and then starts writing to many other files
is behaving like ransomware, not like a backup tool that happens to walk the
tree. The canary read is cheap (one extra tracepoint match) and cuts noise
dramatically.

## Step 3: the kill guardrail

When verdict fires, you must terminate the process — but recklessness kills
production. Talus's kill path enforces four guardrails, all of which I would
implement for an in-house agent:

1. **Whitelist by path and binary name.** `/usr/bin/rsync`, `/usr/sbin/anacron`,
   the backup tool's real path — never kill these.
2. **Canary verification.** Only kill if the canary was read within the window.
3. **Parent attribution.** Kill the encryptor, not the shell that launched it
   unless the parent also opened files.
4. **Rate limit.** Max one kill per process per minute to prevent a looping
   process from DOS-ing the host.

## Step 4: correlate across the fleet

A single host can be patient-zero. The real value of fleet monitoring is
seeing **that three hosts in the same subnet started encrypting within 200 ms of
each other** and cutting lateral movement before it lands. Talus streams events
to Kafka/ClickHouse and lets you key on `hostname`, `pid`, and the
`machine-id`-derived fleet tag.

## Tuning notes from real boxes

- Threshold **50** is the sweet spot for >95% of servers. Database
  `pg_dump`, ELK bulk, and Kubernetes node rotation all sit below 20/s.
- On write-heavy analytics boxes (ClickHouse on a hot compacting node), raise the
  canary file path exclusion rather than the threshold — you still want to catch
  a real encryptor that is masquerading as a compactor.
- The decision window must be **one second**. Below that you risk killing a
  `tar` of many small files; above that you lose the "same-second" response that
  matters.

## Doing it yourself vs Talus

You can absolutely build Steps 1–3 from scratch; they are ~150 lines of eBPF +
a 200-line userspace scorer. But Steps 3 (guardrails) and 4 (fleet) are where
production systems break, and they are where Talus has shipped fixes. The
engine is MIT; if you prefer to own the policy layer, fork it. If you want to
**run it today**, the per-machine activation is:

```bash
pip install talus-process-monitor
talus license activate <KEY>      # 30-day Enterprise trial, no card
talus monitor --auto-kill        # <1s verdict to SIGKILL, canary-aware
```

<a href="https://hartwell-labs.pl/talus-process-monitor/?utm_source=blog&utm_medium=cta&utm_campaign=detect-ransomware-linux-ebpf"
   class="buy-button">Monitor with Talus →</a>

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article",
"headline":"How to Detect Ransomware Activity on Linux with eBPF",
"description":"Guide to detecting ransomware using eBPF open-rate scoring, canary reads, kill guardrails, and fleet correlation.",
"author":{"@type":"Person","name":"Bartosz Osiej"},
"datePublished":"2026-10-20","dateModified":"2026-10-20",
"mainEntityOfPage":{"@type":"WebPage","@id":"https://bo.hartwell-labs.pl/content/detect-ransomware-linux-ebpf"}}
</script>
