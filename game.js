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

  const canvas = document.getElementById('game-canvas');
  const context = canvas.getContext('2d');
  const overlay = document.getElementById('game-overlay');
  const overlayTitle = document.getElementById('game-overlay-title');
  const overlayCopy = document.getElementById('game-overlay-copy');
  const startButton = document.getElementById('game-start');
  const flapButton = document.getElementById('game-flap');
  const status = document.getElementById('game-status');
  const gemScore = document.getElementById('gem-score');
  const courseScore = document.getElementById('course-score');

  if (!context) {
    status.textContent = 'This browser could not start the game canvas. Try a browser with canvas support.';
    startButton.disabled = true;
    flapButton.disabled = true;
    return;
  }

  let state = 'ready';
  let lastFrame = 0;
  let elapsed = 0;
  let worldOffset = 0;
  let score = 0;
  let gems = 0;
  let gates = [];
  let platforms = [];
  let player = { y: 228, velocity: 0, rotation: 0 };

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
    player = { y: 228, velocity: 0, rotation: 0 };
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

  function drawPlayer() {
    const x = PLAYER_X + PLAYER_WIDTH / 2;
    const y = player.y + PLAYER_HEIGHT / 2;
    context.save();
    context.translate(x, y);
    context.rotate(player.rotation);
    context.fillStyle = '#3e5960';
    context.beginPath();
    context.moveTo(-9, 0);
    context.lineTo(-27, Math.sin(elapsed * 17) * 5 - 2);
    context.lineTo(-13, 11);
    context.closePath();
    context.fill();
    context.fillStyle = '#e89252';
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
    drawPlayer();
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
    startButton.textContent = 'Fly again';
    overlay.hidden = false;
    status.textContent = `Flight over. You cleared ${score} gates and collected ${gems} gems.`;
    startButton.focus();
  }

  function startGame() {
    resetWorld();
    state = 'playing';
    overlay.hidden = true;
    startButton.textContent = 'Start flight';
    status.textContent = 'You are flying. Flap through each opening and watch for the moving course.';
    canvas.focus();
    lastFrame = 0;
  }

  function flap() {
    if (state !== 'playing') return;
    player.velocity = FLAP_VELOCITY;
  }

  function intersectsPlayer(x, y, width, height) {
    return PLAYER_X < x + width
      && PLAYER_X + PLAYER_WIDTH > x
      && player.y < y + height
      && player.y + PLAYER_HEIGHT > y;
  }

  function update(delta) {
    elapsed += delta;
    const speed = Math.min(350, 235 + Math.floor(score / 4) * 9);
    worldOffset += speed * delta;
    player.velocity += GRAVITY * delta;
    player.y += player.velocity * delta;
    player.rotation = Math.max(-0.45, Math.min(0.7, player.velocity / 620));

    for (const gate of gates) {
      gate.x -= speed * delta;
      const gapTop = gate.center - gate.gap / 2;
      const gapBottom = gate.center + gate.gap / 2;
      if (
        (intersectsPlayer(gate.x, 0, GATE_WIDTH, gapTop)
          || intersectsPlayer(gate.x, gapBottom, GATE_WIDTH, GROUND_Y - gapBottom))
      ) {
        finishGame();
        return;
      }

      if (!gate.gemCollected) {
        const gemX = gate.x + GATE_WIDTH / 2;
        const gemY = gate.center + Math.sin(elapsed * 3 + gate.x) * 4;
        const playerCenterX = PLAYER_X + PLAYER_WIDTH / 2;
        const playerCenterY = player.y + PLAYER_HEIGHT / 2;
        if (Math.hypot(gemX - playerCenterX, gemY - playerCenterY) < 27) {
          gate.gemCollected = true;
          gems += 1;
          updateScore();
          status.textContent = `${gems} sun gem${gems === 1 ? '' : 's'} collected. Keep flying!`;
        }
      }

      if (!gate.scored && gate.x + GATE_WIDTH < PLAYER_X) {
        gate.scored = true;
        score += 1;
        updateScore();
        status.textContent = `Gate ${score} cleared. The course is getting quicker.`;
      }
    }

    for (const platform of platforms) {
      platform.x -= speed * delta;
      if (intersectsPlayer(platform.x, platform.y, platform.width, platform.height)) {
        finishGame();
        return;
      }
    }

    if (player.y < 0 || player.y + PLAYER_HEIGHT > GROUND_Y) {
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

  function frame(timestamp) {
    const delta = lastFrame === 0 ? 0 : Math.min((timestamp - lastFrame) / 1000, 0.032);
    lastFrame = timestamp;
    if (state === 'playing') update(delta);
    draw();
    window.requestAnimationFrame(frame);
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    canvas.focus();
    flap();
  });
  canvas.addEventListener('keydown', (event) => {
    if (event.repeat || ![' ', 'ArrowUp', 'w', 'W'].includes(event.key)) return;
    event.preventDefault();
    flap();
  });
  startButton.addEventListener('click', startGame);
  flapButton.addEventListener('click', flap);
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lastFrame = 0;
  });

  resetWorld();
  resizeCanvas();
  window.requestAnimationFrame(frame);
})();
