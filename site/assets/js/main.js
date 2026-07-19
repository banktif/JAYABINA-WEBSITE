document.addEventListener('DOMContentLoaded',function(){
  var menuToggle=document.getElementById('menuToggle');
  var mobileMenu=document.getElementById('mobileMenu');
  function closeMenu(returnFocus){
    if(!menuToggle||!mobileMenu)return;
    menuToggle.setAttribute('aria-expanded','false');
    menuToggle.setAttribute('aria-label','Buka menu');
    mobileMenu.classList.remove('open');
    mobileMenu.setAttribute('aria-hidden','true');
    document.body.classList.remove('menu-open');
    if(returnFocus)menuToggle.focus();
  }
  function openMenu(){
    if(!menuToggle||!mobileMenu)return;
    menuToggle.setAttribute('aria-expanded','true');
    menuToggle.setAttribute('aria-label','Tutup menu');
    mobileMenu.classList.add('open');
    mobileMenu.setAttribute('aria-hidden','false');
    document.body.classList.add('menu-open');
    var first=mobileMenu.querySelector('a,button');if(first)first.focus();
  }
  if(menuToggle&&mobileMenu){
    menuToggle.addEventListener('click',function(){this.getAttribute('aria-expanded')==='true'?closeMenu(false):openMenu()});
    mobileMenu.querySelectorAll('[data-mm-toggle]').forEach(function(btn){btn.addEventListener('click',function(){var section=this.closest('.mm-section');if(section){var open=section.classList.toggle('open');this.setAttribute('aria-expanded',String(open))}})});
    mobileMenu.querySelectorAll('a').forEach(function(link){link.addEventListener('click',function(){var toggle=link.closest('.mm-section');if(!toggle){closeMenu(false)}})});
  }
  document.addEventListener('keydown',function(event){
    if(event.key==='Escape'&&mobileMenu&&mobileMenu.classList.contains('open'))closeMenu(true);
    if(event.key==='Tab'&&mobileMenu&&mobileMenu.classList.contains('open')){
      var focusable=Array.from(mobileMenu.querySelectorAll('a[href],button[data-mm-toggle],.btn')).filter(function(el){return el.offsetParent!==null});if(!focusable.length)return;
      var first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
  });
  document.addEventListener('click',function(event){if(mobileMenu&&menuToggle&&mobileMenu.classList.contains('open')&&!mobileMenu.contains(event.target)&&!menuToggle.contains(event.target))closeMenu(false)});

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
