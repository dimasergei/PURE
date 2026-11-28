/* PURE admin experience: structural layout, not a theme-only override.
 * Preserves original element IDs, controls, handlers, and hidden-view semantics.
 */
(() => {
  'use strict';
  const el=(tag,cls,html)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(html!==undefined)node.innerHTML=html;return node;};
  const isOrders=Boolean(document.getElementById('orders-view'));
  const isMarketing=Boolean(document.getElementById('mk-app'));
  if(!isOrders&&!isMarketing)return;

  function authLayout(){
    const login=document.getElementById(isOrders?'login-view':'mk-login');
    if(!login||login.dataset.apEnhanced)return;
    login.dataset.apEnhanced='true';
    login.classList.add('ap-auth-layout');
    const contents=el('div','ap-auth-content');
    while(login.firstChild)contents.append(login.firstChild);
    const left=el('aside','ap-auth-visual');
    left.setAttribute('aria-label','PURE secure business workspace');
    const logo=el('div','ap-auth-symbol');
    const img=document.createElement('img');
    img.src='/favicon-pure-96.png?v=20261117b';
    img.alt='';
    img.width=76;
    img.height=76;
    logo.append(img);
    const title=el('div','ap-auth-message');
    title.append(el('div','ap-auth-overline','PRIVATE WORKSPACE'));
    title.append(el('h2','ap-auth-hero-title','One focused place<br>to run what matters.'));
    title.append(el('p','ap-auth-hero-copy','Orders and creator relationships, organized around the work you do every day.'));
    const bottom=el('div','ap-auth-bottom');
    bottom.append(el('span','ap-auth-bottom-brand pure-wordmark','PURE'));
    bottom.append(el('span','ap-auth-bottom-status','ADMIN CONSOLE'));
    left.append(logo,title,bottom);
    const main=el('div','ap-auth-form-panel');
    main.append(el('div','ap-auth-form-eyebrow','PURE / ADMINISTRATION'));
    main.append(contents);
    login.append(left,main);
  }

  function mobileNav(root, sidebar, body, toggle){
    const backdrop=el('button','ap-nav-backdrop');
    backdrop.type='button';
    backdrop.setAttribute('aria-label','Close admin navigation');
    root.append(backdrop);
    if(!isOrders){
      toggle.onclick=()=>root.classList.toggle('ap-navigation-open');
      backdrop.onclick=()=>root.classList.remove('ap-navigation-open');
      return;
    }

    const mobile=window.matchMedia?.('(max-width: 840px)');
    const dismiss=el('button','ap-nav-dismiss','Close');
    dismiss.type='button';
    sidebar.prepend(dismiss);
    sidebar.id='orders-navigation';
    toggle.setAttribute('aria-controls',sidebar.id);
    backdrop.tabIndex=-1;

    function setOpen(requested, returnFocus=false){
      const open=Boolean(requested && mobile?.matches);
      root.classList.toggle('ap-navigation-open',open);
      toggle.setAttribute('aria-expanded',String(open));
      sidebar.inert=Boolean(mobile?.matches && !open);
      body.inert=open;
      if(open)dismiss.focus();
      else if(returnFocus && mobile?.matches)toggle.focus();
    }
    toggle.onclick=()=>setOpen(true);
    backdrop.onclick=dismiss.onclick=()=>setOpen(false,true);
    sidebar.addEventListener('click',event=>{
      if(event.target.closest('.admin-nav-link, .admin-icon-button'))setOpen(false,true);
    });
    sidebar.addEventListener('keydown',event=>{
      if(!root.classList.contains('ap-navigation-open'))return;
      if(event.key==='Escape'){
        event.preventDefault();
        setOpen(false,true);
      }else if(event.key==='Tab'){
        const controls=[...sidebar.querySelectorAll('button:not(:disabled),a[href]')].filter(node=>node.getClientRects().length);
        const first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
        if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
      }
    });
    window.addEventListener('pure-admin-auth-change',event=>{if(!event.detail?.authenticated)setOpen(false);});
    mobile?.addEventListener('change',()=>setOpen(false));
    setOpen(false);
  }

  function workspaceLayout(){
    const root=document.getElementById(isOrders?'orders-view':'mk-app');
    if(!root||root.dataset.apEnhanced)return;
    root.dataset.apEnhanced='true';
    root.classList.add('ap-workspace',isOrders?'ap-workspace-orders':'ap-workspace-marketing');
    const sidebar=root.querySelector(':scope > .admin-brandbar');
    if(!sidebar)return;
    const body=el('div','ap-workspace-body');
    const children=[...root.children].filter(n=>n!==sidebar);
    for(const node of children)body.append(node);
    sidebar.classList.add('ap-workspace-sidebar');
    sidebar.setAttribute('aria-label','PURE administration navigation');
    root.append(sidebar,body);
    const originalNav=sidebar.querySelector('.admin-nav');
    if(originalNav){
      const label=el('p','ap-sidebar-eyebrow','WORKSPACE');
      originalNav.before(label);
      originalNav.classList.add('ap-primary-nav');
      for(const link of originalNav.querySelectorAll('.admin-nav-link')){
        if(link.textContent.trim()==='Orders')link.dataset.apIcon='orders';
        if(link.textContent.trim()==='Marketing')link.dataset.apIcon='marketing';
        if(!isOrders)link.addEventListener('click',()=>root.classList.remove('ap-navigation-open'));
      }
    }
    const header=sidebar.querySelector('.admin-header-left');
    const utilities=sidebar.querySelector('.admin-utilities');
    if(utilities){
      utilities.classList.add('ap-sidebar-tools');
      sidebar.append(utilities);
    }
    if(header)header.classList.add('ap-sidebar-brand');
    const foot=el('div','ap-sidebar-footer','<span class="ap-status-dot" aria-hidden="true"></span><span>PRIVATE ADMIN ACCESS</span>');
    sidebar.append(foot);
    const top=el('div','ap-workspace-topbar');
    const context=el('div','ap-workspace-context');
    if(isOrders){
      const logo=el('span','orders-top-brand pure-wordmark','PURE');
      context.append(logo,el('span','orders-admin-label','Admin'));
    }else{
      const crumb=el('div','ap-breadcrumb');
      crumb.append(el('span','','ADMINISTRATION'),el('span','ap-breadcrumb-divider','/'),el('strong','','MARKETING'));
      context.append(crumb);
    }
    const controls=el('div','ap-workspace-top-actions');
    const site=document.createElement('a');
    site.href='/';site.className='ap-workspace-store-link';
    site.textContent=isOrders?'Storefront':'View storefront';
    site.setAttribute('aria-label','Open PURE storefront');
    const toggle=el('button','ap-sidebar-toggle');
    toggle.type='button';
    toggle.setAttribute('aria-label','Open admin navigation');
    if(isOrders){
      toggle.append(el('span','orders-menu-icon'));
      top.append(toggle,context,site);
    }else{
      toggle.textContent='☰';
      controls.append(site,toggle);
      top.append(context,controls);
    }
    body.prepend(top);
    mobileNav(root,sidebar,body,toggle);
    const pageHead=body.querySelector(isOrders?'.admin-section-heading':'.mk-title');
    if(pageHead){
      pageHead.classList.add('ap-page-intro');
    }
    if(isOrders)ordersWorkarea(body);
    if(isMarketing)marketingWorkarea(body);
  }
  function ordersWorkarea(body){
    const section=body.querySelector('#admin-orders-section');
    const hub=section?.querySelector('#fulfillment-hub');
    if(!hub)return;
    const surface=el('section','ap-orders-console');
    surface.setAttribute('aria-label','Order queue');
    section.insertBefore(surface,hub);
    surface.append(hub);
    section.classList.add('ap-orders-section');
  }
  function marketingWorkarea(body){
    const nav=body.querySelector('.mk-subnav');
    if(!nav)return;
    nav.classList.add('ap-marketing-sections');
    const panels=[...body.querySelectorAll(':scope > .mk-panel')];
    const area=el('section','ap-marketing-workarea');
    area.setAttribute('aria-label','Marketing workspace tools');
    nav.before(area);
    area.append(nav);
    const content=el('div','ap-marketing-panel-container');
    area.append(content);
    for(const p of panels)content.append(p);
    const score=body.querySelector('.mk-metrics');
    if(score){
      score.classList.add('ap-marketing-overview');
      const names=['Tracked profiles','Outreach recorded','Responses recorded','Need attention'];
      for(const [i,card] of [...score.children].entries()){
        card.classList.add('ap-metric');
        card.dataset.apMetric=String(i+1).padStart(2,'0');
        const hint=card.querySelector('small');
        if(hint)hint.textContent=names[i]||hint.textContent;
      }
    }
  }
  function init(){
    authLayout();
    workspaceLayout();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
