/**
 * fih — 3D ASCII Fish Tank Game
 * A playable 3D ASCII fish tank with third-person camera.
 */
(function () {
    "use strict";

    // ========== CONFIG ==========
    var CFG = {
        TANK_W: 24,   // world units
        TANK_H: 16,
        TANK_D: 24,
        FPS: 30,
        FOV: 120,
        CAM_DIST: 8,
        CAM_HEIGHT: 2,
        CAM_LERP: 0.08,
        MOUSE_SENS: 0.003,
        MOVE_SPEED: 6,
        VERT_SPEED: 5,
        NPC_COUNT: 4,
        BUBBLE_SPAWN_RATE: 0.15,
        MAX_BUBBLES: 30,
        SEAWEED_COUNT: 5,
        COLORS: {
            tank: "#446688",
            tankCorner: "#5588aa",
            player: "#55ff55",
            hud: "#888888",
            hudHighlight: "#aaaaaa",
            bubble: "#6699cc",
            seaweed: "#1a5c2a",
            chest: "#aa8844",
            npc: ["#ff8855", "#55ccff", "#ffcc44", "#ff55aa"],
            depthClose: "#99aacc",
            depthMid: "#556688",
            depthFar: "#334455",
            bg: "#000000"
        }
    };

    // ========== VEC3 ==========
    function v3(x, y, z) { return { x: x, y: y, z: z }; }
    function v3add(a, b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
    function v3sub(a, b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
    function v3scale(a, s) { return v3(a.x * s, a.y * s, a.z * s); }
    function v3len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
    function v3norm(a) {
        var l = v3len(a);
        return l > 0.0001 ? v3(a.x / l, a.y / l, a.z / l) : v3(0, 0, 0);
    }
    function v3lerp(a, b, t) {
        return v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    }
    function v3dist(a, b) { return v3len(v3sub(a, b)); }

    // ========== CAMERA ==========
    var camera = {
        pos: v3(0, 0, 0),
        yaw: 0,
        pitch: 0,
        targetPos: v3(0, 0, 0)
    };

    function cameraForward() {
        var cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
        var cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
        return v3(sy * cp, -sp, cy * cp);
    }

    function worldToCamera(p) {
        var dx = p.x - camera.pos.x;
        var dy = p.y - camera.pos.y;
        var dz = p.z - camera.pos.z;
        var cy = Math.cos(-camera.yaw), sy = Math.sin(-camera.yaw);
        var cp = Math.cos(-camera.pitch), sp = Math.sin(-camera.pitch);
        // Rotate by yaw
        var rx = dx * cy + dz * sy;
        var rz = -dx * sy + dz * cy;
        var ry = dy;
        // Rotate by pitch
        var ry2 = ry * cp - rz * sp;
        var rz2 = ry * sp + rz * cp;
        return v3(rx, ry2, rz2);
    }

    function projectToScreen(worldPos, buf) {
        var cam = worldToCamera(worldPos);
        if (cam.z < 0.5) return null;
        var sx = (cam.x / cam.z) * CFG.FOV + buf.w / 2;
        var sy = -(cam.y / cam.z) * CFG.FOV + buf.h / 2;
        return { x: Math.round(sx), y: Math.round(sy), z: cam.z };
    }

    function updateCamera(playerPos, dt) {
        var cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
        var cp = Math.cos(camera.pitch);
        var sp = Math.sin(camera.pitch);
        var offsetX = -sy * CFG.CAM_DIST * cp;
        var offsetZ = -cy * CFG.CAM_DIST * cp;
        var offsetY = CFG.CAM_DIST * sp;
        camera.targetPos = v3(
            playerPos.x + offsetX,
            playerPos.y + offsetY,
            playerPos.z + offsetZ
        );
        camera.pos = camera.targetPos;
    }

    // ========== BUFFER ==========
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

    function clearBuffer(buf) {
        for (var y = 0; y < buf.h; y++) {
            for (var x = 0; x < buf.w; x++) {
                buf.chars[y][x] = " ";
                buf.colors[y][x] = null;
            }
        }
    }

    function setCell(buf, x, y, ch, color) {
        if (x >= 0 && x < buf.w && y >= 0 && y < buf.h) {
            buf.chars[y][x] = ch;
            buf.colors[y][x] = color || null;
        }
    }

    function drawString(buf, x, y, str, color) {
        for (var i = 0; i < str.length; i++) {
            setCell(buf, x + i, y, str[i], color);
        }
    }

    // Bresenham line drawing
    function drawLine(buf, x0, y0, x1, y1, color, depthAvg) {
        x0 = Math.round(x0); y0 = Math.round(y0);
        x1 = Math.round(x1); y1 = Math.round(y1);
        var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        var err = dx - dy;
        var ch = getLineChar(dx, dy, sx, sy);
        var lineColor = depthColor(depthAvg, color);
        while (true) {
            setCell(buf, x0, y0, ch, lineColor);
            if (x0 === x1 && y0 === y1) break;
            var e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }

    function getLineChar(dx, dy) {
        if (dy === 0) return "\u2500";
        if (dx === 0) return "\u2502";
        var ratio = dx / (dy || 1);
        if (ratio > 2) return "\u2500";
        if (ratio < 0.5) return "\u2502";
        return "\u00b7";
    }

    function depthColor(z, baseColor) {
        if (!baseColor) baseColor = CFG.COLORS.tank;
        if (z < 10) return baseColor;
        // Slight blueshift: blend base color toward deep blue based on distance
        var t = Math.min(1, (z - 10) / 30); // 0 at z=10, 1 at z=40
        var r = parseInt(baseColor.slice(1, 3), 16);
        var g = parseInt(baseColor.slice(3, 5), 16);
        var b = parseInt(baseColor.slice(5, 7), 16);
        // Blend toward dark blue (0x33, 0x44, 0x66)
        r = Math.round(r + (0x33 - r) * t * 0.5);
        g = Math.round(g + (0x44 - g) * t * 0.5);
        b = Math.round(b + (0x66 - b) * t * 0.3);
        var hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        return hex;
    }

    // ========== DOM RENDERER ==========
    var preEl = null;
    var containerEl = null;

    function renderBufferToDOM(buf) {
        if (!preEl) return;
        var parts = [];
        var lastColor = null;
        for (var y = 0; y < buf.h; y++) {
            for (var x = 0; x < buf.w; x++) {
                var c = buf.colors[y][x];
                var ch = buf.chars[y][x];
                if (c !== lastColor) {
                    if (lastColor !== null) parts.push("</span>");
                    if (c !== null) {
                        parts.push('<span style="color:' + c + '">');
                    }
                    lastColor = c;
                }
                // Escape HTML chars
                if (ch === "<") ch = "&lt;";
                else if (ch === ">") ch = "&gt;";
                else if (ch === "&") ch = "&amp;";
                parts.push(ch);
            }
            if (lastColor !== null) {
                parts.push("</span>");
                lastColor = null;
            }
            if (y < buf.h - 1) parts.push("\n");
        }
        if (lastColor !== null) parts.push("</span>");
        preEl.innerHTML = parts.join("");
    }

    // ========== TANK ==========
    var tankCorners = [];
    var tankEdges = [
        // bottom face
        [0, 1], [1, 2], [2, 3], [3, 0],
        // top face
        [4, 5], [5, 6], [6, 7], [7, 4],
        // verticals
        [0, 4], [1, 5], [2, 6], [3, 7]
    ];

    function initTankCorners() {
        var hw = CFG.TANK_W / 2, hh = CFG.TANK_H / 2, hd = CFG.TANK_D / 2;
        tankCorners = [
            v3(-hw, -hh, -hd), v3(hw, -hh, -hd),
            v3(hw, -hh, hd), v3(-hw, -hh, hd),
            v3(-hw, hh, -hd), v3(hw, hh, -hd),
            v3(hw, hh, hd), v3(-hw, hh, hd)
        ];
    }

    function drawTank(buf) {
        for (var i = 0; i < tankEdges.length; i++) {
            var e = tankEdges[i];
            var p0 = projectToScreen(tankCorners[e[0]], buf);
            var p1 = projectToScreen(tankCorners[e[1]], buf);
            if (!p0 || !p1) continue;
            var avgZ = (p0.z + p1.z) / 2;
            drawLine(buf, p0.x, p0.y, p1.x, p1.y, CFG.COLORS.tank, avgZ);
        }
        // Draw corner markers
        for (var j = 0; j < tankCorners.length; j++) {
            var p = projectToScreen(tankCorners[j], buf);
            if (p) {
                setCell(buf, p.x, p.y, "+", depthColor(p.z, CFG.COLORS.tankCorner));
            }
        }
    }

    // ========== PLAYER ==========
    var player = {
        pos: v3(0, 0, 0),
        vel: v3(0, 0, 0),
        facingRight: true
    };

    function initPlayer() {
        player.pos = v3(0, 0, 0);
        player.vel = v3(0, 0, 0);
        player.facingRight = true;
    }

    function updatePlayer(dt) {
        var forward = v3(Math.sin(camera.yaw), 0, Math.cos(camera.yaw));
        var right = v3(Math.cos(camera.yaw), 0, -Math.sin(camera.yaw));
        var moveDir = v3(0, 0, 0);

        if (keys["w"] || keys["arrowup"]) moveDir = v3add(moveDir, forward);
        if (keys["s"] || keys["arrowdown"]) moveDir = v3sub(moveDir, forward);
        if (keys["a"]) moveDir = v3sub(moveDir, right);
        if (keys["d"]) moveDir = v3add(moveDir, right);

        if (v3len(moveDir) > 0.01) {
            moveDir = v3norm(moveDir);
            player.vel.x = moveDir.x * CFG.MOVE_SPEED;
            player.vel.z = moveDir.z * CFG.MOVE_SPEED;
            // Determine facing direction based on screen-space movement
            var screenRight = v3(Math.cos(camera.yaw), 0, -Math.sin(camera.yaw));
            var dot = moveDir.x * screenRight.x + moveDir.z * screenRight.z;
            if (Math.abs(dot) > 0.3) {
                player.facingRight = dot > 0;
            }
        } else {
            player.vel.x *= 0.85;
            player.vel.z *= 0.85;
        }

        if (keys[" "]) {
            player.vel.y = CFG.VERT_SPEED;
        } else if (keys["shift"]) {
            player.vel.y = -CFG.VERT_SPEED;
        } else {
            player.vel.y *= 0.85;
        }

        player.pos = v3add(player.pos, v3scale(player.vel, dt));

        // Clamp to tank
        var hw = CFG.TANK_W / 2 - 1;
        var hh = CFG.TANK_H / 2 - 1;
        var hd = CFG.TANK_D / 2 - 1;
        player.pos.x = Math.max(-hw, Math.min(hw, player.pos.x));
        player.pos.y = Math.max(-hh, Math.min(hh, player.pos.y));
        player.pos.z = Math.max(-hd, Math.min(hd, player.pos.z));
    }

    // Multi-line sprite helper
    function drawMultiLine(buf, cx, cy, lines, color) {
        for (var r = 0; r < lines.length; r++) {
            var line = lines[r];
            var sx = cx - Math.floor(line.length / 2);
            var sy = cy - Math.floor(lines.length / 2) + r;
            for (var c = 0; c < line.length; c++) {
                if (line[c] !== " ") {
                    setCell(buf, sx + c, sy, line[c], color);
                }
            }
        }
    }

    var playerSprites = {
        right: [
            "    ,/>>",
            "  ,/  >>",
            ">==/o >>",
            "  `\\  >>",
            "    `\\>>"
        ],
        left: [
            "<<\\,    ",
            "<<  \\,  ",
            "<< o\\==<",
            "<<  /`  ",
            "<</`    "
        ]
    };

    function drawPlayer(buf) {
        var p = projectToScreen(player.pos, buf);
        if (!p) return;
        var lines = player.facingRight ? playerSprites.right : playerSprites.left;
        drawMultiLine(buf, p.x, p.y, lines, CFG.COLORS.player);
    }

    // ========== NPC FISH ==========
    var npcFish = [];
    var npcSpecies = [
        { name: "clown",
          right: [" />", ">=>", " \\>"],
          left:  ["<\\ ", "<=<", "</  "],
          bigRight: ["    ,/>>", "  ,/  >>", ">==/o >>", "  `\\  >>", "    `\\>>"],
          bigLeft:  ["<<\\,    ", "<<  \\,  ", "<< o\\==<", "<<  /`  ", "<</`    "] },
        { name: "angel",
          right: [" /}", ">=}>", " \\}"],
          left:  ["{\\  ", "<{=<", "{/  "],
          bigRight: ["    /}}>", "  ,/ }}>", ">==>o}}>", "  `\\ }}>", "    \\}}>"],
          bigLeft:  ["<{{\\    ", "<{{ \\,  ", "<{{o<==>", "<{{ /`  ", "<{{/    "] },
        { name: "dart",
          right: ["-/>", "-->", "-\\>"],
          left:  ["<\\-", "<--", "</-"],
          bigRight: ["  --/>>", " --/ >>", "------>", " --\\ >>", "  --\\>>"],
          bigLeft:  ["<<\\--  ", "<< \\-- ", "<------", "<< /-- ", "<</--  "] },
        { name: "big",
          right: ["  ,/>>", ">==/>>", "  `\\>>"],
          left:  ["<<\\,  ", "<<\\==<", "<</`  "],
          bigRight: ["     ,/>>>", "  ,,/  >>>", ">===/ o>>>", "  ``\\  >>>", "     `\\>>>"],
          bigLeft:  ["<<<\\,     ", "<<<  \\,,  ", "<<<o \\===<", "<<<  /``  ", "<<</`     "] }
    ];

    function initNPCs() {
        npcFish = [];
        for (var i = 0; i < CFG.NPC_COUNT; i++) {
            var hw = CFG.TANK_W / 2 - 2;
            var hh = CFG.TANK_H / 2 - 2;
            var hd = CFG.TANK_D / 2 - 2;
            npcFish.push({
                pos: v3(
                    (Math.random() - 0.5) * hw * 2,
                    (Math.random() - 0.5) * hh * 2,
                    (Math.random() - 0.5) * hd * 2
                ),
                target: v3(0, 0, 0),
                speed: 1.5 + Math.random() * 2,
                species: i % npcSpecies.length,
                facingRight: Math.random() > 0.5,
                waitTimer: 0
            });
            pickNPCTarget(npcFish[i]);
        }
    }

    function pickNPCTarget(fish) {
        var hw = CFG.TANK_W / 2 - 2;
        var hh = CFG.TANK_H / 2 - 2;
        var hd = CFG.TANK_D / 2 - 2;
        fish.target = v3(
            (Math.random() - 0.5) * hw * 2,
            (Math.random() - 0.5) * hh * 2,
            (Math.random() - 0.5) * hd * 2
        );
    }

    function updateNPCs(dt) {
        for (var i = 0; i < npcFish.length; i++) {
            var fish = npcFish[i];
            if (fish.waitTimer > 0) {
                fish.waitTimer -= dt;
                continue;
            }
            var toTarget = v3sub(fish.target, fish.pos);
            var dist = v3len(toTarget);
            if (dist < 1.5) {
                pickNPCTarget(fish);
                fish.waitTimer = Math.random() * 1.5;
                continue;
            }
            var dir = v3norm(toTarget);
            fish.pos = v3add(fish.pos, v3scale(dir, fish.speed * dt));
            // Update facing
            var camSpace = worldToCamera(fish.pos);
            var targetCam = worldToCamera(fish.target);
            if (targetCam.x > camSpace.x + 0.5) fish.facingRight = true;
            else if (targetCam.x < camSpace.x - 0.5) fish.facingRight = false;
        }
    }

    function drawNPCs(buf) {
        // Sort by depth (far first)
        var sorted = npcFish.slice().sort(function (a, b) {
            return worldToCamera(b.pos).z - worldToCamera(a.pos).z;
        });
        for (var i = 0; i < sorted.length; i++) {
            var fish = sorted[i];
            var p = projectToScreen(fish.pos, buf);
            if (!p || p.z < 0.5) continue;
            var sp = npcSpecies[fish.species];
            var color = depthColor(p.z, CFG.COLORS.npc[fish.species % CFG.COLORS.npc.length]);
            if (p.z > 25) {
                // Far: single line
                var mid = fish.facingRight ? "><>" : "<><";
                drawString(buf, p.x - 1, p.y, mid, color);
            } else if (p.z > 15) {
                // Mid: 3-row sprite
                var lines = fish.facingRight ? sp.right : sp.left;
                drawMultiLine(buf, p.x, p.y, lines, color);
            } else {
                // Close: big 5-row sprite
                var lines = fish.facingRight ? sp.bigRight : sp.bigLeft;
                drawMultiLine(buf, p.x, p.y, lines, color);
            }
        }
    }

    // ========== BUBBLES ==========
    var bubbles = [];
    var chestPos = v3(4, -CFG.TANK_H / 2 + 0.5, 3);

    function spawnBubble() {
        if (bubbles.length >= CFG.MAX_BUBBLES) return;
        bubbles.push({
            pos: v3(
                chestPos.x + (Math.random() - 0.5) * 1.5,
                chestPos.y + 1,
                chestPos.z + (Math.random() - 0.5) * 1.5
            ),
            speed: 1.5 + Math.random() * 2,
            drift: (Math.random() - 0.5) * 0.5,
            size: Math.random()
        });
    }

    function updateBubbles(dt) {
        if (Math.random() < CFG.BUBBLE_SPAWN_RATE) spawnBubble();
        for (var i = bubbles.length - 1; i >= 0; i--) {
            var b = bubbles[i];
            b.pos.y += b.speed * dt;
            b.pos.x += b.drift * dt;
            b.pos.z += Math.sin(b.pos.y * 2) * 0.3 * dt;
            if (b.pos.y > CFG.TANK_H / 2) {
                bubbles.splice(i, 1);
            }
        }
    }

    function drawBubbles(buf) {
        for (var i = 0; i < bubbles.length; i++) {
            var b = bubbles[i];
            var p = projectToScreen(b.pos, buf);
            if (!p || p.z < 0.5) continue;
            var ch = b.size > 0.7 ? "O" : b.size > 0.3 ? "o" : ".";
            setCell(buf, p.x, p.y, ch, depthColor(p.z, CFG.COLORS.bubble));
        }
    }

    // ========== SEAWEED ==========
    var seaweeds = [];

    function initSeaweed() {
        seaweeds = [];
        var hw = CFG.TANK_W / 2 - 2;
        var hd = CFG.TANK_D / 2 - 2;
        for (var i = 0; i < CFG.SEAWEED_COUNT; i++) {
            seaweeds.push({
                baseX: (Math.random() - 0.5) * hw * 2,
                baseZ: (Math.random() - 0.5) * hd * 2,
                height: 3 + Math.floor(Math.random() * 3),
                phase: Math.random() * Math.PI * 2
            });
        }
    }

    function drawSeaweed(buf, time) {
        var floorY = -CFG.TANK_H / 2;
        var fronds = [
            ["()", ")(", "()", ")("],
            ["){", "({", "){", "({"],
            ["}/", "{\\", "}/", "{\\"]
        ];
        var frondsThin = [
            ["(", ")", "(", ")"],
            [")", "(", ")", "("],
            ["}", "{", "}", "{"]
        ];
        for (var i = 0; i < seaweeds.length; i++) {
            var sw = seaweeds[i];
            var patternWide = fronds[i % fronds.length];
            var patternThin = frondsThin[i % frondsThin.length];
            for (var j = 0; j < sw.height; j++) {
                var sway = Math.sin(time * 1.5 + sw.phase + j * 0.4) * 0.6;
                var pos = v3(sw.baseX + sway, floorY + j + 0.5, sw.baseZ);
                var p = projectToScreen(pos, buf);
                if (!p || p.z < 0.5) continue;
                var col = depthColor(p.z, CFG.COLORS.seaweed);
                var idx = (j + Math.floor(time * 1.5)) % patternWide.length;
                if (p.z > 15) {
                    // Far: single char
                    setCell(buf, p.x, p.y, patternThin[idx], col);
                } else {
                    // Close: 2-char wide
                    drawString(buf, p.x - 1, p.y, patternWide[idx], col);
                }
            }
        }
    }

    // ========== CHEST ==========
    var chestSprite = [
        " ___ ",
        "[___]",
        "|   |",
        "|___|"
    ];

    var chestSpriteMid = [
        "[_]",
        "|_|"
    ];

    function drawChest(buf) {
        var p = projectToScreen(chestPos, buf);
        if (!p || p.z < 0.5) return;
        var color = depthColor(p.z, CFG.COLORS.chest);
        if (p.z > 20) {
            // Far away: single char
            setCell(buf, p.x, p.y, "#", color);
            return;
        }
        if (p.z > 12) {
            // Mid distance: small chest
            drawMultiLine(buf, p.x, p.y, chestSpriteMid, color);
            return;
        }
        // Close: full sprite
        for (var row = 0; row < chestSprite.length; row++) {
            var line = chestSprite[row];
            var sx = p.x - Math.floor(line.length / 2);
            var sy = p.y - chestSprite.length + row + 1;
            for (var col = 0; col < line.length; col++) {
                if (line[col] !== " ") {
                    setCell(buf, sx + col, sy, line[col], color);
                }
            }
        }
    }

    // ========== HUD ==========
    function drawHUD(buf) {
        var hint = "WASD:swim  Space/Shift:up/down  Mouse:look  ESC:exit";
        if (hint.length > buf.w) hint = "WASD Space/Shift Mouse ESC:exit";
        var x = Math.floor((buf.w - hint.length) / 2);
        drawString(buf, x, buf.h - 1, hint, CFG.COLORS.hud);

        // Depth indicator
        var depthPct = ((player.pos.y + CFG.TANK_H / 2) / CFG.TANK_H * 100);
        var depthStr = "depth:" + Math.round(100 - depthPct) + "%";
        drawString(buf, buf.w - depthStr.length - 1, 0, depthStr, CFG.COLORS.hudHighlight);
    }

    // ========== INPUT ==========
    var keys = {};
    var isLocked = false;

    function onKeyDown(e) {
        var k = e.key.toLowerCase();
        // ESC is handled by pointer lock release → onPointerLockChange
        if (k === "escape") return;
        keys[k] = true;
        // Prevent page scrolling for game keys
        if (["w", "a", "s", "d", " ", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].indexOf(k) >= 0) {
            e.preventDefault();
        }
    }

    function onKeyUp(e) {
        keys[e.key.toLowerCase()] = false;
    }

    function onMouseMove(e) {
        if (!isLocked) return;
        camera.yaw += e.movementX * CFG.MOUSE_SENS;
        camera.pitch += e.movementY * CFG.MOUSE_SENS;
        // Clamp pitch
        camera.pitch = Math.max(-0.78, Math.min(0.78, camera.pitch));
    }

    function onPointerLockChange() {
        var wasLocked = isLocked;
        isLocked = (document.pointerLockElement === containerEl);
        // If pointer lock was released by the user (ESC), exit the game
        if (wasLocked && !isLocked && running) {
            stop();
            if (exitCallback) exitCallback();
        }
    }

    // ========== GAME LOOP ==========
    var running = false;
    var lastTime = 0;
    var gameTime = 0;
    var rafId = null;
    var buf = null;

    function tick(timestamp) {
        if (!running) return;
        rafId = requestAnimationFrame(tick);

        var dt = (timestamp - lastTime) / 1000;
        lastTime = timestamp;
        if (dt > 0.1) dt = 0.1; // cap delta
        gameTime += dt;

        updatePlayer(dt);
        updateCamera(player.pos, dt);
        updateNPCs(dt);
        updateBubbles(dt);

        clearBuffer(buf);
        drawTank(buf);
        drawSeaweed(buf, gameTime);
        drawChest(buf);
        drawBubbles(buf);
        drawNPCs(buf);
        drawPlayer(buf);
        drawHUD(buf);
        renderBufferToDOM(buf);
    }

    // ========== LIFECYCLE ==========
    var exitCallback = null;

    function calcBufferSize() {
        if (!containerEl) return { w: 80, h: 24 };
        var style = window.getComputedStyle(containerEl);
        var fontSize = parseFloat(style.fontSize) || 16;
        var charW = fontSize * 0.6;
        var charH = fontSize * 1.4;
        var w = Math.floor(containerEl.clientWidth / charW);
        var h = Math.floor(containerEl.clientHeight / charH);
        return { w: Math.max(40, w), h: Math.max(12, h) };
    }

    function start(container, onExit) {
        containerEl = container;
        exitCallback = onExit || null;

        preEl = document.createElement("pre");
        preEl.style.cssText = "margin:0;padding:0;font-family:monospace;font-size:16px;line-height:1.2;background:#000;color:#d0d0d0;overflow:hidden;width:100%;height:100%;cursor:crosshair;";
        containerEl.appendChild(preEl);

        var size = calcBufferSize();
        buf = createBuffer(size.w, size.h);

        initTankCorners();
        initPlayer();
        initNPCs();
        initSeaweed();
        bubbles = [];
        keys = {};
        camera.yaw = 0;
        camera.pitch = 0.2;
        camera.pos = v3(0, CFG.CAM_HEIGHT, -CFG.CAM_DIST);
        camera.targetPos = v3(0, CFG.CAM_HEIGHT, -CFG.CAM_DIST);
        gameTime = 0;
        isLocked = false;

        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("keyup", onKeyUp);
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("pointerlockchange", onPointerLockChange);

        running = true;
        lastTime = performance.now();
        rafId = requestAnimationFrame(tick);

        // Auto-request pointer lock
        setTimeout(function () {
            if (containerEl) containerEl.requestPointerLock();
        }, 100);
    }

    function stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;

        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("pointerlockchange", onPointerLockChange);

        if (document.pointerLockElement) {
            document.exitPointerLock();
        }

        if (preEl && preEl.parentNode) {
            preEl.parentNode.removeChild(preEl);
        }
        preEl = null;
        containerEl = null;
    }

    function exitGame() {
        // Release pointer lock — this triggers onPointerLockChange which calls stop + exitCallback
        if (document.pointerLockElement) {
            document.exitPointerLock();
        } else {
            stop();
            if (exitCallback) exitCallback();
        }
    }

    function handleResize() {
        if (!running || !containerEl) return;
        var size = calcBufferSize();
        buf = createBuffer(size.w, size.h);
    }

    // ========== EXPORT ==========
    window.FihGame = {
        start: start,
        stop: stop,
        handleResize: handleResize
    };
})();
