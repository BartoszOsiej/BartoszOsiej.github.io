---
seo_title: "dev.to's engagement layer, measured"
permalink: /content/devto-comment-layer-audit/
title: "I measured dev.to's engagement layer. 92% of posts get zero reactions, and the good comments aren't people."
description: "An evidence-based audit of synthetic engagement on dev.to: 460 posts sampled through the public API, 1,366 comments across 346 accounts, and why comment volume is the one metric you should never treat as signal."
tags: [security, forensics, data-analysis, python, devto, content-strategy, measurements]
date: 2026-10-14
canonical_url: https://bo.hartwell-labs.pl/content/devto-comment-layer-audit
layout: post
published: true
tldr: "Two independent audits and a 460-post sample show that dev.to's engagement layer is largely machine-shaped. The practical consequence for anyone publishing there: stop optimising for reactions, because the number is farmable."
---

## TL;DR

I ran three measurements on dev.to using its public API. The results are not a matter of taste:

- **91.7% of posts receive zero reactions. 95.7% receive zero comments.**
- The curated feed shows a mean of 28.8 reactions. The real site shows **0.21**. The feed is a selection filter, not a sample.
- **Publishing more makes each post do worse.** Authors with 1–5 posts in a month: 23.3% of them got a reaction. Authors with 21–25: **7.5%**.
- The strongest comments are frequently automated. Across a 1,366-comment sweep, the same accounts sprayed the same template across **14–22 unrelated threads**, and distinct accounts reused identical 4-grams.

The conclusion is not "dev.to is bad". It is narrower and more useful: **comment and reaction counts on this platform are farmable, and a farmable metric carries no information.** If you are publishing there, optimise for being worth following, not for the counter going up.

## Why I checked

I publish there too. My account had 27 posts and a combined reaction count of zero — which is either a signal that the writing is bad or a signal that the signal is broken. Those have very different remedies, so it was worth measuring.

Everything below comes from the public API. Nothing here is inferred from vibes.

## Measurement 1: what the site actually looks like

The obvious way to sample dev.to is to read the listings, which show a curated selection. That method is wrong, and it is wrong in a flattering direction.

Someone sampling 2,500 posts from the feed and filtering to August got a pleasant picture:

| | curated feed | random sample of the site |
|---|---|---|
| posts | 170 | 460 |
| mean reactions | 28.8 | **0.21** |
| zero reactions | 0.0% | **91.7%** |
| ≥10 reactions | 70.6% | 0.4% |
| zero comments | — | 95.7% |

The omissions are not random. Posts the listing *included* averaged 0.40 reactions; posts it *skipped* averaged 0.15. Sampling through the feed hands you a rosier platform than the one that exists.

One useful control: posts 14–20 days old had a 13.6% chance of any reaction; posts 42–48 days old, 15.0%. Nothing meaningful arrives after the first fortnight. If your post is flat at two weeks, waiting longer will not fix it.

## Measurement 2: volume is actively counterproductive

The relationship between how much you post and how each post does is inverted, and it is steep:

- Authors publishing **1–5 posts** in August: **23.3%** of their posts got a reaction.
- Authors publishing **21–25 posts** in August: **7.5%**.

Those high-volume authors produced 18,386 of the 45,400 posts in the corpus. They are not a curiosity — they are the majority of what the platform serves, and they are the least rewarded.

This is worth stating plainly because the instinct when a post flops is to publish more. On this platform that instinct is wrong in a measurable way.

## Measurement 3: the good comments are synthetic

Here is the part that should change behaviour, because I expected obvious bot slop and did not find any.

On one thread with 35 reactions and 14 comments, the comments were unusually good — substantive pushback, real technical counter-examples. Too good. Reading fourteen in sequence revealed a skeleton: validate the author's framing, add one measured nuance, mention a product the account is named after, cite a number.

Structural counts on the eight non-author comments:

| signal | count |
|---|---|
| product/company plug | 4 / 8 |
| opens by validating a phrase | 5 / 8 |
| genuinely pushes back | 2 / 8 |
| auto-generated username (random hex) | 1 |

A detector built for the old "Great post!" style scored these at a mean coziness of **0.25** — confidently human. It was not broken. It was built to catch cliches, and these comments arrive armoured with exactly the thing that defeats it: real specifics.

Widening to 38 articles, **1,366 comments, 346 accounts**, the fingerprint held:

- The most prolific commenters appeared on **14–22 distinct articles each** — the same accounts, including on the original thread.
- Distinct accounts reused identical 4-grams. One phrase appeared across **13 different accounts**. Humans do not converge on phrasing; templated output does.
- 11 accounts left long product plugs; 32 opened with phrase-validation; 4 ran the full skeleton end to end.

Separately, an audit of another account's MCP posts identified the single strongest comment on the thread as coming from an account that **publishes two full technical articles one second apart, every day, at the same minute past midnight UTC**. No human batches on that schedule. The sophisticated comment was the product, and it was better at looking like real feedback than real feedback is.

## Why detection does not rescue you

The instinct is to reach for a classifier. That does not work, and there is peer-reviewed evidence for it.

- Meng et al. (2025) found people at **50.8%** accuracy distinguishing fake from real product reviews — a coin flip. Detectors did no better.
- Krishna et al. (NeurIPS 2023) showed light paraphrasing collapses DetectGPT from **70.3% to 4.6%**, and defeats GPTZero, OpenAI's classifier, and watermarking.
- Liang et al. (Patterns 2023) showed detectors are biased against non-native English writers and trivially bypassable by prompting.

Specificity is camouflage. The "real technical detail" that makes a synthetic comment feel human is the same mechanism that blinds the detector.

## What actually survived

One result, and it is the only one I found that held up. In a within-author comparison — each writer against their own baseline, to strip out audience size — every stylistic effect collapsed to roughly zero:

| title pattern | effect on reactions |
|---|---|
| first person ("I", "my") | −0.08 |
| listicle / numbered list | −0.08 |
| question mark | −0.08 |
| colon | 0.00 |

The phrasing was never doing the work. It was a marker of *which kind of account* was posting. What survived was the tag choice and whether anyone was already reading you.

So the strategy inverts: **do not optimise the post, build the reason to read the next one.** That means a profile with a real website on it, an identity, and a reason to follow. The post is the entry point, not the asset.

## The uncomfortable part

The bots are a demand signal. Nobody funds a content operation against one keyword cluster, twice a day, indefinitely, for nothing. That cluster converts into affiliate revenue, lead generation, or SEO authority someone intends to sell. Automated capital farming a topic is downstream evidence the topic has money in it.

The inversion is that once the commentary layer is mostly machines, the genuine builders are not a slice of the audience — they are the whole of it, and they are rare. Which is why the number to watch is not reactions. It is whether the people who come back brought something specific with them.

All measurements above use dev.to's public API and are reproducible by anyone with the same queries. The scripts are public: [`analyze_devto.py`](https://github.com/P0rt/the_cozy_web) and [`sweep_devto.py`](https://github.com/P0rt/the_cozy_web).