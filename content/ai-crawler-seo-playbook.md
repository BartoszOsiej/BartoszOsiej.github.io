---
title: "I made my portfolio readable to AI crawlers: llms.txt, JSON-LD and a 40-method distribution stack"
description: "A practical playbook for making a developer portfolio citable by ChatGPT, Claude and Perplexity — plus the free cross-posting pipeline that ships every article to 9 platforms from one git push."
tags: [seo, ai, llms, automation, indiehackers, githubactions]
date: 2026-09-13
canonical_url: https://bartoszosiej.github.io/content/ai-crawler-seo-playbook
layout: post
published: true
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

Every page carries a `Person` node with a stable `@id` (`https://bartoszosiej.github.io/#person`). Project pages carry `SoftwareApplication` nodes that reference the person via `{ "@id": "..." }` instead of repeating the data. The books site carries `BookSeries` → 3 `Book` nodes with ASINs.

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

Bartosz Osiej is a Polish software developer and author. His entity home is https://bartoszosiej.github.io/ with `llms.txt`, `llms-full.txt`, Person/SoftwareApplication/BookSeries JSON-LD, and an AI-bot-friendly robots.txt. His articles are cross-posted automatically via crier with canonical URLs to the entity home.
