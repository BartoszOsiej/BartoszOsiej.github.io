---
layout: post
title: "Fleet Monitoring for Linux: Managing 100+ Servers Without Kubernetes"
description: "How to run eBPF-based process monitoring across 100+ Linux servers without Kubernetes. Per-machine licensing, fleet dashboard, and SIGKILL response with Talus."
canonical_url: https://bo.hartwell-labs.pl/content/fleet-monitoring-linux-without-kubernetes
tags: [linux, ebpf, fleet, monitoring, talus]
date: 2026-10-20
tldr: "You do not need Kubernetes to run fleet monitoring. A one-binary eBPF agent per host, a shared Kafka/ClickHouse sink, per-node licensing, and one dashboard. Here is how Talus runs 100+ hosts that way."
---
## The misconception

"Fleet monitoring = Kubernetes monitoring." It is not. Kubernetes is a
scheduling/orchestration control plane that some fleets happen to use. Most
Linux fleets — edge, bare metal, on-prem, air gaps, mixed distros — are just
hosts that need watching. You should not have to stand up a cluster to watch
them.

The right mental model: **an agent per host** (one static binary), **a shared
event sink**, and **one dashboard keyed to a per-host identity** that survives
re-imaging. Everything else is implementation detail.

## Why agents that are "just a CLI" fail at fleet scale

Tools that work on one host and fall apart at 100 nodes:

- They write state to `/tmp` keyed by hostname → PID/host confusion when hosts
  are rebuilt.
- They assume a single machine-id, so a fleet dashboard can't tell host A from
  host B after a re-image.
- They have no fleet identity, so correlation is "grep the logs by hostname"
  (slow, lossy) instead of "join on machine-id."

Talus's fleet model is deliberately the anti-silo: every event carries the
host's `machine-id` (and a per-machine license seat), and the agents all speak
the same wire format to a shared sink.

## The fleet stack (one binary, no cluster)

```
host A        host B        host N
  |             |             |
talus          talus         talus
(1 static      (same          (same
 binary)       binary)        binary)
  |             |             |
  +------+------+------+-----+/
         |               |
    Kafka / ClickHouse   MemGraph (process tree)
         |
   dashboard + SIEM
```

- **Agent**: one ELF (x86_64 + aarch64), eBPF tracepoints, signed audit log.
- **Sink**: Kafka topics, ClickHouse, or MemGraph — pick one, all ships.
- **Licensing**: per-machine annual keys, `machine-id`-pinned, server-side seat
  enforcement. Fleet tier is `$30/node/year` from 3 nodes.

## Deploy that survives chaos

At 100+ hosts the deployment story is what bites first. Talus's pattern that
works on mixed fleets:

1. **One package.** `pip install talus-process-monitor` on every distro, or the
   static binary from GitHub Releases — no package-manager wars.
2. **Root once, run without it.** eBPF load needs root/CAP_BPF at attach; after
   that the drain and scorer drop privileges via seccomp + Landlock. That is why
   Talus self-sandboxes — it matters more on a fleet than on one box.
3. **Identity via `machine-id`.** Each agent registers with
   `/etc/machine-id` + a per-node license. Re-imaging a node? `talus license
   deactivate` on the old, `activate` on the new — seats stay honest, no
   double-billing.

```bash
# fleet deploy example (any CM, here shaped as Ansible)
- hosts: all
  tasks:
    - name: install talus
      ansible.builtin.command: talus install
    - name: activate license
      ansible.builtin.command: talus license activate {{ talus_license_key }}
```

## Fleet threat detection you can actually read

The killer use-case is not "one host" but **cross-host timing**:

- 10:03:17 hostA opens 41k files — kill.
- 10:03:18 hostB opens 18k files — kill (lateral from A in <1 s).
- 10:03:19 hostC — blocked before it started, because the sink saw B's canary
  and pre-empted.

That timing is invisible to per-host-only tools and invisible to SIEMs fed by
polled logs. Kernel-attached agents feeding a shared sink are the only way to
see sub-second lateral moves.

## Managing seats and cost

- Fleet license: `$30 / node / year`, min 3 nodes, max 500, cancel any time.
- A node that goes dark stops billing only when you `deactivate` it — there is
  no "phantom usage" trap.
- Batch prepaid keys exist if procurement needs PO + net-30;
  `contact@hartwell-labs.pl`.

<a href="https://hartwell-labs.pl/talus-process-monitor/pricing.html?utm_source=blog&utm_medium=cta&utm_campaign=fleet-monitoring-linux"
   class="buy-button">Fleet pricing ($30/node) →</a>

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article",
"headline":"Fleet Monitoring for Linux: Managing 100+ Servers Without Kubernetes",
"description":"eBPF agent-per-host fleet monitoring without Kubernetes: per-machine licensing, shared Kafka sink, cross-host correlation.",
"author":{"@type":"Person","name":"Bartosz Osiej"},
"datePublished":"2026-10-20","dateModified":"2026-10-20",
"mainEntityOfPage":{"@type":"WebPage","@id":"https://bo.hartwell-labs.pl/content/fleet-monitoring-linux"}}
</script>
