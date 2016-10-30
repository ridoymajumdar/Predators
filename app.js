/*
 * PREDATORS
 * Online Multiplayer Game
 *
 * app.js
 *
 * AUTHORS
 * Ridoy Majumdar (https://github.com/ridoymajumdar)
 * Matthew Violet (https://github.com/mattviolet)
 * Jake Vollkommer (https://github.com/jakevollkommer)
 */

// Imports
var express = require('express'),
    app     = express(),
    request = require('request'),
    http    = require('http').Server(app),
    io      = require('socket.io')(http),
    uuid    = require('node-uuid'),
    path    = require('path'),
    config  = require('./config/config.js');
    core    = require('./public/core/predators.js');

// Server settings
// Adjust these to your preference in config/config.js
var port       = config.port;
    maxPlayers = config.maxPlayers; 

var game = new PredatorsCore();

app.use(express.static('public'));

http.listen(port, function() {
  console.log('Listening on ' + port)
})

// Multiplayer logic
io.on('connection', function(client) {

    // Generate unique ID for this client
    client.id = uuid.v1();

    game.players.push({
        id: client.id,
        x: 0,
        y: 0,
        keysDown: {}
    });

    console.log('New friend connected!\nPlayers online:\n' + game.players);

    // Send this player their id and a list of players
    client.emit('connected', {
        id: client.id,
        players: game.players
    });

    // Handle keysDown updates from this player
    client.on('clientStateUpdate', function(msg) {
        var player = game.findPlayer(msg.id);
        if (player) {
            player.keysDown = msg.keysDown;
        }
    });

    // Remove this player from game when disconnected
    client.on('disconnect', function() {
        for (var i = 0; i < game.players.length; i++) {
            if (game.players[i].id === client.id) {
                game.players.splice(i, 1);
                return;
            }
        }
    });

    function updateAllClients() {
        client.emit('serverUpdate', {
            players: game.players,
            time:    Date.now()
        });
    }

    // Send out server's record of positions every 45ms
    setInterval(updateAllClients, 45);
    // Update all player positions every 15ms
    setInterval(game.updatePlayerPositions, 15);
})

var postData = { 
    url: config.thisHost,
    name: config.serverName,
    playerCount: game.players.length, 
    maxPlayers: maxPlayers 
};

// Ping the main server.
// This allows your server to be listed on the list of all avaiable servers.
request.post(config.mainPredatorsHost + '/serverlist', { form: postData }, function(err, res, body) {
    if (err) { 
        console.log('There was an error reaching the server list on http://predators.io :(\n' + err);
        return;
    }
    console.log('Reached main server at http://predators.io/. Your server has been added to the main server list on http://predators.io.');
});


// After initial request to main server, the main server will periodically check on the server at this route.
// We send back the current number of players online.
app.get('/serverinfo', function(req, res) {
    res.send({ 
        playerCount: game.players.length,
    });
});
