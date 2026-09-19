---
title: "Externum: a typed language that transpiles to Python and Bash — and its own benchmark caught two real bugs"
description: "How Externum compiles the same program to readable Python, standalone Bash, and a source-less bytecode artifact — what the design costs, what the benchmark proved, and the two VM bugs it exposed."
tags: [compilers, python, bash, programming-languages, buildinpublic]
date: 2026-09-19
canonical_url: https://bartoszosiej.github.io/content/externum-language-design
layout: post
published: true
tldr: "One typed source, three backends: readable Python, standalone Bash, and a .exbc artifact that runs without source. Honest design trade-offs, a hyperfine benchmark, and the two bytecode-VM bugs the benchmark itself caught — fixed same day."
---

## TL;DR

Externum is a statically-typed language I've been building that compiles one program three ways: to **plain readable Python**, to **standalone Bash** (a real `set -euo pipefail` script, no interpreter dependency), and to a **`.exbc` bytecode artifact** that runs on a small VM without shipping the source. The compiler is written mostly in Externum itself. This post is about the design trade-offs of multi-target transpilation, what the benchmark actually proved (and what my first, *wrong* benchmark claimed), and the two real VM bugs the benchmarking process exposed — root-caused and fixed within a day.

Try it in the browser first: [playground (no install)](https://bartoszosiej.github.io/externum/). Repo: [github.com/BartoszOsiej/externum](https://github.com/BartoszOsiej/externum) · `pip install externum` · MIT.

## Why transpile to *other* languages at all

Writing a new language is easy; the hard question is: **what does your user run when you're not there?** Every compiled language answers with "a binary for each OS × architecture you support." That's a support burden a solo maintainer cannot carry — so Externum never answers it. Instead it leans on runtimes that already exist everywhere:

- **Python** is on every server, laptop, and CI image on earth. Transpiling to plain CPython source means the user ships text files, can read and debug the output, and inherits the entire ecosystem for free.
- **Bash** is *in* every Unix. If your program's backend compiles to a portable script, "installation" means `scp` + `chmod +x`.
- **The bytecode VM** answers the third question: what if the user wants to *distribute* their tool without shipping source? Compile once to `.exbc`, hand the artifact to the VM — the source never leaves your machine.

None of this is a new insight (Lua did the "embed everywhere" thing decades ago), but making all three targets **first-class, same-source outputs** is the part I wanted.

## What the same program looks like on every target

```ext
def fact(n: Int) -> Int:
    if n <= 1:
        return 1
    return n * fact(n - 1)

print("6! =", fact(6))
```

`externum demo.ext --target python` produces ordinary Python you could ship as-is:

```python
def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

print("6! =", fact(6))
```

`--target bash` produces a real script — functions become bash functions with `local` params, recursion works, defaults become `${2:-default}`:

```bash
#!/usr/bin/env bash
set -euo pipefail
fact() { local n="$1"; if [ "$n" -le 1 ]; then printf '%s\n' 1; return 0; fi
         printf '%s\n' "$(( n * $(fact $(( n - 1 )) ) ))"; return 0; }
echo "6! = $(fact 6)"
```

And `--target bytecode` writes a `.exbc` artifact (magic `EXBC` + version + payload) that `externum run demo.exbc` executes without ever seeing the source. Constructs a target can't express (lists/dicts/classes in bash) produce **warnings, never silent empty output** — the old bash target once "compiled" by emitting nothing, and an empty file with exit code 0 is the kind of lie that costs someone a weekend.

## The benchmark: including my own false start

I benchmarked the arithmetic loop (2M iterations, identical output verified across implementations) with hyperfine. My **first measurement was wrong** — I'd invoked the CLI without a subcommand, which *transpiles and prints the generated code* instead of running it. That produced a flattering 4.5×-faster-than-CPython number, which I very briefly believed before noticing the output wasn't the program's output. HN would have found that in minutes; putting a wrong number in a README is how a Show HN dies.

The honest numbers (i7-4610M, hyperfine, [methodology + repro](https://github.com/BartoszOsiej/externum/tree/main/benchmarks)):

| Path | Time | vs Externum |
|---|---|---|
| `externum run` (full pipeline) | 551 ms ± 42 | 1.00× |
| Compiled artifact (compile once, run many) | 458 ms | 1.20× faster |
| CPython (idiomatic `for range`) | 340 ms ± 10 | 1.62× faster |
| Bash (`$(( ))`, no forks) | 6.16 s | **11.2× slower** |

So: **the Python target costs ~1.6× over hand-written CPython** — the price of a typed source and a portable multi-target story, not magic. Against Bash, same-source wins by an order of magnitude. The VM path is ~30× slower than the transpile paths and that's fine: it exists for run-without-source distribution, not for CPU-bound loops.

## The two bugs the benchmark caught

Building the benchmark was the best decision of the release, because it immediately fell into two holes:

1. **Module-level `x += 1` never stored the value.** The bytecode compiler's augmented-assignment path loaded the variable with `LOAD_GLOBAL` but stored with `STORE_VAR` — writing into a frame nobody ever read. The loop variable never incremented; the VM spun in a *silent infinite loop*. Worse, the operator map keyed on `"+"` while the parser delivers `"+="`, so every augmented op except `+=` would have silently executed as addition.
2. **Parenthesized right-hand sides became variable names.** The compiler couldn't strip outer parens, so `(a + b) % m` compiled to an attempt to load a global literally named `"(a + b) % m"`.

Neither was caught by CI, because the existing VM tests didn't use those constructs — a good reminder that **coverage measures what you wrote, not what users will**. Both are now root-caused, fixed, regression-tested (v4.2.0), and the VM runs the benchmark identically to CPython. I filed them as issues before fixing — [#21](https://github.com/BartoszOsiej/externum/issues/21) and [#22](https://github.com/BartoszOsiej/externum/issues/22) — because "benchmark caught real bugs, here's the postmortem" is worth more than the appearance of never having bugs.

## What I'd do differently

- **Benchmark before bragging.** The false 4.5× number almost shipped because I measured the wrong command. Every number in the README is now reproducible from the repo.
- **Empty output is a bug, not a feature gap.** The old bash target's silence was worse than a crash. Anything a target can't express must warn loudly at compile time.
- **Self-hosting is a forcing function.** Writing the compiler in the language it compiles means every language wart is personally painful, immediately.

The roadmap from here: a JS target (the natural next runtime that's already everywhere), more stdlib, and keeping the honest-limits section of the README as current as the features list.

- Repo: [github.com/BartoszOsiej/externum](https://github.com/BartoszOsiej/externum) · Playground: [bartoszosiej.github.io/externum](https://bartoszosiej.github.io/externum/) · `pip install externum` · MIT, ~380 tests
