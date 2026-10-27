const encoder=new TextEncoder();
const cookieName='__Host-oef_session';
const iterations=100000;
const sessionTtlMs=12*60*60*1000;
const maxLoginAttempts=20;
const loginWindowMs=15*60*1000;
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
async function passwordHash(password,salt){
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations,hash:'SHA-256'},key,256));
}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
const securityHeaders={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
};
const json=(data,status=200,cookie)=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...securityHeaders,...(cookie?{'Set-Cookie':cookie}:{})}});
const cookie=(token,maxAge)=>`${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=${maxAge}`;
const tokenFrom=request=>{
  const authHeader=request.headers.get('Authorization')||'';
  if(authHeader.startsWith('Bearer ')){
    const bearer=authHeader.slice(7).trim();
    if(/^[a-f0-9]{64}$/.test(bearer))return bearer;
  }
  return (request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
};
const pending=new WeakMap();
export async function initAuth(DB){
  if(DB.repository)return;
  if(pending.has(DB))return pending.get(DB);
  const operation=(async()=>{
    for(const sql of [
      "CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user','viewer')), created_at TEXT NOT NULL)",
      'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)'
    ])await DB.prepare(sql).run();
    try{
      const table=await DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").first();
      if(table && table.sql && !table.sql.includes('viewer')){
        await DB.prepare("CREATE TABLE users_migrated (username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user','viewer')), created_at TEXT NOT NULL)").run();
        await DB.prepare("INSERT INTO users_migrated (username,salt,password_hash,role,created_at) SELECT username,salt,password_hash,role,created_at FROM users").run();
        await DB.prepare("DROP TABLE users").run();
        await DB.prepare("ALTER TABLE users_migrated RENAME TO users").run();
      }
    }catch{}
    const existing=await DB.prepare('SELECT username FROM users LIMIT 1').first();
    if(!existing){
      const salt=random(),hash=await passwordHash('admin',salt);
      await DB.prepare("INSERT OR IGNORE INTO users (username,salt,password_hash,role,created_at) VALUES (?,?,?,'admin',?)").bind('admin',salt,hash,new Date().toISOString()).run();
    }
  })();pending.set(DB,operation);
  try{await operation;}catch(error){pending.delete(DB);throw error;}
}

export async function currentUser(request,DB){
  const token=tokenFrom(request);if(!/^[a-f0-9]{64}$/.test(token))return null;
  const tokenHash=await digest(token);
  if(DB.repository){
    return await DB.repository.getSessionUser(tokenHash, Date.now());
  }
  return DB.prepare('SELECT users.username, users.role FROM sessions JOIN users ON sessions.username=users.username WHERE sessions.token_hash=? AND sessions.expires_at>?').bind(tokenHash,Date.now()).first();
}

async function body(request){
  if(!request.headers.get('Content-Type')?.includes('application/json'))throw Error('JSON is required.');
  const raw=await request.text();if(raw.length>4096)throw Error('Request too large.');
  const value=JSON.parse(raw);if(!value||typeof value!=='object')throw Error('Invalid request.');return value;
}

export async function authRoute(request,DB,path,user){
  if(path==='/api/login' && request.method==='POST'){
    const now=Date.now(),window=Math.floor(now/loginWindowMs);
    const key=await digest((request.headers.get('CF-Connecting-IP')||'local')+':'+window);
    let attempts = 1;
    if(DB.repository){
      attempts = await DB.repository.checkAndIncrementLogin(key, now, loginWindowMs);
    } else {
      await DB.prepare('DELETE FROM login_limits WHERE expires_at<?').bind(now).run();
      const limit=await DB.prepare('INSERT INTO login_limits (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,(window+1)*loginWindowMs).first();
      attempts = limit.attempts;
    }
    if(attempts>maxLoginAttempts)return json({error:'Too many login attempts. Please try again in 15 minutes.'},429);
    let input;try{input=await body(request);}catch{return json({error:'Enter a valid user ID and password.'},400);}
    const username=String(input.username||'').trim().toLowerCase(),password=String(input.password||'');
    if(username.length>40||password.length>128)return json({error:'Incorrect user ID or password.'},401);

    const account = DB.repository
      ? await DB.repository.getUserByUsername(username)
      : await DB.prepare('SELECT username,salt,password_hash,role FROM users WHERE username=?').bind(username).first();

    const hash=await passwordHash(password,account?.salt||'not-a-user-dummy-salt');
    if(!account||!equal(hash,account.password_hash))return json({error:'Incorrect user ID or password.'},401);
    const token=random(),tokenHash=await digest(token);

    if(DB.repository){
      await DB.repository.cleanExpiredSessions(now);
      await DB.repository.createSessionRecord(tokenHash, username, now+sessionTtlMs);
    } else {
      await DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now).run();
      await DB.prepare('INSERT INTO sessions (token_hash,username,expires_at) VALUES (?,?,?)').bind(tokenHash,username,now+sessionTtlMs).run();
    }
    return json({user:{username:account.username,role:account.role},token},200,cookie(token,sessionTtlMs/1000));
  }
  if(path==='/api/logout' && request.method==='POST'){
    const token=tokenFrom(request);
    if(token){
      const tokenHash=await digest(token);
      if(DB.repository){
        await DB.repository.deleteSessionRecord(tokenHash);
      } else {
        await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash).run();
      }
    }
    return json({loggedOut:true},200,cookie('',0));
  }
  if(path==='/api/session' && request.method==='GET')return user?json({user}):json({error:'Please log in to continue.'},401);
  if(path==='/api/users/backup'){
    if(!user)return json({error:'Please log in to continue.'},401);
    if(user.role!=='admin')return json({error:'Only admin can backup users.'},403);
    if(request.method==='GET'){
      const results = DB.repository
        ? await DB.repository.getUsersBackup()
        : (await DB.prepare('SELECT username,salt,password_hash,role,created_at FROM users ORDER BY username').all()).results;
      return json({
        version:1,
        type:'oef23_users_backup',
        exportedAt:new Date().toISOString(),
        users:results
      });
    }
    if(request.method==='POST'){
      let input;
      try{input=await body(request);}catch{return json({error:'Invalid backup file.'},400);}
      const list=Array.isArray(input)?input:(input?.users);
      if(!Array.isArray(list))return json({error:'Invalid backup file: users list required.'},400);
      let added=0,updated=0,skipped=0;
      for(const u of list){
        if(!u||typeof u!=='object'){skipped++;continue;}
        const username=String(u.username||'').trim().toLowerCase();
        if(!/^[a-z0-9._-]{1,40}$/.test(username)){skipped++;continue;}
        const role=(u.role==='admin')?'admin':((u.role==='viewer')?'viewer':'user');
        const createdAt=String(u.created_at||new Date().toISOString());
        let salt=u.salt;
        let hash=u.password_hash;
        if(!salt||!hash||typeof salt!=='string'||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(salt)||!/^[a-f0-9]{64}$/.test(hash)){
          if(u.password && typeof u.password==='string' && u.password.length<=128){
            salt=random();
            hash=await passwordHash(u.password,salt);
          }else{
            skipped++;
            continue;
          }
        }
        if(DB.repository){
          const existing = await DB.repository.getUserByUsername(username);
          await DB.repository.upsertUserRecord({ username, salt, password_hash: hash, role, created_at: createdAt });
          if(existing) updated++; else added++;
        } else {
          const existing=await DB.prepare('SELECT username,role FROM users WHERE username=?').bind(username).first();
          if(existing){
            await DB.prepare('UPDATE users SET salt=?,password_hash=?,role=? WHERE username=?').bind(salt,hash,role,username).run();
            updated++;
          }else{
            await DB.prepare('INSERT INTO users (username,salt,password_hash,role,created_at) VALUES (?,?,?,?,?)').bind(username,salt,hash,role,createdAt).run();
            added++;
          }
        }
      }
      return json({restored:true,added,updated,skipped,total:list.length});
    }
  }
  if(path==='/api/users'){
    if(!user)return json({error:'Please log in to continue.'},401);
    if(request.method==='GET'){
      if(user.role!=='admin')return json({error:'Only admin can manage users.'},403);
      const list = DB.repository
        ? await DB.repository.getUsers()
        : (await DB.prepare('SELECT username,role,created_at FROM users ORDER BY username').all()).results;
      return json({users: list});
    }
    if(request.method==='DELETE'){
      if(user.role!=='admin')return json({error:'Only admin can manage users.'},403);
      let input;try{input=await body(request);}catch{return json({error:'Invalid user ID.'},400);}
      const username=String(input.username||'').trim().toLowerCase();
      if(!/^[a-z0-9._-]{1,40}$/.test(username))return json({error:'Invalid user ID.'},400);

      const account = DB.repository
        ? await DB.repository.getUserByUsername(username)
        : await DB.prepare('SELECT username,role FROM users WHERE username=?').bind(username).first();

      if(!account)return json({error:'This user no longer exists. Refresh the user list.'},404);
      if(account.role==='admin' || username===user.username)return json({error:'Admin accounts cannot be deleted.'},403);

      if(DB.repository){
        const ok = await DB.repository.deleteUserAccount(username);
        if(!ok)return json({error:'This user no longer exists. Refresh the user list.'},404);
        return json({deleted:true,username});
      } else {
        const results=await DB.batch([
          DB.prepare("DELETE FROM sessions WHERE username=? AND EXISTS (SELECT 1 FROM users WHERE username=? AND role IN ('user','viewer'))").bind(username,username),
          DB.prepare("DELETE FROM users WHERE username=? AND role IN ('user','viewer')").bind(username)
        ]);
        if(!results[1].meta.changes)return json({error:'This user no longer exists. Refresh the user list.'},404);
        return json({deleted:true,username});
      }
    }
    if(request.method==='POST'){
      if(user.role==='viewer')return json({error:'Viewer accounts cannot manage users.'},403);
      let input;try{input=await body(request);}catch{return json({error:'Invalid account details.'},400);}
      const username=String(input.username||'').trim().toLowerCase(),password=String(input.password||'');
      const requestedRole=(input.role==='viewer')?'viewer':'user';
      if(user.role!=='admin' && requestedRole!=='viewer')return json({error:'Only admin can create standard users.'},403);
      if(!/^[a-z0-9._-]{1,40}$/.test(username))return json({error:'Use 1–40 letters, numbers, dots, underscores or hyphens for the user ID.'},400);
      if(!password||password.length>128)return json({error:'Password must contain 1–128 characters.'},400);
      const salt=random(),hash=await passwordHash(password,salt);

      try{
        if(DB.repository){
          await DB.repository.insertUser({
            username,
            salt,
            password_hash: hash,
            role: requestedRole,
            created_at: new Date().toISOString()
          });
        } else {
          await DB.prepare("INSERT INTO users (username,salt,password_hash,role,created_at) VALUES (?,?,?,?,?)").bind(username,salt,hash,requestedRole,new Date().toISOString()).run();
        }
      }catch(error){
        if(String(error.message).includes('UNIQUE') || String(error.message).includes('unique'))return json({error:'That user ID already exists.'},409);
        throw error;
      }
      return json({user:{username,role:requestedRole}},201);
    }
  }
  return null;
}
