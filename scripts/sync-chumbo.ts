import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const target=new URL('../storage/chumbo/supabase/functions/gtm-autoresearch/engine/',import.meta.url);
await mkdir(target,{recursive:true});const hash=createHash('sha256');
for(const name of ['evaluator.ts','mutations.ts','connected.ts']){const source=await readFile(new URL('../src/'+name,import.meta.url));hash.update(name).update(source);const destination=new URL(name,target);if(process.argv.includes('--check')){if(!(await readFile(destination)).equals(source))throw Error('Bundled engine differs: '+name);}else await writeFile(destination,source);}
const version=`export const ENGINE_DIGEST = '${hash.digest('hex')}';\n`;
if(process.argv.includes('--check')){if(await readFile(new URL('version.ts',target),'utf8')!==version)throw Error('Engine digest mismatch');}else await writeFile(new URL('version.ts',target),version);
