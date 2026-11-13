document.getElementById('y').textContent=new Date().getFullYear();
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const label={live:'Live',ready:'Ready',review:'In review','in review':'In review'};
function card(e){
  const links=[];
  if(e.demo) links.push(`<a class="try" href="${esc(e.demo)}">Try it</a>`);
  if(e.play) links.push(`<a class="try" href="${esc(e.play)}">Play</a>`);
  if(e.store) links.push(`<a href="${esc(e.store)}">Store</a>`);
  if(e.repo) links.push(`<a href="${esc(e.repo)}">Code</a>`);
  if(e.privacy) links.push(`<a href="${esc(e.privacy)}">Privacy</a>`);
  const chips=[
    ...(e.stack||[]).map(s=>`<li>${esc(s)}</li>`),
    ...(e.permissions||[]).map(p=>`<li class="perm">${esc(p)}</li>`),
    e.tests?`<li class="t">${e.tests} tests</li>`:''
  ].join('');
  return `<article class="card">
 ${e.screenshot?`<img src="${esc(e.screenshot)}" alt="${esc(e.name)} screenshot" loading="lazy">`:`<div class="ph">${esc((e.name||'').split(' ').map(w=>w[0]).join('').slice(0,3))}</div>`}
 <div class="body">${e.status?`<span class="status ${esc(e.status).replace(' ','-')}">${label[e.status]||esc(e.status)}</span>`:''}<h3>${esc(e.name)}</h3><p>${esc(e.summary)}</p>
 <ul class="chips">${chips}</ul>
 <div class="links">${links.join('')}</div></div></article>`;
}
function gameCard(g){
  const play=g.play||g.path;
  const shot=g.screenshot||g.thumbnail;
  const story=g.summary||g.story||'';
  const initials=esc((g.name||'').split(' ').map(w=>w[0]).join('').slice(0,3));
  return `<article class="card">
 ${shot?`<img src="${esc(shot)}" alt="${esc(g.name)} start screen" loading="lazy">`:`<div class="ph">${initials}</div>`}
 <div class="body">${g.day?`<span class="status">Day ${esc(g.day)}</span>`:''}<h3>${esc(g.name)}</h3><p>${esc(story)}</p>
 <ul class="chips">${g.genre?`<li>${esc(g.genre)}</li>`:''}</ul>
 <div class="links">${play?`<a class="try play-btn" href="${esc(play)}">Play</a>`:''}</div></div></article>`;
}
Promise.all([
  fetch('data/extensions.json').then(r=>r.json()),
  fetch('data/games.json').then(r=>r.ok?r.json():[]).catch(()=>[])
]).then(([all,games])=>{
  const list=all.filter(e=>e.approved===true);
  const tests=list.reduce((n,e)=>n+(e.tests||0),0);
  document.getElementById('stats').innerHTML=[[list.length,'extensions shown'],[list.filter(e=>e.status==='live').length,'live in store'],[tests,'automated tests'],['365','build target']].map(([v,l])=>`<li><b>${v}</b><span>${l}</span></li>`).join('');
  document.getElementById('grid').innerHTML=list.map(card).join('');
  const approvedGames=(games||[]).filter(g=>g.approved!==false);
  const gsec=document.getElementById('games');
  const gnav=document.getElementById('games-nav');
  const ggrid=document.getElementById('games-grid');
  if(approvedGames.length && gsec && ggrid){
    gsec.hidden=false;
    if(gnav) gnav.hidden=false;
    ggrid.innerHTML=approvedGames.map(gameCard).join('');
  }
});
