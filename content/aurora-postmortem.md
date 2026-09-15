---
title: "A web OS that 'never booted': the two bugs that looked like kernel failures but were 404s and z-index"
description: "Aurora (a browser-based OS) stuck on 'Initializing kernel…' for days. The kernel was fine — the bundles were 404ing from GitHub Pages, and then desktop icons refused clicks because of one CSS line. Post-mortem."
tags: [web, typescript, debugging, deploy, github-pages]
date: 2026-09-15
canonical_url: https://bartoszosiej.github.io/content/aurora-postmortem
layout: post
published: true
tldr: "Aurora 'stuck on kernel init' was dist/ being gitignored (GitHub Pages serves the repo, not your build output) — and the follow-up 'icons don't click' was a full-bleed z-index:2 overlay swallowing pointer events. Two boring bugs, two days of 'the OS is broken'."
---

## TL;DR

Aurora is a browser-based OS — window manager, virtual file system, terminal, 8 apps — straight TypeScript with zero runtime deps. For two days it booted to a spinner and hung on "Initializing kernel…". The kernel never had a bug. The app was loading `dist/main.js` which did not exist on GitHub Pages, because `dist/` is gitignored and Pages serves from the repo. Then, after fixing that, the desktop icons silently ignored clicks. Second bug: a full-bleed layer at `z-index: 2` swallowed every pointer event meant for them.

## Bug one: GitHub Pages does not run your build

The page referenced `dist/style.css` and `dist/main.js`. The repo had `.gitignore` ignoring `dist/`. GitHub Pages does not execute `npm run build` for a static site source — it serves the committed tree. Result:

- HTML: 200 (committed)
- assets: 404 (never committed)
- boot: stuck at "Initializing kernel…" forever

The UI text made it look like a kernel hang, because the boot sequence awaited a bundle that would never arrive. **The fix was a one-liner that should have been a CI job:** commit the built output, or publish Pages from the `dist/` folder. I built the bundle and force-added it to the repo.

The deeper lesson is about failure mode. "OS stuck on kernel init" reads as a deep systems bug. It was a static-file deployment miss. The boot screen gives you no diagnostic; the console gives you a 404. Always check the network tab before the CPU.

## Bug two: the invisible layer that eats clicks

After the bundles went live, the OS booted — but desktop icons (double-click to launch) did nothing. Single click *did* select, so it felt random. The real cause:

```
#windows-layer { position: absolute; inset: 0; z-index: 2; }
```

A transparent full-viewport layer sits **above** the icon grid (`z-index: 1`). Even empty, an element with positive z-index and default `pointer-events: auto` captures pointer events that cross it. Icons never received the events; selection worked because… actually it didn't belong to that layer, but the launch (double-click) path went through the window layer's parent.

The fix:

```
#windows-layer { pointer-events: none; }
#windows-layer .win { pointer-events: auto; }
```

Click-through by default; opt-in only for actual windows. This pattern belongs in every layered UI: an empty layout container should never block input.

## What I'd do differently

1. **Walk the asset tree after every Pages deploy.** `curl` every referenced `dist/*` file. A missing bundle is a 30-second check, not a two-day mystery.
2. **Commit the build or CI-render it.** Pick one: either Pages builds from `dist/` (plugin) or the repo carries the bundle. Decide in the repo README so it doesn't drift again.
3. **Default pointer-events to none on layout scaffolding.** Only interactive surfaces (windows, buttons) should claim pointer events; containers should be transparent to input by policy, not by luck.

## Repo

[Aurora](https://github.com/BartoszOsiej/Aurora) — a complete browser OS: window manager, VFS, terminal (35+ commands), 8 apps, procedural audio (TypeScript, zero runtime deps).