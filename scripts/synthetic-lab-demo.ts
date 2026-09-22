import { observeSyntheticCase } from "./synthetic-lab-adapter.js";
const root=process.env.SYNTHETIC_GTM_LAB_PATH;if(!root)throw new Error("Set SYNTHETIC_GTM_LAB_PATH to the local synthetic-gtm-lab checkout");
console.log(JSON.stringify(await observeSyntheticCase(root,"case-008","2026-01-02T06:00:00Z"),null,2));
