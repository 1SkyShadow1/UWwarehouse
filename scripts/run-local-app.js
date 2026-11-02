// Interactive npm startup; the scheduled service still uses server.js directly.
const {spawn}=require('node:child_process');
const path=require('node:path');
const port=Number(process.env.PORT||8080);
const url=`http://127.0.0.1:${port}/`;
const startupTimeoutMs=Number(process.env.UW_STARTUP_TIMEOUT_MS||90000);
const startupPollMs=500;
function openBrowser(){
  if(process.env.UW_NO_BROWSER==='1')return;
  if(process.platform==='win32'){
    const opener=spawn('powershell.exe',['-NoProfile','-WindowStyle','Hidden','-Command',`Start-Process '${url}'`],{windowsHide:true,stdio:'ignore'});
    opener.on('error',()=>console.error(`Open ${url} in your browser.`));
  }else console.log(`Open ${url} in your browser.`);
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function serverReady(){
  try{
    const healthResponse=await fetch(url+'api/health',{signal:AbortSignal.timeout(2000),cache:'no-store'});
    if(!healthResponse.ok)return false;
    const health=await healthResponse.json();
    return Boolean(health.ok&&/UW Accounting/.test(health.message||''));
  }catch{return false;}
}
async function profilesReady(){
  try{
    const profilesResponse=await fetch(url+'api/auth/config',{signal:AbortSignal.timeout(3000),cache:'no-store'});
    if(!profilesResponse.ok)return false;
    const profiles=await profilesResponse.json();
    return typeof profiles.configured==='boolean'&&Array.isArray(profiles.users);
  }catch{return false;}
}
async function waitForApp(child=null){
  const deadline=Date.now()+startupTimeoutMs;
  while(Date.now()<deadline){
    if(child?.startupError)throw child.startupError;
    if(child?.exitCode!==null&&child?.exitCode!==undefined)throw new Error(`The UW Accounting server stopped during startup (exit code ${child.exitCode}).`);
    if(await serverReady()&&await profilesReady())return;
    await delay(startupPollMs);
  }
  throw new Error(`The UW Accounting server did not become ready within ${Math.round(startupTimeoutMs/1000)} seconds. Startup requires both /api/health and /api/auth/config; check the local server log.`);
}
async function run(){
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be a valid TCP port.');
  if(!Number.isFinite(startupTimeoutMs)||startupTimeoutMs<1000)throw new Error('UW_STARTUP_TIMEOUT_MS must be at least 1000 milliseconds.');
  if(await serverReady()){
    await waitForApp();
    console.log(`UW Accounting is ready at ${url}`);openBrowser();return;
  }
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:process.env,stdio:['inherit','pipe','inherit']});
  let startupFailed=false;
  child.stdout.on('data',chunk=>process.stdout.write(chunk));
  child.on('error',error=>{child.startupError=error;startupFailed=true;console.error(error.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=startupFailed?1:code||0;});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  try{await waitForApp(child);console.log(`UW Accounting is ready at ${url}`);openBrowser();}
  catch(error){startupFailed=true;console.error(error.message);child.kill();process.exitCode=1;}
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
