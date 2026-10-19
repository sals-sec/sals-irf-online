import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
const db=new DatabaseSync(':memory:');
const DB={prepare(sql){const stmt=db.prepare(sql);let args=[];return {bind(...a){args=a;return this},async run(){const r=stmt.run(...args);return {meta:{changes:r.changes}}},async first(){return stmt.get(...args)||null},async all(){return {results:stmt.all(...args)}}}}};
const env={DB,ASSETS:{fetch:()=>new Response('site')}};
DB.batch=async statements=>{db.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}};
let cookie='';
async function call(method,path,data,headers={}){const r=await worker.fetch(new Request('https://example.com/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:data?JSON.stringify(data):undefined}),env);return {status:r.status,cookie:r.headers.get('Set-Cookie'),...await r.json()};}
assert.equal((await call('GET','/reports')).status,401);
assert.equal((await call('POST','/login',{username:'admin',password:'wrong'})).status,401);
const login=await call('POST','/login',{username:'admin',password:'admin'});assert.equal(login.status,200);assert(login.cookie.includes('HttpOnly'));assert(login.cookie.includes('Secure'));
cookie=login.cookie.split(';')[0];const adminCookie=cookie;
assert.equal((await call('GET','/session')).user.role,'admin');
const account=await call('POST','/users',{username:'operator1',password:'test-password',role:'admin'});assert.equal(account.status,201);assert.equal(account.user.role,'user');
assert.equal((await call('POST','/users',{username:'operator1',password:'other'})).status,409);
const operator=await call('POST','/login',{username:'operator1',password:'test-password'});cookie=operator.cookie.split(';')[0];const operatorCookie=cookie;
assert.equal((await call('GET','/users')).status,403);assert.equal((await call('POST','/users',{username:'intruder',password:'x',role:'admin'})).status,403);
assert.equal((await call('GET','/reports',null,{Cookie:'__Host-oef_session=fake'})).status,401);
const sig='data:image/png;base64,YWJj';
const first=await call('POST','/reports',{reportNo:'001',employeeName:'Employee',preparedBy:'spoofed-admin',sigComplainant:sig,sigOfficer:sig});assert.equal(first.status,201);assert.equal(first.report.preparedBy,'operator1');
const secondDevice=await call('GET','/reports');assert.equal(secondDevice.reports[0].sigOfficer,sig);
cookie=adminCookie;
const updated=await call('PUT','/reports/'+first.report.id,{...first.report,employeeName:'Changed on device B',preparedBy:'spoofed'});assert.equal(updated.status,200);assert.equal(updated.report.preparedBy,'operator1');
const stale=await call('PUT','/reports/'+first.report.id,{...first.report,employeeName:'Stale edit'});assert.equal(stale.status,409);
assert.equal((await call('GET','/reports')).reports[0].employeeName,'Changed on device B');
assert.equal((await call('POST','/reports',{reportNo:'1',employeeName:'Duplicate'})).status,409);
assert.equal((await call('POST','/reports',{reportNo:'2',employeeName:'Other report'})).status,201);
assert.equal((await call('POST','/reports',{reportNo:'3',employeeName:'Bad',sigOfficer:'javascript:alert(1)'})).status,400);
assert.equal((await call('DELETE','/reports/'+first.report.id,null,{'If-Match':'1'})).status,409);
assert.equal((await call('DELETE','/reports/'+first.report.id,null,{'If-Match':'2'})).status,200);
assert.equal((await call('GET','/reports')).reports.length,1);
assert.equal((await call('POST','/reports',{reportNo:'4',employeeName:'Cross origin'},{Origin:'https://other.example'})).status,403);
const missing=await worker.fetch(new Request('https://example.com/api/reports'),{});assert.equal(missing.status,503);
const users=await call('GET','/users');assert(!JSON.stringify(users).includes('password_hash'));
const hashes=db.prepare('SELECT password_hash FROM users').all();assert(hashes.every(x=>x.password_hash.length===64));
const beforeBulk=(await call('GET','/reports')).reports.length;
assert.equal((await call('DELETE','/reports',{confirmation:'DELETE ALL',expectedCount:beforeBulk},{Cookie:''})).status,401);
assert.equal((await call('DELETE','/reports',{confirmation:'DELETE ALL',expectedCount:beforeBulk},{Cookie:operatorCookie})).status,403);
assert.equal((await call('DELETE','/reports',{confirmation:'DELETE ALL',expectedCount:beforeBulk},{Origin:'https://other.example'})).status,403);
assert.equal((await call('DELETE','/reports',{confirmation:'wrong',expectedCount:beforeBulk})).status,400);
assert.equal((await call('DELETE','/reports',{confirmation:'DELETE ALL',expectedCount:beforeBulk+1})).status,409);
assert.equal((await call('GET','/reports')).reports.length,beforeBulk);
const bulk=await call('DELETE','/reports',{confirmation:'DELETE ALL',expectedCount:beforeBulk});assert.equal(bulk.status,200);assert.equal(bulk.count,beforeBulk);
assert.equal((await call('GET','/reports')).reports.length,0);
assert.equal((await call('GET','/session')).user.role,'admin');
console.log('PASS bulk deletion: admin-only, confirmation, cross-origin denial, changed-count protection, all records removed and users retained.');
assert.equal((await call('DELETE','/users',{username:'operator1'},{Cookie:''})).status,401);
assert.equal((await call('DELETE','/users',{username:'admin'},{Cookie:operatorCookie})).status,403);
assert.equal((await call('DELETE','/users',{username:'operator1'},{Cookie:operatorCookie})).status,403);
assert.equal((await call('DELETE','/users',{username:'admin'})).status,403);
assert.equal((await call('DELETE','/users',{username:'missing'})).status,404);
assert.equal((await call('DELETE','/users',{username:"bad' OR 1=1"})).status,400);
assert.equal((await call('DELETE','/users',{username:'operator1'},{Origin:'https://other.example'})).status,403);
const kept=await call('POST','/reports',{reportNo:'5',employeeName:'Keep this report'},{Cookie:operatorCookie});assert.equal(kept.status,201);
assert.equal((await call('DELETE','/users',{username:'operator1'})).status,200);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE username=?').get('operator1').n,0);
assert.equal((await call('GET','/session',null,{Cookie:operatorCookie})).status,401);
assert.equal((await call('POST','/login',{username:'operator1',password:'test-password'})).status,401);
assert.equal((await call('GET','/reports')).reports.find(r=>r.id===kept.report.id).preparedBy,'operator1');
assert.equal((await call('DELETE','/users',{username:'operator1'})).status,404);
assert.equal((await call('POST','/users',{username:'operator1',password:'replacement'})).status,201);
assert.equal((await call('GET','/session',null,{Cookie:operatorCookie})).status,401);
console.log('PASS admin-only deletion, anonymous/standard/cross-origin denial, admin protection, validation, session revocation, recreated-account isolation, report preservation.');
assert.equal((await call('GET','/users/backup',null,{Cookie:''})).status,401);
const opLogin=await call('POST','/login',{username:'operator1',password:'replacement'});
const freshOpCookie=opLogin.cookie.split(';')[0];
assert.equal((await call('GET','/users/backup',null,{Cookie:freshOpCookie})).status,403);
assert.equal((await call('POST','/users/backup',{},{Cookie:freshOpCookie})).status,403);
cookie=adminCookie;
const usersBackup=await call('GET','/users/backup');
assert.equal(usersBackup.status,200);
assert.equal(usersBackup.type,'oef23_users_backup');
assert(Array.isArray(usersBackup.users));
assert(usersBackup.users.some(u=>u.username==='admin' && u.password_hash && u.salt));
assert(usersBackup.users.some(u=>u.username==='operator1' && u.password_hash && u.salt));
assert.equal((await call('POST','/users/backup',{users:'invalid'})).status,400);
const restoreResult=await call('POST','/users/backup',{
  users:[
    {username:'restored_op',role:'user',password:'restored-pass-123'},
    ...usersBackup.users
  ]
});
assert.equal(restoreResult.status,200);
assert.equal(restoreResult.restored,true);
assert(restoreResult.added>=1);
const restoredLogin=await call('POST','/login',{username:'restored_op',password:'restored-pass-123'});
assert.equal(restoredLogin.status,200);
console.log('PASS user backup and restore: admin-only, role enforcement, export credentials, import/restore accounts, login verified.');

// Test viewer role permissions & restrictions
cookie=adminCookie;
const viewerUser=await call('POST','/users',{username:'viewer1',password:'viewer-password',role:'viewer'});
assert.equal(viewerUser.status,201);
assert.equal(viewerUser.user.role,'viewer');

const viewerLogin=await call('POST','/login',{username:'viewer1',password:'viewer-password'});
assert.equal(viewerLogin.status,200);
assert.equal(viewerLogin.user.role,'viewer');
const viewerCookie=viewerLogin.cookie.split(';')[0];

// Allowed for viewer: GET /reports
const viewerReports=await call('GET','/reports',null,{Cookie:viewerCookie});
assert.equal(viewerReports.status,200);

// Blocked for viewer: POST /reports
assert.equal((await call('POST','/reports',{reportNo:'999',employeeName:'Blocked'},{Cookie:viewerCookie})).status,403);

// Blocked for viewer: PUT /reports/:id
assert.equal((await call('PUT','/reports/'+kept.report.id,{...kept.report,employeeName:'Blocked edit'},{Cookie:viewerCookie})).status,403);

// Blocked for viewer: DELETE /reports/:id
assert.equal((await call('DELETE','/reports/'+kept.report.id,null,{Cookie:viewerCookie,'If-Match':'1'})).status,403);

// Blocked for viewer: DELETE /reports
assert.equal((await call('DELETE','/reports',{confirmation:'DELETE ALL',expectedCount:1},{Cookie:viewerCookie})).status,403);

// Blocked for viewer: user management
assert.equal((await call('GET','/users',null,{Cookie:viewerCookie})).status,403);
assert.equal((await call('POST','/users',{username:'subviewer',password:'pwd',role:'viewer'},{Cookie:viewerCookie})).status,403);
assert.equal((await call('DELETE','/users',{username:'viewer1'},{Cookie:viewerCookie})).status,403);

console.log('PASS viewer ID: print & preview read-only access, write and delete blocked, user management blocked.');

const logout=await call('POST','/logout',{});assert.equal(logout.status,200);assert(logout.cookie.includes('Max-Age=0'));assert.equal((await call('GET','/reports')).status,401);
cookie=operatorCookie;db.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await call('GET','/session')).status,401);
console.log('PASS login, admin account creation, user restrictions, hashed credentials, logout/expiry, trusted preparedBy; shared SQLite API: cross-device read/update, signatures, stale edit/delete protection, number collision, independent records, validation, missing binding.');
