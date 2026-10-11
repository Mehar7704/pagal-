(() => {
  "use strict";

  const PHOTO_LIST = {
    1: { src: "photo-1.jpg", label: "Pagal Ki Jan" },
    2: { src: "photo-2.jpg", label: "Romantic Couple" },
    3: { src: "photo-3.jpg", label: "Gazali Ankhein" },
    4: { src: "photo-4.jpg", label: "Zulfon Wali" },
    5: { src: "photo-5.jpg", label: "Rose Garden Memories" },
    6: { src: "photo-6.jpg", label: "Pagal Ki Jan Plaque" },
    7: { src: "photo-7.jpg", label: "I Love You Plaque" }
  };
  const SAVE_KEY = "pagalMuhtrmaPuzzleSaveV2";
  const $ = id => document.getElementById(id);
  const board = $("board"), tray = $("tray"), modal = $("winModal");
  const photoSelect = $("photoSelect"), difficulty = $("difficulty"), puzzleMode = $("puzzleMode");
  let photo = new Image(), photoReady = false, photoId = "1", size = 4, mode = "square";
  let moves = 0, placed = 0, seconds = 0, selectedPiece = null, timerInterval = null;
  let toastTimeout = null, hintOn = false, solved = new Set(), pieces = [], audioContext = null, musicOsc = null, musicGain = null;
  let isRestoring = false, nextLevelTimeout = null;

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 2600);
  }
  function formatTime(n) {
    return `${String(Math.floor(n / 60)).padStart(2,"0")}:${String(n % 60).padStart(2,"0")}`;
  }
  function updateStats() {
    $("moves").textContent = moves;
    $("placed").textContent = `${placed}/${pieces.length}`;
    $("timer").textContent = formatTime(seconds);
  }
  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (modal.classList.contains("hidden")) {
        seconds++;
        $("timer").textContent = formatTime(seconds);
        saveProgress(false);
      }
    }, 1000);
  }
  function heartCell(r,c,n) {
    // A classic implicit heart mask, slightly widened for small grids.
    const x = ((c + .5) / n) * 2 - 1;
    const y = ((r + .5) / n) * 2 - 1;
    const xx = x * 1.12, yy = y * 1.12 + .12;
    return Math.pow(xx*xx + yy*yy - .52, 3) - xx*xx*Math.pow(yy,3) <= .015;
  }
  function visibleIndices() {
    const out = [];
    for (let i=0;i<size*size;i++) {
      const r=Math.floor(i/size), c=i%size;
      if (mode === "square" || heartCell(r,c,size)) out.push(i);
    }
    return out;
  }
  function photoStyle(el, index) {
    const r=Math.floor(index/size), c=index%size;
    el.style.setProperty("--photo", `url("${PHOTO_LIST[photoId].src}")`);
    el.style.setProperty("--photo-size", `${size*100}% ${size*100}%`);
    el.style.setProperty("--photo-pos", `${size===1?0:c/(size-1)*100}% ${size===1?0:r/(size-1)*100}%`);
  }
  function saveProgress(showMessage=true) {
    if (!photoReady || !pieces.length) return;
    const state = {
      version: 2, photoId, size, mode, moves, placed, seconds,
      solved: [...solved], pieces: pieces.slice(), savedAt: Date.now()
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      if (showMessage) showToast("Progress save ho gayi! ❤️ Dobara isi jagah se continue kar sakti hain.");
    } catch (_) {
      if (showMessage) showToast("Browser storage available nahi. Browser settings check karein.");
    }
  }
  function readSavedState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw);
      if (state.version !== 2 || !PHOTO_LIST[state.photoId] || ![3,4,5,6,8].includes(Number(state.size)) ||
          !["square","heart"].includes(state.mode) || !Array.isArray(state.solved) || !Array.isArray(state.pieces)) return null;
      return state;
    } catch (_) { return null; }
  }
  function shuffle(arr) {
    const out = arr.slice();
    for (let i=out.length-1;i>0;i--) {
      const j=Math.floor(Math.random()*(i+1));
      [out[i],out[j]]=[out[j],out[i]];
    }
    if (out.length>1 && out.every((v,i)=>v===i)) [out[0],out[1]]=[out[1],out[0]];
    return out;
  }
  function makePiece(index) {
    const el=document.createElement("button");
    el.type="button"; el.className="puzzle-piece"; el.dataset.index=String(index);
    el.setAttribute("aria-label",`Puzzle piece ${index+1}`);
    photoStyle(el,index); el.draggable=true;
    el.addEventListener("dragstart", ev=>{
      if (solved.has(index)) { ev.preventDefault(); return; }
      selectedPiece=index; el.classList.add("dragging");
      if(ev.dataTransfer){ev.dataTransfer.setData("text/plain",String(index));ev.dataTransfer.effectAllowed="move";}
    });
    el.addEventListener("dragend",()=>el.classList.remove("dragging"));
    el.addEventListener("click",()=>{
      if(solved.has(index))return;
      tray.querySelectorAll(".puzzle-piece.selected").forEach(p=>p.classList.remove("selected"));
      if(selectedPiece===index){selectedPiece=null;return;}
      selectedPiece=index;el.classList.add("selected");
      showToast("Ab is piece ki sahi jagah board par tap karein ❤️");
    });
    return el;
  }
  function makeSlot(index, visible) {
    const slot=document.createElement("div");
    slot.className="puzzle-slot";slot.dataset.index=String(index);
    if(!visible){slot.classList.add("heart-hidden");slot.setAttribute("aria-hidden","true");return slot;}
    slot.setAttribute("role","button");slot.tabIndex=0;
    slot.setAttribute("aria-label",`Destination for piece ${index+1}`);
    slot.addEventListener("dragover",ev=>{ev.preventDefault();slot.classList.add("drop-target");});
    slot.addEventListener("dragleave",()=>slot.classList.remove("drop-target"));
    slot.addEventListener("drop",ev=>{
      ev.preventDefault();slot.classList.remove("drop-target");
      const raw=ev.dataTransfer?.getData("text/plain");
      const idx=raw ? Number(raw) : selectedPiece;
      if(Number.isInteger(idx))tryPlace(idx,index);
    });
    slot.addEventListener("click",()=>{if(selectedPiece!==null)tryPlace(selectedPiece,index);});
    slot.addEventListener("keydown",ev=>{
      if((ev.key==="Enter"||ev.key===" ")&&selectedPiece!==null){ev.preventDefault();tryPlace(selectedPiece,index);}
    });
    return slot;
  }
  function tryPlace(pieceIndex, slotIndex) {
    if(solved.has(pieceIndex))return;
    moves++;
    if(pieceIndex!==slotIndex){
      updateStats();saveProgress(false);
      showToast("Yeh jagah nahi hai — doosri jagah try karein 💗");return;
    }
    const slot=board.querySelector(`.puzzle-slot[data-index="${slotIndex}"]`);
    const piece=tray.querySelector(`.puzzle-piece[data-index="${pieceIndex}"]`);
    if(!slot||!piece)return;
    solved.add(pieceIndex);placed++;
    slot.classList.add("correct");photoStyle(slot,slotIndex);
    slot.setAttribute("aria-label",`Piece ${slotIndex+1} correctly placed`);
    piece.remove();selectedPiece=null;
    updateStats();saveProgress(false);
    if(placed===pieces.length)finishGame();
    else if(placed%4===0)showToast("Shabash Muhtrma Ji! Bohat khoob! ✨");
  }
  function finishGame() {
    clearInterval(timerInterval);
    saveProgress(false);
    $("finalMoves").textContent=`Moves: ${moves}`;
    $("finalTime").textContent=`Time: ${formatTime(seconds)}`;
    const isFinalPhoto = Number(photoId) === Object.keys(PHOTO_LIST).length;
    $("winTitle").textContent = isFinalPhoto ? "Saare photo levels complete! ❤️" : `Level ${photoId} complete, Muhtrma Ji! ❤️`;
    $("nextLevelBtn").textContent = isFinalPhoto ? "Start Again · Level 1 ♡" : `Next Level · ${Number(photoId) + 1} →`;
    modal.classList.remove("hidden");
    sprinkleConfetti();
    showToast("Level complete! Agla level 4 seconds mein shuru hoga ❤️");
    clearTimeout(nextLevelTimeout);
    nextLevelTimeout = setTimeout(() => {
      if (!modal.classList.contains("hidden")) startNextLevel();
    }, 4000);
  }

  function startNextLevel() {
    clearTimeout(nextLevelTimeout);
    modal.classList.add("hidden");
    const totalPhotos = Object.keys(PHOTO_LIST).length;
    const current = Number(photoId);
    if (current < totalPhotos) {
      photoSelect.value = String(current + 1);
    } else {
      photoSelect.value = "1";
      const levels = ["3", "4", "5", "6", "8"];
      const currentIndex = levels.indexOf(String(difficulty.value));
      difficulty.value = levels[(currentIndex + 1) % levels.length];
      showToast(`All photos complete! New round: ${difficulty.options[difficulty.selectedIndex].text} ❤️`);
    }
    loadPhotoAndRender(null);
    showToast(`Level ${photoSelect.value} ready! Muhtrma Ji, chaliye agay barhein ❤️`);
  }
  function sprinkleConfetti() {
    const chars=["♥","✦","✧","♡","🌸"];
    for(let i=0;i<34;i++){
      const bit=document.createElement("span");bit.textContent=chars[Math.floor(Math.random()*chars.length)];
      Object.assign(bit.style,{position:"fixed",left:`${Math.random()*100}%`,top:"-30px",zIndex:"25",pointerEvents:"none",color:i%2?"var(--accent)":"#ff9eaf",fontSize:`${14+Math.random()*18}px`,transition:`top ${2+Math.random()*2}s ease-in, transform 3s linear, opacity 3s`});
      document.body.appendChild(bit);
      requestAnimationFrame(()=>{bit.style.top=`${65+Math.random()*35}%`;bit.style.transform=`rotate(${Math.random()*540}deg)`;bit.style.opacity="0";});
      setTimeout(()=>bit.remove(),4300);
    }
  }
  function renderGame(state=null) {
    isRestoring=!!state;
    photoId=state ? String(state.photoId) : String(photoSelect.value);
    size=state ? Number(state.size) : Number(difficulty.value);
    mode=state ? state.mode : puzzleMode.value;
    photoSelect.value=photoId;difficulty.value=String(size);puzzleMode.value=mode;
    moves=state?Number(state.moves)||0:0;seconds=state?Number(state.seconds)||0:0;
    solved=new Set(state ? state.solved.map(Number) : []);
    const visible=visibleIndices();
    pieces=visible.slice();
    if(state && Array.isArray(state.pieces)) {
      const allowed=new Set(visible);
      const filtered=state.pieces.map(Number).filter(i=>allowed.has(i)&&!solved.has(i));
      const seen=new Set(filtered);
      pieces=filtered.concat(visible.filter(i=>!solved.has(i)&&!seen.has(i)));
    } else {
      pieces=shuffle(visible.filter(i=>!solved.has(i)));
    }
    placed=solved.size;
    selectedPiece=null;hintOn=false;
    $("hintBtn").textContent="Show hint";
    board.innerHTML="";tray.innerHTML="";
    board.style.setProperty("--grid-size",size);
    $("boardTitle").textContent=mode==="heart"?"Build your photo heart":"Put the pieces together";
    $("boardHelp").textContent=mode==="heart"
      ?"Heart ke andar wali jagahon par pieces lagayen. Photo ke tukray sahi jagah par lagayen."
      :"Drag a piece into its matching place. Touch screen par piece tap karein, phir uski destination tap karein.";
    for(let i=0;i<size*size;i++){
      const r=Math.floor(i/size),c=i%size;
      const slot=makeSlot(i,mode==="square"||heartCell(r,c,size));
      if(solved.has(i)){
        slot.classList.add("correct");photoStyle(slot,i);slot.setAttribute("aria-label",`Piece ${i+1} correctly placed`);
      }
      board.appendChild(slot);
    }
    pieces.forEach(i=>tray.appendChild(makePiece(i)));
    if(!pieces.length)tray.innerHTML='<div class="empty-tray">All pieces placed! ❤️</div>';
    updateStats();modal.classList.add("hidden");
    isRestoring=false;startTimer();saveProgress(false);
  }
  function loadPhotoAndRender(state=null) {
    photoId=state?String(state.photoId):String(photoSelect.value);
    photoReady=false;
    photo=new Image();
    photo.onload=()=>{photoReady=true;renderGame(state);};
    photo.onerror=()=>showToast("Photo load nahi hui. images folder check karein.");
    photo.src=PHOTO_LIST[photoId].src;
  }
  $("newGameBtn").addEventListener("click",()=>{
    const saved=readSavedState();
    if(saved && saved.placed>0 && !confirm("Naya puzzle shuru karna hai? Current saved progress replace ho jayegi."))return;
    loadPhotoAndRender(null);showToast("New puzzle tayyar ho raha hai ❤️");
  });
  $("continueBtn").addEventListener("click",()=>{
    const state=readSavedState();
    if(!state){showToast("Abhi koi saved game nahi. Shuffle & Start dabayein.");return;}
    loadPhotoAndRender(state);showToast("Welcome back, Muhtrma Ji! Aapki progress restore ho rahi hai ❤️");
  });
  $("saveBtn").addEventListener("click",()=>saveProgress(true));
  $("playAgainBtn").addEventListener("click",()=>{
    clearTimeout(nextLevelTimeout);
    if(confirm("Is puzzle ko shuru se khelna hai?")){modal.classList.add("hidden");loadPhotoAndRender(null);}
  });
  $("nextLevelBtn").addEventListener("click", startNextLevel);
  $("closeModalBtn").addEventListener("click",()=>modal.classList.add("hidden"));
  modal.addEventListener("click",ev=>{if(ev.target===modal)modal.classList.add("hidden");});
  $("themeSelect").addEventListener("change",ev=>document.body.dataset.theme=ev.target.value);
  photoSelect.addEventListener("change",()=>{
    if(!photoReady)return;
    if(confirm("Photo change karne se current level reset ho jayega. Continue?"))loadPhotoAndRender(null);
    else photoSelect.value=photoId;
  });
  difficulty.addEventListener("change",()=>{if(photoReady)showToast("Nayi difficulty apply karne ke liye Shuffle & Start dabayein.");});
  puzzleMode.addEventListener("change",()=>{if(photoReady)showToast("Puzzle type change karne ke liye Shuffle & Start dabayein.");});
  $("hintBtn").addEventListener("click",()=>{
    hintOn=!hintOn;
    board.querySelectorAll(".puzzle-slot").forEach(slot=>{
      if(slot.classList.contains("heart-hidden")||slot.classList.contains("correct"))return;
      if(hintOn){
        const i=Number(slot.dataset.index),r=Math.floor(i/size),c=i%size;
        slot.style.backgroundImage=`linear-gradient(#ffffffa8,#ffffffa8),url("${PHOTO_LIST[photoId].src}")`;
        slot.style.backgroundSize=`100% 100%, ${size*100}% ${size*100}%`;
        slot.style.backgroundPosition=`center, ${size===1?0:c/(size-1)*100}% ${size===1?0:r/(size-1)*100}%`;
      } else {slot.style.backgroundImage="";slot.style.backgroundSize="";slot.style.backgroundPosition="";}
    });
    $("hintBtn").textContent=hintOn?"Hide hint":"Show hint";
  });
  $("fullscreenBtn").addEventListener("click",async()=>{
    try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}
    catch(_){showToast("Fullscreen is not available in this browser.");}
  });
  $("musicBtn").addEventListener("click",async()=>{
    try{
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(!Ctx)throw new Error();
      if(!audioContext)audioContext=new Ctx();
      if(audioContext.state==="suspended")await audioContext.resume();
      if(musicOsc){
        try{musicOsc.stop();}catch(_){}
        musicOsc=null;musicGain=null;audioContext.suspend();
        $("musicBtn").textContent="♫";showToast("Demo tone paused.");
      }else{
        const osc=audioContext.createOscillator(),gain=audioContext.createGain();
        osc.type="sine";osc.frequency.value=261.63;gain.gain.value=.012;
        osc.connect(gain);gain.connect(audioContext.destination);osc.start();
        musicOsc=osc;musicGain=gain;$("musicBtn").textContent="♪";
        showToast("Soft demo tone on. Click again to pause.");
      }
    }catch(_){showToast("Audio is not supported in this browser.");}
  });

  // Offer Continue Game automatically when a save exists.
  const savedAtStart=readSavedState();
  if(savedAtStart){
    $("continueBtn").classList.add("has-save");
    $("continueBtn").textContent="▶ Continue Saved Game";
    loadPhotoAndRender(savedAtStart);
  }else{
    loadPhotoAndRender(null);
  }
})();
