---
layout: writing-samples
title: "Writing Samples"
permalink: /writing/
description: "Commissioned technical articles written for external publications."
published: true
---

<!--
PORTFOLIO // WRITING SAMPLES — WORKFLOW DODAWANIA KOLEJNYCH SAMPLE-ÓW:

1. Nowy plik: content/writing-samples/sample-<n>.md (trzymaj prefiks sample- —
   nazwa jest wykluczana w cross-post.yml, więc crier nigdy tego nie zsyndykuje)
2. Front-matter (minimum):
     layout: writing-sample         # WAŻNE: stub-layout, nigdy nie renderuje treści
     title: "..."
     client: "..."                  # np. "Draft.dev" albo "(original, published YYYY-MM-DD)"
     date: YYYY-MM-DD
     tags: [ ... ]
     published: false               # false dopóki firma nie da zielonego światła
     summary: "one-sentence teaser shown to logged-out visitors"
3. Treść artykułu = markdown pod front-matter. Leży w repo (jak wszystko), ale
   pełny tekst serwuje TYLKO worker po sprawdzeniu sesji (/api/writing/sample/<slug>);
   publiczny URL od Jekylla to sam stub z metadanymi (layout writing-sample).
4. Gdy firma zatwierdzi publikację: published: true + canonical_url (jeśli republikacja).

GATE LIMITATION (ważne przy NDA-materiałach):
Repo jest publiczne, więc raw.githubusercontent.com pokazuje każde body.
Artykuły pod NDA trzymaj W KV workera pod kluczem `ws:<slug>` (pełny .md):
    npx wrangler kv key put --binding BZ_KV "ws:sample-2" --path sample-2.md
Worker czyta najpierw KV, dopiero potem raw GitHub. Plik w repo może wtedy
zawierać sam front-matter (bez wrażliwej treści).
-->
