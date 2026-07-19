document.addEventListener('DOMContentLoaded',function(){
  var menuToggle=document.querySelector('[data-menu-toggle]');
  var nav=document.querySelector('[data-primary-nav]');
  var servicesToggle=document.querySelector('[data-services-toggle]');
  var servicesMenu=document.querySelector('[data-services-menu]');
  function closeMenu(returnFocus){
    if(!menuToggle||!nav)return;
    menuToggle.setAttribute('aria-expanded','false');
    menuToggle.setAttribute('aria-label','Buka menu');
    nav.classList.remove('is-open');
    document.body.classList.remove('menu-open');
    if(returnFocus)menuToggle.focus();
  }
  if(menuToggle&&nav){
    menuToggle.addEventListener('click',function(){
      var open=this.getAttribute('aria-expanded')==='true';
      if(open){closeMenu(false);return}
      this.setAttribute('aria-expanded','true');
      this.setAttribute('aria-label','Tutup menu');
      nav.classList.add('is-open');
      document.body.classList.add('menu-open');
      var first=nav.querySelector('a,button');if(first)first.focus();
    });
    nav.querySelectorAll('a').forEach(function(link){link.addEventListener('click',function(){closeMenu(false)})});
  }
  if(servicesToggle&&servicesMenu){
    servicesToggle.addEventListener('click',function(){var open=this.getAttribute('aria-expanded')==='true';this.setAttribute('aria-expanded',String(!open));servicesMenu.classList.toggle('is-open',!open)});
  }
  document.addEventListener('keydown',function(event){
    if(event.key==='Escape'){if(servicesToggle){servicesToggle.setAttribute('aria-expanded','false');servicesMenu&&servicesMenu.classList.remove('is-open')}closeMenu(true)}
    if(event.key==='Tab'&&nav&&nav.classList.contains('is-open')){
      var focusable=Array.from(nav.querySelectorAll('a,button')).filter(function(el){return el.offsetParent!==null});if(!focusable.length)return;
      var first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
  });
  document.addEventListener('click',function(event){if(nav&&menuToggle&&nav.classList.contains('is-open')&&!nav.contains(event.target)&&!menuToggle.contains(event.target))closeMenu(false)});

  document.querySelectorAll('[data-faq-button]').forEach(function(button){button.addEventListener('click',function(){
    var answer=document.getElementById(this.getAttribute('aria-controls'));var open=this.getAttribute('aria-expanded')==='true';
    this.setAttribute('aria-expanded',String(!open));if(answer)answer.hidden=open;
  })});

  document.querySelectorAll('a[href^="#"]').forEach(function(link){link.addEventListener('click',function(event){
    var target=document.querySelector(this.getAttribute('href'));if(!target)return;event.preventDefault();
    var distance=Math.abs(target.getBoundingClientRect().top);var instant=window.matchMedia('(prefers-reduced-motion: reduce)').matches||distance>2200;
    if(instant){var old=document.documentElement.style.scrollBehavior;document.documentElement.style.scrollBehavior='auto';target.scrollIntoView({behavior:'auto',block:'start'});setTimeout(function(){document.documentElement.style.scrollBehavior=old},0)}else{target.scrollIntoView({behavior:'smooth',block:'start'})}
  })});

  var sticky=document.querySelector('[data-sticky-cta]');var hero=document.querySelector('[data-hero]');var lead=document.querySelector('[data-lead-section]');var footer=document.querySelector('[data-footer]');
  if(sticky&&'IntersectionObserver' in window){var heroVisible=true,leadVisible=false,footerVisible=false;function updateSticky(){sticky.classList.toggle('is-hidden',heroVisible||leadVisible||footerVisible)}
    if(hero)new IntersectionObserver(function(entries){heroVisible=entries[0].isIntersecting;updateSticky()},{threshold:.02}).observe(hero);
    if(lead)new IntersectionObserver(function(entries){leadVisible=entries[0].isIntersecting;updateSticky()},{threshold:.02}).observe(lead);
    if(footer)new IntersectionObserver(function(entries){footerVisible=entries[0].isIntersecting;updateSticky()},{threshold:.02}).observe(footer);updateSticky();
  }
});
