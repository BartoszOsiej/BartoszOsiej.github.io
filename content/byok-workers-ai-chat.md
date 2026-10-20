---
seo_title: "A free BYOK AI chat on Cloudflare Workers"
permalink: /content/byok-workers-ai-chat/
title: "A free AI chat that costs me nothing: BYOK on Cloudflare Workers AI"
description: "How to run a public AI chat where every user pays from their own Cloudflare quota: token verification, account discovery, a streaming proxy, and the prompt-leak bug nobody warns you about."
tags: [cloudflare, workers-ai, byok, security, javascript, architecture]
date: 2026-10-13
canonical_url: https://bo.hartwell-labs.pl/content/byok-workers-ai-chat
layout: post
published: true
tldr: "Every user brings their own Workers AI token. The operator pays nothing, the quota is theirs, and the hard part isn't the auth — it's stripping your own directives out of a live token stream."
---

## TL;DR

There is no free tier that stays free. The usual answer is to buy credits and hope. There is another: **make the user pay, using their own key.** Workers AI gives out tokens; you relay the request. You pay $0, you never store a credential you didn't already hand you, and the abuse story collapses into "revoke your own token."

This is the architecture I used for the chat on `ai.hartwell-labs.pl`. It took an afternoon. The auth was twenty lines. The thing that actually broke me twice was something else entirely.

## The shape

A Worker with no AI binding at all. It never touches a model on your behalf — it forwards the caller's own credentials:

```js
async function handleChat(request) {
  const body = await request.json();
  const cfg = body.config;          // { provider, apiKey, accountId, model }

  if (!cfg.apiKey || cfg.apiKey.length < 8) return bad(400, "no_key");

  // Optional: confirm the token can actually list accounts
  const a = await fetch(
    "https://api.cloudflare.com/client/v4/accounts?per_page=1",
    { headers: { authorization: `Bearer ${cfg.apiKey}` } }
  );
  const ad = await a.json();
  if (!ad.success) return bad(400, "bad_token", ad.errors?.[0]?.message);

  const upstream = await fetch(BUILDERS[cfg.provider](cfg), {
    method: "POST",
    headers: { "content-type": "application/json", ...HEADERS[cfg.provider](cfg) },
    body: JSON.stringify({ model: cfg.model, stream: true, messages: body.messages }),
  });
  return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "text/event-stream" } });
}
```

That is genuinely the whole backend. Token lives in `localStorage`, goes up with each request, comes back down with the stream. The Worker holds nothing between calls.

Two details that matter more than the auth code:

**Account discovery removes a step.** `/client/v4/accounts?per_page=50` with the user's token returns their accounts. You auto-select the first, store it, and never show a picker. The user pastes a token and starts typing. One interaction, not three.

**Failure messages are the product.** Cloudflare answers a bad token with `6003: Invalid request headers / 6111: Invalid format for Authorization header` — which is a genuinely terrible thing to show a human who has pasted the wrong kind of credential. Map it to something actionable:

```js
if (msg.includes("Invalid format for Authorization header")) {
  return bad(400, "bad_token",
    "Token format invalid — use a scoped API Token (not Global API Key). " +
    "Create at: dash.cloudflare.com → My Profile → API Tokens → " +
    "Create Token → Account · Workers AI · Read");
}
```

Most people who paste a Global API Key into an OAuth-shaped field are not going to read an error code. They will read that sentence.

## The bug that cost me an hour

The model emits structured directives — this one edits a rich-text notepad in the browser:

```
Zapisuję.
[notepad action=new doc="Zakupy"]
- mleko
- chleb
[/notepad]
```

The client strips the tags and applies them. Simple, and it worked fine in testing with a complete response.

It failed in production, live, in the one place I never tested: **while the bytes were still arriving.**

Streaming means you re-render on every chunk. At some instant the accumulated buffer is:

```
Zapisuję.

- mleko
- chleb
[/notepad
```

The closing tag is half-formed. Every sensible "strip the complete directive" regex fails to match, because a complete directive is by definition not what's on screen yet. So the note contents — the part the user explicitly asked to be filed away — flash through the chat as a stray bullet list.

The fix is to give up on parsing completeness and delete everything after the opening tag:

```js
function stripDirectives(t) {
  return String(t || "")
    .replace(/\[notepad\b[^\]]*\][\s\S]*?\[\/notepad\]/gi, "")  // complete block
    .replace(/\[notepad\b[^\]]*\][\s\S]*$/gi, "")             // partial — from the tag to EOF
    .replace(/\[notepad\b[^\]]*\]/gi, "")
    .replace(/\[\/notepad\]/gi, "")
    .trim();
}
```

The second rule is the whole lesson. **In a stream, an unterminated construct is not "not yet valid" — it is already visible.** Treat anything from the opening delimiter onward as untrusted, every frame, and overwrite your buffer rather than patching it. Any renderer that accumulates and incrementally parses will eventually show you a half-built structure to the user.

## What it costs

The free tier is 10,000 neurons per day. `@cf/meta/llama-3.3-70b-instruct-fp8-fast` against a ~700-word system prompt plus a short exchange costs roughly 1,200–1,500 neurons per turn. I found this the honest way: the suite passed all morning, then returned

```
AiError: you have used up your daily free allocation of 10,000 neurons
```

on every single call. Latency sat at 5–10 seconds per turn — fast enough to feel real, slow enough that a user will notice. Both numbers are worth publishing, because "free AI chat" otherwise sounds like a promise instead of a budget.

BYOK doesn't make the model free. It makes the bill yours — which is the only version of "free" that survives contact with a real user base.

---

*Worker source for the chat lives at `ai.hartwell-labs.pl`. Everything else I write is public — [github.com/BartoszOsiej](https://github.com/BartoszOsiej).*