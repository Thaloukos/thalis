/**
 * ttt — Tic-Tac-Toe
 * Player (X) vs Computer (O). Coin flip decides who goes first.
 */

// ========== CONFIG ==========
var CFG = {
    COLORS: {
        grid: "#888888",
        playerX: "#55ff55",
        computerO: "#ff5555",
        hint: "#444444",
        coin: "#ffcc44",
        win: "#55ff55",
        lose: "#ff5555",
        draw: "#ffcc44",
        hud: "#888888",
        text: "#d0d0d0"
    },
    COIN_SPIN_MS: 1500,
    COIN_RESULT_MS: 800,
    COMPUTER_DELAY_MS: 500,
    GAME_OVER_MS: 2000,
    COIN_FRAME_MS: 100,
    // Board dimensions in characters
    BOARD_W: 23,
    BOARD_H: 11,
    CELL_W: 7,
    CELL_H: 3
};

// ========== BUFFER ==========
var preEl = null;
var containerEl = null;
var buf = null;

function createBuffer(w, h) {
    var chars = [];
    var colors = [];
    for (var i = 0; i < h; i++) {
        chars[i] = [];
        colors[i] = [];
        for (var j = 0; j < w; j++) {
            chars[i][j] = " ";
            colors[i][j] = null;
        }
    }
    return { w: w, h: h, chars: chars, colors: colors };
}

function clearBuffer(b) {
    for (var y = 0; y < b.h; y++) {
        for (var x = 0; x < b.w; x++) {
            b.chars[y][x] = " ";
            b.colors[y][x] = null;
        }
    }
}

function setCell(b, x, y, ch, color) {
    if (x >= 0 && x < b.w && y >= 0 && y < b.h) {
        b.chars[y][x] = ch;
        b.colors[y][x] = color || null;
    }
}

function drawString(b, x, y, str, color) {
    for (var i = 0; i < str.length; i++) {
        setCell(b, x + i, y, str[i], color);
    }
}

function renderBufferToDOM(b) {
    if (!preEl) return;
    var parts = [];
    var lastColor = null;
    for (var y = 0; y < b.h; y++) {
        for (var x = 0; x < b.w; x++) {
            var c = b.colors[y][x];
            var ch = b.chars[y][x];
            if (c !== lastColor) {
                if (lastColor !== null) parts.push("</span>");
                if (c !== null) {
                    parts.push('<span style="color:' + c + '">');
                }
                lastColor = c;
            }
            if (ch === "<") ch = "&lt;";
            else if (ch === ">") ch = "&gt;";
            else if (ch === "&") ch = "&amp;";
            parts.push(ch);
        }
        if (lastColor !== null) {
            parts.push("</span>");
            lastColor = null;
        }
        if (y < b.h - 1) parts.push("\n");
    }
    if (lastColor !== null) parts.push("</span>");
    preEl.innerHTML = parts.join("");
}

function calcBufferSize() {
    if (!containerEl) return { w: 80, h: 24 };
    var style = window.getComputedStyle(containerEl);
    var fontSize = parseFloat(style.fontSize) || 16;
    var charW = fontSize * 0.6;
    var charH = fontSize * 1.0;
    var w = Math.floor(containerEl.clientWidth / charW);
    var h = Math.floor(containerEl.clientHeight / charH);
    return { w: Math.max(40, w), h: Math.max(12, h) };
}

// ========== BOARD ==========
var board = ["", "", "", "", "", "", "", "", ""];

// Numpad mapping: key digit -> board index
// 7->0, 8->1, 9->2, 4->3, 5->4, 6->5, 1->6, 2->7, 3->8
var numpadMap = { 7: 0, 8: 1, 9: 2, 4: 3, 5: 4, 6: 5, 1: 6, 2: 7, 3: 8 };

// Hint numbers displayed in empty cells (numpad layout)
var hintNumbers = [7, 8, 9, 4, 5, 6, 1, 2, 3];

var winLines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6]              // diagonals
];

function checkWin(mark) {
    for (var i = 0; i < winLines.length; i++) {
        var l = winLines[i];
        if (board[l[0]] === mark && board[l[1]] === mark && board[l[2]] === mark) {
            return l;
        }
    }
    return null;
}

function isBoardFull() {
    for (var i = 0; i < 9; i++) {
        if (board[i] === "") return false;
    }
    return true;
}

// Board origin in the buffer (top-left corner of the 23x11 board)
var boardOriginX = 0;
var boardOriginY = 0;

function calcBoardOrigin() {
    boardOriginX = Math.floor((buf.w - CFG.BOARD_W) / 2);
    boardOriginY = Math.floor((buf.h - CFG.BOARD_H) / 2) - 1;
    if (boardOriginY < 2) boardOriginY = 2;
}

function drawBoard() {
    var ox = boardOriginX;
    var oy = boardOriginY;

    // Draw grid lines
    for (var row = 0; row < 3; row++) {
        for (var col = 0; col < 3; col++) {
            var cellX = ox + col * 8;
            var cellY = oy + row * 4;
            var idx = row * 3 + col;
            var mark = board[idx];
            var isWinCell = winningLine && winningLine.indexOf(idx) >= 0;

            if (mark === "X") {
                var color = isWinCell ? CFG.COLORS.win : CFG.COLORS.playerX;
                drawString(buf, cellX + 3, cellY + 1, "X", color);
            } else if (mark === "O") {
                var color = isWinCell ? CFG.COLORS.lose : CFG.COLORS.computerO;
                drawString(buf, cellX + 3, cellY + 1, "O", color);
            } else {
                // Hint number
                drawString(buf, cellX + 3, cellY + 1, String(hintNumbers[idx]), CFG.COLORS.hint);
            }
        }
    }

    // Horizontal dividers
    for (var r = 0; r < 2; r++) {
        var y = oy + 3 + r * 4;
        for (var x = 0; x < CFG.BOARD_W; x++) {
            var ch = "-";
            if (x === 7 || x === 15) ch = "+";
            setCell(buf, ox + x, y, ch, CFG.COLORS.grid);
        }
    }

    // Vertical dividers
    for (var c = 0; c < 2; c++) {
        var x = ox + 7 + c * 8;
        for (var row = 0; row < CFG.BOARD_H; row++) {
            if (row === 3 || row === 7) continue; // skip intersections (already drawn)
            setCell(buf, x, oy + row, "|", CFG.COLORS.grid);
        }
    }
}

// ========== COIN FLIP ==========
// Coin animation frames: wide face → narrowing → edge → widening → wide face (other side)
var coinFrames = [
    // Wide HEADS
    [
        "     ___     ",
        "   /     \\   ",
        "  /       \\  ",
        " |  HEADS  | ",
        "  \\       /  ",
        "   \\_____/   "
    ],
    // Medium HEADS
    [
        "      _      ",
        "    /   \\    ",
        "   /     \\   ",
        "  | HEADS |  ",
        "   \\     /   ",
        "    \\___/    "
    ],
    // Narrow HEADS
    [
        "      _      ",
        "     / \\     ",
        "    /   \\    ",
        "   | H D |   ",
        "    \\   /    ",
        "     \\_/     "
    ],
    // Edge
    [
        "      ||      ",
        "      ||      ",
        "      ||      ",
        "      ||      ",
        "      ||      ",
        "      ||      "
    ],
    // Narrow TAILS
    [
        "      _      ",
        "     / \\     ",
        "    /   \\    ",
        "   | T S |   ",
        "    \\   /    ",
        "     \\_/     "
    ],
    // Medium TAILS
    [
        "      _      ",
        "    /   \\    ",
        "   /     \\   ",
        "  | TAILS |  ",
        "   \\     /   ",
        "    \\___/    "
    ],
    // Wide TAILS
    [
        "     ___     ",
        "   /     \\   ",
        "  /       \\  ",
        " |  TAILS  | ",
        "  \\       /  ",
        "   \\_____/   "
    ],
    // Medium TAILS (narrowing back)
    [
        "      _      ",
        "    /   \\    ",
        "   /     \\   ",
        "  | TAILS |  ",
        "   \\     /   ",
        "    \\___/    "
    ],
    // Narrow TAILS (back)
    [
        "      _      ",
        "     / \\     ",
        "    /   \\    ",
        "   | T S |   ",
        "    \\   /    ",
        "     \\_/     "
    ],
    // Edge (back)
    [
        "      ||      ",
        "      ||      ",
        "      ||      ",
        "      ||      ",
        "      ||      ",
        "      ||      "
    ],
    // Narrow HEADS (back)
    [
        "      _      ",
        "     / \\     ",
        "    /   \\    ",
        "   | H D |   ",
        "    \\   /    ",
        "     \\_/     "
    ],
    // Medium HEADS (widening back)
    [
        "      _      ",
        "    /   \\    ",
        "   /     \\   ",
        "  | HEADS |  ",
        "   \\     /   ",
        "    \\___/    "
    ]
];

var coinResultFrames = {
    heads: [
        "     ___     ",
        "   /     \\   ",
        "  /       \\  ",
        " |  HEADS  | ",
        "  \\       /  ",
        "   \\_____/   "
    ],
    tails: [
        "     ___     ",
        "   /     \\   ",
        "  /       \\  ",
        " |  TAILS  | ",
        "  \\       /  ",
        "   \\_____/   "
    ]
};

var coinTimer = 0;
var coinFrameIdx = 0;
var coinResult = "";       // "heads" or "tails"
var coinPhase = "";        // "spinning" or "result"
var coinResultTimer = 0;

function startCoinFlip() {
    coinTimer = 0;
    coinFrameIdx = 0;
    coinResult = Math.random() < 0.5 ? "heads" : "tails";
    coinPhase = "spinning";
    coinResultTimer = 0;
}

function updateCoinFlip(dt) {
    if (coinPhase === "spinning") {
        coinTimer += dt * 1000;
        if (coinTimer >= CFG.COIN_SPIN_MS) {
            coinPhase = "result";
            coinResultTimer = 0;
        } else {
            // Advance frame
            coinFrameIdx = Math.floor(coinTimer / CFG.COIN_FRAME_MS) % coinFrames.length;
        }
    } else if (coinPhase === "result") {
        coinResultTimer += dt * 1000;
        if (coinResultTimer >= CFG.COIN_RESULT_MS) {
            // Transition to playing
            if (coinResult === "heads") {
                currentTurn = "X"; // player goes first
            } else {
                currentTurn = "O"; // computer goes first
                computerMoveTimer = CFG.COMPUTER_DELAY_MS;
            }
            gameState = "PLAYING";
        }
    }
}

function drawCoinFlip() {
    var lines;
    if (coinPhase === "spinning") {
        lines = coinFrames[coinFrameIdx];
    } else if (coinPhase === "result") {
        lines = coinResultFrames[coinResult];
    }
    if (!lines) return;

    var cx = Math.floor(buf.w / 2);
    var cy = Math.floor(buf.h / 2) - 3;

    for (var i = 0; i < lines.length; i++) {
        var sx = cx - Math.floor(lines[i].length / 2);
        drawString(buf, sx, cy + i, lines[i], CFG.COLORS.coin);
    }

    // Result text
    if (coinPhase === "result") {
        var msg = coinResult === "heads" ? "You go first!" : "Computer goes first...";
        var color = coinResult === "heads" ? CFG.COLORS.playerX : CFG.COLORS.computerO;
        drawString(buf, cx - Math.floor(msg.length / 2), cy + lines.length + 1, msg, color);
    }

    // Title
    var title = "COIN FLIP";
    drawString(buf, cx - Math.floor(title.length / 2), cy - 2, title, CFG.COLORS.text);
}

// ========== SCOREBOARD ==========
// Persists across start/stop cycles within the same page load
var scores = { player: 0, computer: 0, draws: 0 };

function drawScoreboard() {
    var line = "X: " + scores.player + "  O: " + scores.computer + "  Draw: " + scores.draws;
    var cx = Math.floor(buf.w / 2);
    var y = 0;
    drawString(buf, cx - Math.floor(line.length / 2), y, line, CFG.COLORS.text);

    // Color the individual parts
    var sx = cx - Math.floor(line.length / 2);
    drawString(buf, sx, y, "X:", CFG.COLORS.playerX);
    var oStart = sx + line.indexOf("O:");
    drawString(buf, oStart, y, "O:", CFG.COLORS.computerO);
    var dStart = sx + line.indexOf("Draw:");
    drawString(buf, dStart, y, "Draw:", CFG.COLORS.draw);
}

// ============================================================
// COMPUTER AI — Replace this function with your own logic!
// Receives the board array ("" = empty, "X" = player, "O" = computer).
// Must return the index (0-8) of an empty cell to play.
// ============================================================
function checkWinOn(b, mark) {
    for (var i = 0; i < winLines.length; i++) {
        var l = winLines[i];
        if (b[l[0]] === mark && b[l[1]] === mark && b[l[2]] === mark) return l;
    }
    return null;
}

function computerChooseMove(currentBoard) {
    var empty = [];
    var corners = [0, 2, 6, 8];
    for (var i = 0; i < 9; i++) {
        if (currentBoard[i] === "") empty.push(i);
    }

    // Check for an immediate winning move
    for (var i = 0; i < empty.length; i++) {
        currentBoard[empty[i]] = "O";
        if (checkWinOn(currentBoard, "O")) {
            currentBoard[empty[i]] = "";
            return empty[i];
        }
        currentBoard[empty[i]] = "";
    }

    // Block player's immediate winning move
    for (var i = 0; i < empty.length; i++) {
        currentBoard[empty[i]] = "X";
        if (checkWinOn(currentBoard, "X")) {
            currentBoard[empty[i]] = "";
            return empty[i];
        }
        currentBoard[empty[i]] = "";
    }

    // Opening: computer goes first (board is empty)
    if (empty.length === 9) {
        return corners[Math.floor(Math.random() * corners.length)];
    }

    // Response: computer goes second (one X on the board)
    if (empty.length === 8) {
        if (currentBoard[4] === "X") {
            // X took center → play a random corner
            return corners[Math.floor(Math.random() * corners.length)];
        } else {
            // X took edge or corner → play center
            return 4;
        }
    }

    // Third move: computer went first (empty.length === 7)
    if (empty.length === 7) {
        var oppositeCorner = {0: 8, 2: 6, 6: 2, 8: 0};
        var adjacentEdges = {0: [1, 3], 2: [1, 5], 6: [3, 7], 8: [5, 7]};
        var edgeAdjacentCorners = {1: [0, 2], 3: [0, 6], 5: [2, 8], 7: [6, 8]};

        // Find computer's first corner and X's response
        var myCorner = -1;
        var theirMove = -1;
        for (var i = 0; i < 9; i++) {
            if (currentBoard[i] === "O") myCorner = i;
            if (currentBoard[i] === "X") theirMove = i;
        }

        if (theirMove === 4) {
            // X played center → opposite corner
            return oppositeCorner[myCorner];
        } else if (corners.indexOf(theirMove) >= 0) {
            // X played any corner → random remaining corner
            var remaining = [];
            for (var i = 0; i < corners.length; i++) {
                if (corners[i] !== myCorner && corners[i] !== theirMove) remaining.push(corners[i]);
            }
            return remaining[Math.floor(Math.random() * remaining.length)];
        } else if (adjacentEdges[myCorner].indexOf(theirMove) >= 0) {
            // X played adjacent edge → center
            return 4;
        } else if ([1, 3, 5, 7].indexOf(theirMove) >= 0) {
            // X played non-adjacent edge → 50/50 center or adjacent corner (not opposite of first)
            if (Math.random() < 0.5) {
                return 4;
            }
            var candidates = edgeAdjacentCorners[theirMove];
            var opp = oppositeCorner[myCorner];
            for (var i = 0; i < candidates.length; i++) {
                if (candidates[i] !== opp) return candidates[i];
            }
        }
    }

    // Fourth move: computer went second (empty.length === 6)
    if (empty.length === 6) {
        var adjacentEdges = {0: [1, 3], 2: [1, 5], 6: [3, 7], 8: [5, 7]};
        var oppositeCorner = {0: 8, 2: 6, 6: 2, 8: 0};

        var emptyCorners = [];
        for (var i = 0; i < corners.length; i++) {
            if (currentBoard[corners[i]] === "") emptyCorners.push(corners[i]);
        }

        // All four corners available → play one with exactly one adjacent filled edge
        if (emptyCorners.length === 4) {
            var candidates = [];
            for (var i = 0; i < corners.length; i++) {
                var adj = adjacentEdges[corners[i]];
                var filled = (currentBoard[adj[0]] !== "" ? 1 : 0) + (currentBoard[adj[1]] !== "" ? 1 : 0);
                if (filled === 1) candidates.push(corners[i]);
            }
            if (candidates.length > 0) {
                return candidates[Math.floor(Math.random() * candidates.length)];
            }
        }

        // Exactly three corners available → play opposite of the occupied one
        if (emptyCorners.length === 3) {
            for (var i = 0; i < corners.length; i++) {
                if (currentBoard[corners[i]] !== "" && currentBoard[corners[i]] !== "O") {
                    return oppositeCorner[corners[i]];
                }
            }
        }

        // Exactly two corners available
        if (emptyCorners.length === 2) {
            // Both occupied corners are player's → play a random edge
            var occupiedByX = 0;
            for (var i = 0; i < corners.length; i++) {
                if (currentBoard[corners[i]] === "X") occupiedByX++;
            }
            if (occupiedByX === 2) {
                var emptyEdges = [];
                for (var i = 0; i < [1, 3, 5, 7].length; i++) {
                    if (currentBoard[[1, 3, 5, 7][i]] === "") emptyEdges.push([1, 3, 5, 7][i]);
                }
                return emptyEdges[Math.floor(Math.random() * emptyEdges.length)];
            }
            return emptyCorners[Math.floor(Math.random() * emptyCorners.length)];
        }
    }

    // Sixth move: computer went second (empty.length === 4)
    if (empty.length === 4) {
        var adjacentEdges = {0: [1, 3], 2: [1, 5], 6: [3, 7], 8: [5, 7]};

        // Corner without an adjacent player piece
        var safeCorners = [];
        for (var i = 0; i < corners.length; i++) {
            if (currentBoard[corners[i]] !== "") continue;
            var adj = adjacentEdges[corners[i]];
            if (currentBoard[adj[0]] !== "X" && currentBoard[adj[1]] !== "X") {
                safeCorners.push(corners[i]);
            }
        }
        if (safeCorners.length > 0) {
            return safeCorners[Math.floor(Math.random() * safeCorners.length)];
        }

        // No safe corners: if computer has center, play a random corner
        if (currentBoard[4] === "O") {
            var emptyCorners = [];
            for (var i = 0; i < corners.length; i++) {
                if (currentBoard[corners[i]] === "") emptyCorners.push(corners[i]);
            }
            if (emptyCorners.length > 0) {
                return emptyCorners[Math.floor(Math.random() * emptyCorners.length)];
            }
        }

        // Otherwise random available edge
        var emptyEdges = [];
        var edges = [1, 3, 5, 7];
        for (var i = 0; i < edges.length; i++) {
            if (currentBoard[edges[i]] === "") emptyEdges.push(edges[i]);
        }
        if (emptyEdges.length > 0) {
            return emptyEdges[Math.floor(Math.random() * emptyEdges.length)];
        }
    }

    // Fifth move: computer went first (empty.length === 5)
    if (empty.length === 5) {
        var adjacentEdges = {0: [1, 3], 2: [1, 5], 6: [3, 7], 8: [5, 7]};

        // Find empty corners
        var emptyCorners = [];
        for (var i = 0; i < corners.length; i++) {
            if (currentBoard[corners[i]] === "") emptyCorners.push(corners[i]);
        }

        // Only one empty corner → play it
        if (emptyCorners.length === 1) {
            return emptyCorners[0];
        }

        // Center not available → play corner with two empty adjacent edges
        if (currentBoard[4] !== "") {
            for (var i = 0; i < emptyCorners.length; i++) {
                var adj = adjacentEdges[emptyCorners[i]];
                if (currentBoard[adj[0]] === "" && currentBoard[adj[1]] === "") {
                    return emptyCorners[i];
                }
            }
        }

        // 50/50: center or corner with both adjacent edges empty
        var cornerNoAdj = -1;
        for (var i = 0; i < emptyCorners.length; i++) {
            var adj = adjacentEdges[emptyCorners[i]];
            if (currentBoard[adj[0]] === "" && currentBoard[adj[1]] === "") {
                cornerNoAdj = emptyCorners[i];
                break;
            }
        }
        if (cornerNoAdj >= 0 && currentBoard[4] === "") {
            return Math.random() < 0.5 ? 4 : cornerNoAdj;
        } else if (cornerNoAdj >= 0) {
            return cornerNoAdj;
        } else if (currentBoard[4] === "") {
            return 4;
        }
    }

    // Fallback: random empty cell
    return empty[Math.floor(Math.random() * empty.length)];
}

// ========== GAME LOGIC ==========
var gameState = "COIN_FLIP"; // "COIN_FLIP", "PLAYING", "GAME_OVER"
var currentTurn = "X";       // "X" or "O"
var winningLine = null;
var gameOverTimer = 0;
var gameOverResult = "";     // "win", "lose", "draw"
var computerMoveTimer = 0;
var lastLoser = "";          // "X", "O", or "" (draw)

function resetBoard() {
    for (var i = 0; i < 9; i++) board[i] = "";
    winningLine = null;
    gameOverResult = "";
}

function placeMove(idx, mark) {
    if (idx < 0 || idx > 8 || board[idx] !== "") return false;
    board[idx] = mark;

    var wl = checkWin(mark);
    if (wl) {
        winningLine = wl;
        if (mark === "X") {
            gameOverResult = "win";
            scores.player++;
            lastLoser = "O";
        } else {
            gameOverResult = "lose";
            scores.computer++;
            lastLoser = "X";
        }
        gameState = "GAME_OVER";
        gameOverTimer = 0;
        return true;
    }

    if (isBoardFull()) {
        gameOverResult = "draw";
        scores.draws++;
        lastLoser = "";
        gameState = "GAME_OVER";
        gameOverTimer = 0;
        return true;
    }

    // Switch turns
    currentTurn = mark === "X" ? "O" : "X";
    if (currentTurn === "O") {
        computerMoveTimer = CFG.COMPUTER_DELAY_MS;
    }
    return true;
}

function updatePlaying(dt) {
    if (currentTurn === "O") {
        computerMoveTimer -= dt * 1000;
        if (computerMoveTimer <= 0) {
            var move = computerChooseMove(board.slice());
            if (move !== undefined) {
                placeMove(move, "O");
            }
        }
    }
}

function updateGameOver(dt) {
    gameOverTimer += dt * 1000;
    if (gameOverTimer >= CFG.GAME_OVER_MS) {
        resetBoard();
        if (lastLoser === "") {
            // Draw → coin flip
            gameState = "COIN_FLIP";
            startCoinFlip();
        } else {
            // Loser goes first
            currentTurn = lastLoser;
            gameState = "PLAYING";
            if (currentTurn === "O") {
                computerMoveTimer = CFG.COMPUTER_DELAY_MS;
            }
        }
    }
}

function drawGameOverMessage() {
    var msg, color;
    if (gameOverResult === "win") {
        msg = "You win!";
        color = CFG.COLORS.win;
    } else if (gameOverResult === "lose") {
        msg = "Computer wins!";
        color = CFG.COLORS.lose;
    } else {
        msg = "It's a draw!";
        color = CFG.COLORS.draw;
    }
    var cx = Math.floor(buf.w / 2);
    var y = boardOriginY + CFG.BOARD_H + 1;
    drawString(buf, cx - Math.floor(msg.length / 2), y, msg, color);
}

// ========== INPUT ==========
function onKeyDown(e) {
    var code = e.code;

    if (code === "Escape") {
        e.preventDefault();
        exitGame();
        return;
    }

    if (gameState !== "PLAYING" || currentTurn !== "X") return;

    // Digit1-9 or Numpad1-9
    var digit = -1;
    if (code.indexOf("Digit") === 0) {
        digit = parseInt(code.charAt(5), 10);
    } else if (code.indexOf("Numpad") === 0) {
        digit = parseInt(code.charAt(6), 10);
    }

    if (digit >= 1 && digit <= 9) {
        e.preventDefault();
        var idx = numpadMap[digit];
        if (idx !== undefined && board[idx] === "") {
            placeMove(idx, "X");
        }
    }
}

function onClick(e) {
    if (gameState !== "PLAYING" || currentTurn !== "X") return;
    if (!preEl || !buf) return;

    // Calculate character size
    var rect = preEl.getBoundingClientRect();
    var charW = rect.width / buf.w;
    var charH = rect.height / buf.h;

    // Map pixel to buffer coordinates
    var bx = Math.floor((e.clientX - rect.left) / charW);
    var by = Math.floor((e.clientY - rect.top) / charH);

    // Map buffer coords to board cell
    var relX = bx - boardOriginX;
    var relY = by - boardOriginY;

    if (relX < 0 || relX >= CFG.BOARD_W || relY < 0 || relY >= CFG.BOARD_H) return;

    // Determine column (each cell is 7 wide + 1 divider)
    var col, row;

    if (relX < 7) col = 0;
    else if (relX === 7) return; // grid line
    else if (relX < 15) col = 1;
    else if (relX === 15) return; // grid line
    else if (relX < 23) col = 2;
    else return;

    if (relY < 3) row = 0;
    else if (relY === 3) return; // grid line
    else if (relY < 7) row = 1;
    else if (relY === 7) return; // grid line
    else if (relY < 11) row = 2;
    else return;

    var idx = row * 3 + col;
    if (board[idx] === "") {
        placeMove(idx, "X");
    }
}

// ========== GAME LOOP ==========
var running = false;
var lastTime = 0;
var rafId = null;

function tick(timestamp) {
    if (!running) return;
    rafId = requestAnimationFrame(tick);

    var dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.1) dt = 0.1;

    // Update
    if (gameState === "COIN_FLIP") {
        updateCoinFlip(dt);
    } else if (gameState === "PLAYING") {
        updatePlaying(dt);
    } else if (gameState === "GAME_OVER") {
        updateGameOver(dt);
    }

    // Draw
    clearBuffer(buf);
    drawScoreboard();

    if (gameState === "COIN_FLIP") {
        drawCoinFlip();
    } else {
        calcBoardOrigin();
        drawBoard();
        if (gameState === "GAME_OVER") {
            drawGameOverMessage();
        }
    }

    // HUD
    var hint = "1-9:place  Click:place  ESC:exit";
    if (gameState === "PLAYING") {
        if (currentTurn === "X") {
            hint = "Your turn! 1-9:place  Click:place  ESC:exit";
        } else {
            hint = "Computer thinking...  ESC:exit";
        }
    } else if (gameState === "COIN_FLIP") {
        hint = "ESC:exit";
    } else if (gameState === "GAME_OVER") {
        hint = "ESC:exit";
    }
    var cx = Math.floor(buf.w / 2);
    drawString(buf, cx - Math.floor(hint.length / 2), buf.h - 1, hint, CFG.COLORS.hud);

    renderBufferToDOM(buf);
}

// ========== LIFECYCLE ==========
var exitCallback = null;

function exitGame() {
    stop();
    if (exitCallback) exitCallback();
}

export function start(container, onExit) {
    containerEl = container;
    exitCallback = onExit || null;

    preEl = document.createElement("pre");
    preEl.style.cssText = "margin:0;padding:0;font-family:monospace;font-size:16px;line-height:1;background:#000;color:#d0d0d0;overflow:hidden;width:100%;height:100%;cursor:pointer;";
    containerEl.appendChild(preEl);

    var size = calcBufferSize();
    buf = createBuffer(size.w, size.h);

    // Reset game state but keep scores
    resetBoard();
    lastLoser = "";
    gameState = "COIN_FLIP";
    startCoinFlip();

    document.addEventListener("keydown", onKeyDown);
    preEl.addEventListener("click", onClick);

    running = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
}

export function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;

    document.removeEventListener("keydown", onKeyDown);
    if (preEl) preEl.removeEventListener("click", onClick);

    if (preEl && preEl.parentNode) {
        preEl.parentNode.removeChild(preEl);
    }
    preEl = null;
    containerEl = null;
}

export function handleResize() {
    if (!running || !containerEl) return;
    var size = calcBufferSize();
    buf = createBuffer(size.w, size.h);
}
