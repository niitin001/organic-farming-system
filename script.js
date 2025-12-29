// ...existing code...
document.addEventListener('DOMContentLoaded', (function(){
  const slides = Array.from(document.querySelectorAll('.slide'));
  const dots = Array.from(document.querySelectorAll('.dot'));
  const playBtn = document.getElementById('playPauseBtn');
  const playOverlay = document.getElementById('playOverlay');
  const sliderEl = document.getElementById('slider');

  let idx = 0;
  let playing = true;
  let timer = null;
  const interval = 3500;

  function show(i){
    if(!slides.length) return;
    slides.forEach((s, k) => s.classList.toggle('active', k === i));
    dots.forEach((d, k) => d.classList.toggle('active', k === i));
    idx = i;
  }

  function next(){
    if(!slides.length) return;
    show((idx + 1) % slides.length);
  }

  function start(){
    if(!slides.length) return;
    if(timer) clearInterval(timer);
    timer = setInterval(next, interval);
    playing = true;
    updatePlayIcon();
  }

  function stop(){
    if(timer) clearInterval(timer);
    timer = null;
    playing = false;
    updatePlayIcon();
  }

  function updatePlayIcon(){
    if(!playBtn) return;
    if(playing){
      playBtn.innerHTML = '<svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true"><rect x="20" y="16" width="8" height="32" fill="#fff"/><rect x="36" y="16" width="8" height="32" fill="#fff"/></svg>';
      playBtn.setAttribute('aria-label', 'Pause slideshow');
    } else {
      playBtn.innerHTML = '<svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true"><polygon points="22,16 52,32 22,48" fill="#fff" /></svg>';
      playBtn.setAttribute('aria-label', 'Play slideshow');
    }
  }

  // Initialize only if there are slides
  show(0);
  if (slides.length > 1) start();

  dots.forEach(d => {
    d.addEventListener('click', () => {
      const i = parseInt(d.dataset.index, 10);
      if (Number.isFinite(i) && i >= 0 && i < slides.length) {
        show(i);
        // restart autoplay if it was playing
        if(playing) {
          start();
        }
      }
    });
  });

  if (playOverlay) {
    playOverlay.addEventListener('click', () => {
      if(playing) stop();
      else start();
    });
  }

  if (sliderEl) {
    sliderEl.addEventListener('mouseenter', () => { if(playing) stop(); });
    sliderEl.addEventListener('mouseleave', () => { if(!playing) start(); });
  }

})); 
// ...existing code...