import {initAuth,currentUser,authRoute} from './auth.mjs';
const fields = ['dateOfReport','timeOfReport','supervisor','employeeName','passportNo','department','companyAgency','typeOfIncident','locationOfIncident','incidentDateTime','asset','estimatedValue','status','incidentDescription','refName','refPassportNo','refDepartment','refCompanyAgency','employeeStatement','ioAction','policeReportNo','policeStationName','ioComments','recordingOfficerName','complainantName','sigComplainant','sigOfficer'];
const schema = 'CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, report_no TEXT NOT NULL UNIQUE, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)';
const securityHeaders={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
};
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store',...securityHeaders}});
function clean(input){
  const reportNo=String(input.reportNo||'').trim();
  if(!/^\d{1,9}$/.test(reportNo) || Number(reportNo)<1) throw Error('Use a positive numeric report number.');
  const data={reportNo:String(Number(reportNo)).padStart(3,'0')};
  for(const key of fields){
    const value=input[key]??'';
    if(typeof value!=='string' && typeof value!=='number') throw Error('Invalid field: '+key);
    data[key]=String(value);
    if(key.startsWith('sig')){
      if(data[key] && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data[key])) throw Error('Signatures must be PNG images.');
    }else if(data[key].length>30000) throw Error('Field too long: '+key);
  }
  if(!data.employeeName.trim())throw Error('Employee name is required.');
  return data;
}
const unpack=row=>({...JSON.parse(row.data),id:row.id,reportNo:row.report_no,_version:row.version});

const independentComplainantFix = `
<script>
(function(){
  function applyIndependentComplainant(){
    let employee=document.getElementById('employeeName');
    let complainant=document.getElementById('signatureEmployeeName');
    if(!employee || !complainant)return;
    // Remove the original inline two-way bindings completely.
    // Replacing the elements also removes any already-compiled inline handlers.
    if(!employee.dataset.independentBound){
      const replacement=employee.cloneNode(true);
      replacement.removeAttribute('oninput');
      replacement.oninput=null;
      employee.replaceWith(replacement);
      employee=replacement;
      employee.dataset.independentBound='1';
    }else{
      employee.removeAttribute('oninput');
      employee.oninput=null;
    }
    if(!complainant.dataset.independentBound){
      const replacement=complainant.cloneNode(true);
      replacement.removeAttribute('oninput');
      replacement.oninput=null;
      complainant.replaceWith(replacement);
      complainant=replacement;
      complainant.dataset.independentBound='1';
      complainant.setAttribute('placeholder','Employee / complainant name');
    }else{
      complainant.removeAttribute('oninput');
      complainant.oninput=null;
    }
  }

  const originalNewReport=window.newReport;
  if(typeof originalNewReport==='function'){
    window.newReport=function(){
      const result=originalNewReport.apply(this,arguments);
      applyIndependentComplainant();
      const complainant=document.getElementById('signatureEmployeeName');
      if(complainant)complainant.value='';
      return result;
    };
  }

  const originalCollect=window.collectFormData;
  if(typeof originalCollect==='function'){
    window.collectFormData=function(){
      const data=originalCollect.apply(this,arguments);
      const complainant=document.getElementById('signatureEmployeeName');
      data.complainantName=complainant ? complainant.value : '';
      return data;
    };
  }

  const originalLoad=window.loadReportIntoForm;
  if(typeof originalLoad==='function'){
    window.loadReportIntoForm=function(id){
      const result=originalLoad.apply(this,arguments);
      const report=(typeof reports!=='undefined' ? reports : []).find(x=>x.id===id);
      const complainant=document.getElementById('signatureEmployeeName');
      if(complainant)complainant.value=report?.complainantName || '';
      applyIndependentComplainant();
      return result;
    };
  }

  const originalPrint=window.buildPrintHtml;
  if(typeof originalPrint==='function'){
    window.buildPrintHtml=function(report){
      const html=originalPrint.apply(this,arguments);
      const name=String(report?.complainantName || '').replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});
      const marker='<strong>Signature of Complainant</strong><div class="pf-signature-name">';
      const start=html.indexOf(marker);
      if(start<0)return html;
      const valueStart=start+marker.length;
      const valueEnd=html.indexOf('</div>',valueStart);
      if(valueEnd<0)return html;
      return html.slice(0,valueStart)+name+html.slice(valueEnd);
    };
  }

  applyIndependentComplainant();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyIndependentComplainant,{once:true});
})();
</script>`;

async function serveAsset(request,env){
  const response=await env.ASSETS.fetch(request);
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const html=await response.text();
  if(!html.includes('id="signatureEmployeeName"'))return response;
  const headers=new Headers(response.headers);
  headers.set('Content-Type','text/html; charset=UTF-8');
  return new Response(html.replace('</body>',independentComplainantFix+'</body>'),{status:response.status,statusText:response.statusText,headers});
}

export default {async fetch(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return serveAsset(request,env);
  if(url.pathname==='/api/version' && request.method==='GET'){
    return json({
      version: '1.0.0',
      display: 'v1.0.0'
    });
  }
  if(url.pathname==='/api/health' && request.method==='GET'){
    if(!env.DB)return json({status:'error',database:'unavailable'},503);
    try{
      await env.DB.prepare('SELECT 1').first();
      return json({status:'ok',database:'connected'});
    }catch{
      return json({status:'error',database:'unavailable'},503);
    }
  }
  if(!env.DB)return json({error:'Shared database is not connected. Bind a Cloudflare D1 database as DB.'},503);
  const origin=request.headers.get('Origin');
  if(origin){
    try{
      const originUrl=new URL(origin);
      if(originUrl.host!==url.host)return json({error:'Use this website to update reports.'},403);
    }catch{
      return json({error:'Use this website to update reports.'},403);
    }
  }
  try{
    await initAuth(env.DB);
    const user=await currentUser(request,env.DB);
    const authResponse=await authRoute(request,env.DB,url.pathname,user);
    if(authResponse)return authResponse;
    if(!user)return json({error:'Please log in to continue.'},401);
    await env.DB.prepare(schema).run();
    const item=url.pathname.match(/^\/api\/reports\/([a-zA-Z0-9_-]+)$/);
    if(request.method==='DELETE' && url.pathname==='/api/reports'){
      if(user.role!=='admin')return json({error:'Only admin can delete all reports.'},403);
      if(!request.headers.get('Content-Type')?.includes('application/json'))return json({error:'JSON is required.'},415);
      let input;try{input=await request.json();}catch{return json({error:'Invalid confirmation.'},400);}
      if(input?.confirmation!=='DELETE ALL' || !Number.isInteger(input.expectedCount) || input.expectedCount<1)return json({error:'Confirm the number of reports before deleting.'},400);
      const result=await env.DB.prepare('DELETE FROM reports WHERE (SELECT COUNT(*) FROM reports)=?').bind(input.expectedCount).run();
      if(!result.meta.changes)return json({error:'The report list changed. Refresh and confirm again.'},409);
      return json({deleted:true,count:result.meta.changes});
    }
    if(request.method==='POST' && url.pathname==='/api/reports/restore-seed'){
      if(user.role==='viewer')return json({error:'Viewer accounts cannot restore data.'},403);
      let input;try{input=await request.json();}catch{return json({error:'Invalid JSON.'},400);}
      const list=Array.isArray(input)?input:(input?.reports);
      if(!Array.isArray(list))return json({error:'Invalid reports list.'},400);
      let count=0;
      for(const r of list){
        if(!r||!r.reportNo)continue;
        try{
          const cleaned=clean(r);
          const id=r.id||crypto.randomUUID();
          await env.DB.prepare('INSERT INTO reports (id,report_no,data,version) VALUES (?,?,?,?) ON CONFLICT(report_no) DO UPDATE SET data=excluded.data,version=version+1').bind(id,cleaned.reportNo,JSON.stringify(cleaned),r._version||1).run();
          count++;
        }catch{}
      }
      return json({restored:true,count});
    }
    if(request.method==='GET' && url.pathname==='/api/reports'){
      const result=await env.DB.prepare('SELECT id, report_no, data, version FROM reports ORDER BY CAST(report_no AS INTEGER) DESC').all();
      return json({reports:result.results.map(unpack)});
    }
    if(request.method==='POST' && url.pathname==='/api/reports' || request.method==='PUT' && item){
      if(user.role==='viewer')return json({error:'Viewer accounts are limited to preview and print only. Creating or modifying reports is blocked.'},403);
      if(!request.headers.get('Content-Type')?.includes('application/json'))return json({error:'JSON is required.'},415);
      const text=await request.text();
      if(new TextEncoder().encode(text).length>1000000)return json({error:'Report is too large. Limit is 1 MB including signatures.'},413);
      let body,data;
      try{body=JSON.parse(text);data=clean(body);}catch(e){return json({error:e.message},400);}
      data.updatedAt=new Date().toISOString();
      if(request.method==='POST'){
        const id=crypto.randomUUID();data.createdAt=data.updatedAt;data.preparedBy=user.username;
        await env.DB.prepare('INSERT INTO reports (id,report_no,data,version) VALUES (?,?,?,1)').bind(id,data.reportNo,JSON.stringify(data)).run();
        return json({report:{...data,id,_version:1}},201);
      }
      if(!Number.isInteger(body._version))return json({error:'Reopen this report before saving.'},409);
      const old=await env.DB.prepare('SELECT data FROM reports WHERE id=?').bind(item[1]).first();
      if(!old)return json({error:'This report was deleted on another device.'},409);
      data.createdAt=JSON.parse(old.data).createdAt;
      data.preparedBy=JSON.parse(old.data).preparedBy || '';
      data.updatedBy=user.username;
      const result=await env.DB.prepare('UPDATE reports SET report_no=?,data=?,version=version+1 WHERE id=? AND version=?').bind(data.reportNo,JSON.stringify(data),item[1],body._version).run();
      if(!result.meta.changes)return json({error:'Another person updated this report. Export your current form to PDF, then reopen the latest report before editing again.'},409);
      return json({report:{...data,id:item[1],_version:body._version+1}});
    }
    if(request.method==='DELETE' && item){
      if(user.role==='viewer')return json({error:'Viewer accounts are limited to preview and print only. Deleting reports is blocked.'},403);
      const version=Number(request.headers.get('If-Match'));
      if(!Number.isInteger(version)||version<1)return json({error:'Refresh the register before deleting.'},409);
      const result=await env.DB.prepare('DELETE FROM reports WHERE id=? AND version=?').bind(item[1],version).run();
      if(!result.meta.changes)return json({error:'This report changed or was deleted. Refresh and try again.'},409);
      return json({deleted:true});
    }
    return json({error:'Not found.'},404);
  }catch(error){
    if(String(error.message).includes('UNIQUE constraint'))return json({error:'This report number already exists. Refresh and choose another number.'},409);
    console.error('Report database operation failed');
    return json({error:'Shared storage is temporarily unavailable. Your changes have not been saved; please retry.'},503);
  }
}};