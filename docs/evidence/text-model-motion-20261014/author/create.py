import json, math, pathlib, hashlib
out=pathlib.Path(__file__).parent
reqpath=pathlib.Path('work/model-selection-20261014/text-motion-experiment/chinese-classical.request.json')
req=json.loads(reqpath.read_text()); names=[j['name'] for j in req['context']['skeleton']['joints']]
def pose(t,x,z,k,tw,lean,la,ra,lf,rf,lw,rw,step=0,turn=0,raiseheel=0):
 r={n:[0,0,0] for n in names}
 r.update(Hips=[0,turn,0],Spine=[-2,tw*.45,lean*.5],Chest=[-2,tw*.55,lean*.5],Neck=[1,-tw*.25,-lean*.25],Head=[0,-tw*.15,0])
 for side,a,f,w,s in [('Left',la,lf,lw,1),('Right',ra,rf,rw,-1)]:
  r[side+'Shoulder']=[0,0,s*min(8,abs(a[2])*.08)]
  r[side+'UpperArm']=a;r[side+'ForeArm']=[-f,0,0];r[side+'Hand']=w
  # Fresh authored soft knee geometry, not a captured/template pose.
  bend=k+(max(0,s*step)*.6)
  r[side+'UpperLeg']=[-bend*.5,0,step]
  r[side+'LowerLeg']=[bend,0,0]
  r[side+'Foot']=[-bend*.5+raiseheel,0,-step]
 root=[x,round(1.05-.91*(1-math.cos(k*.5*math.pi/180))+.10*math.sin(raiseheel*math.pi/180),5),z]
 return {'time':t,'root':root,'rotations':r}
def save(name,summary,rows):
 data={'summary':summary,'keyframes':[pose(*row) for row in rows]}
 target=out/(name+'.raw.json')
 encoded=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
 if target.exists():
  if target.read_text()!=encoded: raise RuntimeError('Immutable raw exists; use revision-N')
 else: target.write_text(encoded)
 return data
# Each row is a newly authored simultaneous whole-body key pose: time, root X/Z,
# knee, trunk twist/lean, two upper arms, elbows, wrists, lateral stepping.
classical=[
(4.12,0,0,2,0,0,[-2,0,16],[-2,0,-16],3,3,[0,0,0],[0,0,0],0),
(4.4,.008,0,10,-6,-2,[-16,0,26],[-8,0,-23],18,12,[-5,0,6],[-3,0,-4],1),
(4.72,.025,.005,16,-15,-5,[-38,-8,42],[-24,12,-32],38,32,[-10,0,10],[8,0,-8],3),
(5.06,.05,.008,12,-22,-7,[-65,-15,57],[-42,18,-38],55,58,[-16,0,12],[12,0,-10],5),
(5.4,.09,.01,10,-10,-3,[-78,-18,66],[-58,12,-50],44,68,[-8,0,16],[18,0,-12],7),
(5.74,.12,.012,14,6,3,[-58,-5,62],[-78,5,-65],62,42,[14,0,12],[-12,0,-16],3),
(6.08,.12,.012,10,20,6,[-35,15,44],[-72,-15,-58],64,48,[18,0,8],[-16,0,-12],0),
(6.42,.085,.008,14,24,7,[-42,12,36],[-62,-18,-52],60,58,[14,0,10],[-10,0,-14],-4),
(6.76,.035,.006,12,12,4,[-62,5,52],[-38,15,-40],42,64,[-10,0,12],[16,0,-10],-7),
(7.1,-.025,.002,16,-6,-3,[-75,-12,62],[-52,10,-52],48,56,[-14,0,14],[8,0,-14],-6),
(7.44,-.06,0,10,-20,-6,[-62,-15,55],[-76,-8,-62],60,40,[8,0,12],[-16,0,-12],-2),
(7.78,-.04,0,14,-12,-3,[-42,8,46],[-66,-12,-56],65,50,[16,0,8],[-10,0,-12],3),
(8.12,-.015,0,10,8,3,[-48,12,44],[-42,10,-42],52,58,[12,0,8],[12,0,-8],3),
(8.46,0,0,8,12,3,[-32,8,34],[-28,-8,-32],35,38,[8,0,5],[8,0,-5],0),
(8.82,0,0,4,4,1,[-12,2,22],[-12,-2,-22],14,14,[3,0,2],[3,0,-2],0),
(9.2,0,0,1,0,0,[-1,0,15],[-1,0,-15],1,1,[0,0,0],[0,0,0],0)]
save('chinese-classical','新创中国古典舞短句：双臂错层交替云手，躯干左右拧倾配小幅侧步，吸提后柔和收势。仅依据无音频120bpm计数与25关节骨架创作；未通过物理或舞种审计。',classical)
hiphop=[
(4.12,0,0,3,0,0,[-3,0,17],[-3,0,-17],6,6,[0,0,0],[0,0,0],0),
(4.4,.015,.015,28,-6,-3,[-22,0,32],[-18,0,-28],42,48,[8,0,4],[8,0,-4],2),
(4.7,.04,.025,14,8,4,[-38,8,44],[-32,-8,-42],82,78,[-12,0,8],[-12,0,-8],5),
(5,.065,.015,32,-10,-4,[-22,10,35],[-55,-12,-55],55,92,[14,0,12],[-15,0,-10],6),
(5.3,.09,0,12,14,5,[-52,-8,72],[-24,8,-30],90,55,[-25,0,12],[16,0,-8],3),
(5.6,.09,.018,30,5,2,[-50,-8,70],[-22,8,-28],88,52,[-22,0,12],[14,0,-8],0),
(5.9,.06,.03,16,-12,-5,[-28,6,35],[-58,-10,-72],55,88,[16,0,8],[-25,0,-12],-4),
(6.2,.025,.01,34,-4,-2,[-26,6,33],[-56,-10,-70],52,86,[14,0,8],[-22,0,-12],-6),
(6.5,-.025,-.01,16,12,5,[-60,-12,55],[-60,12,-55],95,95,[-18,0,8],[-18,0,-8],-7),
(6.8,-.05,.01,30,-10,-4,[-35,-6,42],[-35,6,-42],70,70,[15,0,12],[15,0,-12],-3),
(7.1,-.035,.025,12,8,3,[-16,0,74],[-16,0,-74],8,8,[18,0,18],[18,0,-18],4),
(7.4,0,.008,26,-8,-3,[-28,0,55],[-28,0,-55],38,38,[-12,0,12],[-12,0,-12],5),
(7.7,.025,-.01,12,12,4,[-48,10,38],[-30,-8,-48],90,70,[-20,0,8],[12,0,-8],2),
(8,.01,.008,24,-6,-2,[-24,5,34],[-42,-6,-36],55,84,[12,0,8],[-18,0,-8],-2),
(8.3,0,0,14,4,1,[-18,0,28],[-18,0,-28],40,40,[8,0,4],[8,0,-4],0),
(8.6,0,0,8,0,0,[-10,0,23],[-10,0,-23],22,22,[4,0,2],[4,0,-2],0),
(8.9,0,0,3,0,0,[-3,0,17],[-3,0,-17],6,6,[0,0,0],[0,0,0],0),
(9.22,0,0,1,0,0,[-1,0,15],[-1,0,-15],1,1,[0,0,0],[0,0,0],0)]
save('hip-hop','新创Hip-hop短句：屈伸groove配左右小步、交替前臂locking定点及开臂停顿，随后逐步收回放松站姿。没有音频输入；未通过物理或舞种审计。',hiphop)
ballet=[
(4.12,0,0,2,0,0,[-2,0,16],[-2,0,-16],3,3,[0,0,0],[0,0,0],0),
(4.45,0,0,12,0,0,[-20,0,24],[-20,0,-24],25,25,[-4,0,4],[-4,0,-4],0),
(4.78,0,0,26,0,0,[-35,-6,36],[-35,6,-36],40,40,[-8,0,6],[-8,0,-6],0),
(5.12,0,0,34,0,0,[-38,-8,44],[-38,8,-44],45,45,[-8,0,8],[-8,0,-8],0),
(5.46,0,0,22,0,0,[-25,-6,60],[-25,6,-60],24,24,[-5,0,12],[-5,0,-12],0),
(5.8,0,0,8,0,0,[-18,-4,76],[-18,4,-76],12,12,[-4,0,14],[-4,0,-14],0),
(6.14,0,0,2,0,0,[-44,-8,70],[-44,8,-70],22,22,[-6,0,12],[-6,0,-12],0,0,10),
(6.48,0,0,1,0,0,[-80,-10,58],[-80,10,-58],34,34,[-8,0,10],[-8,0,-10],0,0,18),
(6.82,0,0,1,0,0,[-115,-8,42],[-115,8,-42],38,38,[-8,0,8],[-8,0,-8],0,0,20),
(7.16,0,0,3,8,2,[-100,-6,48],[-72,10,-62],35,25,[-6,0,8],[-5,0,-12],0,0,12),
(7.5,0,0,14,12,3,[-72,-4,58],[-35,8,-70],28,18,[-6,0,10],[-4,0,-14],0),
(7.84,0,0,26,6,1,[-44,-6,62],[-25,6,-62],22,22,[-5,0,10],[-5,0,-10],0),
(8.18,0,0,18,0,0,[-32,-4,46],[-32,4,-46],30,30,[-6,0,8],[-6,0,-8],0),
(8.52,0,0,10,0,0,[-22,-2,32],[-22,2,-32],22,22,[-4,0,4],[-4,0,-4],0),
(8.88,0,0,4,0,0,[-8,0,20],[-8,0,-20],10,10,[-2,0,2],[-2,0,-2],0),
(9.22,0,0,1,0,0,[-1,0,15],[-1,0,-15],1,1,[0,0,0],[0,0,0],0)]
save('ballet','新创芭蕾短句：低位port de bras随demi-plié展开至二位，再抬臂形成高位弧线配小幅relevé，落跟屈膝收势。仅全脚关节抬跟，不表演pointe，不宣称独立趾/指动作。未通过物理或舞种审计。',ballet)
inputs=[reqpath,pathlib.Path('packages/core/src/motionFeasibility.ts'),pathlib.Path('packages/core/src/humanoid.ts'),pathlib.Path('packages/core/src/humanProfile.ts'),pathlib.Path('AGENTS.md')]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
trial={'actualModel':'gpt-6.1-sol','provider':'codex-session','externalAPICalls':0,'specializedMotionModelsUsed':False,'catalogOrRecordedClipsRead':False,'audioRead':False,'contextSHA256':{str(p):sha(p) for p in inputs},'rawSHA256':{p.name:sha(p) for p in sorted(out.glob('*.raw.json'))},'method':'General text model authored original simultaneous whole-body numerical key poses in this session. Local Python serializes authored pose rows, propagates inherited zero/relaxed-arm posture and applies a simple bilateral knee-height trigonometric approximation. No motion template/prior, external inference, training or audio was read. All marker joints retain zero rotation. No endpoint, outside trajectory or boundary velocity is generated; existing program must freeze them.','limits':['Not a Cloudflare inference; no provider API token/cost receipt is available for this Codex-session creation.','Sparse Euler poses do not establish continuous-time joint limits, contact, balance, collision, speed or acceleration.','Simple root height approximation is not IK or validated contact; stepping may slide and relevé contact is unvalidated.','Genre summaries express intent, not a style or naturalness score. Three short phrases do not establish arbitrary-genre capability.'],'revisionPolicy':'First raw output immutable; any later corrections must use separate revision-N files.'}
(out/'trial.json').write_text(json.dumps(trial,ensure_ascii=False,indent=2)+'\n')
