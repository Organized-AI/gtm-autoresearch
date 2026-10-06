# Container Editor — a Claude Code mod

Say **"edit my container"** in Claude Code. A pane opens and asks where the container comes from:

| Choice | What happens |
|---|---|
| **GTM ID + Google sign-in** | Type `GTM-XXXXXXX`. Claude connects the Stape GTM MCP (`https://gtm-mcp.stape.ai/mcp`); run `/mcp` → **gtm** → **Authenticate** and sign in with Google. Claude reads the live container and works in a new workspace. |
| **Exported JSON file** | Type the path to a GTM export (Admin → Export Container). Claude edits a copy; the original is never overwritten. |
| **Sample container** | Saves the fictional Skyline Charters web + server containers to your folder so you can practise safely. |

Every change is listed in the pane. Rules the mod enforces:

- Never edits **Default Workspace** — it creates its own.
- Never overwrites your original export — it writes `*-edited.json` next to it.
- **Publishing is blocked** until you type the word "publish" yourself.

## Install (Claude Code v2.1.287+)

```
/plugin marketplace add Organized-AI/gtm-autoresearch
/plugin install container-editor@gtm-autoresearch
/reload-plugins
```

Then type `edit my container`, or `/edit-container` (`/edit-container reset` to start over).

Pairs with the [Container Atlas](https://atlas.organizedai.vip): audit first, then edit.
