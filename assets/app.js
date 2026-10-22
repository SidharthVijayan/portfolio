document.getElementById('y').textContent=new Date().getFullYear();
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
fetch('data/extensions.json').then(r=>r.json()).then(all=>{
 const list=all.filter(e=>e.approved===true);
 const tests=list.reduce((n,e)=>n+(e.tests||0),0);
 document.getElementById('stats').innerHTML=[[list.length,'extensions shown'],[list.filter(e=>e.status==='live').length,'live in store'],[tests,'automated tests'],['365','build target']].map(([v,l])=>`<li><b>${v}</b><span>${l}</span></li>`).join('');
 const label={live:'Live',ready:'Ready',review:'In review','in review':'In review'};
 document.getElementById('grid').innerHTML=list.map(e=>`<article class="card">
 ${e.screenshot?`<img src="${esc(e.screenshot)}" alt="${esc(e.name)} screenshot" loading="lazy">`:`<div class="ph">${esc(e.name.split(' ').map(w=>w[0]).join('').slice(0,3))}</div>`}
 <div class="body"><span class="status ${esc(e.status).replace(' ','-')}">${label[e.status]||esc(e.status)}</span><h3>${esc(e.name)}</h3><p>${esc(e.summary)}</p>
 <ul class="chips">${e.stack.map(s=>`<li>${esc(s)}</li>`).join('')}${e.permissions.map(p=>`<li class="perm">${esc(p)}</li>`).join('')}${e.tests?`<li class="t">${e.tests} tests</li>`:''}</ul>
 <div class="links">${e.store?`<a href="${esc(e.store)}">Store</a>`:''}${e.repo?`<a href="${esc(e.repo)}">Code</a>`:''}${e.privacy?`<a href="${esc(e.privacy)}">Privacy</a>`:''}</div></div></article>`).join('');
});
