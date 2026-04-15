import { readFile } from "node:fs/promises";

// Re-declare the primitives locally (they're private to run-gtm-loop; duplicate for test)
interface JsonPatchOp {
  op: "add" | "replace";
  path: string;
  value: unknown;
}

function parseJsonPointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/"))
    throw new Error(`Invalid JSON Pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function navigate(doc: unknown, parts: string[]): { parent: unknown; key: string | number } {
  let parent: unknown = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (Array.isArray(parent)) parent = parent[parseInt(p, 10)];
    else if (parent && typeof parent === "object")
      parent = (parent as Record<string, unknown>)[p];
    else throw new Error(`bad segment ${p}`);
  }
  const last = parts[parts.length - 1];
  const key = Array.isArray(parent) && last !== "-" ? parseInt(last, 10) : last;
  return { parent, key };
}

function applyJsonPatch(doc: unknown, ops: JsonPatchOp[]): unknown {
  const result = structuredClone(doc);
  for (const op of ops) {
    const parts = parseJsonPointer(op.path);
    const { parent, key } = navigate(result, parts);
    if (Array.isArray(parent)) {
      if (key === "-") parent.push(op.value);
      else if (typeof key === "number") {
        if (op.op === "add") parent.splice(key, 0, op.value);
        else parent[key] = op.value;
      }
    } else if (parent && typeof parent === "object") {
      (parent as Record<string, unknown>)[key as string] = op.value;
    }
  }
  return result;
}

async function main() {
  const raw = await readFile(
    "content/clients/blade/web-GTM-W9S77T7.json",
    "utf-8",
  );
  const c = JSON.parse(raw);

  const beforeTags = c.containerVersion.tag.length;
  const targetTag = c.containerVersion.tag[0];
  const beforeConsent = targetTag.consentSettings;

  // Patch 1: append a new tag
  // Patch 2: replace consentSettings on the first tag
  const ops: JsonPatchOp[] = [
    {
      op: "add",
      path: "/containerVersion/tag/-",
      value: {
        tagId: "9999",
        name: "TEST - patch insert",
        type: "html",
        parameter: [],
      },
    },
    {
      op: "replace",
      path: "/containerVersion/tag/0/consentSettings",
      value: { consentStatus: "NEEDED" },
    },
  ];

  const patched = applyJsonPatch(c, ops) as typeof c;
  const afterTags = patched.containerVersion.tag.length;
  const afterLast = patched.containerVersion.tag[afterTags - 1];
  const afterConsent = patched.containerVersion.tag[0].consentSettings;

  console.log(`tags: ${beforeTags} → ${afterTags}`);
  console.log(`appended:`, { name: afterLast.name, tagId: afterLast.tagId });
  console.log(`consentSettings[0]:`, beforeConsent, "→", afterConsent);

  // Verify original is untouched (structuredClone)
  const origConsent = c.containerVersion.tag[0].consentSettings;
  const origTags = c.containerVersion.tag.length;
  console.log(
    `original still intact: tags=${origTags}, consent=${JSON.stringify(origConsent)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
