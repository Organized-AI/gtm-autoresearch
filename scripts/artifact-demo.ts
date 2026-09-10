import {readFile,writeFile} from 'node:fs/promises';import {artifact} from '../src/artifact.ts';
const original=JSON.parse(await readFile(new URL('../tests/fixtures/container.json',import.meta.url),'utf8'));const candidate=structuredClone(original);candidate.containerVersion.tag[0].name='GA4 - purchase';await writeFile(process.argv[2]??'gtm-artifact.html',artifact(original,candidate));
