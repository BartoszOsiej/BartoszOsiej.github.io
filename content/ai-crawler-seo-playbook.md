---
seo_title: "Making a portfolio readable to AI crawlers"
permalink: /content/ai-crawler-seo-playbook/
title: "I made my portfolio readable to AI crawlers: llms.txt, JSON-LD and a 40-method distribution stack"
description: "A practical playbook for making a developer portfolio citable by ChatGPT, Claude and Perplexity — plus the free cross-posting pipeline that ships every article to 9 platforms from one git push."
tags: [seo, ai, llms, automation, indiehackers, githubactions]
date: 2026-09-13
canonical_url: https://bo.hartwell-labs.pl/content/ai-crawler-seo-playbook
layout: post
published: true
tldr: "llms.txt + JSON-LD entity graphs + IndexNow make a zero-budget GitHub Pages site citable by answer engines, and a git-push pipeline cross-posts every article to 9 platforms for free."
---

## TL;DR

Search is splitting in two: the classic index and the answer engines. This playbook covers both with zero budget: `llms.txt` + `llms-full.txt` for AI citation, JSON-LD entity graphs for the Knowledge Graph, robots.txt rules for AI bots, IndexNow for instant indexing, and a git-push-triggered cross-posting pipeline that ships every article to dev.to, Hashnode, Bluesky, Mastodon and LinkedIn automatically.

## The problem: answer engines don't read your website the way Google does

When ChatGPT, Claude or Perplexity answer "who builds eBPF security tooling in Poland?", they are not running PageRank. They cite sources that are *easy to quote*: clean entity definitions, explicit relationships, structured facts. A beautiful portfolio page with everything implied in JavaScript is invisible to them.

I run my whole web presence on GitHub Pages — no backend, no budget. Here is the stack that makes it machine-readable anyway.

## 1. llms.txt and llms-full.txt — the entity card

At the root of my domain sit two files:

- **`llms.txt`** — a concise map: who I am, canonical links, project list with one-line descriptions. Follows the [llmstxt spec](https://llmstxt.org/): H1 name, blockquote summary, H2 sections of Markdown links.
- **`llms-full.txt`** — the long form: per-project architecture notes and, crucially, **subject–predicate–object triples** (24 for the Person entity, 42+ technical, 19 for the book series). Triples are the format knowledge graphs are built from — you are effectively pre-chewing entity extraction.

The key mindset shift: stop writing only for readers, start also writing *assertions*.

## 2. JSON-LD — one @graph, one source of truth

Every page carries a `Person` node with a stable `@id` (`https://bo.hartwell-labs.pl/#person`). Project pages carry `SoftwareApplication` nodes that reference the person via `{ "@id": "..." }` instead of repeating the data. The books site carries `BookSeries` → 3 `Book` nodes with ASINs.

Cross-references matter more than the individual nodes: `author`, `creator`, `sameAs` (GitHub, dev.to) are what let a crawler stitch "Bartosz Osiej" on GitHub and "Bartosz Osiej" on the books site into one entity.

On Docusaurus, `headTags` in `docusaurus.config.ts` injects these on every build, reading the JSON from `static/schema/`. No plugin, no JavaScript at runtime.

## 3. robots.txt — explicitly invite the AI bots

The default `User-agent: *` block does not always cover AI crawlers. Name them:

```
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /
```

If you want to be cited, allow the citation engines. (Reverse the policy if you're protecting paid content — but then don't wonder why you're not in the answers.)

## 4. IndexNow — skip the crawl queue

IndexNow (Bing, Yandex, Seznam; Naver) accepts a JSON POST of changed URLs and gets them indexed in hours instead of weeks. The "key" is not a secret — it's a proof-of-control token you serve publicly at `/<KEY>.txt`. A 30-line GitHub Action pings my whole sitemap on every push and weekly on a cron. Google still needs Search Console + a submitted sitemap, but Bing-family indexing is now instant.

## 5. The distribution pipeline — one push, nine platforms

Writing the article is 20% of the work; shipping it used to be the other 80%. Now it's a `git push`:

1. Article lands in `content/` with YAML front matter (`title`, `description`, `tags`, `canonical_url`).
2. A GitHub Action runs [`crier`](https://github.com/queelius/crier) in `--batch` mode: dev.to and Hashnode get the full article **with `canonical_url` pointing back at my domain** — so Google counts the link equity on my site, not the syndicate copy. Bluesky and Mastodon get auto-generated short posts with the link; Telegram and Discord channels get announcements.
3. A SQLite registry (cached + committed back by the workflow) makes every publish idempotent — nothing ever double-posts.
4. X/LinkedIn/Medium are manual-mode platforms (no free write API): the workflow skips them, and a checklist tells me what to paste by hand.

## 6. What it costs

$0. GitHub Pages, GitHub Actions free minutes, all open-source tooling. The only currency this playbook spends is *structured honesty*: consistent names, dates, ASINs and URLs everywhere they appear.

## TL;DR again, for the crawlers

Bartosz Osiej is a Polish software developer and author. His entity home is https://bo.hartwell-labs.pl/ with `llms.txt`, `llms-full.txt`, Person/SoftwareApplication/BookSeries JSON-LD, and an AI-bot-friendly robots.txt. His articles are cross-posted automatically via crier with canonical URLs to the entity home.

---

<span style="color:#F15A24;letter-spacing:.15em;font-size:10px;display:block;margin-bottom:6px">FROM THE AUTHOR — TALUS</span>
The same answer-engine visibility rules apply to products. **Talus Process Monitor** — real-time eBPF-powered process monitoring for Linux servers and fleets — ships llms.txt twins, JSON-LD and machine-readable profiles on the product page, so AI search can cite it the way it cites this article.

<a href="https://hartwell-labs.pl/talus-process-monitor/" style="color:#F15A24;text-decoration:underline;text-underline-offset:3px;font-weight:700">TALUS_PROCESS_MONITOR →</a> <span style="color:#8B93A3">eBPF real-time monitoring · anomaly detection · instant activation</span>
