// Interactive npm startup; the scheduled service still uses server.js directly.
const {spawn}=require('node:child_process');
const path=require('node:path');
const port=Number(process.env.PORT||8080);
const url=`http://127.0.0.1:${port}/`;
function openBrowser(){
  if(process.env.UW_NO_BROWSER==='1')return;
  if(process.platform==='win32'){
    const opener=spawn('powershell.exe',['-NoProfile','-WindowStyle','Hidden','-Command',`Start-Process '${url}'`],{windowsHide:true,stdio:'ignore'});
    opener.on('error',()=>console.error(`Open ${url} in your browser.`));
  }else console.log(`Open ${url} in your browser.`);
}
async function run(){
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be a valid TCP port.');
  try{
    const response=await fetch(url+'api/health',{signal:AbortSignal.timeout(1500)}),health=await response.json();
    if(response.ok&&health.ok&&/UW Accounting/.test(health.message||'')){console.log(`UW Accounting is already running at ${url}`);openBrowser();return;}
  }catch{}
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:process.env,stdio:['inherit','pipe','inherit']});
  let opened=false;
  child.stdout.on('data',chunk=>{process.stdout.write(chunk);if(!opened&&chunk.toString().includes('UW Accounting app and API running')){opened=true;openBrowser();}});
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code||0;});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
