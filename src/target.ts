/** Targets must come from the current user's authorized GTM listing, never model inference. */
export type Target={clientId:string;accountId:string;containerId:string;publicId?:string;name:string};
export function resolveTarget(query:string,authorized:Target[]):Target {
 const q=query.trim().toLowerCase();if(!q)throw Error('Choose a client, container name or ID');
 const matches=authorized.filter(t=>[t.clientId,t.name,t.containerId,t.publicId,`accounts/${t.accountId}/containers/${t.containerId}`].some(v=>v?.toLowerCase()===q));
 const unique=[...new Map(matches.map(t=>[JSON.stringify([t.clientId,t.accountId,t.containerId]),t])).values()];
 if(!unique.length)throw Error('No authorized container matches');
 if(unique.length!==1)throw Error('Ambiguous target: select an exact account/container path');
 return unique[0];
}
export function assertExportTarget(target:Target,exported:any){
 const cv=exported?.containerVersion,c=cv?.container;
 if(String(cv?.accountId??c?.accountId??'')!==target.accountId||String(cv?.containerId??c?.containerId??'')!==target.containerId)throw Error('Export does not match authorized target');
 if(cv?.accountId!==undefined&&c?.accountId!==undefined&&String(cv.accountId)!==String(c.accountId))throw Error('Conflicting account identity');
 if(cv?.containerId!==undefined&&c?.containerId!==undefined&&String(cv.containerId)!==String(c.containerId))throw Error('Conflicting container identity');
}
export function objectKey(target:Target,runId:string){
 const parts=[target.clientId,target.accountId,target.containerId,runId];
 if(parts.some(x=>!x||x==='.'||x==='..'))throw Error('Invalid identity');
 return parts.map(encodeURIComponent).join('/')+'/container.json';
}
