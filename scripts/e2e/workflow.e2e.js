// End-to-end workflow on the local dump copy (projects.md section 4: happy path, delegation, own-team
// access, rework, changes V2/V3, cancel, auto-complete, re-open, PMT view, negative checks, emails).
// Run: node scripts/e2e/workflow.e2e.js   (API on the local dump copy, see lib.js). It creates one
// 'E2E Test <time>' project; delete it afterwards (ids are printed at the end).
const {sql,api,check,done,form,today,plus}=require('./lib');
const PMT=63, COLLEAGUE=77, CMA=24, ARTA=50, CMB=31, ARTB=30, OTHER_MGR=21, OTHER_ART=26, VIDEO_MGR2=251;
const MA='manager/assigned-work-requests';
const ok=(r)=>r.status>=200&&r.status<300;
const hist=async(table,col,id,action)=>(await sql(`select count(*) n from ${table} where ${col}=? and action=?`,[id,action]))[0].n;
(async()=>{
  const name='E2E Test '+Date.now();
  // ---- 1. PMT raises a project in vertical A (Graphic, request type 1)
  let r=await api(PMT,'POST','work-requests',form({project_name:name,brand:'E2E',request_type_id:1,project_id:1,description:'E2E workflow test',about_project:{output_devices:['Print'],target_audience:['Doctors']},priority:'medium'}));
  check('PMT creates project', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,120)}`);
  const [wr]=await sql('select * from work_requests where project_name=?',[name]);
  const mgrs=(await sql('select manager_id from work_request_managers where work_request_id=?',[wr.id])).map(x=>x.manager_id);
  check('project row + managers saved', wr && wr.status==='pending' && mgrs.includes(CMA), `wr ${wr.id} managers ${mgrs}`);
  // ---- 2. accept: outsider manager cannot, CM A can, twice is rejected
  r=await api(VIDEO_MGR2,'PUT',`${MA}/${wr.id}/accept`,{});
  check('other-vertical manager cannot accept', [403,404].includes(r.status), r.status);
  r=await api(CMA,'PUT',`${MA}/${wr.id}/accept`,{});
  check('CM A accepts', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,100)}`);
  r=await api(CMA,'PUT',`${MA}/${wr.id}/accept`,{});
  check('accept twice -> 400', r.status===400, r.status);
  check('accept history', await hist('work_request_history','work_request_id',wr.id,'manager_accepted')>=1);
  // ---- 3. tasks: own artist OK, delegate to CM B OK, other vertical's artist 403, bad date 400
  const taskBody=(n,ids,extra={})=>({work_request_id:wr.id,task_name:n,description:'e2e',request_type_id:1,task_type_id:1,assigned_to_ids:ids,deadline:plus(10),task_count:2,...extra});
  r=await api(CMA,'POST',`${MA}/tasks`,taskBody('E2E T1',[ARTA]));
  check('CM A creates T1 for own artist', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,100)}`);
  const T1=r.body.data?.id;
  r=await api(CMA,'POST',`${MA}/tasks`,taskBody('E2E T2',[CMB],{request_type_id:2}));
  check('CM A delegates T2 to CM B (other Digilabs manager)', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,100)}`);
  const T2=r.body.data?.id;
  let before=(await sql('select count(*) n from tasks where work_request_id=?',[wr.id]))[0].n;
  r=await api(CMA,'POST',`${MA}/tasks`,taskBody('E2E bad',[ARTB]));
  check('CM A -> other vertical artist directly: 403', r.status===403, `${r.status} ${r.body.error}`);
  r=await api(CMA,'POST',`${MA}/tasks`,taskBody('E2E bad',[ARTA],{deadline:'2026-02-31'}));
  check('bad deadline 2026-02-31: 400', r.status===400, `${r.status} ${r.body.error}`);
  check('rejected creates wrote no task', (await sql('select count(*) n from tasks where work_request_id=?',[wr.id]))[0].n===before);
  check('T1 assignment + created history', (await sql('select user_id from task_assignments where task_id=?',[T1]))[0]?.user_id===ARTA && await hist('task_history','task_id',T1,'created')===1);
  // ---- R2 own-team access: T1 visible to CM A + artist A only
  for (const [u,exp] of [[ARTA,200],[CMA,200],[OTHER_ART,404],[CMB,404],[ARTB,404],[VIDEO_MGR2,404]]) {
    r=await api(u,'GET',`users/tasks/${T1}`);
    check(`GET task T1 as ${u} -> ${exp}`, r.status===exp, r.status);
  }
  for (const [u,exp] of [[ARTA,200],[CMA,200],[PMT,200],[COLLEAGUE,200],[OTHER_ART,403],[ARTB,403],[OTHER_MGR,403]]) {
    r=await api(u,'GET',`users/tasks/${T1}/history`);
    check(`T1 history as ${u} -> ${exp}`, r.status===exp, r.status);
  }
  // ---- delegation: CM B assigns T2 to own artist; not to Graphic artist; outsiders cannot
  r=await api(CMB,'POST','users/assign-task',{task_id:T2,user_id:ARTA,work_request_id:wr.id});
  check('CM B -> Graphic artist: 403', r.status===403, `${r.status} ${r.body.error}`);
  r=await api(OTHER_MGR,'POST','users/assign-task',{task_id:T2,user_id:ARTB,work_request_id:wr.id});
  check('uninvolved manager cannot delegate: 403', r.status===403, r.status);
  r=await api(CMB,'POST','users/assign-task',{task_id:T2,user_id:ARTB,work_request_id:wr.id,deadline:plus(12)});
  check('CM B assigns T2 to own artist B', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,100)}`);
  check('one assigned history row (was written twice)', await hist('task_history','task_id',T2,'assigned')===1);
  for (const [u,exp] of [[ARTB,200],[CMB,200],[CMA,200],[ARTA,404],[OTHER_ART,404]]) {
    r=await api(u,'GET',`users/tasks/${T2}`);
    check(`GET task T2 as ${u} -> ${exp}`, r.status===exp, r.status);
  }
  for (const [u,exp] of [[CMA,200],[CMB,200],[ARTB,200],[ARTA,200],[OTHER_ART,403],[VIDEO_MGR2,200],[OTHER_MGR,403]]) {
    r=await api(u,'GET',`work-requests/history/${wr.id}`);
    check(`project history as ${u} -> ${exp}`, r.status===exp, r.status);
  }
  // ---- 4. artists accept and submit
  for (const [u,t] of [[ARTA,T1],[ARTB,T2]]) {
    r=await api(u,'PUT',`users/tasks/${t}/accept`,{start_date:today()});
    check(`artist ${u} accepts task ${t}`, ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  }
  r=await api(ARTA,'PUT',`users/tasks/${T1}/accept`,{start_date:today()});
  check('accept task twice -> 400', r.status===400, r.status);
  r=await api(ARTB,'PUT',`users/tasks/${T1}/accept`,{start_date:today()});
  check('other artist cannot accept T1', [403,404].includes(r.status), r.status);
  const submit=async(u,t)=>api(u,'POST','users/tasks/submit',form({task_id:t,task_count:2,work_request_id:wr.id,link:'https://example.com'},{documents:`t${t}.txt`}));
  for (const [u,t] of [[ARTA,T1],[ARTB,T2]]) { r=await submit(u,t); check(`artist ${u} submits ${t}`, ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`); }
  let [t1]=await sql('select status,review,review_stage from tasks where id=?',[T1]);
  check('T1 completed + manager_review', t1.status==='completed' && t1.review_stage==='manager_review', JSON.stringify(t1));
  check('T1 document saved', (await sql('select count(*) n from task_documents d join task_assignments a on a.id=d.task_assignment_id where a.task_id=?',[T1]))[0].n>=1);
  // ---- 5. manager rework on T1, resubmit, approve
  r=await api(OTHER_MGR,'PUT',`${MA}/review`,{task_id:T1,action:'approved'});
  check('uninvolved manager cannot review T1', [403,404].includes(r.status), r.status);
  r=await api(CMA,'PUT',`${MA}/review`,{task_id:T1,action:'change_request',comments:'rework'});
  check('CM A sends T1 back', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  [t1]=await sql('select status,review,review_stage from tasks where id=?',[T1]);
  check('T1 back with artist', t1.status!=='completed', JSON.stringify(t1));
  r=await submit(ARTA,T1); check('artist resubmits T1', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,120)}`);
  r=await api(CMA,'PUT',`${MA}/review`,{task_id:T1,action:'approved'}); check('CM A approves T1', ok(r), r.status);
  r=await api(CMB,'PUT',`${MA}/review`,{task_id:T2,action:'approved'}); check('CM B (artist manager) approves T2', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  // ---- 6. share for client review
  r=await api(OTHER_MGR,'POST',`${MA}/share-for-client-review`,{work_request_id:wr.id,task_ids:[T1]});
  check('uninvolved manager cannot share: 403', r.status===403, r.status);
  r=await api(CMA,'POST',`${MA}/share-for-client-review`,{work_request_id:wr.id,task_ids:[T1]}); check('CM A shares T1', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  r=await api(CMB,'POST',`${MA}/share-for-client-review`,{work_request_id:wr.id,task_ids:[T2]}); check('CM B shares T2', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  // ---- 7. PMT: approve T1, change request on T2
  r=await api(OTHER_ART,'POST','work-requests/pm-approve',{task_id:T1}); check('artist cannot PM-approve', r.status===403, r.status);
  r=await api(PMT,'POST','work-requests/pm-approve',{task_id:T1}); check('PMT approves T1', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  check('project not completed while T2 open', (await sql('select status from work_requests where id=?',[wr.id]))[0].status!=='completed');
  const [reg]=await sql('select id from issue_register limit 1');
  const issueBody=(extra)=>({task_id:T2,requested_by_user_id:PMT,assignment_type:'mod',version:'V2',description:'e2e change',intimate_client:1,issue_register_ids:[reg.id],deadline:plus(15),...extra});
  r=await api(OTHER_ART,'POST','issue-register/assignment',issueBody());
  check('artist cannot request changes: 403', r.status===403, `${r.status} ${r.body.error}`);
  r=await api(PMT,'POST','issue-register/assignment',issueBody({task_id:999999}));
  check('change on unknown task: 404', r.status===404, r.status);
  r=await api(PMT,'POST','issue-register/assignment',form(issueBody({issue_register_ids:`[${reg.id}]`}),{files:'brief.txt'}));
  check('PMT requests V2 on T2 (multipart + file)', r.status===201, `${r.status} ${JSON.stringify(r.body).slice(0,120)}`);
  const V2=r.body.data?.id;
  let [iv2]=await sql('select * from issue_assignments where id=?',[V2]);
  check('V2 saved with task_id, version, status m_pending', iv2.task_id===T2 && iv2.version==='V2' && iv2.status==='m_pending');
  check('V2 change types saved', (await sql('select count(*) n from issue_assignment_types where issue_assignment_id=?',[V2]))[0].n===1);
  check('V2 created history + task change_request_created', await hist('issue_history','issue_assignment_id',V2,'created')===1 && await hist('task_history','task_id',T2,'change_request_created')===1);
  // ---- 8. change cycle
  r=await api(OTHER_MGR,'PUT',`${MA}/issue/${V2}/accept`,{}); check('uninvolved manager cannot accept V2: 403', r.status===403, r.status);
  r=await api(CMB,'PUT',`${MA}/issue/${V2}/accept`,{}); check('CM B accepts V2', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  r=await api(CMB,'PUT',`${MA}/issue/${V2}/accept`,{}); check('accept V2 twice -> 400', r.status===400, r.status);
  const listB=await api(CMB,'GET',`${MA}/issue-assignments?limit=-1`);
  const listO=await api(OTHER_MGR,'GET',`${MA}/issue-assignments?limit=-1`);
  check('V2 in CM B list, not in uninvolved manager list', listB.body.data?.some(i=>i.id===V2) && !(listO.body.data||[]).some(i=>i.id===V2), `${listB.status}/${listO.status}`);
  r=await api(CMB,'POST',`${MA}/assign-issue-to-user`,{issue_assignment_id:V2,user_id:ARTA}); check('CM B -> Graphic artist for V2: 403', r.status===403, `${r.status} ${r.body.error}`);
  r=await api(CMB,'POST',`${MA}/assign-issue-to-user`,{issue_assignment_id:V2,user_id:ARTB,deadline:plus(15)}); check('CM B assigns V2 to artist B', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  r=await api(ARTB,'PUT',`users/issues/${V2}/accept`,{start_date:today()}); check('artist B accepts V2', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  r=await api(ARTB,'PUT',`users/issues/${V2}/submit`,form({task_count:1,link:'https://example.com',description:'done'},{documents:'v2.txt'})); check('artist B submits V2', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  r=await api(CMB,'PUT',`${MA}/review`,{issue_id:V2,action:'approved'}); check('CM B approves V2', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  r=await api(CMB,'POST',`${MA}/share-for-client-review`,{work_request_id:wr.id,issue_ids:[V2]}); check('CM B shares V2', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  r=await api(PMT,'POST','work-requests/pm-approve',{issue_id:V2}); check('PMT approves V2', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,120)}`);
  // ---- 9. completion
  let [w]=await sql('select status from work_requests where id=?',[wr.id]);
  check('project auto-completed after last approval', w.status==='completed' && await hist('work_request_history','work_request_id',wr.id,'auto_completed')===1, w.status);
  // ---- 10. re-open by a new change (V3), then by a new task
  r=await api(PMT,'POST','issue-register/assignment',{task_id:T2,issue_id:V2,requested_by_user_id:PMT,assignment_type:'mod',version:'V3',description:'one more',intimate_client:1,issue_register_ids:[reg.id]});
  check('PMT requests V3 after completion', r.status===201, `${r.status} ${JSON.stringify(r.body).slice(0,100)}`);
  const V3=r.body.data?.id;
  [w]=await sql('select status from work_requests where id=?',[wr.id]);
  check('project re-opened with history', w.status==='accepted' && await hist('work_request_history','work_request_id',wr.id,'reopened')===1, w.status);
  check('V3 parent = V2, task_id = T2', (await sql('select issue_id,task_id from issue_assignments where id=?',[V3]))[0].issue_id===V2);
  for (const step of [
    ()=>api(CMB,'PUT',`${MA}/issue/${V3}/accept`,{}),
    ()=>api(CMB,'POST',`${MA}/assign-issue-to-user`,{issue_assignment_id:V3,user_id:ARTB}),
    ()=>api(ARTB,'PUT',`users/issues/${V3}/accept`,{start_date:today()}),
    ()=>api(ARTB,'PUT',`users/issues/${V3}/submit`,form({task_count:1},{documents:'v3.txt'})),
    ()=>api(CMB,'PUT',`${MA}/review`,{issue_id:V3,action:'approved'}),
    ()=>api(CMB,'POST',`${MA}/share-for-client-review`,{work_request_id:wr.id,issue_ids:[V3]}),
    ()=>api(PMT,'POST','work-requests/pm-approve',{issue_id:V3})]) { r=await step(); if(!ok(r)) { check('V3 cycle step', false, `${r.status} ${JSON.stringify(r.body).slice(0,120)}`); break; } }
  [w]=await sql('select status from work_requests where id=?',[wr.id]);
  check('V3 cycle done -> project completed again', w.status==='completed', w.status);
  r=await api(CMA,'POST',`${MA}/tasks`,taskBody('E2E T3 after completion',[ARTA]));
  [w]=await sql('select status from work_requests where id=?',[wr.id]);
  check('new task re-opens project with history', ok(r) && w.status==='accepted' && await hist('work_request_history','work_request_id',wr.id,'reopened')===2, `${r.status} ${w.status}`);
  // ---- cancel a change (manager), with the cancel handler's email path
  r=await api(PMT,'POST','issue-register/assignment',{task_id:T2,issue_id:V3,requested_by_user_id:PMT,assignment_type:'mod',version:'V4',description:'to cancel',intimate_client:1,issue_register_ids:[reg.id]});
  const V4=r.body.data?.id;
  r=await api(OTHER_MGR,'PUT',`${MA}/issue/${V4}/cancel`,{}); check('uninvolved manager cannot cancel V4: 403', r.status===403, r.status);
  r=await api(CMB,'PUT',`${MA}/issue/${V4}/cancel`,{}); check('CM B cancels V4', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0,100)}`);
  // ---- PMT view
  r=await api(PMT,'GET',`work-requests/my-requests?limit=-1&artist_name=${encodeURIComponent('Mahesh')}`);
  const mine=r.body.data?.find(x=>x.id===wr.id);
  check('PMT list: artist filter finds the project with tasks + changes', !!mine && mine.Tasks.length===3 && mine.Tasks.find(t=>t.id===T2).issueAssignments.length===2, `${r.status}`);
  r=await api(COLLEAGUE,'GET','work-requests/division/all?limit=-1&requester_name='+encodeURIComponent('a'));
  check('division colleague sees project', r.body.data?.some(x=>x.id===wr.id), r.status);
  // ---- emails queued (mail jobs fail locally on purpose: EMAIL_PORT=9)
  const { Queue } = require(require('path').join(require('./lib').repo, 'node_modules/bullmq'));
  const q=new Queue('mail-queue',{connection:{host:process.env.REDIS_HOST,port:Number(process.env.REDIS_PORT),password:process.env.REDIS_PASSWORD||undefined}});
  const jobs=[...await q.getJobs(['failed','waiting','delayed','active','completed'],0,400)].filter(j=>j.timestamp>Number(name.split(' ')[2]));
  const subjects=jobs.map(j=>j.data?.subject||j.data?.mailOptions?.subject||j.name);
  console.log('   mails queued during test:', jobs.length, [...new Set(subjects)].slice(0,30).join(' | '));
  check('mails were queued for the workflow steps', jobs.length>=10, jobs.length);
  await q.close();
  console.log('test project', wr.id, 'T1',T1,'T2',T2,'V2',V2,'V3',V3);
  await done();
})().catch(e=>{console.error(e);process.exit(1)});
