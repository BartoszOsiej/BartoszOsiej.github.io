# Build-in-public: 30-day prompt calendar

Source for `bip-draft.yml` — the workflow picks `Day N = (day-of-year mod 30)`.
One section per day; each draft gets auto-enriched with yesterday's commits.
**Voice rule:** drafts are scaffolding — rewrite at least one sentence in your own words before posting.

## Day 1 — Show the stack
Screenshot/diagram of the project constellation (linux-aegis, talus, externum, fortis, quantum-shield, NV2). One line each: what problem it kills. End: "which one should I deep-dive first?"

## Day 2 — Number drop
Post one real metric (192 externum tests, boot log timing, benchmark ops/sec). Explain why that number was hard to get. Never fake precision — say "measured on my machine, config in repo".

## Day 3 — The in-tree war story
How linux-aegis ships as four patches against upstream instead of a DKMS out-of-tree blob. Why "compiles in-tree, boots in QEMU from CI" was the whole battle.

## Day 4 — Teaser frame
"One of my projects compiles to Python, Bash AND a native binary from the same source. Guess why the Bash backend is the weird one." Answer in the next post.

## Day 5 — Dev-log snippet
Paste a 5-line terminal capture (talus catching a simulated churn burst, NV2 frame times). Caption: what the viewer is looking at in one sentence.

## Day 6 — Anti-hustle take
Build in public ≠ posting daily dopamine. I automate drafts and syndication precisely so the writing time goes into the work. Short, honest, no threads-of-threads.

## Day 7 — Weekend build
What got shipped this week across all repos (the workflow's commit list makes this trivial). One paragraph max, links to entity home.

## Day 8 — Explain like I'm five
eBPF in 3 sentences for non-kernel people: syscall syscall syscall — police inside the kernel watching every door. Then one line on why that's fast.

## Day 9 — Tooling shoutout
Name one OSS tool that saved you hours this week (crier, git-cliff, libbpf). Genuine recommendation, no affiliation — good-faith networking.

## Day 10 — Design decision
Why quantum-shield derives per-chunk keys instead of one global nonce. The bug class it prevents, in plain language.

## Day 11 — Fail post
Something that broke this week and the fix. The more mundane the better — reliability porn is boring, debugging stories are not.

## Day 12 — Writing corner
Line from The Stitcher Trilogy + one sentence on stitching horror with systems-brain discipline. Books and code are the same skill: constraints.

## Day 13 — Screenshot Saturday
Best visual of the week (NV2 voxel render, root page CRT aesthetic, terminal UI). Let the image do the work.

## Day 14 — Question to builders
Ask a real question you have (CO-RE portability across 6.x? ML-KEM key rotation UX?). Answer every reply — questions are the cheapest engagement there is.

## Day 15 — Milestone marker
Tag/release shipped? Post the changelog's best three lines. git-cliff makes this a copy-paste.

## Day 16 — Myth-busting
"You need a CS degree / a budget / a team to build systems software." You need a kernel tree, QEMU and stubbornness. Show the CI boot log as proof.

## Day 17 — Architecture candy
One Mermaid diagram (fortis boot chain or NV2 pipeline). Caption: "every arrow is a link in a trust chain".

## Day 18 — Workflow flex
The pipeline itself: article → `git push` → 9 platforms. "I don't have a marketing team; I have GitHub Actions." Link the repo.

## Day 19 — Contrarian take (polite)
"Most 'post-quantum ready' tools are marketing until ML-KEM is in the default path." One argument, one caveat, invite pushback.

## Day 20 — Reading list
Three things you actually read this week (patch series, paper, blog). One sentence each on what changed in your head.

## Day 21 — Weekly wrap
Commits + what's next week. Consistency beats intensity — this is the post that compounds.

## Day 22 — Author life
KDP dashboard moment, a review, or the process of writing book 2's ending. Writers on dev Twitter are rare; use that lane.

## Day 23 — Mini-tutorial
One actionable tip (e.g., "add llms.txt to your site in 10 minutes"). Pure value post; nothing asked back.

## Day 24 — Progress bar
NV2_ENGINE frame time over the month, or externum test count trend. Small chart, big credibility.

## Day 25 — Behind the name
Why the projects are named what they're named (aegis, talus, fortis). Names are free branding; tell the story.

## Day 26 — Security PSA
One habit that actually helps devs (verify signatures, zeroize keys, pin CI base commits). No fear-mongering, one concrete command.

## Day 27 — Collab bait
"linux-aegis needs SELinux-stacking test scenarios — if you've done LSM stacking, I'd love your take." Specific asks get specific help.

## Day 28 — Tech/genre crossover
"The Stitcher is a crime-horror trilogy written like a distributed system: state, failure modes, irreversible operations." Post the good line.

## Day 29 — Open roadmap
Public TODO for the quarter. Accountability post; people return to check if you did it.

## Day 30 — Gratitude + links
Shout out people who replied/reshared this month. End with the entity home link. The 30-day loop restarts tomorrow.
