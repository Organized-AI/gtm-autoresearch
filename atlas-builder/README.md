# Atlas Builder (Claude Code mod)

Builds your own GTM Container Atlas on your Cloudflare account, step by step. You answer questions and connect tools; Claude does the rest.

## Install

```
/plugin marketplace add Organized-AI/gtm-autoresearch
/plugin install atlas-builder@gtm-autoresearch
```

Restart Claude Code (or start a new session), then send:

> Build my own GTM Container Atlas with the Atlas Builder. Start with step 1 and ask me only what you need.

## What you see

- **Atlas build pane**: the ten steps with a ✓ as each finishes.
- **Your turn band** above the prompt whenever you need to act: sign in to Cloudflare, sign in to Google for the GTM MCP, pick your container, click Watch.
- `/atlas-build` shows progress; `/atlas-build reset` clears it. Send "continue building my container atlas" to pick up where you left off.

## The steps

1. Check Node, git and Wrangler
2. Get the atlas code
3. Sign in to Cloudflare *(you)*
4. Create the D1 database
5. Choose where Jev runs *(you)*: your own Workers AI, or the hosted Jev-gateway by Organized AI, free for 30 days
6. Deploy your atlas
7. Connect the GTM MCP *(you: Google sign-in)*
8. Audit your real container *(you: pick it)*
9. Watch for drift *(you: click Watch)*
10. Publish fixes, only when you type "publish"

You need your own Cloudflare account (free plan works) and Node 20+.
