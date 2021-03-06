/* 
 * Client functions
 */

// Set game variables and listeners when client connects
PredatorsCore.prototype.clientConnect = function() {
    var $this = this;

    // Set up client data
    this.clientTime = new Date().getTime() - this.interpolationDelay;
    this.player = {
        x: 100,
        y: 100,
        xVelocity: 0,
        yVelocity: 0,
        isOnGround: false,
        keysDown: { right: false, left: false, up: false },
        canKill: false
    };

    // Set up view
    this.canvas       = $('#view')[0];
    this.ctx          = this.canvas.getContext('2d');

    // Connect to remote server
    var queryParams = this.getQueryParamsFromURL();
    this.serverUrl  = queryParams['url'];
    this.socket     = io(this.serverUrl);

    // Handle connection to game server
    this.socket.on('connected', function(msg) {
        $this.id      = msg.id;
        $this.players = msg.players;
        $this.coins   = msg.coins;
        $this.score   = 0;
        $this.name    = msg.name; // TODO change
        $this.powerupExpire = null;

        // Resize canvas to fit map
        $this.setMap(msg.map);
        $this.canvas.width  = $this.mapWidth * $this.scaleFactor;
        $this.canvas.height = $this.mapHeight * $this.scaleFactor;

        // Center the canvas
        $this.canvas.style.marginLeft  = 'auto'
        $this.canvas.style.marginRight = 'auto'

        // Begin game processing and drawing
        $this.clientUpdateLoop();
    });

    // Handle updates from the server
    this.socket.on('serverUpdate', function(msg) {
        $this.coins = msg.coins;
        $this.serverSnapshots.push(msg);
        $this.player.canKill = msg.canKill;
        $this.powerupExpire = msg.powerupExpire;
        $this.leaderboard   = msg.leaderboard;

        // Discard oldest server update
        if ($this.serverSnapshots.length > $this.bufferSize) {
            $this.serverSnapshots.shift();
        }

        // Update local position if different from server's record
        var thisPlayer = $this.findPlayer($this.id, msg.players);
        if (thisPlayer) {
            $this.score = thisPlayer.score;
            if (msg.isDead) {
                $this.player.x = thisPlayer.x;
                $this.player.y = thisPlayer.y;
                $this.player.xVelocity = thisPlayer.xVelocity;
                $this.player.yVelocity = thisPlayer.yVelocity;
            }
        }
    });

    // Handle keyboard input
    $(window).keydown(function(e) {
        var direction = $this.getDirectionFromKey(e.keyCode);
        if (direction) {
            $this.player.keysDown[direction] = true;
            $this.sendClientStateToServer();
        }
    });

    // Handle user releasing key -- no longer apply movement in that direciton
    $(window).keyup(function(e) {
        var direction = $this.getDirectionFromKey(e.keyCode);

        if (direction) {
            $this.player.keysDown[direction] = false;
            $this.sendClientStateToServer();
        }
    });

};

PredatorsCore.prototype.sendClientStateToServer = function() {
    this.socket.emit('clientStateUpdate', {
        id: this.id,
        localX: this.player.x,
        localY: this.player.y,
        localXVelocity: this.player.xVelocity,
        localYVelocity: this.player.xVelocity,
        keysDown: this.player.keysDown
    });
};

PredatorsCore.prototype.sendCoinCaughtEvent = function(coin) {
    this.socket.emit('coinCaughtEvent', {
        coin: coin,
        id: this.id,
        time: Date.now()
    });
};

PredatorsCore.prototype.sendPlayerCaughtEvent = function(victimId) {
    this.socket.emit('playerCaughtEvent', {
        victimId: victimId,
        id: this.id,
        time: Date.now(),
        interpolationDelay: this.interpolationDelay
    });
};

PredatorsCore.prototype.sendPowerupExpireEvent = function() {
    this.socket.emit('powerupExpireEvent', {
        id: this.id
    });
};

PredatorsCore.prototype.calculateXAfterOneTick = function(player) {
    // Handle left/right movement
    if (player.keysDown.right) player.xVelocity = 3;
    if (player.keysDown.left)  player.xVelocity = -3;

    player.xVelocity *= 0.9; // Smoothly decelerate

    return player.x + player.xVelocity;
}

PredatorsCore.prototype.calculateYAfterOneTick = function(player) {
    var prevX = player.x;
    var prevY = player.y;

    // Test if block below is filled or if this player is floating
    var rowBelow   = 1 + Math.floor(prevY / this.scaleFactor);
    var col        = Math.floor(prevX / this.scaleFactor);
    var blockBelow = this.map[rowBelow][col];
    if (blockBelow === 0) {
        player.isOnGround = false;
    }

    // Handle jumping
    if (player.isOnGround) {
        if (player.keysDown.up) {
            player.isOnGround = false;
            // TODO reinstate player.yVelocity = 10;
            player.yVelocity = 10;
        } else {
            player.yVelocity = 0;
        }
    } else {
        // Calculate the user's position in the next tick
        var tempYVelocity = player.yVelocity - 0.5;
        var scaleFactor   = player.scaleFactor || this.scaleFactor || 10;
        var playerRadius  = player.playerRadius || this.playerRadius || 5;

        var newRow = Math.floor((prevY - tempYVelocity) / scaleFactor);
        var newCol = Math.floor(prevX / scaleFactor);

        // If the user will be in the ground in the next tick, then bounce back up to the surface
        if (this.map[newRow][newCol] === 1) { 
            player.yVelocity = -1 * ((newRow * scaleFactor) - (prevY + playerRadius));
            player.isOnGround = true;
        } else { // User is still in the air
            player.yVelocity = tempYVelocity;
        }
    }

    return prevY - player.yVelocity;
}

// Calculate player's movement for one tick
PredatorsCore.prototype.updatePlayerPosition = function(player) {
    var x = this.calculateXAfterOneTick(player);
    var y = this.calculateYAfterOneTick(player);

    if (!this.isWithinBoundaries(x, y)) { // Hitting boundary, push back
        player.xVelocity *= -2;
        x = player.x + player.xVelocity;
    }

    if (this.isInWall(x, y)) {
        x = player.x;
    }

    player.x = x;
    player.y = y;
};

PredatorsCore.prototype.generateNewPlayer = function() {
    return {
        x: 100,
        y: 100,
        xVelocity: 0,
        yVelocity: 0,
        isOnGround: false,
        keysDown: { 'left': false, 'right': false, 'up': false, 'down': false }
    };
};

PredatorsCore.prototype.interpolateOtherPlayers = function() {
    // Find server positions to interpolate between
    var prevSnapshot = null;
    var nextSnapshot = null;

    this.clientTime = new Date().getTime() - this.interpolationDelay;

    for (var i = 0; i < this.serverSnapshots.length - 1; i++) {
        var a = this.serverSnapshots[i];
        var b = this.serverSnapshots[i + 1];
        
        if (a.time <= this.clientTime && this.clientTime <= b.time) {
            prevSnapshot = a;
            nextSnapshot = b;
            break;
        }
    }

    if (!prevSnapshot || !nextSnapshot) {
        return;
    }

    // Update this.players with interpolated positions
    // TODO This can probably be done better
    var players = [];
    var timePoint = 1 - ((nextSnapshot.time - this.clientTime) / (nextSnapshot.time - prevSnapshot.time));
    for (var i = 0; i < prevSnapshot.players.length; i++) {
        // Skip if current player
        if (prevSnapshot.players[i].id !== this.id) {
            var prevPosition = prevSnapshot.players[i];
            var nextPosition = nextSnapshot.players[i];
            var newPosition  = this.lerp(prevPosition, nextPosition, timePoint);

            players.push({
                x: newPosition.x,
                y: newPosition.y,
                id: prevSnapshot.players[i].id,
                keysDown: prevSnapshot.players[i].keysDown,
                canKill: prevSnapshot.players[i].canKill
            });
        }
    }
    this.players = players;
};

PredatorsCore.prototype.checkIfTouchingCoin = function(player) {
    if (!player.x || !player.y) return false;

    var playerPos = { x: player.x, y: player.y };
    for (var coin of this.coins) {
        if (this.distance(playerPos, coin.position) < 3*this.coinRadius) {
            this.removeCoin(coin);
            this.sendCoinCaughtEvent(coin);
        }
    }
};

PredatorsCore.prototype.checkIfTouchingOtherPlayer = function(player) {
    if (!player.x || !player.y) return false;
    if (!player.canKill) return false;

    var playerPos = { x: player.x, y: player.y };
    for (var other of this.players) {
        var otherPos = { x: other.x, y: other.y };
        if (this.distance(playerPos, otherPos) < 3*this.playerRadius) {
            this.sendPlayerCaughtEvent(other.id);
        }
    }
};

// Refresh all updates
PredatorsCore.prototype.clientUpdateLoop = function() {
    requestAnimationFrame(this.clientUpdateLoop.bind(this));

    if (this.powerupExpire && Date.now() > this.powerupExpire) {
        this.player.canKill = false;
        this.powerupExpire  = null;
        this.sendPowerupExpireEvent();
    }

    this.updatePlayerPosition(this.player);
    this.checkIfTouchingCoin(this.player);
    this.checkIfTouchingOtherPlayer(this.player);
    this.interpolateOtherPlayers();
    this.draw();
};
