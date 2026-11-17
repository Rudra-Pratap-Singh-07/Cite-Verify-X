(() => {
  const WIDTH = 960;
  const HEIGHT = 500;
  const GROUND_Y = 450;
  const PLAYER_X = 178;
  const PLAYER_WIDTH = 36;
  const PLAYER_HEIGHT = 34;
  const GATE_WIDTH = 68;
  const GATE_SPACING = 320;
  const GRAVITY = 1120;
  const FLAP_VELOCITY = -430;
  const VOICE_MIN_THRESHOLD = 0.025;
  const VOICE_REARM_QUIET_SECONDS = 0.045;
  const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ROOM_CODE_LENGTH = 8;
  const PLAYER_SPACING = 64;
  const NETWORK_SNAPSHOT_MS = 50;

  const canvas = document.getElementById('game-canvas');
  const context = canvas.getContext('2d');
  const overlay = document.getElementById('game-overlay');
  const overlayTitle = document.getElementById('game-overlay-title');
  const overlayCopy = document.getElementById('game-overlay-copy');
  const startButton = document.getElementById('game-start');
  const voiceButton = document.getElementById('voice-toggle');
  const voiceStatus = document.getElementById('voice-status');
  const status = document.getElementById('game-status');
  const usernameInput = document.getElementById('player-name');
  const hostButton = document.getElementById('coop-host');
  const joinForm = document.getElementById('coop-join-form');
  const roomCodeInput = document.getElementById('room-code-input');
  const roomElement = document.getElementById('coop-room');
  const roomCodeElement = document.getElementById('room-code');
  const roomPlayers = document.getElementById('room-players');
  const roomStatus = document.getElementById('coop-status');
  const copyRoomButton = document.getElementById('room-copy');
  const coopStartButton = document.getElementById('coop-start');
  const leaveRoomButton = document.getElementById('coop-leave');
  const gemScore = document.getElementById('gem-score');
  const courseScore = document.getElementById('course-score');

  if (!context) {
    status.textContent = 'This browser could not start the game canvas. Try a browser with canvas support.';
    startButton.disabled = true;
    voiceButton.disabled = true;
    voiceStatus.textContent = 'Voice controls are unavailable because the game could not start.';
    return;
  }

  let state = 'ready';
  let roomRole = 'solo';
  let localUsername = '';
  let otherUsername = '';
  let roomCode = '';
  let activePeer = null;
  let roomConnection = null;
  let roomActionPending = false;
  let peerLibraryPromise = null;
  let joinTimeoutId = 0;
  let lastSnapshotAt = 0;
  let lastFrame = 0;
  let animationFrameId = 0;
  let pageIsLeaving = false;
  let audioStream = null;
  let audioContext = null;
  let audioSource = null;
  let analyser = null;
  let audioSamples = null;
  let ambientFloor = 0.01;
  let calibrationSamples = [];
  let calibrationElapsed = 0;
  let voiceLatched = false;
  let quietElapsed = 0;
  let elapsed = 0;
  let worldOffset = 0;
  let score = 0;
  let gems = 0;
  let gates = [];
  let platforms = [];
  let players = [{ y: 228, velocity: 0, rotation: 0, username: 'Player 1' }];

  function gapSize() {
    return Math.max(138, 178 - Math.floor(score / 8) * 8);
  }

  function makeGate(x, index) {
    const center = 222 + Math.sin(index * 1.43) * 66;
    return { x, center, gap: gapSize(), scored: false, gemCollected: false };
  }

  function resetWorld() {
    elapsed = 0;
    worldOffset = 0;
    score = 0;
    gems = 0;
    players = roomRole === 'solo'
      ? [{ y: 228, velocity: 0, rotation: 0, username: localUsername || 'Player 1' }]
      : [
          { y: 228, velocity: 0, rotation: 0, username: roomRole === 'host' ? localUsername : otherUsername || 'Player 1' },
          { y: 228, velocity: 0, rotation: 0, username: roomRole === 'host' ? otherUsername || 'Player 2' : localUsername }
        ];
    gates = [];
    platforms = [];
    for (let index = 0; index < 5; index += 1) {
      const gate = makeGate(640 + index * GATE_SPACING, index);
      gates.push(gate);
      if (index > 1 && index % 3 === 2) {
        platforms.push({
          x: gate.x + 126,
          y: gate.center + (index % 2 === 0 ? 56 : -56),
          width: 70,
          height: 15
        });
      }
    }
    gemScore.textContent = '0';
    courseScore.textContent = '0';
  }

  function resizeCanvas() {
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = WIDTH * pixelRatio;
    canvas.height = HEIGHT * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    draw();
  }

  function roundedRect(x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }

  function drawCloud(x, y, scale) {
    context.fillStyle = 'rgb(255 255 245 / 65%)';
    context.beginPath();
    context.ellipse(x, y, 34 * scale, 12 * scale, 0, 0, Math.PI * 2);
    context.ellipse(x - 18 * scale, y + 1 * scale, 17 * scale, 9 * scale, 0, 0, Math.PI * 2);
    context.ellipse(x + 13 * scale, y - 6 * scale, 19 * scale, 14 * scale, 0, 0, Math.PI * 2);
    context.fill();
  }

  function drawHill(baseY, height, color, shift, frequency) {
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, HEIGHT);
    for (let x = 0; x <= WIDTH; x += 8) {
      const worldX = x + shift;
      const y = baseY - (Math.sin(worldX * frequency) * 0.5 + 0.5) * height;
      context.lineTo(x, y);
    }
    context.lineTo(WIDTH, HEIGHT);
    context.closePath();
    context.fill();
  }

  function drawBackground() {
    const sky = context.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, '#9bd8e6');
    sky.addColorStop(1, '#e8edc8');
    context.fillStyle = sky;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    context.fillStyle = '#fff0bd';
    context.beginPath();
    context.arc(780, 98, 36, 0, Math.PI * 2);
    context.fill();

    const cloudShift = (worldOffset * 0.14) % 1120;
    drawCloud(140 - cloudShift, 102, 1);
    drawCloud(510 - cloudShift, 74, 0.72);
    drawCloud(930 - cloudShift, 139, 0.9);
    drawCloud(1260 - cloudShift, 90, 0.78);

    drawHill(362, 96, '#9ec49a', worldOffset * 0.16, 0.009);
    drawHill(395, 63, '#75a87d', worldOffset * 0.32, 0.013);
  }

  function drawGate(gate) {
    const gapTop = gate.center - gate.gap / 2;
    const gapBottom = gate.center + gate.gap / 2;
    const parts = [
      { y: 0, height: gapTop },
      { y: gapBottom, height: GROUND_Y - gapBottom }
    ];

    for (const part of parts) {
      if (part.height <= 0) continue;
      context.fillStyle = '#b96f50';
      context.fillRect(gate.x, part.y, GATE_WIDTH, part.height);
      context.fillStyle = '#d28a62';
      context.fillRect(gate.x - 5, part.y + (part.y === 0 ? Math.max(0, part.height - 18) : 0), GATE_WIDTH + 10, 18);

      context.strokeStyle = 'rgb(105 63 50 / 38%)';
      context.lineWidth = 2;
      for (let rowY = Math.ceil(part.y / 23) * 23 + 3; rowY < part.y + part.height - 5; rowY += 23) {
        context.beginPath();
        context.moveTo(gate.x + 2, rowY);
        context.lineTo(gate.x + GATE_WIDTH - 2, rowY);
        context.stroke();
        const offset = Math.floor(rowY / 23) % 2 === 0 ? 0 : 17;
        for (let seamX = gate.x + 17 + offset; seamX < gate.x + GATE_WIDTH; seamX += 34) {
          context.beginPath();
          context.moveTo(seamX, rowY - 21);
          context.lineTo(seamX, rowY);
          context.stroke();
        }
      }
      context.fillStyle = '#8f563f';
      context.fillRect(gate.x + 7, part.y + 8, 5, Math.max(0, part.height - 16));
    }
  }

  function drawPlatform(platform) {
    context.fillStyle = '#8f563f';
    context.fillRect(platform.x, platform.y, platform.width, platform.height);
    context.fillStyle = '#e5ae70';
    context.fillRect(platform.x - 3, platform.y, platform.width + 6, 6);
    context.fillStyle = '#c88058';
    for (let x = platform.x + 10; x < platform.x + platform.width; x += 22) {
      context.fillRect(x, platform.y + 7, 2, platform.height - 7);
    }
  }

  function drawGem(gate) {
    const x = gate.x + GATE_WIDTH / 2;
    const y = gate.center + Math.sin(elapsed * 3 + gate.x) * 4;
    context.save();
    context.translate(x, y);
    context.rotate(Math.sin(elapsed * 2 + gate.x) * 0.12);
    context.fillStyle = 'rgb(255 231 130 / 25%)';
    context.beginPath();
    context.arc(0, 0, 19, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ffe27f';
    context.beginPath();
    for (let point = 0; point < 10; point += 1) {
      const radius = point % 2 === 0 ? 11 : 7;
      const angle = -Math.PI / 2 + point * Math.PI / 5;
      const pointX = Math.cos(angle) * radius;
      const pointY = Math.sin(angle) * radius;
      if (point === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    }
    context.closePath();
    context.fill();
    context.fillStyle = '#fff9dc';
    context.beginPath();
    context.arc(-2, -3, 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawGround() {
    context.fillStyle = '#75945b';
    context.fillRect(0, GROUND_Y, WIDTH, 9);
    context.fillStyle = '#bd8958';
    context.fillRect(0, GROUND_Y + 9, WIDTH, HEIGHT - GROUND_Y - 9);
    const tileOffset = worldOffset % 36;
    context.fillStyle = '#d4a36a';
    for (let x = -tileOffset; x < WIDTH; x += 36) {
      context.fillRect(x, GROUND_Y + 19, 18, 8);
      context.fillRect(x + 18, GROUND_Y + 36, 18, 8);
    }
  }

  function drawPlayer(bird, index) {
    const birdX = PLAYER_X + (players.length > 1 ? index * PLAYER_SPACING : 0);
    const x = birdX + PLAYER_WIDTH / 2;
    const y = bird.y + PLAYER_HEIGHT / 2;
    context.save();
    context.translate(x, y);
    context.rotate(bird.rotation);
    context.fillStyle = '#3e5960';
    context.beginPath();
    context.moveTo(-9, 0);
    context.lineTo(-27, Math.sin(elapsed * 17) * 5 - 2);
    context.lineTo(-13, 11);
    context.closePath();
    context.fill();
    context.fillStyle = index === 1 ? '#7488c7' : '#e89252';
    roundedRect(-17, -15, 32, 29, 10);
    context.fill();
    context.fillStyle = '#f6bc72';
    context.beginPath();
    context.arc(7, -5, 9, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#35423d';
    context.beginPath();
    context.arc(10, -6, 1.8, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#775441';
    roundedRect(-13, 10, 13, 5, 2);
    context.fill();
    context.restore();
    context.fillStyle = '#263d3d';
    context.font = '12px sans-serif';
    context.textAlign = 'center';
    context.fillText(bird.username, x, bird.y - 7);
  }

  function draw() {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    drawBackground();
    for (const gate of gates) drawGate(gate);
    for (const platform of platforms) drawPlatform(platform);
    for (const gate of gates) {
      if (!gate.gemCollected) drawGem(gate);
    }
    drawGround();
    players.forEach(drawPlayer);
  }

  function updateScore() {
    gemScore.textContent = String(gems);
    courseScore.textContent = String(score);
  }

  function finishGame() {
    if (state !== 'playing') return;
    state = 'over';
    overlayTitle.textContent = 'A breeze to try again';
    overlayCopy.textContent = `You cleared ${score} gate${score === 1 ? '' : 's'} and collected ${gems} sun gem${gems === 1 ? '' : 's'}. Ready for another flight?`;
    startButton.textContent = roomRole === 'guest' ? 'Waiting for host' : 'Fly again';
    startButton.disabled = roomRole === 'guest';
    overlay.hidden = false;
    status.textContent = `Flight over. You cleared ${score} gates and collected ${gems} gems.`;
    updateStartControls();
    if (roomRole === 'host') startButton.focus();
  }

  function startGame(isRemoteStart) {
    if (roomRole === 'guest' && !isRemoteStart) return;
    if (roomRole === 'host' && (!roomConnection || !roomConnection.open)) {
      roomStatus.textContent = 'Connect the second player before starting a co-op flight.';
      return;
    }
    resetWorld();
    state = 'playing';
    overlay.hidden = true;
    startButton.textContent = 'Start flight';
    startButton.disabled = false;
    status.textContent = players.length > 1
      ? `${players[0].username} and ${players[1].username} are flying together. Make a short sound with the microphone on, or press Space, W, or ↑ to flap through each opening.`
      : 'Make a short sound with the microphone on, or press Space, W, or ↑ to flap through each opening and watch for the moving course.';
    canvas.focus();
    lastFrame = 0;
    updateStartControls();
    if (roomRole === 'host' && !isRemoteStart) {
      sendRoomMessage({ type: 'start' });
      sendGameSnapshot();
    }
  }

  function flap() {
    if (state !== 'playing') return;
    const playerIndex = roomRole === 'guest' ? 1 : 0;
    players[playerIndex].velocity = FLAP_VELOCITY;
    if (roomRole === 'guest') sendRoomMessage({ type: 'flap' });
  }

  function setVoiceStatus(message) {
    voiceStatus.textContent = message;
  }

  function releaseMicrophone(updateStatus) {
    if (audioSource) audioSource.disconnect();
    audioSource = null;
    analyser = null;
    audioSamples = null;
    if (audioStream) {
      for (const track of audioStream.getTracks()) track.stop();
    }
    audioStream = null;
    if (audioContext) {
      const contextToClose = audioContext;
      audioContext = null;
      contextToClose.close().catch((error) => {
        console.error('Could not close the microphone audio context.', error);
        if (!pageIsLeaving) setVoiceStatus('The microphone stopped, but audio cleanup reported an error. Reload the page if this continues.');
      });
    }
    calibrationSamples = [];
    calibrationElapsed = 0;
    voiceLatched = false;
    quietElapsed = 0;
    voiceButton.disabled = false;
    voiceButton.setAttribute('aria-pressed', 'false');
    voiceButton.textContent = 'Enable microphone';
    if (updateStatus) {
      setVoiceStatus('Microphone is off. Audio is analyzed on this device only; it is not recorded or sent.');
    }
  }

  function microphoneErrorMessage(error) {
    if (error && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error.name)) {
      return 'Microphone permission was denied. Allow access in your browser settings, then try again.';
    }
    if (error && ['NotFoundError', 'DevicesNotFoundError'].includes(error.name)) {
      return 'No microphone was found. Connect a microphone or use the keyboard controls.';
    }
    if (error && ['NotReadableError', 'TrackStartError', 'AbortError'].includes(error.name)) {
      return 'The microphone is unavailable or in use by another app. Close the other app or use the keyboard controls.';
    }
    const detail = error && error.message ? ` (${error.message})` : '';
    return `Microphone could not start${detail}. You can still flap with Space, W, or ↑.`;
  }

  async function enableMicrophone() {
    if (!window.isSecureContext) {
      setVoiceStatus('Microphone access requires a secure page: open this game over HTTPS or localhost.');
      return;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setVoiceStatus('This browser does not support microphone access. Use Space, W, or ↑ to flap.');
      return;
    }
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      setVoiceStatus('This browser does not support local audio analysis. Use Space, W, or ↑ to flap.');
      return;
    }

    voiceButton.disabled = true;
    voiceButton.textContent = 'Requesting microphone…';
    setVoiceStatus('Waiting for microphone permission. Audio stays on this device and is never recorded or sent.');
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      });
      if (pageIsLeaving) {
        releaseMicrophone(false);
        return;
      }

      audioContext = new AudioContextConstructor();
      await audioContext.resume();
      if (pageIsLeaving) {
        releaseMicrophone(false);
        return;
      }

      audioSource = audioContext.createMediaStreamSource(audioStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.1;
      audioSamples = new Float32Array(analyser.fftSize);
      audioSource.connect(analyser);
      calibrationSamples = [];
      calibrationElapsed = 0;
      ambientFloor = 0.01;
      voiceLatched = false;
      quietElapsed = 0;
      voiceButton.disabled = false;
      voiceButton.setAttribute('aria-pressed', 'true');
      voiceButton.textContent = 'Turn microphone off';
      setVoiceStatus('Microphone on. Calibrating to ambient sound for a moment; make a short sound to flap.');
    } catch (error) {
      console.error('Could not start microphone controls.', error);
      releaseMicrophone(false);
      setVoiceStatus(microphoneErrorMessage(error));
    }
  }

  function detectSound(delta) {
    if (!analyser || !audioSamples) return;
    analyser.getFloatTimeDomainData(audioSamples);
    let sum = 0;
    for (const sample of audioSamples) {
      sum += sample * sample;
    }
    const level = Math.sqrt(sum / audioSamples.length);

    if (calibrationElapsed < 1) {
      calibrationElapsed += delta;
      calibrationSamples.push(level);
      if (calibrationElapsed >= 1 && calibrationSamples.length > 0) {
        calibrationSamples.sort((left, right) => left - right);
        ambientFloor = Math.max(0.005, calibrationSamples[Math.floor(calibrationSamples.length * 0.25)]);
        calibrationSamples = [];
        setVoiceStatus('Microphone ready. Make a short sound to flap; audio remains on this device.');
      }
      return;
    }

    const threshold = Math.max(VOICE_MIN_THRESHOLD, ambientFloor * 2.4 + 0.008);
    const releaseThreshold = threshold * 0.5;
    if (!voiceLatched && level < threshold) {
      const smoothing = 1 - Math.exp(-delta * 0.6);
      ambientFloor += (level - ambientFloor) * smoothing;
    }

    if (level >= threshold) {
      if (!voiceLatched) {
        voiceLatched = true;
        quietElapsed = 0;
        flap();
        setVoiceStatus('Sound detected — flap! Make another short sound whenever you are ready.');
      }
      return;
    }

    if (voiceLatched && level <= releaseThreshold) {
      quietElapsed += delta;
      if (quietElapsed >= VOICE_REARM_QUIET_SECONDS) {
        voiceLatched = false;
        quietElapsed = 0;
      }
    } else if (voiceLatched) {
      quietElapsed = 0;
    }
  }

  function playerX(index) {
    return PLAYER_X + (players.length > 1 ? index * PLAYER_SPACING : 0);
  }

  function intersectsPlayer(x, y, width, height, playerIndex) {
    const bird = players[playerIndex];
    const xPosition = playerX(playerIndex);
    return xPosition < x + width
      && xPosition + PLAYER_WIDTH > x
      && bird.y < y + height
      && bird.y + PLAYER_HEIGHT > y;
  }

  function update(delta) {
    elapsed += delta;
    const speed = Math.min(350, 235 + Math.floor(score / 4) * 9);
    worldOffset += speed * delta;
    for (const bird of players) {
      bird.velocity += GRAVITY * delta;
      bird.y += bird.velocity * delta;
      bird.rotation = Math.max(-0.45, Math.min(0.7, bird.velocity / 620));
    }

    for (const gate of gates) {
      gate.x -= speed * delta;
      const gapTop = gate.center - gate.gap / 2;
      const gapBottom = gate.center + gate.gap / 2;
      const hitGate = players.some((bird, index) => (
        intersectsPlayer(gate.x, 0, GATE_WIDTH, gapTop, index)
          || intersectsPlayer(gate.x, gapBottom, GATE_WIDTH, GROUND_Y - gapBottom, index)
      ));
      if (hitGate) {
        finishGame();
        return;
      }

      if (!gate.gemCollected) {
        const gemX = gate.x + GATE_WIDTH / 2;
        const gemY = gate.center + Math.sin(elapsed * 3 + gate.x) * 4;
        const collectedByPlayer = players.some((bird, index) => {
          const playerCenterX = playerX(index) + PLAYER_WIDTH / 2;
          const playerCenterY = bird.y + PLAYER_HEIGHT / 2;
          return Math.hypot(gemX - playerCenterX, gemY - playerCenterY) < 27;
        });
        if (collectedByPlayer) {
          gate.gemCollected = true;
          gems += 1;
          updateScore();
          status.textContent = `${gems} sun gem${gems === 1 ? '' : 's'} collected. Keep flying!`;
        }
      }

      if (!gate.scored && gate.x + GATE_WIDTH < playerX(players.length - 1)) {
        gate.scored = true;
        score += 1;
        updateScore();
        status.textContent = `Gate ${score} cleared. The course is getting quicker.`;
      }
    }

    for (const platform of platforms) {
      platform.x -= speed * delta;
      if (players.some((bird, index) => intersectsPlayer(platform.x, platform.y, platform.width, platform.height, index))) {
        finishGame();
        return;
      }
    }

    if (players.some((bird) => bird.y < 0 || bird.y + PLAYER_HEIGHT > GROUND_Y)) {
      finishGame();
      return;
    }

    gates = gates.filter((gate) => gate.x + GATE_WIDTH > -10);
    platforms = platforms.filter((platform) => platform.x + platform.width > -10);

    let nextIndex = score + gates.length;
    let nextX = gates.length ? gates[gates.length - 1].x : WIDTH;
    while (nextX < WIDTH + GATE_SPACING) {
      nextX += GATE_SPACING;
      const gate = makeGate(nextX, nextIndex);
      gates.push(gate);
      if (nextIndex > 1 && nextIndex % 3 === 2) {
        platforms.push({
          x: gate.x + 126,
          y: gate.center + (nextIndex % 2 === 0 ? 56 : -56),
          width: 70,
          height: 15
        });
      }
      nextIndex += 1;
    }
  }

  function getUsername() {
    let username = usernameInput.value.trim().slice(0, 20);
    if (!username) {
      const randomBytes = new Uint8Array(3);
      window.crypto.getRandomValues(randomBytes);
      const suffix = Array.from(randomBytes, (value) => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join('');
      username = `Sky Flyer ${suffix}`;
      usernameInput.value = username;
      roomStatus.textContent = `Using the guest username “${username}”. You can change it before hosting or joining next time.`;
    }
    return username;
  }

  function generateRoomCode() {
    const randomBytes = new Uint8Array(ROOM_CODE_LENGTH);
    window.crypto.getRandomValues(randomBytes);
    return Array.from(randomBytes, (value) => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join('');
  }

  function createPeer(peerId) {
    const options = { host: '0.peerjs.com', port: 443, path: '/', secure: true };
    return peerId ? new window.Peer(peerId, options) : new window.Peer(undefined, options);
  }

  function loadPeerLibrary() {
    if (window.Peer) return Promise.resolve();
    if (peerLibraryPromise) return peerLibraryPromise;
    peerLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
      script.async = true;
      script.onload = () => {
        if (window.Peer) resolve();
        else reject(new Error('PeerJS did not initialize.'));
      };
      script.onerror = () => reject(new Error('Could not load PeerJS.'));
      document.head.append(script);
    }).catch((error) => {
      peerLibraryPromise = null;
      throw error;
    });
    return peerLibraryPromise;
  }

  async function preparePeerAction() {
    if (window.Peer) return true;
    roomActionPending = true;
    hostButton.disabled = true;
    document.getElementById('coop-join').disabled = true;
    roomStatus.textContent = 'Loading secure co-op networking…';
    try {
      await loadPeerLibrary();
      return true;
    } catch (error) {
      console.error('Could not load the co-op networking library.', error);
      roomStatus.textContent = 'The co-op library could not load. Check your internet connection or browser content-blocking settings, then try again.';
      return false;
    } finally {
      roomActionPending = false;
      if (roomRole === 'solo') {
        hostButton.disabled = false;
        document.getElementById('coop-join').disabled = false;
      }
    }
  }

  function sendRoomMessage(message) {
    if (!roomConnection || !roomConnection.open) return false;
    try {
      roomConnection.send(message);
      return true;
    } catch (error) {
      console.error('Could not send co-op game data.', error);
      roomStatus.textContent = 'The room connection had a problem sending game data. Try reconnecting.';
      return false;
    }
  }

  function updateStartControls() {
    if (roomRole === 'host') {
      const canStart = Boolean(roomConnection && roomConnection.open) && state !== 'playing';
      startButton.disabled = !canStart;
      startButton.textContent = state === 'playing'
        ? 'Flight in progress'
        : canStart ? 'Start with 2 players' : 'Waiting for player…';
      coopStartButton.disabled = !canStart;
      coopStartButton.textContent = state === 'playing' ? 'Flight in progress' : 'Start with 2 players';
    } else if (roomRole === 'guest') {
      startButton.disabled = true;
      startButton.textContent = 'Waiting for host';
      coopStartButton.disabled = true;
      coopStartButton.textContent = state === 'playing' ? 'Flight in progress' : 'Waiting for host';
    } else {
      startButton.disabled = false;
      startButton.textContent = state === 'over' ? 'Fly again' : 'Start flight';
      coopStartButton.disabled = true;
      coopStartButton.textContent = 'Start with 2 players';
    }
  }

  function setRoomBusy(isBusy) {
    hostButton.disabled = isBusy || roomActionPending;
    document.getElementById('coop-join').disabled = isBusy || roomActionPending;
    usernameInput.disabled = isBusy;
    roomCodeInput.disabled = isBusy;
    roomElement.hidden = !isBusy;
    leaveRoomButton.hidden = !isBusy;
  }

  function clearConnectionTimeout() {
    if (joinTimeoutId) window.clearTimeout(joinTimeoutId);
    joinTimeoutId = 0;
  }

  function roomSnapshot() {
    return {
      gameState: state,
      elapsed,
      worldOffset,
      score,
      gems,
      gates,
      platforms,
      players
    };
  }

  function sendGameSnapshot() {
    if (roomRole === 'host') sendRoomMessage({ type: 'snapshot', snapshot: roomSnapshot() });
  }

  function applyGameSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.players) || !Array.isArray(snapshot.gates)) return;
    if (snapshot.gameState === 'playing' && state !== 'playing') startGame(true);
    const wasPlaying = state === 'playing';
    elapsed = snapshot.elapsed;
    worldOffset = snapshot.worldOffset;
    score = snapshot.score;
    gems = snapshot.gems;
    gates = snapshot.gates;
    platforms = snapshot.platforms;
    players = snapshot.players;
    updateScore();
    if (snapshot.gameState === 'over' && (wasPlaying || state !== 'over')) {
      state = 'playing';
      finishGame();
    } else if (snapshot.gameState !== 'playing' && snapshot.gameState !== 'over') {
      state = snapshot.gameState;
    }
    draw();
  }

  function handleRoomMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (roomRole === 'host') {
      if (message.type === 'hello' && typeof message.username === 'string') {
        otherUsername = message.username.slice(0, 20);
        if (players.length > 1) players[1].username = otherUsername;
        roomPlayers.textContent = `${localUsername} and ${otherUsername} are in the room. Start when you’re both ready.`;
        sendRoomMessage({ type: 'welcome', host: localUsername, guest: otherUsername });
        sendGameSnapshot();
      } else if (message.type === 'flap' && state === 'playing' && players.length > 1) {
        players[1].velocity = FLAP_VELOCITY;
      }
      return;
    }

    if (message.type === 'start') {
      startGame(true);
    } else if (message.type === 'welcome') {
      otherUsername = typeof message.host === 'string' ? message.host.slice(0, 20) : 'Host';
      roomPlayers.textContent = `You are connected with ${otherUsername}. Waiting for the host to start.`;
      roomStatus.textContent = `Connected to ${otherUsername}’s room. The host starts the two-player flight.`;
    } else if (message.type === 'snapshot') {
      applyGameSnapshot(message.snapshot);
    } else if (message.type === 'room-full') {
      disconnectRoom('That room already has two players. Ask the host for another room code.');
    }
  }

  function disconnectRoom(message) {
    clearConnectionTimeout();
    const oldConnection = roomConnection;
    const oldPeer = activePeer;
    roomConnection = null;
    activePeer = null;
    roomRole = 'solo';
    roomCode = '';
    otherUsername = '';
    if (oldConnection && oldConnection.open) oldConnection.close();
    if (oldPeer && !oldPeer.destroyed) oldPeer.destroy();
    setRoomBusy(false);
    roomCodeElement.textContent = '';
    roomPlayers.textContent = 'Waiting for a second player…';
    coopStartButton.disabled = true;
    updateStartControls();
    if (state === 'playing') {
      state = 'ready';
      overlayTitle.textContent = 'Co-op flight ended';
      overlayCopy.textContent = message;
      overlay.hidden = false;
    }
    roomStatus.textContent = message;
    resetWorld();
    updateStartControls();
  }

  function failRoom(message) {
    disconnectRoom(message);
  }

  function bindRoomConnection(connection) {
    roomConnection = connection;
    connection.on('open', () => {
      clearConnectionTimeout();
      if (roomRole === 'host') {
        otherUsername = typeof connection.metadata?.username === 'string'
          ? connection.metadata.username.slice(0, 20)
          : 'Player 2';
        resetWorld();
        roomPlayers.textContent = `${localUsername} and ${otherUsername} are in the room. Start when you’re both ready.`;
        roomStatus.textContent = 'Two players connected. You can start the flight now.';
        updateStartControls();
        sendRoomMessage({ type: 'welcome', host: localUsername, guest: otherUsername });
      } else {
        roomStatus.textContent = 'Room connected. Waiting for the host to start the flight.';
        connection.send({ type: 'hello', username: localUsername });
        startButton.disabled = true;
        startButton.textContent = 'Waiting for host';
      }
    });
    connection.on('data', handleRoomMessage);
    connection.on('close', () => {
      if (roomConnection !== connection) return;
      disconnectRoom('The other player left or the connection was lost. You can host or join another room.');
    });
    connection.on('error', (error) => {
      console.error('Co-op data connection error.', error);
      if (roomConnection === connection) {
        disconnectRoom('The room connection failed. Check your internet connection and try again.');
      }
    });
  }

  function handlePeerError(error) {
    console.error('Co-op peer connection error.', error);
    if (error.type === 'peer-unavailable') {
      failRoom('Room not found. Check the code and ask the host to keep the room open.');
    } else if (error.type === 'unavailable-id') {
      failRoom('That room code is already in use. Try hosting again for a new code.');
    } else if (error.type === 'network' || error.type === 'socket-error' || error.type === 'server-error') {
      failRoom('Could not reach the co-op service. Check your connection and try again.');
    } else {
      failRoom('The co-op connection could not be created. Try again or play solo.');
    }
  }

  async function hostRoom() {
    if (roomRole !== 'solo' || roomActionPending) return;
    const username = getUsername();
    if (!username) return;
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
      roomStatus.textContent = 'Secure random room codes are unavailable in this browser. Open the game over HTTPS.';
      return;
    }
    if (!await preparePeerAction()) return;
    if (roomRole !== 'solo') return;
    localUsername = username;
    roomRole = 'host';
    roomCode = generateRoomCode();
    roomCodeElement.textContent = roomCode;
    roomPlayers.textContent = 'Waiting for a second player…';
    roomStatus.textContent = 'Opening your room…';
    setRoomBusy(true);
    updateStartControls();
    try {
      activePeer = createPeer(roomCode);
      activePeer.on('open', (openedId) => {
        clearConnectionTimeout();
        roomCode = openedId.toUpperCase();
        roomCodeElement.textContent = roomCode;
        roomStatus.textContent = 'Room is ready. Share the code with one friend.';
      });
      activePeer.on('connection', (connection) => {
        if (roomConnection) {
          connection.on('open', () => {
            connection.send({ type: 'room-full' });
            connection.close();
          });
          return;
        }
        bindRoomConnection(connection);
      });
      activePeer.on('error', handlePeerError);
      joinTimeoutId = window.setTimeout(() => {
        if (roomRole === 'host' && activePeer && !activePeer.open) {
          failRoom('Could not reach the co-op service. Check your connection and try again.');
        }
      }, 15000);
      activePeer.on('disconnected', () => {
        if (roomRole !== 'solo') roomStatus.textContent = 'Connection to the co-op service was interrupted. Reconnect or leave the room.';
      });
    } catch (error) {
      console.error('Could not host a co-op room.', error);
      failRoom('Could not start hosting. Check your internet connection and try again.');
    }
  }

  async function joinRoom() {
    if (roomRole !== 'solo' || roomActionPending) return;
    const username = getUsername();
    if (!username) return;
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(code)) {
      roomStatus.textContent = 'Enter the complete 8-character room code shared by the host.';
      roomCodeInput.focus();
      return;
    }
    if (!await preparePeerAction()) return;
    if (roomRole !== 'solo') return;
    localUsername = username;
    roomRole = 'guest';
    roomCode = code;
    roomCodeElement.textContent = code;
    roomPlayers.textContent = `Joining ${code}…`;
    roomStatus.textContent = `Connecting to room ${code}…`;
    setRoomBusy(true);
    updateStartControls();
    try {
      activePeer = createPeer('');
      joinTimeoutId = window.setTimeout(() => {
        if (roomRole === 'guest' && (!activePeer || !activePeer.open || !roomConnection || !roomConnection.open)) {
          failRoom('Could not join that room. Check the code and confirm the host is still waiting.');
        }
      }, 15000);
      activePeer.on('open', () => {
        const connection = activePeer.connect(roomCode, {
          reliable: true,
          metadata: { username: localUsername }
        });
        bindRoomConnection(connection);
      });
      activePeer.on('error', handlePeerError);
      activePeer.on('disconnected', () => {
        if (roomRole !== 'solo') roomStatus.textContent = 'Connection to the co-op service was interrupted. Try again.';
      });
    } catch (error) {
      console.error('Could not join the co-op room.', error);
      failRoom('Could not connect to that room. Check your internet connection and try again.');
    }
  }

  async function copyRoomCode() {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      roomStatus.textContent = 'Room code copied. Send it to one friend to join.';
    } catch (error) {
      console.error('Could not copy the room code.', error);
      roomStatus.textContent = `Copy was blocked by the browser. Share this room code manually: ${roomCode}`;
    }
  }

  function frame(timestamp) {
    const delta = lastFrame === 0 ? 0 : Math.min((timestamp - lastFrame) / 1000, 0.032);
    lastFrame = timestamp;
    detectSound(delta);
    if (state === 'playing' && roomRole !== 'guest') update(delta);
    if (roomRole === 'host' && roomConnection && roomConnection.open && timestamp - lastSnapshotAt >= NETWORK_SNAPSHOT_MS) {
      lastSnapshotAt = timestamp;
      sendGameSnapshot();
    }
    draw();
    animationFrameId = window.requestAnimationFrame(frame);
  }

  canvas.addEventListener('keydown', (event) => {
    if (event.repeat || ![' ', 'ArrowUp', 'w', 'W'].includes(event.key)) return;
    event.preventDefault();
    flap();
  });
  startButton.addEventListener('click', () => startGame(false));
  hostButton.addEventListener('click', hostRoom);
  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    joinRoom();
  });
  copyRoomButton.addEventListener('click', copyRoomCode);
  coopStartButton.addEventListener('click', () => startGame(false));
  leaveRoomButton.addEventListener('click', () => {
    disconnectRoom('You left the room. You can play solo or host or join another room.');
  });
  voiceButton.addEventListener('click', () => {
    if (audioStream) {
      releaseMicrophone(true);
      return;
    }
    enableMicrophone();
  });
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lastFrame = 0;
  });
  window.addEventListener('pagehide', () => {
    pageIsLeaving = true;
    if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    clearConnectionTimeout();
    if (roomConnection) roomConnection.close();
    if (activePeer && !activePeer.destroyed) activePeer.destroy();
    releaseMicrophone(false);
  });

  resetWorld();
  resizeCanvas();
  animationFrameId = window.requestAnimationFrame(frame);
})();
