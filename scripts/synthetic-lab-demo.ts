import { observeSyntheticCase, buildSyntheticReplayRows } from "./synthetic-lab-adapter.js";
import { splitByGroup, assertGroupDisjoint, replayReport } from "./jev-offline.js";
const root=process.env.SYNTHETIC_GTM_LAB_PATH;if(!root)throw new Error("Set SYNTHETIC_GTM_LAB_PATH to the local synthetic-gtm-lab checkout");
const decisionTime="2026-01-02T06:00:00Z"; const observation=await observeSyntheticCase(root,"case-008",decisionTime); const rows=await buildSyntheticReplayRows(root,decisionTime); const split=splitByGroup(rows); assertGroupDisjoint(split); console.log(JSON.stringify({observation,splitCounts:Object.fromEntries(Object.entries(split).map(([key,value])=>[key,value.length])),report:replayReport(rows.map(row=>({...row,route:"review" as const})) )},null,2));
