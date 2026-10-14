import pathlib,json,math
out=pathlib.Path(__file__).parent
results={}
for f in sorted(out.glob('*.raw.json')):
 d=json.loads(f.read_text());frames=d['keyframes'];issues=[];maxdeg=0;maxspeed=0
 for i,k in enumerate(frames):
  if not 4<k['time']<9.5:issues.append('time outside strict interval')
  if i and k['time']<=frames[i-1]['time']:issues.append('nonincreasing time')
  if len(k['rotations'])!=25:issues.append('wrong joint count')
  for j,v in k['rotations'].items():
   if len(v)!=3 or not all(math.isfinite(x) for x in v):issues.append('nonfinite Euler')
   maxdeg=max(maxdeg,*map(abs,v))
   if (j.endswith('Tip') or j.endswith('Toe') or j.endswith('Heel')) and v!=[0,0,0]:issues.append('rotating marker')
   if i:maxspeed=max(maxspeed,math.sqrt(sum((v[a]-frames[i-1]['rotations'][j][a])**2 for a in range(3)))/(k['time']-frames[i-1]['time']))
 results[f.name]={'keyframes':len(frames),'firstTime':frames[0]['time'],'lastTime':frames[-1]['time'],'schemaDiagnosticIssues':issues,'maxAbsoluteEulerDegrees':maxdeg,'maxEulerVectorSecantDegreesPerSecond':maxspeed,'diagnosticOnly':True,'physicalAcceptance':'not evaluated','styleAcceptance':'not evaluated','limitations':'Secant Euler speed is not SO3 speed, spline acceleration, anatomical-envelope or continuous-time physics evaluation.'}
(out/'diagnostic.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
