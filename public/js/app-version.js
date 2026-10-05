// Code version only; no accounting state or credentials are read here.
const UW_RELEASE='2026-10-05-pricing-v39';
window.addEventListener('DOMContentLoaded',async()=>{
  const label=document.getElementById('app-build-label');if(!label)return;
  label.textContent='Pricing update · '+UW_RELEASE;
  try{
    const response=await fetch('./build-info.json',{cache:'no-store'});
    if(response.ok){const build=await response.json();label.textContent=`Build ${String(build.revision||'').slice(0,7)||UW_RELEASE} · ${UW_RELEASE}`;}
  }catch{}
});
if('serviceWorker' in navigator){
  const alreadyControlled=Boolean(navigator.serviceWorker.controller);let refreshed=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(!alreadyControlled||refreshed)return;
    if(document.querySelector('#modal-root input,#modal-root textarea')){
      const label=document.getElementById('app-build-label');
      if(label){label.textContent='Update ready · finish editing, then reload';label.onclick=()=>location.reload();}
      return;
    }
    refreshed=true;location.reload();
  });
}
