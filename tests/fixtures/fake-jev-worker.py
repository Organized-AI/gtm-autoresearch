#!/usr/bin/env python3
import json, sys, time
r=json.load(sys.stdin); e=r['evidence']; mode=e.get('targetedIssue')
if mode=='malformed': print('not-json'); sys.exit(0)
if mode=='timeout': time.sleep(1)
if mode=='oversized': print('x'*200000); sys.exit(0)
if mode=='wrong': print(json.dumps({'status':'success','evidenceHash':'wrong','definitionHash':'wrong','requestedModel':'wrong','answers':{'evidenceSufficient':'pass','purchaseBehaviorPreserved':'pass'}})); sys.exit(0)
print(json.dumps({'status':'success','evidenceHash':e['evidenceHash'],'definitionHash':e['frozen']['contentHash'],'requestedModel':e['frozen']['requestedModel'],'answers':{'evidenceSufficient':'pass','purchaseBehaviorPreserved':'pass'},'uncertainty':0.2}))
