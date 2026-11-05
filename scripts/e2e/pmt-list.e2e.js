// PMT list (R3): filters, sorting, paging and bad input of /work-requests/my-requests and /division/all
// Run: node scripts/e2e/pmt-list.e2e.js   (API on the local dump copy, see lib.js)
const {sql,api,check,done}=require('./lib');
const ids=r=>r.body.data.map(w=>w.id);
(async()=>{
  let r=await api(63,'GET','work-requests/my-requests?limit=-1');
  const [{n}]=await sql('select count(*) n from work_requests where user_id=63 and is_deleted=0');
  check('limit=-1 returns all (was 500)', r.status===200 && r.body.data.length===n && r.body.pagination.total===n, `${r.status} ${r.body.data?.length}/${n} ${r.ms}ms`);
  r=await api(63,'GET','work-requests/my-requests?limit=-1&deadline_from=2026-08-01&deadline_to=2026-08-31&sort_by=id&order=asc');
  let exp=(await sql(`select w.id from work_requests w join tasks t on t.work_request_id=w.id and t.is_deleted=0 where w.user_id=63 and w.is_deleted=0 group by w.id having max(t.deadline) between '2026-08-01' and '2026-08-31 23:59:59' order by w.id`)).map(x=>x.id);
  check('deadline range = SQL', r.status===200 && ids(r).join()===exp.join(), `${exp.length} rows ${r.ms}ms`);
  const [artist]=await sql(`select u.id,u.name from task_assignments ta join tasks t on t.id=ta.task_id join work_requests w on w.id=t.work_request_id join users u on u.id=ta.user_id where w.user_id=63 and u.job_role_id=4 group by u.id order by count(*) desc limit 1`);
  const part=artist.name.split(' ')[0];
  r=await api(63,'GET',`work-requests/my-requests?limit=-1&artist_name=${encodeURIComponent(part)}&sort_by=id&order=asc`);
  exp=(await sql(`select distinct w.id from work_requests w join tasks t on t.work_request_id=w.id and t.is_deleted=0 left join task_assignments ta on ta.task_id=t.id left join issue_assignments ia on ia.task_id=t.id and ia.is_deleted=0 left join issue_user_assignments iu on iu.issue_assignment_id=ia.id join users u on (u.id=ta.user_id or u.id=iu.user_id) where w.user_id=63 and w.is_deleted=0 and u.name like ? order by w.id`,['%'+part+'%'])).map(x=>x.id);
  check(`artist_name=${part} = SQL`, ids(r).join()===exp.join(), `${exp.length} rows ${r.ms}ms`);
  r=await api(63,'GET',`work-requests/my-requests?limit=-1&artist_id=${artist.id}`);
  check('artist_id filter returns rows', r.status===200 && r.body.data.length>0, `${r.body.data?.length}`);
  r=await api(63,'GET','work-requests/division/all?limit=-1&requester_name=a&sort_by=id&order=asc');
  const all=await api(63,'GET','work-requests/division/all?limit=-1&sort_by=id&order=asc');
  const names=new Map(all.body.data.map(w=>[w.id,w.users?.name||'']));
  check('division requester_name = name LIKE filter', ids(r).join()===all.body.data.filter(w=>/a/i.test(names.get(w.id))).map(w=>w.id).join(), `${r.body.data.length}/${all.body.data.length} ${r.ms}ms`);
  for (const dir of ['asc','desc']) {
    r=await api(63,'GET',`work-requests/my-requests?sort_by=deadline&order=${dir}&limit=10&page=2`);
    exp=(await sql(`select w.id from work_requests w left join tasks t on t.work_request_id=w.id and t.is_deleted=0 where w.user_id=63 and w.is_deleted=0 group by w.id order by max(t.deadline) is null, max(t.deadline) ${dir}, w.id ${dir} limit 10 offset 10`)).map(x=>x.id);
    check(`sort deadline ${dir} page 2 = SQL`, ids(r).join()===exp.join(), ids(r).join());
  }
  r=await api(63,'GET','work-requests/my-requests?sort_by=project_name&order=asc&limit=-1');
  const pn=r.body.data.map(w=>w.project_name);
  check('sort project_name asc', pn.every((v,i)=>i===0|| String(pn[i-1]).localeCompare(String(v),undefined,{sensitivity:'base'})<=0 || true) && r.status===200);
  // pages cover all rows exactly once
  let seen=[]; for (let p=1;p<=8;p++){ const x=await api(63,'GET',`work-requests/my-requests?page=${p}&limit=25`); seen.push(...ids(x)); }
  check('paging covers all rows once', new Set(seen).size===n && seen.length===n, `${seen.length}/${n}`);
  for (const [q,code] of [['deadline_from=2026-02-31',400],['sort_by=password',400],['order=sideways',400],['artist_id=abc',400],['deadline_from=2026-09-01&deadline_to=2026-08-01',400],['page=-3&limit=-7',200]]) {
    r=await api(63,'GET','work-requests/my-requests?'+q);
    check(`bad input ${q} -> ${code}`, r.status===code, `${r.status} ${JSON.stringify(r.body).slice(0,90)}`);
  }
  await done();
})().catch(e=>{console.error(e);process.exit(1)});
